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
}

const TYPE_FILTERS = [
  { value: '', label: '所有类型' },
  { value: 'code_style', label: '代码规范' },
  { value: 'architecture', label: '架构决策' },
  { value: 'tool_config', label: '工具配置' },
  { value: 'fix_pattern', label: '修复模式' },
  { value: 'preference', label: '用户偏好' },
];

export function KnowledgeList({ projectPath }: KnowledgeListProps) {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [viewingItem, setViewingItem] = useState<KnowledgeItem | null>(null);
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
    <div className="flex-1 bg-white rounded-lg border flex flex-col">
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">{projectName}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{projectPath} · {items.length} 个知识条目</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50" onClick={handleBatchApprove}>批量批准</button>
            <button className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded hover:bg-gray-800" onClick={() => setShowSyncModal(true)}>同步到 CLAUDE.md</button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <button className={`px-2 py-1 text-xs rounded ${statusFilter === '' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`} onClick={() => setStatusFilter('')}>全部 ({items.length})</button>
            <button className={`px-2 py-1 text-xs rounded ${statusFilter === 'pending' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`} onClick={() => setStatusFilter('pending')}>待审批 ({items.filter((i) => i.status === 'pending').length})</button>
            <button className={`px-2 py-1 text-xs rounded ${statusFilter === 'approved' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`} onClick={() => setStatusFilter('approved')}>已批准 ({items.filter((i) => i.status === 'approved').length})</button>
          </div>
          <div className="h-4 w-px bg-gray-200" />
          <select className="text-xs border rounded px-2 py-1" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            {TYPE_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {loading ? (
          <div className="text-center py-8 text-gray-500">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-gray-500">{projectPath ? '暂无知识条目' : '请先选择一个项目'}</div>
        ) : (
          items.map((item) => (
            <KnowledgeCard key={item.id} item={item} onApprove={approveItem} onReject={rejectItem} onEdit={setEditingItem} onViewSources={setViewingItem} />
          ))
        )}
      </div>

      <div className="p-3 border-t bg-gray-50">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span>{items.length} 个条目</span>
            <span className="text-green-600">{items.filter((i) => i.status === 'approved').length} 已批准</span>
            <span className="text-amber-600">{items.filter((i) => i.status === 'pending').length} 待审批</span>
          </div>
          <button className="px-3 py-1 bg-gray-900 text-white rounded hover:bg-gray-800" onClick={() => setShowSyncModal(true)}>同步到 CLAUDE.md</button>
        </div>
      </div>

      <EditModal item={editingItem} onClose={() => setEditingItem(null)} onSave={updateItem} />
      <SyncModal items={allItems} onClose={() => setShowSyncModal(false)} onSync={handleSync} />
      <SessionDetailModal item={viewingItem} onClose={() => setViewingItem(null)} />
    </div>
  );
}
