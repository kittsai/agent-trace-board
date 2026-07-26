# Agent Trace Viewer - Frontend

基于 React + TypeScript + Vite 的前端应用，提供直观的 UI 界面来查看和分析 Agent 执行过程。

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 技术栈

- **React 19** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **TailwindCSS** - 样式框架
- **shadcn/ui** - UI 组件库
- **lucide-react** - 图标库
- **react-markdown** - Markdown 渲染
- **react-syntax-highlighter** - 代码高亮
- **SWR** - 数据获取和缓存

## 项目结构

```
src/
├── App.tsx           # 主应用组件（三栏布局）
├── main.tsx          # 入口文件
├── types/            # TypeScript 类型定义
├── hooks/            # 自定义 Hooks
│   ├── useSessions.ts  # Session 数据获取
│   ├── useSteps.ts     # Turn/Step 数据获取
│   └── useWebSocket.ts # WebSocket 连接
├── api/              # API 客户端
├── components/       # UI 组件
│   └── ui/           # shadcn/ui 组件
└── lib/              # 工具函数
```

## 核心组件

### App.tsx
主应用组件，实现三栏布局：
- 左栏：Session 列表
- 中栏：Turn 列表
- 右栏：详情面板

支持：
- 双向联动（点击左栏跳转右侧，右侧滚动同步左栏高亮）
- IntersectionObserver 追踪当前可见 turn
- 智能自动滚动（用户在底部时自动滚动到最新内容）
