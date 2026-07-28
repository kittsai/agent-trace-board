/**
 * Knowledge 页面
 */

import { useState } from 'react';
import { ProjectList } from '@/components/knowledge/ProjectList';
import { KnowledgeList } from '@/components/knowledge/KnowledgeList';
import { ScanModal } from '@/components/knowledge/ScanModal';
import { toast } from 'sonner';

interface KnowledgeProps {
  onJumpToSession?: (sessionId: string) => void;
}

export function Knowledge({ onJumpToSession }: KnowledgeProps) {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);

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
        window.location.reload();
      } else {
        toast.error('添加失败');
      }
    } catch {
      toast.error('添加失败');
    }
  };

  return (
    <div className="flex-1 flex gap-4 p-4 overflow-hidden">
      <ProjectList
        selectedProject={selectedProject}
        onSelectProject={setSelectedProject}
        onScanProjects={handleScanProjects}
      />
      {selectedProject ? (
        <KnowledgeList projectPath={selectedProject} onJumpToSession={onJumpToSession} />
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
