/** API 客户端 */

import type { Session, Step, Stats, Turn, FileChange, FileChangeDiff, TodoTask, CostAnalysis, SubagentSummary, SubagentTrace } from '../types';

const BASE = '/api';

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface Project {
  id: string;
  name: string;
  path: string;
  session_count: number;
  active_count: number;
}

// Projects
export const projectsAPI = {
  list: () => fetchJSON<Project[]>(`${BASE}/projects`),
};

// Sessions
export const sessionsAPI = {
  list: (params?: { project?: string; search?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) qs.set(k, v);
      });
    }
    return fetchJSON<{ items: Session[]; total: number }>(`${BASE}/sessions?${qs}`);
  },

  get: (id: string) => fetchJSON<Session>(`${BASE}/sessions/${id}`),
};

// Traces
export const tracesAPI = {
  getTurns: (sessionId: string) =>
    fetchJSON<Turn[]>(`${BASE}/sessions/${sessionId}/turns`),

  getSteps: (sessionId: string, params?: { type?: string; tool_name?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) qs.set(k, v);
      });
    }
    return fetchJSON<Step[]>(`${BASE}/sessions/${sessionId}/steps?${qs}`);
  },

  getStats: (sessionId: string) =>
    fetchJSON<Stats>(`${BASE}/sessions/${sessionId}/stats`),
};

// File history
export const fileHistoryAPI = {
  list: (sessionId: string) =>
    fetchJSON<{ items: FileChange[]; total: number }>(
      `${BASE}/sessions/${sessionId}/file-changes`
    ),

  getDiff: (sessionId: string, messageId: string) =>
    fetchJSON<FileChangeDiff>(
      `${BASE}/sessions/${sessionId}/file-changes/${messageId}`
    ),
};

// Todos
export const todosAPI = {
  list: (sessionId: string) =>
    fetchJSON<{ items: TodoTask[]; total: number }>(
      `${BASE}/sessions/${sessionId}/todos`
    ),
};

// Cost analysis
export const costAPI = {
  get: (sessionId: string) =>
    fetchJSON<CostAnalysis>(`${BASE}/sessions/${sessionId}/cost`),
};

// Subagents
export const subagentsAPI = {
  list: (sessionId: string) =>
    fetchJSON<{ items: SubagentSummary[]; total: number }>(
      `${BASE}/sessions/${sessionId}/subagents`
    ),
  getTrace: (sessionId: string, toolUseId: string) =>
    fetchJSON<SubagentTrace>(`${BASE}/sessions/${sessionId}/subagents/${toolUseId}`),
};
