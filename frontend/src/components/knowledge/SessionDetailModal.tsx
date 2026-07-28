/**
 * Session 详情浮层
 */

import type { KnowledgeItem } from '@/types';

interface SessionDetailModalProps {
  item: KnowledgeItem | null;
  onClose: () => void;
}

export function SessionDetailModal({ item, onClose }: SessionDetailModalProps) {
  if (!item) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[640px] max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">知识来源详情</h3>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                <span>{item.source_sessions.length} 个来源 session</span>
              </div>
            </div>
            <button className="text-gray-400 hover:text-gray-600" onClick={onClose}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-2 text-xs text-gray-600">
            提取的知识：<span className="font-medium">{item.content}</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="text-[10px] text-gray-400 font-medium mb-3">来源 Session</div>
          <div className="space-y-3">
            {item.source_sessions.map((sessionId, index) => (
              <div key={sessionId} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                    <span className="text-[10px] font-medium text-gray-600">{index + 1}</span>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-xs font-medium text-gray-800">Session: {sessionId.slice(0, 8)}...</div>
                  <div className="text-[10px] text-gray-500 mt-1">点击在 Sessions 页面查看完整对话</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-amber-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-[10px] text-amber-800">
                <div className="font-medium mb-1">置信度计算</div>
                <div>基于 {item.source_sessions.length} 个来源 session，置信度 {Math.round(item.confidence * 100)}%</div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t bg-gray-50 flex items-center justify-end">
          <button className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
