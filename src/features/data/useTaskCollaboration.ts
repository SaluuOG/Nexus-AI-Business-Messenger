import { useCallback, useEffect, useRef, useState } from 'react';
import { collaborationPageSize, emptyTaskCollaboration, loadTaskCollaboration, subscribeTaskCollaboration, unsubscribeTaskCollaboration } from './taskCollaboration';

// The view is keyed by account, workspace, task and role. A generation additionally
// rejects late responses after refresh/unmount even if the transport ignores abort.
export function useTaskCollaboration(workspaceId: string, taskId: string, focusedCommentId?: string | null) {
  const [data, setData] = useState(emptyTaskCollaboration);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const active = useRef(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const counts = useRef({ comments: collaborationPageSize, activity: collaborationPageSize });
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (active.current) setLoading(true);
    const result = await loadTaskCollaboration(workspaceId, taskId, counts.current, controller.signal, focusedCommentId);
    if (!active.current || id !== generation.current) return;
    setData(result.data); setError(result.error); setLoading(false);
  }, [workspaceId, taskId, focusedCommentId]);

  useEffect(() => {
    active.current = true;
    void refresh();
    let timer: number | undefined;
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void refresh(), 150); };
    const channel = subscribeTaskCollaboration(workspaceId, taskId, schedule);
    const focus = () => { if (document.visibilityState === 'visible') schedule(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    const poll = window.setInterval(focus, 30_000);
    return () => {
      active.current = false; generation.current++; request.current?.abort(); window.clearTimeout(timer); window.clearInterval(poll);
      window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus);
      void unsubscribeTaskCollaboration(channel);
    };
  }, [workspaceId, taskId, refresh]);

  const more = async (kind: 'comments' | 'activity') => {
    if (loading) return;
    const previous = counts.current[kind];
    counts.current = { ...counts.current, [kind]: previous + collaborationPageSize };
    await refresh();
  };
  return { data, error, loading, refresh, more };
}
