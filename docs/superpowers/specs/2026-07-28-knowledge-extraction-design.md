# Knowledge Extraction Design

## 产品定位

Agent Trace Board 的知识提取模块，从 AI Agent 执行过程中提取有价值的、可管理的知识条目，供用户判断是否批准/拒绝，以及是否写入到 CLAUDE.md。

**核心价值：**
- 被动查看 AI 做了什么 → 主动提取 AI 学到的 patterns
- 执行过程记录 → 可复用的知识库

## 架构设计

### 分层架构

```
┌─────────────────────────────────────────────────────┐
│                   展示层 (React)                     │
│         Knowledge 页面 / 审批界面 / 同步弹窗          │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│               分析层 (AI Analysis)                    │
│   Claude Code CLI 分析执行过程 → 提取知识条目          │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│               解析层 (Parser) ← 现有                  │
│   ClaudeParser / CodexParser / ...                   │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│               数据源 (JSONL Logs)                    │
│   ~/.claude/projects/ / ~/.codex/ / ...             │
└─────────────────────────────────────────────────────┘
```

### 分析流程

```
定时任务 (每5分钟)
    │
    ▼
扫描未分析 session
    │
    ▼
准备结构化数据 (Parser 输出)
    │
    ▼
调用 Claude Code CLI 分析
    │
    ▼
提取知识条目
    │
    ▼
跨 session 去重合并
    │
    ▼
存储到数据库
    │
    ▼
用户审批/编辑
    │
    ▼
同步到 CLAUDE.md
```

## 数据模型

### knowledge_items 表

```sql
CREATE TABLE knowledge_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_path TEXT NOT NULL,              -- 项目路径 (聚合键)
    type VARCHAR(50) NOT NULL,               -- 知识类型
    content TEXT NOT NULL,                   -- 知识内容 (用于去重)
    title VARCHAR(200),                      -- 标题 (可选，用于展示)
    confidence FLOAT DEFAULT 0.5,            -- 置信度 0-1
    status VARCHAR(20) DEFAULT 'pending',    -- pending/approved/rejected
    source_sessions TEXT[],                  -- 来源 session ID 列表
    source_turns JSONB,                      -- 来源 turn 信息
    write_level VARCHAR(20) DEFAULT 'project', -- project/user
    is_modified BOOLEAN DEFAULT FALSE,       -- 用户是否修改过
    created_at TIMESTAMP DEFAULT NOW(),
    approved_at TIMESTAMP,
    synced_at TIMESTAMP,                     -- 同步到 CLAUDE.md 的时间
    synced_path TEXT                         -- 同步的文件路径
);

-- 索引
CREATE INDEX idx_knowledge_project ON knowledge_items(project_path);
CREATE INDEX idx_knowledge_status ON knowledge_items(status);
CREATE INDEX idx_knowledge_content_hash ON knowledge_items USING hash(content);
```

### analysis_jobs 表

```sql
CREATE TABLE analysis_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    project_path TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',    -- pending/running/completed/failed
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    cost_usd FLOAT,
    items_extracted INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## 知识类型

| 类型 | 说明 | 示例 |
|------|------|------|
| code_style | 代码规范 | 使用 kebab-case 命名文件 |
| architecture | 架构决策 | 使用 SWR 管理服务端状态 |
| tool_config | 工具配置 | shadcn 需要手动移动文件 |
| fix_pattern | 修复模式 | P95 缩放解决图表 outlier 问题 |
| preference | 用户偏好 | 注释使用中文 |

## 功能模块

### 1. 项目管理

**扫描新项目：**
- 扫描 `~/.claude/projects/` 目录
- 发现新项目后弹窗确认
- 添加后自动触发分析

**Projects 列表：**
- 显示项目路径
- 显示知识条目数、待审批数、已同步数
- 点击选中，右侧显示该项目的知识条目

### 2. 知识提取

**分析触发：**
- 定时任务：每 5 分钟扫描未分析 session
- 手动触发：用户点击"重新分析"
- 新 session 自动触发

**分析方式：**
```bash
claude --print \
  --output-format json \
  --system-prompt "分析执行过程，提取知识条目" \
  < session_data.json
```

**去重逻辑：**
- 相同 content 的条目合并
- 来源 session 列表合并
- 置信度随来源增加而提升

### 3. 知识管理

**列表展示：**
- 显示当前版本内容
- 显示置信度、来源 session 数
- 显示写入级别
- 已修改标记

**编辑功能：**
- 修改类型、标题、内容
- 调节置信度
- 选择写入级别
- 来源信息只读

**审批操作：**
- 批准：状态改为 approved
- 拒绝：状态改为 rejected
- 批量操作：批量批准/拒绝

### 4. 同步到 CLAUDE.md

**同步弹窗：**
- 显示待同步条目列表
- 为每个条目选择写入级别
- 显示统计：项目级/用户级数量

**写入逻辑：**
- 项目级：`.claude/CLAUDE.md`
- 用户级：`~/.claude/CLAUDE.md`
- 追加写入，不覆盖已有内容

**CLAUDE.md 格式：**
```markdown
## 项目规范（由 Agent Trace Board 自动提取）

### 代码规范
- 使用 kebab-case 命名文件

### 架构决策
- 使用 SWR 管理服务端状态
```

## 界面设计

### Knowledge 页面截图

![Knowledge Extraction Demo](../images/knowledge-extraction-demo.png)

### Knowledge 页面原型

```
┌─────────────────────────────────────────────────────────────┐
│  Agent Trace Board    [Sessions] [Knowledge]                │
├─────────────────────────────────────────────────────────────┤
│  Projects                    │  知识条目列表                  │
│  ────────                    │  ──────────                   │
│  📁 agent-trace-viewer       │  全部(12) 待审批(3) 已批准(9)  │
│     12条目 · 3待审批          │  筛选: [代码规范 ▾]           │
│  📁 my-web-app               │                              │
│     8条目 · 全部已同步        │  ☐ 使用 kebab-case 命名文件   │
│  📁 backend-api              │    代码规范 · 置信度92%        │
│     5条目 · 2待审批          │    来自3个session              │
│                              │    [编辑] [批准] [拒绝]        │
│  ───────────────             │                              │
│  最近分析的Sessions           │  ☑ 使用 SWR 管理服务端状态     │
│  · 修复登录 [已分析]          │    架构决策 · 已同步           │
│  · 重构图表 [已分析]          │    [编辑]                      │
│                              │                              │
│                              │  ────────────────────────     │
│                              │  总计12条目 · 9已批准 · 3待审批 │
│                              │  [同步到 CLAUDE.md]            │
└─────────────────────────────────────────────────────────────┘
```

### 同步弹窗

```
┌─────────────────────────────────────────┐
│  同步到 CLAUDE.md                    [×] │
│  选择要同步的条目和写入级别               │
├─────────────────────────────────────────┤
│  ☑ 使用 kebab-case 命名文件             │
│    写入到: [📁 项目级] [👤 用户级]       │
│    .claude/CLAUDE.md                    │
│                                         │
│  ☑ 注释使用中文                          │
│    写入到: [📁 项目级] [👤 用户级]       │
│    ~/.claude/CLAUDE.md                  │
├─────────────────────────────────────────┤
│  已选2个 · 1项目级 · 1用户级  [确认同步]  │
└─────────────────────────────────────────┘
```

## 技术实现

### 后端目录结构

```
backend/
├── services/
│   └── analyzer/
│       ├── __init__.py
│       ├── service.py          # AnalyzerService 主服务
│       ├── claude_code.py      # ClaudeCodeAnalyzer 分析器
│       ├── scheduler.py        # 定时任务调度
│       └── models.py           # 数据模型
```

### 核心代码

**ClaudeCodeAnalyzer:**
```python
class ClaudeCodeAnalyzer:
    def analyze_session(self, session_data: dict) -> list[KnowledgeItem]:
        # 1. 准备结构化数据
        prompt = self._build_prompt(session_data)

        # 2. 调用 Claude Code CLI
        result = subprocess.run(
            ["claude", "--print", "--output-format", "json",
             "--system-prompt", ANALYSIS_PROMPT, prompt],
            capture_output=True, text=True, timeout=300
        )

        # 3. 解析输出
        return self._parse_result(json.loads(result.stdout))
```

**去重合并:**
```python
def merge_knowledge_items(new_items: list, existing_items: list) -> list:
    merged = []
    for new_item in new_items:
        # 查找相似条目 (基于 content hash)
        similar = find_similar(new_item.content, existing_items)
        if similar:
            # 合并来源
            similar.source_sessions.extend(new_item.source_sessions)
            # 提升置信度
            similar.confidence = min(similar.confidence + 0.05, 0.99)
        else:
            merged.append(new_item)
    return merged
```

### 前端组件

```
frontend/src/
├── pages/
│   └── Knowledge.tsx           # Knowledge 页面
├── components/
│   ├── ProjectList.tsx         # 左侧项目列表
│   ├── KnowledgeList.tsx       # 右侧知识列表
│   ├── KnowledgeCard.tsx       # 知识条目卡片
│   ├── SyncModal.tsx           # 同步弹窗
│   ├── EditModal.tsx           # 编辑弹窗
│   └── SessionDetailModal.tsx  # Session 详情浮层
└── hooks/
    └── useKnowledge.ts         # 知识数据 hook
```

## 未来扩展

1. **多 Agent 支持** — 添加 Codex、Copilot 等解析器
2. **知识冲突检测** — 检测矛盾的条目
3. **知识关联** — 条目之间的关联关系
4. **版本历史** — 知识的编辑历史
5. **导入/导出** — 知识库的备份和恢复
6. **批量同步** — 一次同步多个项目
7. **统计面板** — 项目级统计图表
