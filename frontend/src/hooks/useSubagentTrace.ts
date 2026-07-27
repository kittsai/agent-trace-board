/** 单个子 agent trace hook */

import useSWR from 'swr';
import { subagentsAPI } from '../api/client';
import type { SubagentTrace } from '../types';

export function useSubagentTrace(sessionId: string | undefined, toolUseId: string | null) {
  const key = sessionId && toolUseId ? ['subagent-trace', sessionId, toolUseId] : null;
  const { data, error } = useSWR(key, () => subagentsAPI.getTrace(sessionId!, toolUseId!));

  return {
    trace: (data ?? null) as SubagentTrace | null,
    loading: !data && !error,
    error,
  };
}
