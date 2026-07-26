/** Step / Turn 数据 hook */

import useSWR from 'swr';
import { tracesAPI } from '../api/client';
import type { Turn } from '../types';

export function useTurns(sessionId: string | undefined) {
  const key = sessionId ? ['turns', sessionId] : null;
  const { data, error, mutate } = useSWR(key, () => tracesAPI.getTurns(sessionId!));

  return {
    turns: (data ?? []) as Turn[],
    loading: !data && !error,
    error,
    refresh: mutate,
  };
}

export function useStats(sessionId: string | undefined) {
  const key = sessionId ? ['stats', sessionId] : null;
  const { data, error } = useSWR(key, () => tracesAPI.getStats(sessionId!));

  return {
    stats: data,
    loading: !data && !error,
    error,
  };
}
