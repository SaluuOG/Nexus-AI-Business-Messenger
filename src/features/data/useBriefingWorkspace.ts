import { retryRead } from './readRetry';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadBriefingWorkspace, subscribeToBusinessWorkspace, unsubscribeBusinessWorkspace,
  type BusinessConnection, type NexusProject, type NexusProjectTask,
} from './businessData';

type Snapshot = {
  scope: string; projects: NexusProject[]; tasks: NexusProjectTask[];
  loading: boolean; error: string | null; updatedAt: Date | null;
};
const emptySnapshot = (scope: string, loading: boolean): Snapshot => ({
  scope, projects: [], tasks: [], loading, error: null, updatedAt: null,
});

export function useBriefingWorkspace(workspaceId: string | null, currentUserId?: string) {
  const scope = workspaceId + ':' + currentUserId;
  const [snapshot, setSnapshot] = useState(() => emptySnapshot(scope, Boolean(workspaceId)));
  const [connection, setConnection] = useState<BusinessConnection>('connecting');
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++version.current;
    if (!workspaceId || !currentUserId) {
      setSnapshot(emptySnapshot(scope, false));
      return;
    }
    setSnapshot(current => ({ ...(current.scope === scope ? current : emptySnapshot(scope, true)), loading: true }));
    try {
      const result = await retryRead(() => loadBriefingWorkspace(workspaceId, currentUserId), () => request === version.current);
      if (request !== version.current) return;
      setSnapshot({
        scope, projects: result.projects, tasks: result.tasks,
        error: result.error, updatedAt: result.error ? null : new Date(), loading: false,
      });
    } catch {
      if (request !== version.current) return;
      setSnapshot({ ...emptySnapshot(scope, false), error: 'Das Briefing konnte nicht geladen werden. Bitte erneut aktualisieren.' });
    }
  }, [workspaceId, currentUserId, scope]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setConnection('connecting');
    void refresh();
    const schedule = () => {
      if (!active) return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (active) void refresh(); }, 150);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') schedule(); };
    const channel = workspaceId && currentUserId
      ? subscribeToBusinessWorkspace(workspaceId, schedule, state => { if (active) setConnection(state); })
      : null;
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // Also recover from missed notifications while a websocket reconnects.
    const interval = window.setInterval(onVisible, 60_000);
    return () => {
      active = false;
      ++version.current;
      clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      void unsubscribeBusinessWorkspace(channel);
    };
  }, [workspaceId, currentUserId, refresh]);

  // Never render data from the previous workspace while the next effect starts.
  return {
    ...(snapshot.scope === scope ? snapshot : emptySnapshot(scope, Boolean(workspaceId))),
    connection, refresh,
  };
}
