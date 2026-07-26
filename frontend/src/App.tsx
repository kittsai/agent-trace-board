import { useState, useCallback, useEffect, useRef, useMemo, memo, createContext, useContext, type ReactNode } from 'react';
import { useSessions } from './hooks/useSessions';
import { useTurns, useStats } from './hooks/useSteps';
import { useWebSocket } from './hooks/useWebSocket';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import {
  Bot, User, Brain, Zap, Check, Search, Copy, Image as ImageIcon,
  ChevronRight, ChevronDown, Terminal, FileText, FileEdit,
  FolderSearch, FileSearch, Globe,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { diffLines } from 'diff';
import type { Session, Step, Turn, ContentBlock, WSEvent } from './types';

const ImagePreviewContext = createContext<(src: string) => void>(() => {});

function App() {
  const [selectedSession, setSelectedSession] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('session')
      || sessionStorage.getItem('lastSession')
  );
  const [selectedTurn, setSelectedTurn] = useState<Turn | null>(null);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('claude-code');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

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
  const { turns, refresh: refreshTurns } = useTurns(selectedSession || undefined);
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

  const formatTime = (ms: number | null) => {
    if (!ms) return '-';
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <ImagePreviewContext.Provider value={setPreviewImage}>
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      {/* 左栏：Session 列表 */}
      <div className="w-64 flex-shrink-0 border-r flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="Logo" className="w-7 h-7" />
            <span className="font-bold text-sm">Agent Trace Board</span>
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
        {!selectedSession ? (
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

            <div className="flex-1 flex overflow-hidden">
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
                  <div className="text-center text-muted-foreground text-sm mt-20">
                    {selectedSession ? '加载中...' : '选择左侧对话查看详情'}
                  </div>
                ) : (
                  turns.map((turn: Turn) => (
                    <TurnDetailBlock
                      key={turn.turn_index}
                      turn={turn}
                      formatTime={formatTime}
                      onVisible={(visible) => {
                        // 点击跳转时忽略 IntersectionObserver
                        if (visible && !clickingRef.current) {
                          setVisibleTurnId(turn.turn_index);
                        }
                      }}
                    />
                  ))
                )}
              </div>
            </div>
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
    </div>
    </ImagePreviewContext.Provider>
  );
}

// ── Turn 行 ──

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
                <span key={name} className="text-[10px] text-muted-foreground/70 px-1 py-0.5">
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
  onVisible: (visible: boolean) => void;
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
          onVisibleRef.current(true);
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

function ToolUseBlock({ name, input }: { name: string; input: Record<string, unknown> | undefined }) {
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
          <div className="flex items-center gap-2 text-xs">
            <Bot className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-cyan-400">{desc}</span>
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
        defaultOpen={name === 'Bash'}
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
      <ToolUseBlock name={name} input={input} />
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

export default App;
