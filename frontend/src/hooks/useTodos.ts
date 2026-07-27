/** 任务追踪 hook */

import useSWR from 'swr';
import { todosAPI } from '../api/client';
import type { TodoTask } from '../types';

export function useTodos(sessionId: string | undefined) {
  const key = sessionId ? ['todos', sessionId] : null;
  const { data, error } = useSWR(key, () => todosAPI.list(sessionId!));

  return {
    tasks: (data?.items ?? []) as TodoTask[],
    loading: !data && !error,
    error,
  };
}
