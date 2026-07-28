/** Knowledge 数据 Hook */

import useSWR from 'swr';
import { knowledgeAPI } from '../api/client';
import type { KnowledgeItem, KnowledgeProject, KnowledgeStats } from '../types';

export function useKnowledge(
  projectPath?: string,
  status?: string,
  type?: string
) {
  const params = { project_path: projectPath, status, type };
  const hasFilter = projectPath || status || type;
  const key = hasFilter ? ['knowledge', JSON.stringify(params)] : 'knowledge';

  const { data, error, mutate } = useSWR(key, () => knowledgeAPI.list(params));

  const approveItem = async (itemId: string) => {
    await knowledgeAPI.approve(itemId);
    mutate();
  };

  const rejectItem = async (itemId: string) => {
    await knowledgeAPI.reject(itemId);
    mutate();
  };

  const updateItem = async (itemId: string, updates: Partial<KnowledgeItem>) => {
    await knowledgeAPI.update(itemId, updates);
    mutate();
  };

  const batchApprove = async (itemIds: string[]) => {
    await knowledgeAPI.batchApprove(itemIds);
    mutate();
  };

  return {
    items: data || [],
    loading: !data && !error,
    error,
    approveItem,
    rejectItem,
    updateItem,
    batchApprove,
    refresh: mutate,
  };
}

export function useKnowledgeProjects() {
  const { data, error, mutate } = useSWR<KnowledgeProject[]>(
    'knowledge-projects',
    () => knowledgeAPI.getProjects()
  );

  return {
    projects: data || [],
    loading: !data && !error,
    error,
    refresh: mutate,
  };
}

export function useKnowledgeStats(projectPath?: string) {
  const key = projectPath
    ? ['knowledge-stats', projectPath]
    : 'knowledge-stats';

  const { data, error } = useSWR<KnowledgeStats>(
    key,
    () => knowledgeAPI.getStats(projectPath)
  );

  return {
    stats: data ?? null,
    loading: !data && !error,
    error,
  };
}
