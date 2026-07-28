/**
 * 编辑知识条目弹窗
 */

import { useState } from 'react';
import type { KnowledgeItem } from '@/types';

interface EditModalProps {
  item: KnowledgeItem | null;
  onClose: () => void;
  onSave: (itemId: string, updates: Partial<KnowledgeItem>) => void;
}

const TYPE_OPTIONS = [
  { value: 'code_style', label: '代码规范' },
  { value: 'architecture', label: '架构决策' },
  { value: 'tool_config', label: '工具配置' },
  { value: 'fix_pattern', label: '修复模式' },
  { value: 'preference', label: '用户偏好' },
];

export function EditModal({ item, onClose, onSave }: EditModalProps) {
  const [type, setType] = useState(item?.type || 'code_style');
  const [content, setContent] = useState(item?.content || '');
  const [title, setTitle] = useState(item?.title || '');
  const [confidence, setConfidence] = useState(item?.confidence || 0.5);
  const [writeLevel, setWriteLevel] = useState(item?.write_level || 'project');

  if (!item) return null;

  const handleSave = () => {
    onSave(item.id, {
      type,
      content,
      title: title || undefined,
      confidence,
      write_level: writeLevel,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl w-[520px] max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-card-foreground">编辑知识条目</h3>
            <button className="text-muted-foreground hover:text-muted-foreground" onClick={onClose}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* 类型选择 */}
          <div>
            <label className="block text-xs font-medium text-card-foreground mb-1">类型</label>
            <select className="w-full text-sm border rounded px-3 py-2" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 标题 */}
          <div>
            <label className="block text-xs font-medium text-card-foreground mb-1">标题（可选）</label>
            <input type="text" className="w-full text-sm border rounded px-3 py-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="简短描述" />
          </div>

          {/* 内容 */}
          <div>
            <label className="block text-xs font-medium text-card-foreground mb-1">内容</label>
            <textarea className="w-full text-sm border rounded px-3 py-2 h-24 resize-none" value={content} onChange={(e) => setContent(e.target.value)} />
          </div>

          {/* 置信度 */}
          <div>
            <label className="block text-xs font-medium text-card-foreground mb-1">置信度: {Math.round(confidence * 100)}%</label>
            <input type="range" min="0" max="100" value={Math.round(confidence * 100)} onChange={(e) => setConfidence(parseInt(e.target.value) / 100)} className="w-full" />
          </div>

          {/* 写入级别 */}
          <div>
            <label className="block text-xs font-medium text-card-foreground mb-1">写入级别</label>
            <div className="flex gap-2">
              <button className={`px-3 py-1.5 text-xs rounded border ${writeLevel === 'project' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-muted text-muted-foreground hover:bg-muted'}`} onClick={() => setWriteLevel('project')}>
                📁 项目级
              </button>
              <button className={`px-3 py-1.5 text-xs rounded border ${writeLevel === 'user' ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-muted text-muted-foreground hover:bg-muted'}`} onClick={() => setWriteLevel('user')}>
                👤 用户级
              </button>
            </div>
          </div>

          {/* 来源信息（只读） */}
          <div className="p-3 bg-muted rounded-lg">
            <div className="text-xs font-medium text-card-foreground mb-2">来源（只读）</div>
            <div className="space-y-1 text-[10px] text-muted-foreground">
              {item.source_sessions.map((sessionId) => (
                <div key={sessionId} className="flex items-center gap-2">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>{sessionId}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t bg-muted flex items-center justify-end gap-2">
          <button className="px-3 py-1.5 text-xs border rounded hover:bg-accent" onClick={onClose}>取消</button>
          <button className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90" onClick={handleSave}>保存修改</button>
        </div>
      </div>
    </div>
  );
}
