/**
 * 分析状态栏组件
 */

import { Loader2, X } from 'lucide-react';

interface AnalysisStatus {
  isAnalyzing: boolean;
  currentSession: string | null;
  projectName: string | null;
  progress?: {
    current: number;
    total: number;
  };
  onCancel?: () => void;
}

export function AnalysisStatusBar({
  isAnalyzing,
  currentSession,
  projectName,
  progress,
  onCancel,
}: AnalysisStatus) {
  if (!isAnalyzing || !currentSession) {
    return null;
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2.5 flex items-center gap-2 z-10 rounded-full shadow-lg">
      <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
      <span className="text-xs">
        正在分析: {currentSession}
        {projectName && <span className="opacity-70"> ({projectName})</span>}
      </span>
    </div>
  );
}
