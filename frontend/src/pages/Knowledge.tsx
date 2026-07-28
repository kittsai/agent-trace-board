/**
 * Knowledge 页面
 */

import { useState } from 'react';
import { ProjectList } from '@/components/knowledge/ProjectList';
import { KnowledgeList } from '@/components/knowledge/KnowledgeList';

export function Knowledge() {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);

  const handleScanProjects = () => {
    setShowScanModal(true);
  };

  return (
    <div className="flex gap-4 h-full">
      <ProjectList selectedProject={selectedProject} onSelectProject={setSelectedProject} onScanProjects={handleScanProjects} />
      <KnowledgeList projectPath={selectedProject} />
    </div>
  );
}
