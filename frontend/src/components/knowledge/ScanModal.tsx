/**
 * 扫描新项目弹窗
 */

import { useState, useEffect } from 'react';
import { Folder, X, Loader2 } from 'lucide-react';

interface DiscoveredProject {
  path: string;
  name: string;
  session_count: number;
  last_activity: string;
  is_new: boolean;
}

interface ScanModalProps {
  onClose: () => void;
  onAddProjects: (paths: string[]) => void;
}

export function ScanModal({ onClose, onAddProjects }: ScanModalProps) {
  const [scanning, setScanning] = useState(true);
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/knowledge/projects/scan');
        if (res.ok) {
          const data = await res.json();
          setProjects(data);
        }
      } catch (error) {
        console.error('Failed to scan projects:', error);
      } finally {
        setScanning(false);
      }
    };

    fetchProjects();
  }, []);

  const handleToggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleAdd = () => {
    onAddProjects(Array.from(selected));
    onClose();
  };

  const existingProjects = projects.filter((p) => !p.is_new);
  const newProjects = projects.filter((p) => p.is_new);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl w-[520px] max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-card-foreground">扫描新项目</h3>
              <p className="text-xs text-muted-foreground mt-0.5">从 ~/.claude/projects/ 发现的项目</p>
            </div>
            <button className="text-muted-foreground hover:text-muted-foreground" onClick={onClose}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 overflow-auto max-h-96 space-y-3">
          {scanning ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mb-2" />
              <span className="text-xs">正在扫描项目...</span>
            </div>
          ) : (
            <>
              {/* 已添加的项目 */}
              {existingProjects.length > 0 && (
                <>
                  <div className="text-[10px] text-muted-foreground font-medium mb-1">已添加的项目</div>
                  {existingProjects.map((project) => (
                    <div key={project.path} className="border rounded-lg p-3 bg-muted opacity-60">
                      <div className="flex items-center gap-3">
                        <input type="checkbox" className="rounded" disabled checked />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Folder className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs font-medium text-muted-foreground">{project.name}</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1 ml-6">{project.path}</div>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 bg-muted text-muted-foreground rounded">已添加</span>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* 发现的新项目 */}
              {newProjects.length > 0 && (
                <>
                  <div className="text-[10px] text-muted-foreground font-medium mb-1 mt-4">
                    发现 {newProjects.length} 个新项目
                  </div>
                  {newProjects.map((project) => (
                    <div
                      key={project.path}
                      className={`border rounded-lg p-3 hover:border-blue-200 cursor-pointer ${
                        selected.has(project.path) ? 'border-blue-300 bg-blue-50' : ''
                      }`}
                      onClick={() => handleToggle(project.path)}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={selected.has(project.path)}
                          onChange={() => handleToggle(project.path)}
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Folder className="w-4 h-4 text-blue-500" />
                            <span className="text-xs font-medium">{project.name}</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1 ml-6">{project.path}</div>
                          <div className="flex items-center gap-3 mt-1 ml-6">
                            <span className="text-[10px] text-muted-foreground">{project.session_count} 个 sessions</span>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <span className="text-[10px] text-muted-foreground">最后活动: {project.last_activity}</span>
                          </div>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">新项目</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t bg-muted">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {scanning ? (
                '扫描中...'
              ) : (
                <span>
                  发现 {newProjects.length} 个新项目，已选择 {selected.size} 个
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 text-xs border rounded hover:bg-accent" onClick={onClose}>
                取消
              </button>
              <button
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:bg-muted-foreground/50 disabled:cursor-not-allowed"
                onClick={handleAdd}
                disabled={selected.size === 0 || scanning}
              >
                添加选中项目
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
