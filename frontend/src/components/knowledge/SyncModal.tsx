/**
 * 同步到 CLAUDE.md 弹窗
 */

import { useState } from 'react';
import type { KnowledgeItem } from '@/types';

interface SyncModalProps {
  items: KnowledgeItem[];
  onClose: () => void;
  onSync: (items: Array<{ id: string; write_level: string }>) => void;
}

export function SyncModal({ items, onClose, onSync }: SyncModalProps) {
  const [selectedItems, setSelectedItems] = useState<Array<{ id: string; write_level: string }>>(
    items.map((item) => ({ id: item.id, write_level: item.write_level }))
  );

  const handleToggleItem = (itemId: string) => {
    setSelectedItems((prev) =>
      prev.some((i) => i.id === itemId)
        ? prev.filter((i) => i.id !== itemId)
        : [...prev, { id: itemId, write_level: 'project' }]
    );
  };

  const handleWriteLevelChange = (itemId: string, level: string) => {
    setSelectedItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, write_level: level } : i)));
  };

  const handleSync = () => {
    onSync(selectedItems);
    onClose();
  };

  const projectCount = selectedItems.filter((i) => i.write_level === 'project').length;
  const userCount = selectedItems.filter((i) => i.write_level === 'user').length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">同步到 CLAUDE.md</h3>
            <button className="text-gray-400 hover:text-gray-600" onClick={onClose}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">为每个条目选择写入级别</p>
        </div>

        <div className="p-4 overflow-auto max-h-96 space-y-3">
          {items.map((item) => {
            const isSelected = selectedItems.some((i) => i.id === item.id);
            const writeLevel = selectedItems.find((i) => i.id === item.id)?.write_level || item.write_level;

            return (
              <div key={item.id} className="border rounded-lg p-3">
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 rounded" checked={isSelected} onChange={() => handleToggleItem(item.id)} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-800">{item.title || item.content.slice(0, 40)}</span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">{item.content}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] text-gray-500">写入到:</span>
                      <button className={`px-2 py-0.5 text-[10px] rounded border ${writeLevel === 'project' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`} onClick={() => handleWriteLevelChange(item.id, 'project')}>
                        📁 项目级
                      </button>
                      <button className={`px-2 py-0.5 text-[10px] rounded border ${writeLevel === 'user' ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`} onClick={() => handleWriteLevelChange(item.id, 'user')}>
                        👤 用户级
                      </button>
                      <span className="text-[10px] text-gray-400">{writeLevel === 'project' ? '.claude/CLAUDE.md' : '~/.claude/CLAUDE.md'}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">
              <span>已选 {selectedItems.length} 个条目</span>
              <span className="ml-2 text-green-600">{projectCount} 项目级</span>
              <span className="ml-2 text-purple-600">{userCount} 用户级</span>
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50" onClick={onClose}>取消</button>
              <button className="px-3 py-1.5 text-xs bg-gray-900 text-white rounded hover:bg-gray-800" onClick={handleSync}>确认同步</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
