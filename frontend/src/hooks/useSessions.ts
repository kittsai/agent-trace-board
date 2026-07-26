/** Session 数据 hook */

import useSWR from 'swr';
import { sessionsAPI } from '../api/client';

export function useSessions(params?: { project?: string; search?: string; status?: string }) {
  const key = ['sessions', JSON.stringify(params)];
  const { data, error, mutate } = useSWR(key, () => sessionsAPI.list(params));

  return {
    sessions: data?.items ?? [],
    total: data?.total ?? 0,
    loading: !data && !error,
    error,
    refresh: mutate,
  };
}
