/**
 * 知识条目卡片组件
 */

import { Badge } from '@/components/ui/badge';
import type { KnowledgeItem } from '@/types';

// Mock session 标题映射
const SESSION_TITLES: Record<string, string> = {
  'session-abc123': '优化列表渲染性能',
  'session-def456': '数据获取方案讨论',
  'session-ghi789': 'TypeScript 配置优化',
  'session-jkl012': 'WebSocket 重连机制',
  'session-mno345': '样式框架选型',
};

interface KnowledgeCardProps {
  item: KnowledgeItem;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (item: KnowledgeItem) => void;
  onViewSources: (item: KnowledgeItem) => void;
  onSessionClick?: (sessionId: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  code_style: '代码规范',
  architecture: '架构决策',
  tool_config: '工具配置',
  fix_pattern: '修复模式',
  preference: '用户偏好',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
};

export function KnowledgeCard({
  item,
  onApprove,
  onReject,
  onEdit,
  onViewSources,
  onSessionClick,
}: KnowledgeCardProps) {
  return (
    <div className="p-3 border rounded-lg hover:border-border">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* 标签 */}
          <div className="flex items-center gap-2 mb-1.5">
            <Badge className={STATUS_STYLES[item.status]}>
              {STATUS_LABELS[item.status]}
            </Badge>
            <Badge variant="outline">{TYPE_LABELS[item.type]}</Badge>
            <span className="text-[10px] text-muted-foreground">
              置信度 {Math.round(item.confidence * 100)}%
            </span>
            {item.is_modified && (
              <Badge className="bg-amber-100 text-amber-700">已修改</Badge>
            )}
          </div>

          {/* 标题和内容 */}
          <h3 className="text-sm font-medium text-card-foreground">
            {item.title || item.content.slice(0, 50)}
          </h3>
          {item.title && (
            <p className="text-xs text-muted-foreground mt-1">{item.content}</p>
          )}

          {/* 来源 */}
          <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground flex-wrap">
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-muted rounded">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>来自 {item.source_sessions.length} 个 session</span>
            </div>
            {item.source_sessions.slice(0, 2).map((sid, i) => (
              <span key={sid}>
                {i > 0 && <span className="mr-1">·</span>}
                <span
                  className="text-blue-600 cursor-pointer hover:underline"
                  onClick={() => onSessionClick?.(sid)}
                >
                  {SESSION_TITLES[sid] || sid.slice(0, 8)}
                </span>
              </span>
            ))}
            {item.source_sessions.length > 2 && (
              <span
                className="text-blue-600 cursor-pointer hover:underline"
                onClick={() => onViewSources(item)}
              >
                +{item.source_sessions.length - 2}
              </span>
            )}
          </div>

          {/* 同步状态 */}
          {item.synced_at && (
            <div className="flex items-center gap-2 mt-2 text-[10px]">
              <span className="text-muted-foreground">已同步到:</span>
              <Badge className={
                item.write_level === 'project'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-purple-100 text-purple-700'
              }>
                {item.write_level === 'project' ? '项目级' : '用户级'}
              </Badge>
              <span className="text-muted-foreground">{item.synced_path}</span>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 ml-3">
          <button
            className="w-7 h-7 flex items-center justify-center rounded border bg-blue-50 text-blue-600 hover:bg-blue-100"
            title="编辑"
            onClick={() => onEdit(item)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          {item.status === 'pending' && (
            <>
              <button
                className="w-7 h-7 flex items-center justify-center rounded border bg-green-50 text-green-600 hover:bg-green-100"
                title="批准"
                onClick={() => onApprove(item.id)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </button>
              <button
                className="w-7 h-7 flex items-center justify-center rounded border bg-red-50 text-red-600 hover:bg-red-100"
                title="拒绝"
                onClick={() => onReject(item.id)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
