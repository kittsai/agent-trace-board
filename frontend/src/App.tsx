import { useState, useCallback, useEffect, useRef, useMemo, memo, createContext, useContext, type ReactNode } from 'react';
import { useSessions } from './hooks/useSessions';
import { useTurns, useStats } from './hooks/useSteps';
import { useFileChanges, useFileChangeDiff } from './hooks/useFileHistory';
import { useTodos } from './hooks/useTodos';
import { useCost } from './hooks/useCost';
import { useSubagentTrace } from './hooks/useSubagentTrace';
import { useWebSocket } from './hooks/useWebSocket';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from '@/components/ui/sonner';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { toast } from 'sonner';
import {
  Bot, User, Brain, Zap, Check, Search, Copy, Image as ImageIcon,
  ChevronRight, ChevronDown, Terminal, FileText, FileEdit,
  FolderSearch, FileSearch, Globe, Loader2, MessageSquare, FileDiff, ListTodo, DollarSign, Archive, Network, X,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { diffLines } from 'diff';
import { Knowledge } from './pages/Knowledge';
import type { Session, Step, Turn, ContentBlock, WSEvent, FileChange, FileChangeDiff, TodoTask, CostAnalysis, CostPerTurn, CostPerTool } from './types';

const ImagePreviewContext = createContext<(src: string) => void>(() => {});
const SubagentJumpContext = createContext<(toolUseId: string) => void>(() => {});

function App() {
  const [selectedSession, setSelectedSession] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('session')
      || sessionStorage.getItem('lastSession')
  );
  const [selectedTurn, setSelectedTurn] = useState<Turn | null>(null);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('claude-code');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'conversation' | 'files' | 'todos' | 'cost'>('conversation');
  const [subagentDrawerToolUseId, setSubagentDrawerToolUseId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<'sessions' | 'knowledge'>('sessions');

  // 复制 session ID
  const copySessionId = useCallback(() => {
    if (!selectedSession) return;
    navigator.clipboard.writeText(selectedSession).then(() => {
      toast.success('Session ID 已复制');
    });
  }, [selectedSession]);

  const turnListRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const { sessions, refresh: refreshSessions } = useSessions({ search: search || undefined });
  const { turns, refresh: refreshTurns, loading: turnsLoading } = useTurns(selectedSession || undefined);
  const { stats } = useStats(selectedSession || undefined);

  // 获取当前选中的 session 信息
  const currentSession = sessions.find(s => s.id === selectedSession);

  // 检测元素是否在底部（允许一定误差）
  const isAtBottom = useCallback((el: HTMLDivElement | null) => {
    if (!el) return false;
    const threshold = 100; // 允许100px的误差
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // 自动滚动到底部（使用 scrollIntoView 确保滚动到最后一个 turn）
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      // 找到最后一个 turn 的元素
      const turnEls = detailRef.current?.querySelectorAll('[data-turn-id]');
      if (turnEls && turnEls.length > 0) {
        const lastTurnEl = turnEls[turnEls.length - 1];
        lastTurnEl.scrollIntoView({ behavior: 'auto', block: 'end' });
      }
    });
  }, []);

  // 滚动左栏 turn 列表到指定位置
  const scrollTurnListToTurn = useCallback((turnIndex: number) => {
    const el = turnListRef.current?.querySelector(`[data-turn-id="${turnIndex}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
  }, []);

  // 当前右栏中可见的 turn（IntersectionObserver 追踪）
  const [visibleTurnId, setVisibleTurnId] = useState<number | null>(null);
  const activeTurnId = visibleTurnId ?? selectedTurn?.turn_index ?? null;
  // 记录上次 turn 数量，用于检测新 turn
  const prevTurnCountRef = useRef(0);
  // 记录上次总 step 数量，用于检测新 step
  const prevStepCountRef = useRef(0);
  // 点击跳转时忽略 IntersectionObserver
  const clickingRef = useRef(false);
  // 防止滚动过程中的误触发
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用户点击的目标 turn，用于精确控制
  const clickedTurnRef = useRef<number | null>(null);

  const handleEvent = useCallback(
    (event: WSEvent) => {
      if (event.event === 'new_session' || event.event === 'session_status') {
        refreshSessions();
      } else if (event.event === 'step' && event.session_id === selectedSession) {
        refreshTurns();
      }
    },
    [selectedSession, refreshSessions, refreshTurns]
  );
  useWebSocket('/ws/monitor', handleEvent);

  // 当 turns 列表更新时，检测新 turn，自动滚到底部
  useEffect(() => {
    // 计算当前总 step 数
    const currentStepCount = turns.reduce((sum, turn) => sum + turn.steps.length, 0);

    if (turns.length > prevTurnCountRef.current || currentStepCount > prevStepCountRef.current) {
      // 记录是否在底部
      const wasAtBottom = isAtBottom(detailRef.current);

      // 总是滚动左栏到底部
      requestAnimationFrame(() => {
        if (turnListRef.current) {
          turnListRef.current.scrollTop = turnListRef.current.scrollHeight;
        }
      });

      // 右栏：延迟检测并滚动（等待 DOM 更新）
      setTimeout(() => {
        // 如果之前在底部，或者现在还在底部，则自动滚动
        if (wasAtBottom || isAtBottom(detailRef.current)) {
          scrollToBottom();
        }
      }, 50);
    }
    prevTurnCountRef.current = turns.length;
    prevStepCountRef.current = currentStepCount;
  }, [turns, scrollToBottom, isAtBottom]);

  // 点击 turn 时，直接跳转到对应位置
  const handleTurnClick = useCallback((turn: Turn) => {
    // 清除之前的防抖
    if (scrollDebounceRef.current) {
      clearTimeout(scrollDebounceRef.current);
    }

    clickingRef.current = true;
    clickedTurnRef.current = turn.turn_index;
    setSelectedTurn(turn);
    setVisibleTurnId(turn.turn_index);

    // 使用 scrollIntoView 精确跳转到用户消息
    requestAnimationFrame(() => {
      // 优先滚动到用户消息
      const messageEl = detailRef.current?.querySelector(`[data-turn-message="${turn.turn_index}"]`);
      if (messageEl) {
        messageEl.scrollIntoView({ behavior: 'auto', block: 'start' });
      } else {
        // 如果没有用户消息，滚动到 turn 顶部
        const el = detailRef.current?.querySelector(`[data-turn-id="${turn.turn_index}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
      }
    });

    // 使用防抖延迟重置，等待滚动稳定
    scrollDebounceRef.current = setTimeout(() => {
      clickingRef.current = false;
      clickedTurnRef.current = null;
    }, 300);
  }, []);

  // turn 可见性回调 — 必须稳定(useCallback),否则 TurnDetailBlock 的 memo 失效,
  // 右栏所有 turn 会在每次点击时全部重渲染(切换卡顿的根因)
  const handleTurnVisible = useCallback((turnIndex: number, visible: boolean) => {
    if (visible && !clickingRef.current) {
      setVisibleTurnId(turnIndex);
    }
  }, []);

  // 对话里 Agent tool_use → 弹出子 agent trace drawer
  const handleOpenSubagent = useCallback((toolUseId: string) => {
    setSubagentDrawerToolUseId(toolUseId);
  }, []);

  // 当前可见 turn 变化时，瞬间跳转左栏使其可见（点击跳转时跳过）
  useEffect(() => {
    if (clickingRef.current) return;
    if (!activeTurnId || !turnListRef.current) return;
    const el = turnListRef.current.querySelector(`[data-turn-id="${activeTurnId}"]`);
    if (el) {
      // 使用 scrollIntoView 并指定 block: 'nearest' 确保平滑跳转
      // 添加一个小延迟避免快速连续滚动
      const timer = setTimeout(() => {
        el.scrollIntoView({ behavior: 'auto', block: 'nearest' });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [activeTurnId]);

  // 切换 session 时重置
  useEffect(() => {
    // 记住选中的 session
    if (selectedSession) {
      sessionStorage.setItem('lastSession', selectedSession);
    } else {
      sessionStorage.removeItem('lastSession');
    }
    setSelectedTurn(null);
    setVisibleTurnId(null);
    prevTurnCountRef.current = 0;
    clickedTurnRef.current = null;
    // 清除防抖
    if (scrollDebounceRef.current) {
      clearTimeout(scrollDebounceRef.current);
    }
  }, [selectedSession]);

  // 当 turns 加载完成后，自动选中最新的一条（如果没有手动选择）
  useEffect(() => {
    if (turns.length > 0 && selectedTurn === null && !clickingRef.current) {
      const latestTurn = turns[turns.length - 1];
      setSelectedTurn(latestTurn);
      setVisibleTurnId(latestTurn.turn_index);

      // 滚动到最新 turn 的用户消息
      requestAnimationFrame(() => {
        // 优先滚动到用户消息
        const messageEl = detailRef.current?.querySelector(`[data-turn-message="${latestTurn.turn_index}"]`);
        if (messageEl) {
          messageEl.scrollIntoView({ behavior: 'auto', block: 'start' });
        } else {
          // 如果没有用户消息，滚动到 turn 顶部
          const el = detailRef.current?.querySelector(`[data-turn-id="${latestTurn.turn_index}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'auto', block: 'start' });
          }
        }
      });
    }
  }, [turns, selectedTurn]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
    };
  }, []);

  // Escape 键关闭图片预览
  useEffect(() => {
    if (!previewImage) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewImage(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewImage]);

  const formatTime = useCallback((ms: number | null) => {
    if (!ms) return '-';
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }, []);

  const formatDuration = useCallback((ms: number | null) => {
    if (!ms) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }, []);

  return (
    <ImagePreviewContext.Provider value={setPreviewImage}>
    <SubagentJumpContext.Provider value={handleOpenSubagent}>
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      {/* 左栏：Session 列表 */}
      <div className="w-64 flex-shrink-0 border-r flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="Logo" className="w-7 h-7" />
            <span className="font-bold text-sm">Agent Trace Board</span>
            <nav className="flex gap-1 ml-2">
              <button className={`px-2 py-1 text-xs rounded ${currentPage === 'sessions' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`} onClick={() => setCurrentPage('sessions')}>Sessions</button>
              <button className={`px-2 py-1 text-xs rounded ${currentPage === 'knowledge' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`} onClick={() => setCurrentPage('knowledge')}>Knowledge</button>
            </nav>
          </div>
        </div>
        <div className="p-2 border-b space-y-1.5">
          <h2 className="text-xs font-semibold">Sessions</h2>
          <select
            value={platform}
            onChange={(e) => { setPlatform(e.target.value); setSelectedSession(null); }}
            className="flex h-7 w-full rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="claude-code">Claude Code</option>
          </select>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              placeholder="搜索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 pl-6 text-xs"
            />
          </div>
        </div>
        <ScrollArea className="flex-1 [&>[data-slot=scroll-area-scrollbar]]:hidden">
          <div className="p-1">
            {sessions.length === 0 ? (
              <div className="text-center text-muted-foreground text-[11px] py-6">没有 session</div>
            ) : (
              sessions.map((s: Session) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSession(s.id)}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors ${
                    selectedSession === s.id
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      s.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'
                    }`} />
                    <span className="font-medium truncate">{s.title || s.id.slice(0, 8) + '...'}</span>
                  </div>
                  <div className="text-muted-foreground ml-3 text-[10px]">
                    {s.project_path?.split('/').pop()} · {formatTime(s.started_at)}
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* 右栏 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {currentPage === 'knowledge' ? (
          <Knowledge />
        ) : !selectedSession ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            选择 session 查看执行过程
          </div>
        ) : (
          <>
            {/* 共享顶部栏 */}
            {currentSession && (
              <div className="border-b bg-muted/30 px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    currentSession.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'
                  }`} />
                  <span className="font-medium text-xs truncate">
                    {currentSession.title || currentSession.id.slice(0, 8) + '...'}
                  </span>
                  <span className="text-muted-foreground text-[10px] ml-2">
                    {currentSession.project_path?.split('/').pop()}
                  </span>
                </div>
                {stats && (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 ml-3.5">
                    <span>{stats.total_turns} 轮对话</span>
                    <span>{stats.total_steps} 步</span>
                    <span>{((stats.total_input_tokens + stats.total_output_tokens) / 1000).toFixed(1)}k tokens</span>
                    <button
                      onClick={copySessionId}
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      <span className="text-[10px]">复制 sessionId</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Tab 切换 */}
            <div className="border-b px-3 py-1.5 flex items-center gap-1 bg-muted/20">
              <TabButton
                active={detailTab === 'conversation'}
                onClick={() => setDetailTab('conversation')}
                icon={<MessageSquare className="w-3.5 h-3.5" />}
                label="对话"
              />
              <TabButton
                active={detailTab === 'files'}
                onClick={() => setDetailTab('files')}
                icon={<FileDiff className="w-3.5 h-3.5" />}
                label="文件变更"
              />
              <TabButton
                active={detailTab === 'todos'}
                onClick={() => setDetailTab('todos')}
                icon={<ListTodo className="w-3.5 h-3.5" />}
                label="任务"
              />
              <TabButton
                active={detailTab === 'cost'}
                onClick={() => setDetailTab('cost')}
                icon={<DollarSign className="w-3.5 h-3.5" />}
                label="成本"
              />
            </div>

            <div className="flex-1 flex overflow-hidden">
            {detailTab === 'conversation' ? (
            <>
            {/* 中栏：Turn 列表 */}
            <div className="w-[380px] flex-shrink-0 border-r flex flex-col overflow-hidden">

              {/* Turn 列表 */}
              <div ref={turnListRef} className="flex-1 overflow-auto [&::-webkit-scrollbar]:hidden">
                <div className="p-2 space-y-1.5">
                  {turns.length === 0 ? (
                    <div className="text-center text-muted-foreground text-xs py-8">没有数据</div>
                  ) : (
                    turns.map((turn: Turn) => (
                      <TurnRow
                        key={turn.turn_index}
                        turn={turn}
                        isSelected={selectedTurn?.turn_index === turn.turn_index}
                        isActive={activeTurnId === turn.turn_index}
                        onClick={() => handleTurnClick(turn)}
                        formatTime={formatTime}
                        formatDuration={formatDuration}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* 右栏：所有 Turn 完整对话 */}
            <div ref={detailRef} className="flex-1 overflow-auto">
              <div className="p-5 pb-20 space-y-6">
                {turns.length === 0 ? (
                  <div className="text-center text-muted-foreground text-sm mt-20 flex flex-col items-center gap-2">
                    {selectedSession && turnsLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : null}
                    {selectedSession ? '加载中...' : '选择左侧对话查看详情'}
                  </div>
                ) : (
                  turns.map((turn: Turn) => (
                    <TurnDetailBlock
                      key={turn.turn_index}
                      turn={turn}
                      formatTime={formatTime}
                      onVisible={handleTurnVisible}
                    />
                  ))
                )}
              </div>
            </div>
            </>
            ) : detailTab === 'files' ? (
              <FileChangesView
                sessionId={selectedSession}
                formatTime={formatTime}
              />
            ) : detailTab === 'todos' ? (
              <TodosView
                sessionId={selectedSession}
                formatTime={formatTime}
              />
            ) : (
              <CostView sessionId={selectedSession} />
            )}
            </div>
          </>
        )}
      </div>
      <Toaster />

      {/* 图片预览弹窗 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={previewImage}
            alt="preview"
            className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {subagentDrawerToolUseId && selectedSession && (
        <SubagentDrawer
          sessionId={selectedSession}
          toolUseId={subagentDrawerToolUseId}
          formatTime={formatTime}
          onClose={() => setSubagentDrawerToolUseId(null)}
        />
      )}
    </div>
    </SubagentJumpContext.Provider>
    </ImagePreviewContext.Provider>
  );
}

// ── Turn 行 ──

const TOOL_TAG_COLORS: Record<string, string> = {
  Bash: 'bg-green-100 text-green-700',
  Read: 'bg-blue-100 text-blue-700',
  Write: 'bg-orange-100 text-orange-700',
  Edit: 'bg-orange-100 text-orange-700',
  Glob: 'bg-purple-100 text-purple-700',
  Grep: 'bg-purple-100 text-purple-700',
  Agent: 'bg-cyan-100 text-cyan-700',
  WebFetch: 'bg-teal-100 text-teal-700',
  WebSearch: 'bg-teal-100 text-teal-700',
  TaskCreate: 'bg-amber-100 text-amber-700',
  TaskUpdate: 'bg-amber-100 text-amber-700',
};

const TurnRow = memo(function TurnRow({
  turn,
  isSelected,
  isActive,
  onClick,
  formatTime,
  formatDuration,
}: {
  turn: Turn;
  isSelected: boolean;
  isActive: boolean;
  onClick: () => void;
  formatTime: (ms: number | null) => string;
  formatDuration: (ms: number | null) => string;
}) {
  const userMsg = turn.user_message || '(无用户消息)';
  const stepCount = turn.steps.length;
  const duration = turn.finished_at && turn.started_at
    ? turn.finished_at - turn.started_at
    : null;

  // 统计 tool 使用情况 - memoize
  const { toolCounts, topTools } = useMemo(() => {
    const counts: Record<string, number> = {};
    turn.steps.forEach((s) => {
      if (s.tool_name) counts[s.tool_name] = (counts[s.tool_name] || 0) + 1;
    });
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    return { toolCounts: counts, topTools: top };
  }, [turn.steps]);

  return (
    <button
      data-turn-id={turn.turn_index}
      onClick={onClick}
      className={`group w-full text-left px-3 py-2 rounded-lg transition-all duration-150 bg-transparent ${
        isActive
          ? 'bg-primary/10 ring-1 ring-primary/20 shadow-sm'
          : 'hover:bg-muted/40 hover:shadow-sm'
      }`}
    >
      {/* 轮次号 + 时间 */}
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
          isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        }`}>
          #{turn.turn_index + 1}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {formatTime(turn.started_at)}
        </span>
        {duration != null && (
          <span className="text-[10px] text-muted-foreground ml-auto">{formatDuration(duration)}</span>
        )}
      </div>

      {/* 用户消息 */}
      <p className={`text-xs leading-relaxed line-clamp-2 mb-1.5 ${
        isSelected ? 'text-foreground' : 'text-foreground/90 group-hover:text-foreground'
      }`}>
        {userMsg}
      </p>

      {/* 底部：步数 + 工具 */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">{stepCount} 步</span>
        {topTools.length > 0 && (
          <>
            <span className="text-[10px] text-muted-foreground/50">·</span>
            <div className="flex flex-wrap gap-1">
              {topTools.map(([name, count]) => (
                <span key={name} className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${TOOL_TAG_COLORS[name] || 'bg-muted text-muted-foreground'}`}>
                  {name}{count > 1 ? `×${count}` : ''}
                </span>
              ))}
              {Object.keys(toolCounts).length > 3 && (
                <span className="text-[10px] text-muted-foreground/50">+{Object.keys(toolCounts).length - 3}</span>
              )}
            </div>
          </>
        )}
      </div>
    </button>
  );
});

// ── Turn 包装（带 IntersectionObserver） ──

const TurnDetailBlock = memo(function TurnDetailBlock({
  turn,
  formatTime,
  onVisible,
}: {
  turn: Turn;
  formatTime: (ms: number | null) => string;
  onVisible: (turnIndex: number, visible: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 使用 ref 存储最新的 onVisible 回调，避免 useEffect 依赖变化
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 使用更精确的 rootMargin，只追踪进入视口的 turn
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onVisibleRef.current(turn.turn_index, true);
        }
      },
      { rootMargin: '-20% 0px -20% 0px', threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);  // 空依赖，因为 onVisibleRef 已经是最新的

  return (
    <div ref={ref} data-turn-id={turn.turn_index} className="scroll-mt-16">
      <TurnDetail turn={turn} formatTime={formatTime} />
    </div>
  );
});

// ── Turn 完整对话详情 ──

function TurnDetail({ turn, formatTime }: { turn: Turn; formatTime: (ms: number | null) => string }) {
  return (
    <div className="space-y-4">
      {/* Turn 头部信息 */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">
          <User className="w-3 h-3 mr-1" /> Turn #{turn.turn_index + 1}
        </Badge>
        <span>{formatTime(turn.started_at)}</span>
        {turn.input_tokens > 0 && <span>输入: {turn.input_tokens.toLocaleString()}</span>}
        {turn.output_tokens > 0 && <span>输出: {turn.output_tokens.toLocaleString()}</span>}
      </div>

      {/* 用户消息 */}
      {turn.user_message && (() => {
        // 找到第一个 user step，渲染其 content_blocks（含图片）
        const userStep = turn.steps.find(s => s.role === 'user' || s.type === 'user');
        // 过滤掉 text 块（已由 turn.user_message 展示），只保留图片等
        const userBlocks = (userStep?.content_blocks || []).filter(b => b.type !== 'text');
        return (
          <div data-turn-message={turn.turn_index} className="scroll-mt-16 border-l-2 border-l-green-400 pl-3 py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <User className="w-3.5 h-3.5 text-green-600" />
              <span className="text-xs font-medium">User</span>
            </div>
            <div className="text-sm whitespace-pre-wrap">{turn.user_message}</div>
            {userBlocks.length > 0 && (
              <div className="mt-2 space-y-2">
                {userBlocks.map((block, i) => (
                  <ContentBlockDetail key={i} block={block} />
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* 所有 Steps */}
      <div className="space-y-3">
        {turn.steps.map((step) => (
          <StepBlock key={step.id} step={step} formatTime={formatTime} />
        ))}
      </div>
    </div>
  );
}

// ── 系统事件解析 ──

interface SystemEventInfo {
  label: string;
  element: ReactNode;
}

function parseSystemEvent(content: string | null): SystemEventInfo | null {
  if (!content) return null;
  try {
    const data = JSON.parse(content);
    if (data.type !== 'system') return null;

    if (data.subtype === 'stop_hook_summary') {
      const hooks = data.hookInfos || [];
      const errors = data.hookErrors || [];
      // 计算所有 hooks 的总耗时
      const totalDurationMs = hooks.reduce((sum: number, h: Record<string, unknown>) => {
        return sum + (typeof h.durationMs === 'number' ? h.durationMs : 0);
      }, 0);
      return {
        label: 'hook summary',
        element: (
          <div className="text-xs text-muted-foreground space-y-1">
            <div>执行了 {data.hookCount || hooks.length} 个 hooks，耗时 {formatDurationStatic(totalDurationMs > 0 ? totalDurationMs : null)}</div>
            {hooks.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {hooks.map((h: Record<string, unknown>, i: number) => (
                  <span key={i} className="bg-muted px-1.5 py-0.5 rounded font-mono text-[10px]">
                    {String(h.command || '').split('/').pop()}
                    {h.durationMs != null && <span className="text-muted-foreground ml-1">({formatDurationStatic(h.durationMs as number | null)})</span>}
                  </span>
                ))}
              </div>
            )}
            {errors.length > 0 && (
              <div className="text-destructive">{errors.length} 个 hook 出错</div>
            )}
          </div>
        ),
      };
    }

    if (data.subtype === 'turn_duration') {
      return {
        label: 'turn stats',
        element: (
          <div className="text-xs text-muted-foreground flex gap-3">
            <span>耗时 {formatDurationStatic(data.durationMs)}</span>
            <span>{data.messageCount} 条消息</span>
          </div>
        ),
      };
    }

    // 其他系统事件
    return {
      label: data.subtype || 'system',
      element: (
        <pre className="text-[10px] text-muted-foreground bg-muted p-2 rounded font-mono overflow-auto max-h-24">
          {JSON.stringify(data, null, 2)}
        </pre>
      ),
    };
  } catch {
    return null;
  }
}

function formatDurationStatic(ms: number | null): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// ── 单个 Step 块（用于 Turn 详情内）──

function StepBlock({ step, formatTime }: { step: Step; formatTime: (ms: number | null) => string }) {
  const role = step.role || step.type;
  const blocks = step.content_blocks || [];

  // 压缩摘要:上下文压缩产物,渲染为分隔标记而非普通 step
  if (step.type === 'compact') {
    return (
      <div className="border border-dashed border-amber-300 bg-amber-50/40 rounded-md pl-3 pr-2 py-1.5 my-2">
        <div className="flex items-center gap-1.5">
          <Archive className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-xs font-medium text-amber-800">压缩摘要</span>
          <span className="text-[10px] text-muted-foreground/60 ml-1">上下文已压缩,前序对话被摘要</span>
          <span className="text-[10px] text-muted-foreground font-mono ml-auto">
            {formatTime(step.timestamp)}
          </span>
        </div>
        <Collapsible
          summary={<span className="text-[10px] text-muted-foreground hover:text-foreground">查看摘要内容</span>}
        >
          <pre className="bg-muted/50 p-2 rounded text-[11px] whitespace-pre-wrap overflow-auto max-h-48 font-mono mt-1">
            {step.content}
          </pre>
        </Collapsible>
      </div>
    );
  }

  const isUser = role === 'user';

  // user 消息已在 TurnDetail 顶部展示，跳过
  if (isUser) return null;

  // 检查是否为系统元数据事件
  const systemEvent = parseSystemEvent(step.content);

  return (
    <div className="border-l-2 border-l-blue-400 pl-3 py-1">
      <div className="flex items-center gap-1.5 mb-1">
        <Bot className="w-3.5 h-3.5 text-blue-600" />
        <span className="text-xs font-medium">Assistant</span>
        {step.model && <Badge variant="outline" className="text-[10px] h-4">{step.model}</Badge>}
        {step.tool_name && <Badge variant="outline" className="text-[10px] h-4">{step.tool_name}</Badge>}
        {systemEvent && <Badge variant="secondary" className="text-[10px] h-4">{systemEvent.label}</Badge>}
        <span className="text-[10px] text-muted-foreground font-mono ml-auto">
          {formatTime(step.timestamp)}
        </span>
      </div>

      <div className="space-y-2">
        {blocks.map((block: ContentBlock, i: number) => (
          <ContentBlockDetail key={i} block={block} />
        ))}
      </div>

      {/* 系统事件渲染 */}
      {systemEvent && (
        <div className="mt-1">
          {systemEvent.element}
        </div>
      )}

      {/* 普通空内容 */}
      {!systemEvent && blocks.length === 0 && step.content && (
        <pre className="bg-muted p-3 rounded-md text-xs whitespace-pre-wrap overflow-auto max-h-96 font-mono">
          {step.content}
        </pre>
      )}
    </div>
  );
}

// ── 折叠组件 ──

function Collapsible({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={className}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {summary}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}


// ── Tool Use 块 ──

const TOOL_STYLES: Record<string, { border: string; icon: ReactNode; lang: string }> = {
  Bash: { border: 'border-l-green-500', icon: <Terminal className="w-3.5 h-3.5 text-green-500" />, lang: 'bash' },
  Read: { border: 'border-l-blue-500', icon: <FileText className="w-3.5 h-3.5 text-blue-500" />, lang: 'text' },
  Write: { border: 'border-l-orange-500', icon: <FileEdit className="w-3.5 h-3.5 text-orange-500" />, lang: 'text' },
  Edit: { border: 'border-l-orange-500', icon: <FileEdit className="w-3.5 h-3.5 text-orange-500" />, lang: 'diff' },
  Glob: { border: 'border-l-purple-500', icon: <FolderSearch className="w-3.5 h-3.5 text-purple-500" />, lang: 'text' },
  Grep: { border: 'border-l-purple-500', icon: <FileSearch className="w-3.5 h-3.5 text-purple-500" />, lang: 'regex' },
  Agent: { border: 'border-l-cyan-500', icon: <Bot className="w-3.5 h-3.5 text-cyan-500" />, lang: 'text' },
  WebFetch: { border: 'border-l-teal-500', icon: <Globe className="w-3.5 h-3.5 text-teal-500" />, lang: 'text' },
  WebSearch: { border: 'border-l-teal-500', icon: <Globe className="w-3.5 h-3.5 text-teal-500" />, lang: 'text' },
};

function ToolUseBlock({ name, input, toolUseId }: { name: string; input: Record<string, unknown> | undefined; toolUseId?: string }) {
  const jumpToSubagent = useContext(SubagentJumpContext);
  const style = TOOL_STYLES[name] || { border: 'border-l-gray-400', icon: <Zap className="w-3.5 h-3.5 text-gray-500" />, lang: 'json' };

  // 提取主要展示内容
  const renderMainContent = () => {
    if (!input) return null;

    switch (name) {
      case 'Bash': {
        const cmd = String(input.command || '');
        return (
          <SyntaxHighlighter
            language="bash"
            style={oneLight}
            customStyle={{ margin: 0, borderRadius: '0.375rem', fontSize: '12px' }}
          >
            {cmd}
          </SyntaxHighlighter>
        );
      }
      case 'Read': {
        const path = String(input.file_path || '');
        return (
          <div className="flex items-center gap-2 text-xs">
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-mono text-blue-400">{path}</span>
          </div>
        );
      }
      case 'Write': {
        const path = String(input.file_path || '');
        const content = String(input.content || '');
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <FileEdit className="w-3.5 h-3.5 text-orange-400" />
              <span className="font-mono text-orange-400">{path}</span>
            </div>
            {content && (
              <SyntaxHighlighter
                language="text"
                style={oneLight}
                customStyle={{ margin: 0, borderRadius: '0.375rem', fontSize: '12px', maxHeight: '200px' }}
              >
                {content}
              </SyntaxHighlighter>
            )}
          </div>
        );
      }
      case 'Edit': {
        const path = String(input.file_path || '');
        const oldStr = String(input.old_string || '');
        const newStr = String(input.new_string || '');
        const changes = diffLines(oldStr, newStr);
        let oldLineNum = 0;
        let newLineNum = 0;
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <FileEdit className="w-3.5 h-3.5 text-orange-400" />
              <span className="font-mono text-orange-400">{path}</span>
            </div>
            <div className="rounded-md border border-border overflow-hidden text-xs font-mono">
              {changes.map((part, ci) => {
                const lines = part.value.split('\n').filter((l, i, arr) => i < arr.length - 1 || l !== '');
                return lines.map((line, li) => {
                  if (part.added) {
                    newLineNum++;
                    return (
                      <div key={`${ci}-${li}`} className="flex bg-green-50">
                        <span className="w-8 text-right pr-2 text-green-400/60 select-none shrink-0">{newLineNum}</span>
                        <span className="text-green-600 pl-1">+ {line || ' '}</span>
                      </div>
                    );
                  }
                  if (part.removed) {
                    oldLineNum++;
                    return (
                      <div key={`${ci}-${li}`} className="flex bg-red-50">
                        <span className="w-8 text-right pr-2 text-red-400/60 select-none shrink-0">{oldLineNum}</span>
                        <span className="text-red-600 pl-1">- {line || ' '}</span>
                      </div>
                    );
                  }
                  oldLineNum++;
                  newLineNum++;
                  return (
                    <div key={`${ci}-${li}`} className="flex">
                      <span className="w-8 text-right pr-2 text-muted-foreground/40 select-none shrink-0">{oldLineNum}</span>
                      <span className="text-foreground/70 pl-1">  {line || ' '}</span>
                    </div>
                  );
                });
              })}
            </div>
          </div>
        );
      }
      case 'Glob': {
        const pattern = String(input.pattern || '');
        return (
          <div className="flex items-center gap-2 text-xs">
            <FolderSearch className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-mono text-purple-400">{pattern}</span>
          </div>
        );
      }
      case 'Grep': {
        const pattern = String(input.pattern || '');
        const path = input.path ? String(input.path) : '';
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <FileSearch className="w-3.5 h-3.5 text-purple-400" />
              <span className="font-mono text-purple-400">{pattern}</span>
            </div>
            {path && <div className="text-[10px] text-muted-foreground ml-5">in {path}</div>}
          </div>
        );
      }
      case 'Agent': {
        const desc = String(input.description || '');
        return (
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <Bot className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
            <span className="text-cyan-400">{desc}</span>
            {toolUseId && (
              <button
                onClick={() => jumpToSubagent(toolUseId)}
                className="text-cyan-600 hover:text-cyan-800 hover:underline transition-colors flex items-center gap-0.5 flex-shrink-0"
              >
                查看子 agent <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      }
      case 'WebFetch': {
        const url = String(input.url || '');
        return (
          <div className="flex items-center gap-2 text-xs">
            <Globe className="w-3.5 h-3.5 text-teal-400" />
            <span className="font-mono text-teal-400 truncate">{url}</span>
          </div>
        );
      }
      case 'WebSearch': {
        const query = String(input.query || '');
        return (
          <div className="flex items-center gap-2 text-xs">
            <Globe className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-teal-400">{query}</span>
          </div>
        );
      }
      default: {
        // 其他工具显示 JSON
        return (
          <SyntaxHighlighter
            language="json"
            style={oneLight}
            customStyle={{ margin: 0, borderRadius: '0.375rem', fontSize: '12px', maxHeight: '200px' }}
          >
            {JSON.stringify(input, null, 2)}
          </SyntaxHighlighter>
        );
      }
    }
  };

  return (
    <div>
      <Collapsible
        summary={
          <span className="flex items-center gap-1.5">
            {style.icon}
            <span className="font-medium font-mono text-xs">{name}</span>
          </span>
        }
        defaultOpen={name === 'Agent'}
      >
        <div className="mt-1">
          {renderMainContent()}
        </div>
      </Collapsible>
    </div>
  );
}

// ── Content Block 详情 ──

function ContentBlockDetail({ block }: { block: ContentBlock }) {
  const setPreviewImage = useContext(ImagePreviewContext);

  // ── Thinking ──
  if (block.type === 'thinking') {
    const text = block.thinking || '';
    const preview = text.split('\n')[0]?.slice(0, 80) || '(empty)';
    return (
      <Collapsible
        summary={
          <span className="flex items-center gap-1.5">
            <Brain className="w-3 h-3 text-blue-500" />
            <span className="text-blue-600 font-medium">thinking</span>
            <span className="text-muted-foreground truncate max-w-[200px]">{preview}</span>
          </span>
        }
      >
        <div className="bg-muted/50 p-3 rounded-md text-sm leading-relaxed mt-1 max-h-96 overflow-auto">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !String(children).includes('\n');
                if (isInline) {
                  return (
                    <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono" {...props}>
                      {children}
                    </code>
                  );
                }
                return (
                  <SyntaxHighlighter
                    language={match?.[1] || 'text'}
                    style={oneLight}
                    customStyle={{ margin: 0, borderRadius: '0.375rem', fontSize: '12px', maxHeight: '200px' }}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                );
              },
              p({ children }) {
                return <p className="mb-2 last:mb-0">{children}</p>;
              },
              ul({ children }) {
                return <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>;
              },
              ol({ children }) {
                return <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>;
              },
            }}
          >
            {text}
          </Markdown>
        </div>
      </Collapsible>
    );
  }

  // ── Tool Use ──
  if (block.type === 'tool_use') {
    const name = block.name || 'unknown';
    const input = block.input as Record<string, unknown> | undefined;

    return (
      <ToolUseBlock name={name} input={input} toolUseId={block.id} />
    );
  }

  // ── Tool Result ──
  if (block.type === 'tool_result') {
    const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2);
    const isError = block.is_error;
    const preview = content.slice(0, 120).replace(/\n/g, ' ');

    return (
      <Collapsible
        summary={
          <span className="flex items-center gap-1.5">
            {isError ? (
              <span className="text-destructive font-medium">✗ error</span>
            ) : (
              <Check className="w-3 h-3 text-green-500" />
            )}
            <span className="text-muted-foreground truncate max-w-[250px] font-mono text-[10px]">{preview}</span>
          </span>
        }
      >
        <pre className={`p-3 rounded-md text-xs whitespace-pre-wrap overflow-auto max-h-96 font-mono mt-1 ${
          isError ? 'bg-destructive/10 text-destructive' : 'bg-muted'
        }`}>
          {content}
        </pre>
      </Collapsible>
    );
  }

  // ── Image ──
  if (block.type === 'image' && block.source) {
    const { media_type, data } = block.source;
    const src = `data:${media_type};base64,${data}`;
    return (
      <Collapsible
        summary={
          <span className="flex items-center gap-1.5">
            <ImageIcon className="w-3 h-3 text-purple-500" />
            <span className="text-purple-600 font-medium">image</span>
            <span className="text-muted-foreground text-[10px]">{media_type}</span>
          </span>
        }
      >
        <div className="mt-1">
          <img
            src={src}
            alt="content"
            onClick={() => setPreviewImage(src)}
            className="max-w-full max-h-[500px] rounded-md border cursor-pointer hover:opacity-80 transition-opacity"
          />
        </div>
      </Collapsible>
    );
  }

  // ── Text (Markdown) ──
  if (block.type === 'text') {
    return (
      <div className="bg-muted/50 p-3 rounded-md text-sm leading-relaxed">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const isInline = !match && !String(children).includes('\n');
              if (isInline) {
                return (
                  <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono" {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <SyntaxHighlighter
                  language={match?.[1] || 'text'}
                  style={oneLight}
                  customStyle={{ margin: 0, borderRadius: '0.375rem', fontSize: '12px', maxHeight: '320px' }}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              );
            },
            p({ children }) {
              return <p className="mb-2 last:mb-0">{children}</p>;
            },
            ul({ children }) {
              return <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>;
            },
            ol({ children }) {
              return <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>;
            },
            h1({ children }) {
              return <h1 className="text-base font-bold mb-2 mt-3">{children}</h1>;
            },
            h2({ children }) {
              return <h2 className="text-sm font-bold mb-1.5 mt-2">{children}</h2>;
            },
            h3({ children }) {
              return <h3 className="text-sm font-semibold mb-1 mt-2">{children}</h3>;
            },
            blockquote({ children }) {
              return <blockquote className="border-l-2 border-border pl-3 text-muted-foreground mb-2">{children}</blockquote>;
            },
            table({ children }) {
              return <div className="overflow-auto mb-2"><table className="text-xs border-collapse">{children}</table></div>;
            },
            th({ children }) {
              return <th className="border border-border px-2 py-1 text-left font-medium bg-muted">{children}</th>;
            },
            td({ children }) {
              return <td className="border border-border px-2 py-1">{children}</td>;
            },
            a({ href, children }) {
              return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{children}</a>;
            },
          }}
        >
          {block.text || ''}
        </Markdown>
      </div>
    );
  }

  // ── Unknown type ──
  return (
    <Collapsible
      summary={<span className="text-muted-foreground">{block.type}</span>}
    >
      <pre className="bg-muted p-3 rounded-md text-xs whitespace-pre-wrap overflow-auto max-h-64 font-mono mt-1">
        {JSON.stringify(block, null, 2)}
      </pre>
    </Collapsible>
  );
}

// ── Tab 按钮 ──

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ── 文件变更视图 ──

function FileChangesView({
  sessionId,
  formatTime,
}: {
  sessionId: string;
  formatTime: (ms: number | null) => string;
}) {
  const { fileChanges, loading } = useFileChanges(sessionId);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const { diff, loading: diffLoading } = useFileChangeDiff(
    sessionId,
    selectedMessageId
  );

  // 加载完成后自动选中第一条
  useEffect(() => {
    if (!selectedMessageId && fileChanges.length > 0) {
      setSelectedMessageId(fileChanges[0].message_id);
    }
  }, [fileChanges, selectedMessageId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (fileChanges.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        本会话没有文件变更
      </div>
    );
  }

  return (
    <>
      {/* 左:变更列表 */}
      <div className="w-80 flex-shrink-0 border-r flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b text-xs font-semibold flex items-center gap-1.5">
          <FileDiff className="w-3.5 h-3.5" />
          <span>文件变更 ({fileChanges.length})</span>
        </div>
        <div className="flex-1 overflow-auto">
          {fileChanges.map((c: FileChange) => {
            const path = c.tracking_path || '';
            const name = path.split('/').pop() || path;
            const dir = path.includes('/') ? path.slice(0, path.length - name.length - 1) : '';
            return (
              <button
                key={c.message_id}
                onClick={() => setSelectedMessageId(c.message_id)}
                className={`w-full text-left px-3 py-2 border-b transition-colors ${
                  selectedMessageId === c.message_id
                    ? 'bg-primary/10'
                    : 'hover:bg-muted/40'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  {c.is_new_file ? (
                    <Badge variant="outline" className="text-[9px] h-4 px-1">新建</Badge>
                  ) : (
                    <FileEdit className="w-3 h-3 text-orange-500 flex-shrink-0" />
                  )}
                  <span className="text-xs font-medium truncate">{name}</span>
                  {c.step_index != null && (
                    <span className="text-[10px] text-muted-foreground ml-auto font-mono">#{c.step_index}</span>
                  )}
                </div>
                {dir && (
                  <div className="text-[10px] text-muted-foreground/70 truncate ml-4">{dir}</div>
                )}
                <div className="text-[10px] text-muted-foreground mt-0.5 ml-4">
                  {c.version != null && `v${c.version}`}
                  {c.is_new_file ? ' · 新建文件' : ' · 编辑'}
                  {' · '}{formatTime(c.timestamp)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 右:diff */}
      <div className="flex-1 overflow-auto">
        {selectedMessageId ? (
          diff ? (
            <UnifiedDiff diff={diff} />
          ) : diffLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : null
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            选择左侧变更查看 diff
          </div>
        )}
      </div>
    </>
  );
}

// ── Unified Diff 渲染 ──

function UnifiedDiff({ diff }: { diff: FileChangeDiff }) {
  const lines = diff.diff ? diff.diff.split('\n') : [];

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <FileEdit className="w-4 h-4 text-orange-500 flex-shrink-0" />
        <span className="font-mono text-xs break-all">{diff.tracking_path}</span>
        {diff.is_new_file && (
          <Badge variant="outline" className="text-[10px] h-4">新建文件</Badge>
        )}
      </div>
      {lines.length === 0 ? (
        <div className="text-xs text-muted-foreground">无差异</div>
      ) : (
        <div className="rounded-md border border-border overflow-hidden text-xs font-mono">
          {lines.map((line, i) => {
            if (line.startsWith('--- ') || line.startsWith('+++ ')) return null;
            if (line.startsWith('@@')) {
              return (
                <div key={i} className="bg-blue-50 text-blue-700 px-2 py-0.5 border-b border-border/50">
                  {line}
                </div>
              );
            }
            if (line.startsWith('+')) {
              return (
                <div key={i} className="flex bg-green-50">
                  <span className="w-6 text-right pr-1 text-green-400/60 select-none shrink-0">+</span>
                  <span className="text-green-700 pl-1 whitespace-pre-wrap break-all">{line.slice(1) || ' '}</span>
                </div>
              );
            }
            if (line.startsWith('-')) {
              return (
                <div key={i} className="flex bg-red-50">
                  <span className="w-6 text-right pr-1 text-red-400/60 select-none shrink-0">-</span>
                  <span className="text-red-700 pl-1 whitespace-pre-wrap break-all">{line.slice(1) || ' '}</span>
                </div>
              );
            }
            if (line.startsWith('\\')) {
              return (
                <div key={i} className="text-muted-foreground italic px-2 py-0.5">
                  {line}
                </div>
              );
            }
            return (
              <div key={i} className="flex">
                <span className="w-6 text-right pr-1 text-muted-foreground/40 select-none shrink-0"> </span>
                <span className="text-foreground/70 pl-1 whitespace-pre-wrap break-all">{line.slice(1) || ' '}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 任务视图 ──

const STATUS_STYLES: Record<string, { label: string; cls: string; dot: string }> = {
  pending: { label: '待处理', cls: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  in_progress: { label: '进行中', cls: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  completed: { label: '已完成', cls: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  deleted: { label: '已删除', cls: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
};

function TodosView({
  sessionId,
  formatTime,
}: {
  sessionId: string;
  formatTime: (ms: number | null) => string;
}) {
  const { tasks, loading } = useTodos(sessionId);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      setSelectedTaskId(tasks[0].task_id);
    }
  }, [tasks, selectedTaskId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        本会话没有任务
      </div>
    );
  }

  const selected = tasks.find((t) => t.task_id === selectedTaskId);

  return (
    <>
      <div className="w-80 flex-shrink-0 border-r flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b text-xs font-semibold flex items-center gap-1.5">
          <ListTodo className="w-3.5 h-3.5" />
          <span>任务 ({tasks.length})</span>
        </div>
        <div className="flex-1 overflow-auto">
          {tasks.map((t: TodoTask) => {
            const s = STATUS_STYLES[t.final_status] || STATUS_STYLES.pending;
            return (
              <button
                key={t.task_id}
                onClick={() => setSelectedTaskId(t.task_id)}
                className={`w-full text-left px-3 py-2 border-b transition-colors ${
                  selectedTaskId === t.task_id ? 'bg-primary/10' : 'hover:bg-muted/40'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${s.dot} flex-shrink-0`} />
                  <span className="text-xs font-medium truncate flex-1">{t.subject || '(无标题)'}</span>
                  {t.created_step_index != null && (
                    <span className="text-[10px] text-muted-foreground font-mono">#{t.created_step_index}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 ml-3">
                  <Badge variant="outline" className={`text-[9px] h-4 px-1 ${s.cls}`}>{s.label}</Badge>
                  <span className="text-[10px] text-muted-foreground">#{t.task_id}</span>
                  {t.events.length > 1 && (
                    <span className="text-[10px] text-muted-foreground ml-auto">{t.events.length} 次变更</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {selected ? (
          <TodoTimeline task={selected} formatTime={formatTime} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            选择左侧任务查看状态轨迹
          </div>
        )}
      </div>
    </>
  );
}

// ── 任务状态轨迹 ──

function TodoTimeline({
  task,
  formatTime,
}: {
  task: TodoTask;
  formatTime: (ms: number | null) => string;
}) {
  return (
    <div className="p-4">
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">{task.subject || '(无标题)'}</span>
          <span className="text-[10px] text-muted-foreground font-mono">#{task.task_id}</span>
        </div>
        {task.description && <p className="text-xs text-muted-foreground">{task.description}</p>}
        {task.active_form && (
          <p className="text-[11px] text-muted-foreground/70 mt-1">进行时: {task.active_form}</p>
        )}
      </div>

      <div className="text-xs font-semibold text-muted-foreground mb-2">状态轨迹</div>
      <div className="relative pl-5 space-y-3">
        <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
        {task.events.map((ev, i) => {
          const s = STATUS_STYLES[ev.status] || STATUS_STYLES.pending;
          const oldS = STATUS_STYLES[ev.old_status || 'pending'] || STATUS_STYLES.pending;
          return (
            <div key={i} className="relative">
              <span className={`absolute -left-5 top-0.5 w-3 h-3 rounded-full ${s.dot} border-2 border-background`} />
              <div className="flex items-center gap-2 flex-wrap">
                {ev.event_type === 'created' ? (
                  <Badge variant="outline" className="text-[9px] h-4 px-1">创建</Badge>
                ) : (
                  <Badge variant="outline" className={`text-[9px] h-4 px-1 ${oldS.cls}`}>{oldS.label}</Badge>
                )}
                <span className="text-muted-foreground text-[10px]">→</span>
                <Badge variant="outline" className={`text-[9px] h-4 px-1 ${s.cls}`}>{s.label}</Badge>
                {ev.step_index != null && (
                  <span className="text-[10px] text-muted-foreground font-mono ml-auto">step #{ev.step_index}</span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground/70 mt-0.5">{formatTime(ev.timestamp)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Token / 成本分析 ──

const TOKEN_SEGMENTS = [
  { key: 'fresh_input_ratio', label: '新输入', cls: 'bg-blue-500' },
  { key: 'cache_read_ratio', label: '缓存读', cls: 'bg-green-500' },
  { key: 'cache_creation_ratio', label: '缓存写', cls: 'bg-amber-500' },
  { key: 'output_ratio', label: '输出', cls: 'bg-purple-500' },
] as const;

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
  return '$0';
}

function CostView({ sessionId }: { sessionId: string }) {
  const { analysis, loading } = useCost(sessionId);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        无法加载成本数据
      </div>
    );
  }

  const { totals, pricing, per_turn, per_tool, cache_efficiency } = analysis;
  const cards = [
    { label: '输入', tokens: totals.input_tokens, price: pricing.input_per_mtok, cls: 'bg-blue-500' },
    { label: '输出', tokens: totals.output_tokens, price: pricing.output_per_mtok, cls: 'bg-purple-500' },
    { label: '缓存读', tokens: totals.cache_read_tokens, price: pricing.cache_read_per_mtok, cls: 'bg-green-500' },
    { label: '缓存写', tokens: totals.cache_creation_tokens, price: pricing.cache_creation_per_mtok, cls: 'bg-amber-500' },
  ];

  return (
    <div className="flex-1 overflow-auto p-4 space-y-5">
      {/* 头部:总成本 + 档位 */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">估算总成本</div>
          <div className="text-2xl font-bold tabular-nums">{fmtCost(totals.estimated_cost_usd)}</div>
        </div>
        <div className="text-right">
          <Badge variant="outline" className="text-[10px] capitalize">{pricing.tier}</Badge>
          {pricing.tiers_used.length > 1 && (
            <span className="text-[10px] text-muted-foreground ml-1">+ 混档 {pricing.tiers_used.length}</span>
          )}
          <div className="text-[10px] text-muted-foreground mt-0.5">{totals.total_tokens.toLocaleString()} tokens</div>
        </div>
      </div>

      {/* 4 stat 卡 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {cards.map((c) => (
          <div key={c.label} className="border rounded-lg p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-2 h-2 rounded-full ${c.cls}`} />
              <span className="text-[11px] text-muted-foreground">{c.label}</span>
            </div>
            <div className="text-sm font-semibold tabular-nums">{fmtTokens(c.tokens)}</div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">
              {c.tokens.toLocaleString()} · ${c.price}/MTok
            </div>
          </div>
        ))}
      </div>

      {/* 缓存效率 */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-1.5">缓存效率</div>
        <div className="flex h-5 rounded overflow-hidden border">
          {TOKEN_SEGMENTS.map((seg) => {
            const ratio = cache_efficiency[seg.key];
            if (ratio <= 0) return null;
            return (
              <div
                key={seg.key}
                className={`${seg.cls} flex items-center justify-center text-[9px] text-white font-medium`}
                style={{ width: `${ratio * 100}%` }}
                title={`${seg.label}: ${(ratio * 100).toFixed(1)}%`}
              >
                {ratio > 0.08 ? `${(ratio * 100).toFixed(0)}%` : ''}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
          {TOKEN_SEGMENTS.map((seg) => (
            <div key={seg.key} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${seg.cls}`} />
              <span className="text-[10px] text-muted-foreground">
                {seg.label} {(cache_efficiency[seg.key] * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 每轮成本柱状图 */}
      {per_turn.length > 0 && (() => {
        const maxTurnCost = Math.max(...per_turn.map((t) => t.estimated_cost_usd), 0.0001);
        // 用 P95 作为 Y 轴上限，避免极端值压缩其他柱子
        const sorted = [...per_turn].map(t => t.estimated_cost_usd).sort((a, b) => a - b);
        const p95Index = Math.floor(sorted.length * 0.95);
        const yMax = Math.max(sorted[p95Index] || maxTurnCost, 0.0001);
        const chartMax = Math.max(yMax, maxTurnCost * 0.6);

        // 根据占比最大的 token 类型选择颜色（与上方颜色一致）
        const TOKEN_COLORS = {
          input: '#3b82f6',       // 蓝色 - 新输入
          cache_read: '#22c55e',  // 绿色 - 缓存读
          cache_write: '#f59e0b', // 琥珀色 - 缓存写
          output: '#a855f7',      // 紫色 - 输出
        };

        const getBarColor = (t: typeof per_turn[0]) => {
          const total = t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_creation_tokens;
          if (total === 0) return 'hsl(var(--muted-foreground))';
          // 找占比最大的类型
          const max = Math.max(t.input_tokens, t.output_tokens, t.cache_read_tokens, t.cache_creation_tokens);
          if (max === t.input_tokens) return TOKEN_COLORS.input;
          if (max === t.cache_read_tokens) return TOKEN_COLORS.cache_read;
          if (max === t.cache_creation_tokens) return TOKEN_COLORS.cache_write;
          return TOKEN_COLORS.output;
        };

        // 准备图表数据
        const chartData = per_turn.map((t) => ({
          name: `T${t.turn_index + 1}`,
          cost: t.estimated_cost_usd,
          input: t.input_tokens,
          output: t.output_tokens,
          cacheRead: t.cache_read_tokens,
          cacheWrite: t.cache_creation_tokens,
          color: getBarColor(t),
        }));

        const chartConfig = {
          cost: {
            label: '成本',
          },
        } satisfies ChartConfig;

        return (
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2">
              每轮成本 <span className="text-muted-foreground/60 font-normal">({per_turn.length} 轮)</span>
            </div>
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval={Math.max(Math.floor(per_turn.length / 20), 0)}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => fmtCost(v)}
                  width={50}
                />
                <ChartTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-background border rounded-lg shadow-lg p-2 text-xs space-y-1">
                        <div className="font-medium">{data.name}</div>
                        <div>成本: {fmtCost(data.cost)}</div>
                        <div className="text-muted-foreground">
                          输入 {fmtTokens(data.input)} · 输出 {fmtTokens(data.output)}
                        </div>
                        <div className="text-muted-foreground">
                          缓存读 {fmtTokens(data.cacheRead)} · 缓存写 {fmtTokens(data.cacheWrite)}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="cost" radius={[2, 2, 0, 0]} maxBarSize={40}>
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2">
              {Object.entries(TOKEN_COLORS).map(([key, color]) => (
                <div key={key} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-[10px] text-muted-foreground">
                    {key === 'input' ? '新输入' : key === 'cache_read' ? '缓存读' : key === 'cache_write' ? '缓存写' : '输出'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 每工具表 */}
      {per_tool.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">工具成本</div>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-[10px] text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium">工具</th>
                  <th className="text-right px-2 py-1.5 font-medium">次数</th>
                  <th className="text-right px-2 py-1.5 font-medium">输入</th>
                  <th className="text-right px-2 py-1.5 font-medium">输出</th>
                  <th className="text-right px-2 py-1.5 font-medium">缓存读</th>
                  <th className="text-right px-2 py-1.5 font-medium">成本</th>
                </tr>
              </thead>
              <tbody>
                {per_tool.map((t: CostPerTool) => (
                  <tr key={t.tool_name} className="border-t hover:bg-muted/20">
                    <td className="px-2 py-1.5 font-mono text-[11px]">{t.tool_name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{t.count}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{fmtTokens(t.input_tokens)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{fmtTokens(t.output_tokens)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{fmtTokens(t.cache_read_tokens)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmtCost(t.estimated_cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground/60 pt-1">{pricing.note}</div>
    </div>
  );
}

// ── 子 agent trace drawer ──

function SubagentDrawer({
  sessionId,
  toolUseId,
  formatTime,
  onClose,
}: {
  sessionId: string;
  toolUseId: string;
  formatTime: (ms: number | null) => string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <div
        className="w-[700px] max-w-[80vw] bg-background border-l flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-cyan-500" />
            <span className="text-sm font-semibold">子 agent trace</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <SubagentTracePane sessionId={sessionId} toolUseId={toolUseId} formatTime={formatTime} />
        </div>
      </div>
    </div>
  );
}

function SubagentTracePane({
  sessionId,
  toolUseId,
  formatTime,
}: {
  sessionId: string;
  toolUseId: string | null;
  formatTime: (ms: number | null) => string;
}) {
  const { trace, loading } = useSubagentTrace(sessionId, toolUseId);

  if (!toolUseId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        选择左侧子 agent 查看其执行 trace
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!trace) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        无法加载子 agent trace
      </div>
    );
  }

  return (
    <div className="p-4 pb-20 space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        <Bot className="w-3.5 h-3.5 text-cyan-500" />
        <Badge variant="outline" className="text-[10px] h-4">{trace.agent_type || '?'}</Badge>
        <span className="font-medium text-foreground/80">{trace.description}</span>
      </div>
      {trace.turns.map((turn: Turn) => (
        <TurnDetail key={turn.turn_index} turn={turn} formatTime={formatTime} />
      ))}
    </div>
  );
}

export default App;
