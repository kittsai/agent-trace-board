/** Token / 成本分析 hook */

import useSWR from 'swr';
import { costAPI } from '../api/client';
import type { CostAnalysis } from '../types';

export function useCost(sessionId: string | undefined) {
  const key = sessionId ? ['cost', sessionId] : null;
  const { data, error } = useSWR(key, () => costAPI.get(sessionId!));

  return {
    analysis: (data ?? null) as CostAnalysis | null,
    loading: !data && !error,
    error,
  };
}
