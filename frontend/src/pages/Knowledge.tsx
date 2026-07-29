/**
 * Knowledge 页面
 */

import { useState } from 'react';
import { ProjectList } from '@/components/knowledge/ProjectList';
import { KnowledgeList } from '@/components/knowledge/KnowledgeList';
import { ScanModal } from '@/components/knowledge/ScanModal';
import { useKnowledgeProjects } from '@/hooks/useKnowledge';
import { toast } from 'sonner';

interface KnowledgeProps {
  onJumpToSession?: (sessionId: string) => void;
}

export function Knowledge({ onJumpToSession }: KnowledgeProps) {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<{
    isAnalyzing: boolean;
    currentSession: string | null;
    projectName: string | null;
  }>({
    isAnalyzing: false,
    currentSession: null,
    projectName: null,
  });

  const { refresh: refreshProjects } = useKnowledgeProjects();

  const handleScanProjects = () => {
    setShowScanModal(true);
  };

  const handleAddProjects = async (paths: string[]) => {
    try {
      const res = await fetch('/api/knowledge/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (res.ok) {
        toast.success(`已添加 ${paths.length} 个项目`);
        // 刷新项目列表
        refreshProjects();
      } else {
        toast.error('添加失败');
      }
    } catch {
      toast.error('添加失败');
    }
  };

  const handleExtract = async (projectPath: string) => {
    const projectName = projectPath.split('/').pop() || projectPath;

    // 开始分析
    setAnalysisStatus({
      isAnalyzing: true,
      currentSession: '正在获取 sessions...',
      projectName,
    });

    try {
      // 1. 获取项目下的 sessions
      const sessionsRes = await fetch(`/api/knowledge/projects/${encodeURIComponent(projectPath)}/sessions`);
      if (!sessionsRes.ok) {
        throw new Error('获取 sessions 失败');
      }
      const sessionsData = await sessionsRes.json();
      const sessions = sessionsData.sessions || [];

      if (sessions.length === 0) {
        toast.info('该项目没有 session');
        return;
      }

      // 2. 逐个分析 sessions
      let totalItems = 0;
      for (let i = 0; i < Math.min(sessions.length, 5); i++) {
        const session = sessions[i];
        setAnalysisStatus(prev => ({
          ...prev,
          currentSession: session.title || `Session ${i + 1}`,
        }));

        // 分析单个 session
        const res = await fetch('/api/knowledge/analyze/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_path: projectPath,
            session_id: session.id,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          totalItems += data.count;
          // SWR 会自动重新验证知识列表
        }
      }

      toast.success(`萃取完成，共提取 ${totalItems} 个知识条目`);
    } catch (error) {
      toast.error('萃取失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setAnalysisStatus({
        isAnalyzing: false,
        currentSession: null,
        projectName: null,
      });
    }
  };

  const handleCancelAnalysis = () => {
    setAnalysisStatus({
      isAnalyzing: false,
      currentSession: null,
      projectName: null,
    });
    toast.info('已取消分析');
  };

  return (
    <div className="flex-1 flex gap-4 p-4 overflow-hidden">
      <ProjectList
        selectedProject={selectedProject}
        onSelectProject={setSelectedProject}
        onScanProjects={handleScanProjects}
      />
      {selectedProject ? (
        <KnowledgeList
          projectPath={selectedProject}
          onJumpToSession={onJumpToSession}
          onExtract={handleExtract}
          analysisStatus={analysisStatus}
          onCancelAnalysis={handleCancelAnalysis}
        />
      ) : (
        <div className="flex-1 bg-card rounded-lg border flex items-center justify-center text-muted-foreground text-sm">
          选择左侧项目查看知识条目
        </div>
      )}

      {showScanModal && (
        <ScanModal
          onClose={() => setShowScanModal(false)}
          onAddProjects={handleAddProjects}
        />
      )}
    </div>
  );
}
