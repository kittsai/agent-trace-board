/**
 * Session 详情浮层
 */

import type { KnowledgeItem } from '@/types';

// Mock session 数据
const MOCK_SESSIONS: Record<string, { title: string; id: string; started_at: string; turns: number }> = {
  'session-abc123': { title: '修复登录页面 bug', id: 'abc-123-def', started_at: '3 分钟前', turns: 12 },
  'session-def456': { title: '数据获取方案讨论', id: 'def-456-ghi', started_at: '1 小时前', turns: 8 },
  'session-ghi789': { title: 'TypeScript 配置优化', id: 'ghi-789-jkl', started_at: '昨天', turns: 15 },
  'session-jkl012': { title: 'WebSocket 重连机制', id: 'jkl-012-mno', started_at: '2 天前', turns: 10 },
  'session-mno345': { title: '样式框架选型', id: 'mno-345-pqr', started_at: '3 天前', turns: 6 },
};

// Mock 相关步骤数据
const MOCK_STEPS: Record<string, Array<{
  turn_index: number;
  tool_name: string;
  tool_input: string;
  user_message?: string;
  ai_result: string;
  reason: string;
}>> = {
  'session-abc123': [
    { turn_index: 5, tool_name: '编辑文件', tool_input: 'Edit src/components/my-component.tsx', user_message: '帮我把这个组件改成 kebab-case 命名', ai_result: '已将组件重命名为 my-component.tsx', reason: '用户明确要求使用 kebab-case 命名，AI 执行并确认' },
    { turn_index: 8, tool_name: '创建文件', tool_input: 'Write src/components/button-group.tsx', ai_result: '创建新组件 button-group.tsx（自动遵循 kebab-case）', reason: 'AI 主动遵循项目命名规范，无需用户提示' },
    { turn_index: 10, tool_name: '读取文件', tool_input: 'Read src/components/my-component.tsx', ai_result: '读取文件确认命名正确', reason: '' },
  ],
};

interface SessionDetailModalProps {
  item: KnowledgeItem | null;
  sessionId?: string | null;
  onClose: () => void;
  onJumpToSession?: (sessionId: string) => void;
}

export function SessionDetailModal({ item, sessionId, onClose, onJumpToSession }: SessionDetailModalProps) {
  if (!item) return null;

  // 使用传入的 sessionId 或第一个来源 session
  const targetSessionId = sessionId || item.source_sessions[0];
  const session = MOCK_SESSIONS[targetSessionId];
  const steps = MOCK_STEPS[targetSessionId] || [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl w-[640px] max-h-[85vh] overflow-hidden flex flex-col">
        {/* 头部：Session 信息 */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-card-foreground">{session?.title || 'Session 详情'}</h3>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                <span>Session: {session?.id || targetSessionId?.slice(0, 8)}</span>
                <span>·</span>
                <span>{session?.turns || 0} 轮对话</span>
                <span>·</span>
                <span>{session?.started_at || '未知时间'}</span>
              </div>
            </div>
            <button className="text-muted-foreground hover:text-muted-foreground" onClick={onClose}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            提取的知识：<span className="font-medium">{item.title || item.content}</span>
          </div>
        </div>

        {/* 内容：相关步骤 */}
        <div className="flex-1 overflow-auto p-4">
          <div className="text-[10px] text-muted-foreground font-medium mb-3">相关步骤（知识来源）</div>
          <div className="space-y-3">
            {steps.map((step, index) => {
              const isFirst = index === 0;
              return (
                <div key={index} className={`flex gap-3 p-3 rounded-lg ${isFirst ? 'bg-accent border border-accent/50' : 'bg-muted'}`}>
                  {/* 左侧：圆圈数字 + 连线 */}
                  <div className="flex flex-col items-center">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                      isFirst ? 'bg-accent/80' : 'bg-muted'
                    }`}>
                      <span className={`text-[10px] font-medium ${isFirst ? 'text-accent-foreground' : 'text-muted-foreground'}`}>
                        {step.turn_index}
                      </span>
                    </div>
                    {index < steps.length - 1 && (
                      <div className={`w-px flex-1 mt-1 ${isFirst ? 'bg-accent/60' : 'bg-muted'}`} />
                    )}
                  </div>

                  {/* 右侧：内容 */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        isFirst ? 'bg-accent/80 text-accent-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                        Turn {step.turn_index}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{step.tool_name}</span>
                    </div>
                    <div className="text-xs font-medium text-card-foreground">{step.tool_input}</div>
                    {step.user_message && (
                      <div className="text-[10px] text-muted-foreground mt-1">
                        <span className="font-medium">用户:</span> {step.user_message}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1">
                      <span className="font-medium">AI:</span> {step.ai_result}
                    </div>
                    {step.reason && (
                      <div className="mt-2 p-2 bg-card rounded border text-[10px]">
                        <div className="text-muted-foreground mb-1">提取依据：</div>
                        <div className="text-muted-foreground">{step.reason}</div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 置信度说明 */}
          <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-amber-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-[10px] text-amber-800">
                <div className="font-medium mb-1">置信度计算</div>
                <div>
                  基于 {steps.length} 个相关步骤，包含用户明确指令（Turn 5）+ AI 自主遵循（Turn 8, 10）
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作 */}
        <div className="p-4 border-t bg-muted flex items-center justify-between">
          <button
            className="text-xs text-accent-foreground hover:text-accent-foreground"
            onClick={() => {
              onJumpToSession?.(targetSessionId);
              onClose();
            }}
          >
            在 Sessions 中查看完整对话 →
          </button>
          <button className="px-3 py-1.5 text-xs border rounded hover:bg-accent" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
