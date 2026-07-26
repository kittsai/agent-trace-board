# Agent Trace Board

Coding Agent 的执行过程追踪面板。

实时监控和事后分析 Claude Code 等 Coding Agent 的执行过程，帮开发者理解 Agent 在做什么、为什么这么做、哪里可以优化。

![Agent Trace Board](docs/images/screenshot.png)

## 功能特性

- **三栏布局** — Session 列表 → Turn 列表 → 详情面板
- **实时监控** — WebSocket 推送，自动发现新 session 和 turn
- **智能滚动** — 新内容添加时自动滚动到底部（用户向上浏览时不打断）
- **双向联动** — 左栏点击跳转右侧，右侧滚动同步左栏高亮
- **Turn 追踪** — IntersectionObserver 精确追踪当前可见 turn
- **丰富的 Step 展示** — 支持 thinking、tool_use、tool_result、text、image 等内容块
- **Markdown 渲染** — 支持代码高亮、GFM 语法
- **Diff 展示** — Edit 工具调用显示代码对比
- **图片预览** — 支持 base64 图片展示，点击可放大预览
- **Session 持久化** — 刷新页面保持选中状态，复制 Session ID 方便分享

## 环境要求

- **Python** >= 3.11
- **Node.js** >= 18
- **npm** >= 9

## 快速开始

```bash
# 1. 克隆项目
git clone <repo-url>
cd agent-trace-viewer

# 2. 安装后端依赖
cd backend
pip install -e .
cd ..

# 3. 安装前端依赖
cd frontend
npm install
cd ..

# 4. 启动（同时启动前端 + 后端）
npm run dev
```

打开 http://localhost:5173 查看。

## 命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 同时启动前端 + 后端（开发模式） |
| `npm run build` | 构建前端 |
| `npm run start` | 启动生产模式（仅后端，需先 build） |
| `npm run list` | 列出所有 session |

## 架构

```
前端 (React) ← REST/WebSocket → 后端 (FastAPI) → 直接读 ~/.claude/（只读）
```

- **无数据库** — 直接读取 Claude Code 的 JSONL 日志
- **自动发现** — 扫描 `~/.claude/projects/` 下所有 session
- **实时监控** — watchfiles 监听文件变化，WebSocket 推送

## 技术栈

- **后端**: Python 3.11+ / FastAPI / watchfiles
- **前端**: React 19 / TypeScript / Vite / TailwindCSS
- **UI 组件**: shadcn/ui + lucide-react + sonner

## UI 交互说明

### 左栏 - Session 列表
- 显示所有 session，支持搜索过滤
- 点击切换 session，右侧自动加载对应 turn

### 中栏 - Turn 列表
- 显示所有对话轮次的摘要信息
- 点击可跳转到右侧详情
- 新 turn 添加时自动滚动到底部

### 右栏 - 详情面板
- 显示完整的对话内容和工具调用
- 支持展开/折叠各类内容块（thinking、tool_use、tool_result）
- 图片内容可点击放大预览
- 自动滚动到底部（仅当用户已在底部时）
- 左侧列表会同步高亮当前可见的 turn

### 双向联动机制
- **点击中栏** → 右侧精确跳转到对应 turn
- **滚动右栏** → 中栏自动高亮当前可见 turn
- **防抖机制** → 避免快速连续滚动导致的抖动

## License

MIT
