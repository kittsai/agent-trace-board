# List Sessions 缓存设计

> v1.0 | 2026-07-27
> 父设计：[2026-07-26-agent-trace-viewer-design.md](./2026-07-26-agent-trace-viewer-design.md)

## 1. 目标与范围

**一句话目标：** 让 `GET /api/sessions`（列表）在轻量场景下不再每次重读所有 JSONL，靠内存缓存把"每次列表重读盘"压成"只 stat"。

**在范围内：**
- 列表路径的元数据缓存（mtime-keyed）
- `_check_status` 的 O(sessions × meta_files) → O(sessions + meta_files)
- 让现有 `_cache` 真正生效（解决 per-request 新实例问题）+ 加 LRU 上限
- watcher 失效与 mtime 失效的协同

**不在范围内（明确推迟）：**
- 实时 WS 路径的优化（`watcher.py` 的 `readlines()`、前端全量 `refreshTurns()`）
- `turn_id` bug 修复（`claude_code.py:419-426`）——与缓存无关
- REST 端点的阻塞 I/O 移出事件循环（`run_in_executor`）
- 前端 `memo` 化、`App.tsx` 拆分
- parser 去重、死代码清理、未用依赖移除

这些项各自独立，后续单独出设计。

## 2. 背景：当前为什么慢

### 2.1 `list_sessions` 每次重读所有 JSONL

`session_service.py:22-42` 的 `list_sessions` 对每个 JSONL 调 `_get_session_summary`，后者（`:168-211`）`open()` 文件、读前 200 行找 `ai-title` 和首尾时间戳。**每次列表调用都对所有 session 重读一遍**，无缓存。

### 2.2 `_check_status` 是 O(sessions × meta_files)

`_get_session_summary`（`:175`）对每条 session 调 `_check_status`，后者（`:213-224`）遍历 `~/.claude/sessions/*.json` 全部 meta 文件找 `sessionId` 匹配。N 条 session × M 个 meta 文件 = O(N×M) 次读盘，**每次列表调用都重来**。

### 2.3 关键：现有 `_cache` 对 REST 端点根本没生效

`SessionService.__init__`（`:17-20`）初始化 `self._cache = {}`。但 `api/sessions.py:20`、`api/traces.py:17/32/42` **每个 handler 都 `service = SessionService()`**——每次请求一个新实例，`_cache` 永远是空的。`_parse_cached`（`:161-166`）的缓存逻辑只在一个请求的生命周期内有效，等于没缓存。

只有 `main.py:21` 在 lifespan 里给 watcher 创建的实例有持久缓存，但那个实例不服务 REST 读请求。

**结论：要让任何缓存生效，必须先让所有 handler 和 watcher 共享同一个 `SessionService` 实例。这是本设计的前提。**

## 3. 设计

### 3.1 单例访问器（前提性改动）

在 `services/session_service.py` 增加模块级单例访问函数：

```python
_service: "SessionService | None" = None

def get_session_service() -> "SessionService":
    global _service
    if _service is None:
        _service = SessionService()
    return _service
```

改动点：
- `api/sessions.py:20`、`api/traces.py:17/32/42`：`SessionService()` → `get_session_service()`
- `main.py:21`：lifespan 里同样用 `get_session_service()`，watcher 拿到的就是单例

这样 watcher 的 `invalidate_cache` 调用（`session_service.py:143-145`）才真正影响后续 REST 请求看到的缓存。

### 3.2 `_meta_cache`：mtime-keyed 列表元数据缓存

新增实例属性：

```python
from collections import OrderedDict
import os

# 列表元数据缓存：file_path → (mtime, summary_dict)
self._meta_cache: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()
self._META_CAP = 1000  # 元数据条目小,上限可以宽松
```

`_get_session_summary`（`:168-211`）改写为先查 mtime：

```python
def _get_session_summary(self, jsonl_path: Path) -> Optional[dict]:
    try:
        mtime = os.stat(jsonl_path).st_mtime
    except OSError:
        return None

    cached = self._meta_cache.get(str(jsonl_path))
    if cached and cached[0] == mtime:
        # 命中:文件没变,返回浅拷贝避免调用方污染缓存
        self._meta_cache.move_to_end(str(jsonl_path))
        return dict(cached[1])

    # 未命中/变了:只重读这一个文件
    summary = self._read_summary_from_disk(jsonl_path)
    if summary is None:
        return None
    self._meta_cache[str(jsonl_path)] = (mtime, summary)
    if len(self._meta_cache) > self._META_CAP:
        self._meta_cache.popitem(last=False)  # LRU 淘汰
    return summary
```

其中 `_read_summary_from_disk` 是把现有 `_get_session_summary` 的 `open()` + 200 行扫描部分（`:178-197`）抽出来的纯读函数，逻辑不变。

**失效策略：mtime 比对**。JSONL 被 live agent 不断 append，mtime 会变 → 自动 miss → 下次重读。**这是正确性关键，不是优化**：朴素缓存会把旧 title/timestamp 当命中返回。

### 3.3 status 一次读全

`list_sessions`（`:22-42`）开头先建一次 `{sessionId: status}` map，传给 `_get_session_summary`：

```python
def list_sessions(self, search=None, status=None):
    sessions = []
    if not PROJECTS_DIR.exists():
        return sessions

    status_map = self._build_status_map()  # 一次扫 sessions/*.json

    for project_dir in PROJECTS_DIR.iterdir():
        if not project_dir.is_dir():
            continue
        for jsonl_file in project_dir.glob("*.jsonl"):
            session = self._get_session_summary(jsonl_file, status_map)
            ...
```

新增 `_build_status_map`（替代原 `_check_status` 的 per-session 扫描）：

```python
def _build_status_map(self) -> dict[str, str]:
    """一次扫描 sessions/*.json,返回 {sessionId: status}。"""
    if not SESSIONS_DIR.exists():
        return {}
    result = {}
    for meta_file in SESSIONS_DIR.glob("*.json"):
        try:
            meta = json.loads(meta_file.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        sid = meta.get("sessionId")
        if sid:
            result[sid] = "active" if meta.get("status") == "busy" else "completed"
    return result
```

`_get_session_summary` 改为接收 `status_map` 参数，从中直接查 `status_map.get(session_id, "completed")`。

复杂度：O(N + M) 一次，不再 O(N × M)。

**是否跨调用缓存 status_map？** 不做。`sessions/*.json` 在 agent 启停时变化频繁，mtime 失效要监听目录而非文件，复杂度收益不高。每次 list 调用扫一次 O(M) 已经足够便宜。留作后续优化。

### 3.4 `_cache` 加 LRU 上限

现有 `_cache`（`:20`，`Dict[str, dict]`）无上限。改用 `OrderedDict`，访问时 `move_to_end`，超限 `popitem(last=False)`：

```python
self._cache: "OrderedDict[str, dict]" = OrderedDict()
self._CACHE_CAP = 50  # 完整解析结果很重,上限严格
```

`_parse_cached`（`:161-166`）补 `move_to_end`，`get_steps`/`get_turns`/`get_stats`/`get_session` 这些命中 `_cache` 的路径不变（dict 语义一致）。

`invalidate_cache`（`:143-145`）逻辑不变，`pop(session_id, None)` 在 `OrderedDict` 上同样有效。

## 4. 数据流

### 4.1 `GET /api/sessions` 命中路径

```
handler → get_session_service() → list_sessions()
  → _build_status_map()              # O(M) 一次,扫 sessions/*.json
  → for each jsonl in projects/:
      → os.stat(path)                 # 便宜的系统调用
      → if mtime == cached: 命中      # 不读盘
      → else: _read_summary_from_disk  # 只重读这一个文件
  → 过滤/排序 → 返回
```

**典型命中场景（浏览历史 session）：** 所有 JSONL mtime 稳定 → 全命中 → 列表调用只做 N 次 `stat` + 1 次 `sessions/*.json` 扫描。

**未命中场景（live agent 正在 append 的 session）：** 那个文件的 mtime 在变 → miss → 重读前 200 行。其余 session 仍命中。可接受。

### 4.2 `GET /api/sessions/{id}/turns` 命中路径

```
handler → get_session_service() → get_turns(session_id)
  → _find_jsonl(session_id)           # 现状仍线性扫描,见 §6 备注
  → _parse_cached(path)
      → if session_id in _cache: 命中   # 现在真的能命中,因为单例
      → else: parser.parse_file(path)  # 冷启动一次
```

> **§6 备注：`_find_jsonl` 的线性扫描**（`session_service.py:149-159`）是详情路径的另一个性能点，但它与缓存无关，不在本设计范围内。单例改造后 `_cache` 命中能避免重复 `parse_file`，但 `_find_jsonl` 仍每次扫 `PROJECTS_DIR`。后续单独优化（如建 `session_id → file_path` 的反向索引）。

单例改造后，`_cache` 跨请求生效——第二个请求访问同一 session 直接命中。

## 5. 失效策略（两套，互不干扰）

| 缓存 | 失效方式 | 触发者 |
|------|---------|--------|
| `_cache`（完整解析） | 显式 `invalidate_cache(session_id)` | watcher（`watcher.py` 文件变化时调用） |
| `_meta_cache`（列表摘要） | mtime 比对自动失效 | 无需 watcher 介入 |

watcher 的 `invalidate_cache` 只清 `_cache`，不清 `_meta_cache`——后者靠 mtime 自管。**不修改 watcher**，避免侵入实时路径（§1 范围外）。

边界：watcher 监不到的变更（如外部直接改 JSONL），mtime 兜底。stat 是便宜的系统调用，每次 list 都查一次没有成本顾虑。

## 6. 并发说明

单例 + 同步方法 + async handler：
- 多个并发请求调 `list_sessions`，dict 操作在 GIL 下单条原子，无损坏。
- 冷缓存竞态：两个并发请求同时 miss 同一文件 → 都 parse → 都写 `_meta_cache[path]`，后写覆盖，值相同 → 浪费一次解析，**非正确性问题**。轻量场景可接受；若要消除可加 `asyncio.Lock`，本次不做。
- **阻塞 I/O 仍在事件循环上**（`open()` 在 `_read_summary_from_disk` 和 `parser.parse_file`）。缓存命中时无 I/O，本设计已显著降低阻塞面；剩余的"未命中时阻塞 loop"属 §1 范围外（`run_in_executor`），后续单独处理。

## 7. 错误处理

- `os.stat` 失败（文件被删）：`_get_session_summary` 返回 `None`，`list_sessions` 跳过（现有 `:33` 已处理）。
- `open()` 失败（权限/IO）：现有 `except OSError: return None`（`:196-197`）保留。
- 损坏的 JSONL 行：现有 `except json.JSONDecodeError: continue`（`:185-186`）保留，跳过坏行。
- 损坏的 `sessions/*.json`：`_build_status_map` 的 `except` 跳过该文件，对应 session 的 status 落到默认 `"completed"`。
- **缓存永远不会返回损坏数据**：mtime 比对保证文件没变才命中；文件变了必然 miss 重读。

## 8. 测试

轻量场景，不引入测试框架基建。最小验证：

**手动验证（必做）：**
1. 启动 `npm run dev`，`curl http://localhost:18080/api/sessions` 两次，第二次响应时间应显著下降（日志或 `time` 命令）。
2. 在 Python REPL 里 `get_session_service()` 两次取同一个实例，确认 `id()` 相同。
3. 修改一个 JSONL（`touch` 或 append 一行），再调 list，确认对应 session 的摘要更新（mtime 失效生效）。
4. watcher 触发 `invalidate_cache` 后，`_cache` 对应条目被清（REPL 检查 `_cache` 长度）。

**单元测试（可选 follow-up）：** pytest 不在本次范围；若加，重点测 `_get_session_summary` 的命中/失效分支和 `_build_status_map` 的去重。本次只做手动验证。

## 9. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 单例改动影响 watcher 行为 | watcher 已接收 `session_service` 参数（`main.py:22`），换成单例后语义一致；`invalidate_cache` 逻辑不变 |
| `_meta_cache` 内存膨胀 | LRU cap=1000，每条几百字节，上限 ~几百 KB |
| `_cache` 命中后数据过时 | mtime 失效 + watcher 显式失效双保险 |
| 并发冷缓存重复解析 | 可接受（§6），非正确性问题 |

**回滚：** 改动集中在 `session_service.py` + 3 个 api 文件的 `SessionService()` → `get_session_service()` 一行替换 + `main.py` 一行。`git revert` 单 commit 即可。

## 10. 落地清单

1. `services/session_service.py`：加 `get_session_service()` 单例；`_cache` 改 `OrderedDict` + LRU；新增 `_meta_cache` + `_get_session_summary` 改 mtime 路径；`_check_status` → `_build_status_map`。
2. `api/sessions.py`：2 处 `SessionService()` → `get_session_service()`。
3. `api/traces.py`：3 处 `SessionService()` → `get_session_service()`。
4. `main.py`：lifespan 用 `get_session_service()`。
5. 手动验证 §8 的四步。
