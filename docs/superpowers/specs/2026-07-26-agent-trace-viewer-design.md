# Agent Trace Viewer — 概要设计

> v1.0 | 2026-07-26

## 1. 产品概述

**一句话定位：** Coding Agent 的执行过程录像机。

Agent Trace Viewer (ATV) 是一个本地工具，用于实时监控和事后分析 Claude Code 等 Coding Agent 的执行过程。帮开发者理解 Agent 在做什么、为什么这么做、哪里可以优化。

**目标用户：**
- 用 Agent 写代码的开发者（看懂 Agent 的决策过程）
- 做 Agent 开发的团队（调试和优化自己的 Agent）

**部署方式：** 本地工具 + 本地 Web UI，数据不出本机。

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────┐
│                   前端 (React + TS)              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Session  │ │ Timeline │ │   Trace Detail   │ │
│  │  列表    │ │  时间线   │ │     详情面板     │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
└─────────────────────┬───────────────────────────┘
                      │ REST + WebSocket
┌─────────────────────┴───────────────────────────┐
│                  后端 (FastAPI)                   │
│  ┌──────────────────────────────────────────┐   │
│  │  API 层                                  │   │
│  │  GET /sessions  WS /ws/{session_id}      │   │
│  └────────────────────┬─────────────────────┘   │
│  ┌────────────────────┴─────────────────────┐   │
│  │  Service 层                              │   │
│  │  SessionService（只读） / Watcher        │   │
│  └────────────────────┬─────────────────────┘   │
│  ┌────────────────────┴─────────────────────┐   │
│  │  Parser 层                               │   │
│  │  ClaudeCodeParser（可扩展 Codex 等）       │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────┘
                      │ 只读
┌─────────────────────┴───────────────────────────┐
│         ~/.claude/（Claude Code 原始数据）         │
│    projects/<path>/<uuid>.jsonl                  │
│    sessions/<pid>.json                           │
└─────────────────────────────────────────────────┘
```

**关键设计决策：**
1. **纯只读** — 直接读 `~/.claude/` 目录，不复制、不导入、不修改数据。
2. **无数据库** — JSONL 就是数据源，按需解析，内存缓存。
3. **自动发现** — 启动时扫描 `~/.claude/projects/`，无需手动导入。
4. **实时监控** — watchfiles 监听文件变化，WebSocket 推送新 steps。

---

## 3. 数据模型

### 3.1 Claude Code JSONL 格式

每个 `.jsonl` 文件位于 `~/.claude/projects/<编码后的项目路径>/<session-uuid>.jsonl`。每行是一个 JSON 对象，通过 `type` 字段区分类型。

**Entry 类型：**

| type | 说明 | 关键字段 |
|------|------|----------|
| `assistant` | LLM 响应 | `message.content[]`（含 thinking/tool_use/text）、`message.usage`（token）、`message.model`、`message.stop_reason` |
| `user` | 用户输入 + 工具结果 | `message.content[]`（text/tool_result）、`toolUseResult`、`promptId` |
| `system` | Hook 事件 | `subtype`、`hookInfos` |
| `ai-title` | 自动生成的标题 | `aiTitle` |
| `attachment` | Hook 输出 / 技能列表 | `attachment.type`、`attachment.stdout` |
| `file-history-snapshot` | 文件修改快照 | `snapshot.trackedFileBackups` |
| `queue-operation` | 后台任务队列 | `operation`、`content` |
| `last-prompt` | 最新 prompt 书签 | `lastPrompt` |
| `mode` | 对话模式 | `mode`（normal/plan） |
| `permission-mode` | 权限模式 | `permissionMode` |

**对话树结构：**
- `uuid` / `parentUuid` 形成树状结构
- `promptId` 将同一轮用户输入触发的所有消息关联在一起（即一个 Turn）
- `isSidechain: true` 标记子代理线程
- `tool_use_id` 关联 tool_call 和 tool_result

**Turn 边界判断：**
- `promptId` 是 Turn 的唯一标识。当 `type == "user"` 且出现新的 `promptId` 时，新 Turn 开始
- 该 Turn 包含此 `promptId` 下的所有后续 `assistant` / `user` 消息
- 下一条不同 `promptId` 的 `user` 消息标志着下一个 Turn 的开始
- 解析时按 `promptId` 分组即可得到所有 Turn

**`assistant.message.content[]` 中的内容块：**
```json
{"type": "thinking", "thinking": "...", "signature": "..."}
{"type": "tool_use", "id": "call_xxx", "name": "Bash", "input": {...}}
{"type": "text", "text": "..."}
```

**`user.message.content[]` 中的内容块：**
```json
{"type": "text", "text": "..."}
{"type": "tool_result", "tool_use_id": "call_xxx", "content": "...", "is_error": false}
```

**Token 用量（每条 `assistant` 消息）：**
```json
{
  "input_tokens": 30414,
  "output_tokens": 210,
  "cache_read_input_tokens": 512,
  "cache_creation_input_tokens": 0
}
```

**Session 元数据** 位于 `~/.claude/sessions/<pid>.json`：
```json
{
  "pid": 23480,
  "sessionId": "9d864b3b-...",
  "cwd": "/Users/cosmic/Work/project/ai/agent-trace-viewer",
  "startedAt": 1785048946214,
  "version": "2.1.215",
  "status": "busy",
  "name": "agent-trace-viewer-ee"
}
```

### 3.2 统一 Trace 数据模型（SQLite）

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,                  -- session UUID（来自文件名）
    agent TEXT NOT NULL DEFAULT 'claude-code',
    project_path TEXT,                    -- 解码后的项目路径
    title TEXT,                           -- 来自 ai-title 或首条用户消息
    started_at INTEGER,                   -- Unix 毫秒
    finished_at INTEGER,
    status TEXT DEFAULT 'active',         -- 'active' | 'completed'
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_cache_read_tokens INTEGER DEFAULT 0,
    file_path TEXT NOT NULL,              -- 原始 JSONL 文件路径
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    turn_index INTEGER NOT NULL,
    user_message TEXT,                    -- 用户输入的文本
    started_at INTEGER,
    finished_at INTEGER,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0
);

CREATE TABLE steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    turn_id INTEGER REFERENCES turns(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,          -- 全局序号
    type TEXT NOT NULL,                   -- 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'system' | 'attachment'
    timestamp INTEGER,                    -- Unix 毫秒
    duration_ms INTEGER,                  -- 与下一步的时间差
    tool_name TEXT,                       -- 'Bash' | 'Read' | 'Edit' | 'Agent' | ...
    tool_input TEXT,                      -- JSON 字符串
    tool_output TEXT,                     -- 完整输出（最大 10KB，超出截断）
    tool_use_id TEXT,                     -- 关联 tool_call ↔ tool_result
    content TEXT,                         -- thinking/text 内容
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    raw_json TEXT                         -- 原始 JSON 行（调试用）
);

CREATE INDEX idx_steps_session ON steps(session_id);
CREATE INDEX idx_steps_turn ON steps(turn_id);
CREATE INDEX idx_steps_type ON steps(type);
CREATE INDEX idx_steps_tool ON steps(tool_name);
CREATE INDEX idx_turns_session ON turns(session_id);
```

### 3.3 映射：JSONL → 统一模型

| JSONL Entry | → 统一模型 |
|-------------|-----------|
| `assistant` 且 `content[].type == "thinking"` | `Step(type="thinking", content=thinking_text)` |
| `assistant` 且 `content[].type == "tool_use"` | `Step(type="tool_call", tool_name=name, tool_input=input_json, tool_use_id=id)` |
| `assistant` 且 `content[].type == "text"` | `Step(type="text", content=text)` |
| `user` 且 `content[].type == "tool_result"` | `Step(type="tool_result", tool_use_id=tool_use_id, tool_output=output)` |
| `user` 且 `content[].type == "text"` | `Turn.user_message`（不是 step） |
| `system` | `Step(type="system", content=raw_json)` |
| `attachment` | `Step(type="attachment", content=stdout)` |
| `ai-title` | `Session.title`（不是 step） |

**Token 分配策略：** `assistant.message.usage` 中的 token 归属于消息级别。从同一条 `assistant` 消息提取的所有 Step 共享相同的 token 计数。前端在消息级别展示 token，而非逐 step 展示。

**耗时计算：** `duration_ms` = `timestamp(下一步) - timestamp(当前步)`。Session 最后一步的 duration 为 null。

**工具输出截断：** `tool_output` 存储完整内容，最大 10KB。超出部分截断，添加 `[truncated, X bytes total]` 后缀。`raw_json` 字段始终保留完整的原始数据用于调试。

---

## 4. 后端设计

### 4.1 Parser 层

```python
# parsers/base.py
class BaseParser(ABC):
    @abstractmethod
    def parse_file(self, file_path: str) -> tuple[Session, list[Turn], list[Step]]:
        """离线解析完整 JSONL 文件。"""

    @abstractmethod
    def parse_line(self, line: str, context: ParseContext) -> list[Step]:
        """解析单行 JSONL（实时模式）。"""

# parsers/claude_code.py
class ClaudeCodeParser(BaseParser):
    def parse_file(self, file_path: str) -> tuple[Session, list[Turn], list[Step]]:
        """读取整个 JSONL，构建 Session + Turns + Steps。"""
        # 1. 读取所有行
        # 2. 提取 ai-title 作为 Session.title
        # 3. 按 promptId 分组为 Turn（每遇到新的 promptId 创建新 Turn）
        # 4. 遍历 assistant 消息，提取 content blocks → Steps
        # 5. 遍历 user 消息中的 tool_result → Steps
        # 6. 根据时间戳计算 duration_ms
        # 7. 汇总 token 用量

    def parse_line(self, line: str, context: ParseContext) -> list[Step]:
        """解析单行，返回新的 Steps。"""
        # 逻辑同 parse_file，但只处理单条 entry
        # context 持有累积状态（当前 turn、step_index 等）
```

### 4.2 Service 层

```python
# services/session_service.py
class SessionService:
    def list_sessions(self, filters) -> list[Session]: ...
    def get_session(self, id) -> Session: ...
    def import_session(self, file_path: str) -> Session: ...
    def scan_and_import(self) -> list[Session]: ...
    def delete_session(self, id) -> None: ...

# services/trace_service.py
class TraceService:
    def get_turns(self, session_id) -> list[Turn]: ...
    def get_steps(self, session_id, filters) -> list[Step]: ...
    def get_stats(self, session_id) -> Stats: ...

# services/watcher.py
class SessionWatcher:
    """监听活跃 JSONL 文件的变化，通过 WebSocket 推送新 Steps。"""

    def start(self):
        """开始监听 ~/.claude/sessions/ 中的活跃 session。"""
        # 1. 扫描 sessions 目录，找到 status=busy 的 session
        # 2. 为每个活跃 session 找到对应的 JSONL 文件
        # 3. 开始监听 JSONL 文件的新行
        # 4. 新行到来时：解析 → 存入 DB → 推送到 WebSocket

    def watch_session(self, session_id, file_path):
        """监听单个 JSONL 文件的新行。"""
        # 使用 watchfiles 监听文件变化
        # 记录文件位置（seek），只读取新内容
        # 解析新行并发送事件

    def stop(self):
        """停止所有监听。"""
```

### 4.3 API 层

```python
# api/sessions.py
@router.get("/api/sessions")
async def list_sessions(
    page: int = 1,
    size: int = 50,
    agent: str = None,
    status: str = None,
    search: str = None,
    sort: str = "-started_at",
): ...

@router.get("/api/sessions/{session_id}")
async def get_session(session_id: str): ...

@router.post("/api/sessions/import")
async def import_session(file_path: str): ...

@router.post("/api/sessions/scan")
async def scan_sessions(): ...

@router.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str): ...

# api/traces.py
@router.get("/api/sessions/{session_id}/turns")
async def get_turns(session_id: str): ...

@router.get("/api/sessions/{session_id}/steps")
async def get_steps(
    session_id: str,
    type: str = None,
    tool_name: str = None,
    search: str = None,
): ...

@router.get("/api/sessions/{session_id}/stats")
async def get_stats(session_id: str): ...

# api/ws.py
@router.websocket("/ws/sessions/{session_id}")
async def session_ws(websocket: WebSocket, session_id: str):
    """特定 session 的实时 step 推送。"""

@router.websocket("/ws/monitor")
async def monitor_ws(websocket: WebSocket):
    """全局监控：新 session 通知、活跃 session 列表。"""
```

### 4.4 Session 发现机制

```python
CLAUDE_DIR = Path.home() / ".claude"
PROJECTS_DIR = CLAUDE_DIR / "projects"
SESSIONS_DIR = CLAUDE_DIR / "sessions"

def discover_sessions() -> list[dict]:
    """扫描 ~/.claude/projects/ 发现所有 JSONL session 文件。"""
    sessions = []
    for project_dir in PROJECTS_DIR.iterdir():
        if not project_dir.is_dir():
            continue
        project_name = project_dir.name  # 例如 "-Users-cosmic-Work-project-xxx"
        for jsonl_file in project_dir.glob("*.jsonl"):
            session_id = jsonl_file.stem
            sessions.append({
                "id": session_id,
                "file_path": str(jsonl_file),
                "project": project_name,
            })
    return sessions

def get_active_sessions() -> list[dict]:
    """检查 ~/.claude/sessions/ 中 status=busy 的 session。"""
    active = []
    for meta_file in SESSIONS_DIR.glob("*.json"):
        meta = json.loads(meta_file.read_text())
        if meta.get("status") == "busy":
            active.append(meta)
    return active
```

---

## 5. 前端设计

### 5.1 页面

**Session 列表页（`/`）：**
- 表格展示所有 session（活跃 + 历史）
- 列：标题、Agent、开始时间、Token、状态
- 活跃 session 置顶 + 绿色指示灯
- 过滤：agent、status、搜索
- 操作：Scan、Import、Delete

**Trace 详情页（`/sessions/:id`）：**
- 左侧面板：垂直时间线，按 Turn 分组
- 右侧面板：选中 step 的详情
- Turn 组可折叠/展开
- Step 类型视觉区分（thinking=蓝色、tool_call=橙色、tool_result=绿色、text=灰色）
- 每个 step 显示 token 标签
- 实时模式：自动滚动到最新 step

### 5.2 组件

```
src/
├── pages/
│   ├── SessionList.tsx          # Session 列表页
│   └── TraceDetail.tsx          # Trace 详情页
├── components/
│   ├── layout/
│   │   └── Header.tsx           # 顶部导航
│   ├── session/
│   │   ├── SessionTable.tsx     # Session 表格
│   │   └── StatusBadge.tsx      # 状态标签
│   ├── trace/
│   │   ├── Timeline.tsx         # 垂直时间线
│   │   ├── TurnGroup.tsx        # Turn 折叠组
│   │   ├── StepItem.tsx         # 时间线中的 step 节点
│   │   ├── StepDetail.tsx       # 右侧详情面板
│   │   ├── ThinkingBlock.tsx    # thinking 内容
│   │   ├── ToolCallBlock.tsx    # tool 调用详情
│   │   ├── ToolResultBlock.tsx  # tool 结果
│   │   └── TextBlock.tsx        # 文本响应
│   └── common/
│       ├── TokenBadge.tsx       # token 用量标签
│       ├── DurationBadge.tsx    # 耗时标签
│       └── SearchInput.tsx      # 搜索框
├── hooks/
│   ├── useWebSocket.ts          # WebSocket 连接
│   ├── useSessions.ts           # Session 数据
│   └── useSteps.ts              # Step 数据
├── api/
│   └── client.ts                # API 客户端
├── types/
│   └── index.ts                 # TypeScript 类型定义
└── App.tsx
```

### 5.3 TypeScript 类型

```typescript
interface Session {
  id: string;
  agent: 'claude-code' | 'codex';
  project_path: string | null;
  title: string | null;
  started_at: number | null;
  finished_at: number | null;
  status: 'active' | 'completed';
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  file_path: string;
}

interface Turn {
  id: number;
  session_id: string;
  turn_index: number;
  user_message: string | null;
  started_at: number | null;
  finished_at: number | null;
  input_tokens: number;
  output_tokens: number;
  steps: Step[];
}

interface Step {
  id: number;
  session_id: string;
  turn_id: number | null;
  step_index: number;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'system' | 'attachment';
  timestamp: number | null;
  duration_ms: number | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  tool_use_id: string | null;
  content: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
}

interface Stats {
  total_steps: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_duration_ms: number;
  tool_counts: Record<string, number>;
  type_counts: Record<string, number>;
}
```

---

## 6. CLI 设计

```bash
# 启动服务（后端 + 前端静态资源）
atv serve [--port 8080] [--host 0.0.0.0]

# 导入指定 JSONL 文件
atv import <file-path>

# 扫描并导入 ~/.claude/projects/ 下的所有 session
atv scan

# 列出所有已导入的 session
atv list [--agent claude-code] [--status active]
```

---

## 7. 技术选型

| 层 | 技术 | 选型理由 |
|----|------|----------|
| 后端 | Python 3.9+ / FastAPI | 异步、高性能、与 Agent 生态一致 |
| 文件监听 | watchfiles | 跨平台、原生异步支持 |
| WebSocket | FastAPI WebSocket | 内置，无额外依赖 |
| 前端 | React 18 + TypeScript | 生态丰富，适合交互式 UI |
| 构建 | Vite | 快速开发服务器，开发体验好 |
| 样式 | TailwindCSS | 工具类优先，快速原型开发 |
| 状态管理 | React hooks + SWR | 轻量，无 Redux 开销 |

---

## 8. 实施计划

### 第一阶段：后端核心（第 1 周）
- Day 1：项目初始化、FastAPI 骨架、SQLite 建表
- Day 2：ClaudeCodeParser（parse_file + parse_line）
- Day 3：Session/Trace REST API
- Day 4：SessionWatcher（watchfiles + WebSocket）
- Day 5：CLI（atv serve / import / scan）

### 第二阶段：前端核心（第 2 周）
- Day 6：Vite + React 脚手架、类型定义、API 客户端
- Day 7：SessionList 页面
- Day 8-9：TraceDetail 页面（Timeline + StepDetail）
- Day 10：WebSocket 集成（实时更新）

### 第三阶段：打磨（第 3 周）
- Day 11：搜索和过滤
- Day 12：Token 统计面板
- Day 13：错误处理、边界情况
- Day 14：README、文档、测试

---

## 9. 范围

### MVP 范围内
- Claude Code JSONL 解析（只读）
- Session 列表（自动发现 ~/.claude/projects/）
- Trace 详情 + 时间线
- WebSocket 实时监控
- CLI 工具（serve / list）

### P1+ 范围外
- Codex 支持
- Diff 对比视图
- Session 回放（视频播放器式）
- 性能分析仪表盘
- 导出（JSON / Markdown）
- Prompt 库
- 成本计算
- 团队协作 / 云端同步

---

## 10. 设计决策

- **SQLite 存储位置：** `~/.atv/data.db`（全局）。一个 DB 管理所有项目，维护更简单。
- **前端服务方式：** 生产环境由 FastAPI 直接提供前端静态资源。开发环境使用 Vite 开发服务器（代理到 FastAPI）。
- **认证：** 无。纯本地工具，REST 和 WebSocket 均不需要认证。
