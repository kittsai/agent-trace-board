/**
 * 项目设置弹窗
 */

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface ProjectSettings {
  // 萃取提示词
  extractionPrompt: string;
  // 扫描频率: manual | hourly | daily | weekly
  scanFrequency: string;
  // 知识类型
  knowledgeTypes: string[];
  // 置信度阈值
  confidenceThreshold: number;
  // 自动审批
  autoApprove: boolean;
  // 默认同步级别
  defaultSyncLevel: 'project' | 'user';
}

const DEFAULT_SETTINGS: ProjectSettings = {
  extractionPrompt: `分析以下项目的执行过程，提取可复用知识。

## 提取维度
1. **代码规范** - 命名、格式、组织方式
2. **架构决策** - 技术选型、设计模式
3. **工具配置** - 环境、依赖、构建
4. **修复模式** - bug 原因、解决方案
5. **用户偏好** - 编码习惯、工作流

## 输出要求
- 每个类型最多 5 条
- 内容要具体，有明确证据
- 置信度基于证据强度`,
  scanFrequency: 'manual',
  knowledgeTypes: ['code_style', 'architecture', 'tool_config', 'fix_pattern', 'preference'],
  confidenceThreshold: 0.7,
  autoApprove: false,
  defaultSyncLevel: 'project',
};

const FREQUENCY_OPTIONS = [
  { value: 'manual', label: '手动' },
  { value: 'hourly', label: '每小时' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
];

const TYPE_OPTIONS = [
  { value: 'code_style', label: '代码规范' },
  { value: 'architecture', label: '架构决策' },
  { value: 'tool_config', label: '工具配置' },
  { value: 'fix_pattern', label: '修复模式' },
  { value: 'preference', label: '用户偏好' },
];

interface SettingsModalProps {
  onClose: () => void;
  onSave: (settings: ProjectSettings) => void;
}

export function SettingsModal({ onClose, onSave }: SettingsModalProps) {
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);

  // 从 localStorage 加载设置
  useEffect(() => {
    const saved = localStorage.getItem('knowledge-global-settings');
    if (saved) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
      } catch {}
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('knowledge-global-settings', JSON.stringify(settings));
    onSave(settings);
    onClose();
  };

  const toggleType = (type: string) => {
    setSettings(prev => ({
      ...prev,
      knowledgeTypes: prev.knowledgeTypes.includes(type)
        ? prev.knowledgeTypes.filter(t => t !== type)
        : [...prev.knowledgeTypes, type],
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[600px] max-h-[80vh] bg-card rounded-lg border shadow-lg flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="text-sm font-semibold">知识萃取设置</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">全局配置</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-auto p-4 space-y-5">
          {/* 扫描频率 */}
          <div>
            <label className="text-xs font-medium text-card-foreground block mb-2">
              扫描频率
            </label>
            <div className="flex gap-2">
              {FREQUENCY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`px-3 py-1.5 text-xs rounded border ${
                    settings.scanFrequency === opt.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
                  onClick={() => setSettings(prev => ({ ...prev, scanFrequency: opt.value }))}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 知识类型 */}
          <div>
            <label className="text-xs font-medium text-card-foreground block mb-2">
              知识类型
            </label>
            <div className="flex flex-wrap gap-2">
              {TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`px-3 py-1.5 text-xs rounded border ${
                    settings.knowledgeTypes.includes(opt.value)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
                  onClick={() => toggleType(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 置信度阈值 */}
          <div>
            <label className="text-xs font-medium text-card-foreground block mb-2">
              置信度阈值: {Math.round(settings.confidenceThreshold * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.confidenceThreshold * 100}
              onChange={e => setSettings(prev => ({
                ...prev,
                confidenceThreshold: parseInt(e.target.value) / 100,
              }))}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>0% - 显示所有</span>
              <span>100% - 只显示高置信度</span>
            </div>
          </div>

          {/* 自动审批 */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs font-medium text-card-foreground block">
                自动审批
              </label>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                高于阈值的知识条目自动批准
              </p>
            </div>
            <button
              className={`w-10 h-5 rounded-full transition-colors ${
                settings.autoApprove ? 'bg-primary' : 'bg-muted'
              }`}
              onClick={() => setSettings(prev => ({ ...prev, autoApprove: !prev.autoApprove }))}
            >
              <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
                settings.autoApprove ? 'translate-x-5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {/* 默认同步级别 */}
          <div>
            <label className="text-xs font-medium text-card-foreground block mb-2">
              默认同步级别
            </label>
            <div className="flex gap-2">
              <button
                className={`px-3 py-1.5 text-xs rounded border ${
                  settings.defaultSyncLevel === 'project'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
                onClick={() => setSettings(prev => ({ ...prev, defaultSyncLevel: 'project' }))}
              >
                项目级 (.claude/CLAUDE.md)
              </button>
              <button
                className={`px-3 py-1.5 text-xs rounded border ${
                  settings.defaultSyncLevel === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
                onClick={() => setSettings(prev => ({ ...prev, defaultSyncLevel: 'user' }))}
              >
                用户级 (~/.claude/CLAUDE.md)
              </button>
            </div>
          </div>

          {/* 萃取提示词 */}
          <div>
            <label className="text-xs font-medium text-card-foreground block mb-2">
              萃取提示词
            </label>
            <textarea
              value={settings.extractionPrompt}
              onChange={e => setSettings(prev => ({ ...prev, extractionPrompt: e.target.value }))}
              className="w-full h-40 text-xs font-mono border rounded p-2 resize-none"
              placeholder="输入知识萃取的提示词..."
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              自定义知识萃取的分析提示词
            </p>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <button
            className="px-3 py-1.5 text-xs border rounded hover:bg-accent"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
            onClick={handleSave}
          >
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
