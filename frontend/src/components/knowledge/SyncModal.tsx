/**
 * 同步知识条目弹窗
 */

import { useState } from 'react';
import type { KnowledgeItem } from '@/types';

type SyncTarget = 'claude-md-project' | 'claude-md-user' | 'skill' | 'hook';

interface SyncItem {
  id: string;
  target: SyncTarget;
}

interface SyncModalProps {
  items: KnowledgeItem[];
  onClose: () => void;
  onSync: (items: SyncItem[]) => void;
}

const SYNC_TARGETS: Record<SyncTarget, { label: string; icon: string; path: string; description: string }> = {
  'claude-md-project': {
    label: '项目级 CLAUDE.md',
    icon: '📁',
    path: '.claude/CLAUDE.md',
    description: '项目专属指令，团队共享',
  },
  'claude-md-user': {
    label: '用户级 CLAUDE.md',
    icon: '👤',
    path: '~/.claude/CLAUDE.md',
    description: '个人偏好，所有项目生效',
  },
  'skill': {
    label: 'Skill',
    icon: '⚡',
    path: '.claude/skills/<name>.md',
    description: '可复用的工作流，按需加载',
  },
  'hook': {
    label: 'Hook',
    icon: '🪝',
    path: '.claude/settings.json',
    description: '自动触发的命令',
  },
};

export function SyncModal({ items, onClose, onSync }: SyncModalProps) {
  const [selectedItems, setSelectedItems] = useState<SyncItem[]>(
    items.map((item) => ({ id: item.id, target: 'claude-md-project' }))
  );

  const handleToggleItem = (itemId: string) => {
    setSelectedItems((prev) =>
      prev.some((i) => i.id === itemId)
        ? prev.filter((i) => i.id !== itemId)
        : [...prev, { id: itemId, target: 'claude-md-project' }]
    );
  };

  const handleTargetChange = (itemId: string, target: SyncTarget) => {
    setSelectedItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, target } : i)));
  };

  const handleSync = () => {
    onSync(selectedItems);
    onClose();
  };

  const targetCounts = Object.keys(SYNC_TARGETS).reduce((acc, key) => {
    acc[key as SyncTarget] = selectedItems.filter((i) => i.target === key).length;
    return acc;
  }, {} as Record<SyncTarget, number>);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl w-[560px] max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-card-foreground">同步知识条目</h3>
            <button className="text-muted-foreground hover:text-muted-foreground" onClick={onClose}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">为每个条目选择同步目标</p>
        </div>

        <div className="p-4 overflow-auto max-h-96 space-y-3">
          {items.map((item) => {
            const isSelected = selectedItems.some((i) => i.id === item.id);
            const target = selectedItems.find((i) => i.id === item.id)?.target || 'claude-md-project';
            const targetInfo = SYNC_TARGETS[target];

            return (
              <div key={item.id} className="border rounded-lg p-3">
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 rounded" checked={isSelected} onChange={() => handleToggleItem(item.id)} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-card-foreground">{item.title || item.content.slice(0, 40)}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">{item.content}</p>

                    {/* 同步目标选择 */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(Object.keys(SYNC_TARGETS) as SyncTarget[]).map((key) => {
                        const info = SYNC_TARGETS[key];
                        return (
                          <button
                            key={key}
                            className={`px-2 py-0.5 text-[10px] rounded border ${
                              target === key
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground hover:bg-accent'
                            }`}
                            onClick={() => handleTargetChange(item.id, key)}
                          >
                            {info.icon} {info.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* 目标路径 */}
                    <div className="text-[10px] text-muted-foreground mt-1.5">
                      → {targetInfo.path}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t bg-muted">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span>已选 {selectedItems.length} 个</span>
              {targetCounts['claude-md-project'] > 0 && (
                <span className="text-green-600">📁 {targetCounts['claude-md-project']}</span>
              )}
              {targetCounts['claude-md-user'] > 0 && (
                <span className="text-purple-600">👤 {targetCounts['claude-md-user']}</span>
              )}
              {targetCounts['skill'] > 0 && (
                <span className="text-blue-600">⚡ {targetCounts['skill']}</span>
              )}
              {targetCounts['hook'] > 0 && (
                <span className="text-orange-600">🪝 {targetCounts['hook']}</span>
              )}
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 text-xs border rounded hover:bg-accent" onClick={onClose}>取消</button>
              <button className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90" onClick={handleSync}>确认同步</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
