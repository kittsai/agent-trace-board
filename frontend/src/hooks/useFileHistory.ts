/** 文件变更历史 hook */

import useSWR from 'swr';
import { fileHistoryAPI } from '../api/client';
import type { FileChange, FileChangeDiff } from '../types';

export function useFileChanges(sessionId: string | undefined) {
  const key = sessionId ? ['file-changes', sessionId] : null;
  const { data, error } = useSWR(key, () =>
    fileHistoryAPI.list(sessionId!)
  );

  return {
    fileChanges: (data?.items ?? []) as FileChange[],
    loading: !data && !error,
    error,
  };
}

export function useFileChangeDiff(
  sessionId: string | undefined,
  messageId: string | null
) {
  const key =
    sessionId && messageId ? ['file-diff', sessionId, messageId] : null;
  const { data, error } = useSWR(key, () =>
    fileHistoryAPI.getDiff(sessionId!, messageId!)
  );

  return {
    diff: data as FileChangeDiff | undefined,
    loading: !data && !error,
    error,
  };
}
