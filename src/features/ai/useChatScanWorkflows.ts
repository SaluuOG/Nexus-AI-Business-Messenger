import { useCallback, useEffect, useState } from 'react';
import { loadChatScanWorkflows, type ChatScanKind, type ChatScanWorkflowState } from './chatScan';

export function useChatScanWorkflows(kind: ChatScanKind, userId: string | undefined, historyVersion: string) {
  const scopeKey = `${userId ?? ''}:${kind}`;
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<{ scopeKey: string; states: Map<string, ChatScanWorkflowState>; ready: boolean; error: boolean }>({
    scopeKey: '', states: new Map(), ready: false, error: false,
  });
  const refresh = useCallback(() => setRefreshVersion(value => value + 1), []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let controller: AbortController | null = null;
    const load = async () => {
      if (document.hidden || !navigator.onLine) return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const values = await loadChatScanWorkflows(kind, request.signal);
        if (active && !request.signal.aborted) {
          setSnapshot({ scopeKey, states: new Map(values.map(value => [value.chatId, value])), ready: true, error: false });
        }
      } catch {
        if (active && !request.signal.aborted) setSnapshot({ scopeKey, states: new Map(), ready: false, error: true });
      }
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ kind?: string }>).detail?.kind === kind) void load();
    };
    const resume = () => { void load(); };
    const offline = () => {
      controller?.abort();
      setSnapshot({ scopeKey, states: new Map(), ready: false, error: true });
    };
    if (navigator.onLine) void load(); else offline();
    window.addEventListener('nexus:chat-scan-state-changed', changed);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', resume);
    const interval = setInterval(resume, 30000);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(interval);
      window.removeEventListener('nexus:chat-scan-state-changed', changed);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [kind, userId, scopeKey, historyVersion, refreshVersion]);

  const current = snapshot.scopeKey === scopeKey && Boolean(userId);
  return {
    states: current ? snapshot.states : new Map<string, ChatScanWorkflowState>(),
    ready: current && snapshot.ready,
    error: current && snapshot.error,
    refresh,
  };
}
