/**
 * 知识列表组件
 */

import { useState } from 'react';
import { useKnowledge } from '@/hooks/useKnowledge';
import type { KnowledgeItem } from '@/types';
import { KnowledgeCard } from './KnowledgeCard';
import { EditModal } from './EditModal';
import { SyncModal } from './SyncModal';
import { SessionDetailModal } from './SessionDetailModal';

interface KnowledgeListProps {
  projectPath: string | null;
  onJumpToSession?: (sessionId: string) => void;
}

const TYPE_FILTERS = [
  { value: '', label: '所有类型' },
  { value: 'code_style', label: '代码规范' },
  { value: 'architecture', label: '架构决策' },
  { value: 'tool_config', label: '工具配置' },
  { value: 'fix_pattern', label: '修复模式' },
  { value: 'preference', label: '用户偏好' },
];

export function KnowledgeList({ projectPath, onJumpToSession }: KnowledgeListProps) {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [viewingItem, setViewingItem] = useState<KnowledgeItem | null>(null);
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const [showSyncModal, setShowSyncModal] = useState(false);

  const { items, loading, approveItem, rejectItem, updateItem, batchApprove } =
    useKnowledge(projectPath || undefined, statusFilter, typeFilter);

  const { items: allItems } = useKnowledge(projectPath || undefined, 'approved');

  const handleBatchApprove = async () => {
    const pendingIds = items.filter((i) => i.status === 'pending').map((i) => i.id);
    if (pendingIds.length > 0) {
      await batchApprove(pendingIds);
    }
  };

  const handleSync = async (syncItems: Array<{ id: string; write_level: string }>) => {
    console.log('Syncing items:', syncItems);
  };

  const projectName = projectPath?.split('/').pop() || '未知项目';

  return (
    <div className="flex-1 bg-card rounded-lg border flex flex-col overflow-hidden">
      <div className="p-3 border-b flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-card-foreground">{projectName}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{projectPath} · {items.length} 个知识条目</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="text-xs px-3 py-1.5 border rounded hover:bg-accent" onClick={handleBatchApprove}>批量批准</button>
            <button className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90" onClick={() => setShowSyncModal(true)}>同步到 CLAUDE.md</button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <button className={`px-2 py-1 text-xs rounded ${statusFilter === '' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted'}`} onClick={() => setStatusFilter('')}>全部 ({items.length})</button>
            <button className={`px-2 py-1 text-xs rounded ${statusFilter === 'pending' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted'}`} onClick={() => setStatusFilter('pending')}>待审批 ({items.filter((i) => i.status === 'pending').length})</button>
            <button className={`px-2 py-1 text-xs rounded ${statusFilter === 'approved' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted'}`} onClick={() => setStatusFilter('approved')}>已批准 ({items.filter((i) => i.status === 'approved').length})</button>
          </div>
          <div className="h-4 w-px bg-muted" />
          <select className="text-xs border rounded px-2 py-1" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            {TYPE_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 pb-6 space-y-3 min-h-0">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">{projectPath ? '暂无知识条目' : '请先选择一个项目'}</div>
        ) : (
          items.map((item) => (
            <KnowledgeCard
              key={item.id}
              item={item}
              onApprove={approveItem}
              onReject={rejectItem}
              onEdit={setEditingItem}
              onViewSources={setViewingItem}
              onSessionClick={(sid) => {
                setViewingItem(item);
                setViewingSessionId(sid);
              }}
            />
          ))
        )}
      </div>

      <div className="p-3 border-t bg-muted flex-shrink-0">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>{items.length} 个条目</span>
            <span className="text-green-600">{items.filter((i) => i.status === 'approved').length} 已批准</span>
            <span className="text-amber-600">{items.filter((i) => i.status === 'pending').length} 待审批</span>
          </div>
          <button className="px-3 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90" onClick={() => setShowSyncModal(true)}>同步到 CLAUDE.md</button>
        </div>
      </div>

      <EditModal item={editingItem} onClose={() => setEditingItem(null)} onSave={updateItem} />
      {showSyncModal && <SyncModal items={allItems} onClose={() => setShowSyncModal(false)} onSync={handleSync} />}
      <SessionDetailModal
        item={viewingItem}
        sessionId={viewingSessionId}
        onClose={() => { setViewingItem(null); setViewingSessionId(null); }}
        onJumpToSession={onJumpToSession}
      />
    </div>
  );
}
