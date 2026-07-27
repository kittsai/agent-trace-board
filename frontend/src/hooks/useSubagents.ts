/** 子 agent 列表 hook */

import useSWR from 'swr';
import { subagentsAPI } from '../api/client';
import type { SubagentSummary } from '../types';

export function useSubagents(sessionId: string | undefined) {
  const key = sessionId ? ['subagents', sessionId] : null;
  const { data, error } = useSWR(key, () => subagentsAPI.list(sessionId!));

  return {
    subagents: (data?.items ?? []) as SubagentSummary[],
    loading: !data && !error,
    error,
  };
}
