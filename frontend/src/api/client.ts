/** API 客户端 */

import type { Session, Step, Stats, Turn } from '../types';

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
