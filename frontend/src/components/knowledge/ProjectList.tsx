/**
 * 项目列表组件
 */

import { useState } from 'react';
import { Settings } from 'lucide-react';
import { useKnowledgeProjects } from '@/hooks/useKnowledge';
import { SettingsModal } from './SettingsModal';

interface ProjectListProps {
  selectedProject: string | null;
  onSelectProject: (path: string | null) => void;
  onScanProjects: () => void;
}

export function ProjectList({
  selectedProject,
  onSelectProject,
  onScanProjects,
}: ProjectListProps) {
  const { projects, loading } = useKnowledgeProjects();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="w-72 bg-card rounded-lg border flex flex-col">
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-card-foreground">Projects</h2>
          <div className="flex items-center gap-2">
            <button
              className="p-1 hover:bg-accent rounded"
              onClick={() => setShowSettings(true)}
              title="知识萃取设置"
            >
              <Settings className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button
              className="text-xs text-blue-600 hover:text-blue-700"
              onClick={onScanProjects}
            >
              扫描新项目
            </button>
          </div>
        </div>
        <input
          type="text"
          placeholder="搜索项目..."
          className="w-full text-xs border rounded px-2 py-1.5"
        />
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-1">
        {loading ? (
          <div className="text-xs text-muted-foreground text-center py-4">加载中...</div>
        ) : projects.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            暂无项目，点击"扫描新项目"添加
          </div>
        ) : (
          projects.map((project) => (
            <div
              key={project.path}
              className={`p-2.5 rounded border cursor-pointer ${
                selectedProject === project.path
                  ? 'border-blue-200 bg-blue-50'
                  : 'border hover:bg-accent'
              }`}
              onClick={() => onSelectProject(project.path)}
            >
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                <span className="text-xs font-medium">
                  {project.path.split('/').pop()}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 ml-6 truncate">
                {project.path}
              </div>
              <div className="flex items-center gap-3 mt-2 ml-6">
                <span className="text-[10px] text-muted-foreground">
                  {project.total_items} 个知识条目
                </span>
                {project.pending_items > 0 && (
                  <span className="text-[10px] text-amber-600">
                    {project.pending_items} 待审批
                  </span>
                )}
                {project.synced_items > 0 && (
                  <span className="text-[10px] text-green-600">
                    {project.synced_items} 已同步
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSave={(settings) => {
            console.log('Settings saved:', settings);
            // TODO: 保存到后端
          }}
        />
      )}
    </div>
  );
}
