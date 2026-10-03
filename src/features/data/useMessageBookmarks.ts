import { useEffect, useRef, useState } from 'react';
import { loadBookmarkStatus, setMessageBookmark, watchBookmarks, type BookmarkKind } from './messageBookmarks';

type State = { scope: string; ids: Set<string>; ready: boolean; pending: Set<string>; error: string | null; feedback: string | null };
type Controller = { scope: string; alive: boolean; revision: number; pending: Set<string>; refresh: () => Promise<void> };

export function useMessageBookmarks(kind: BookmarkKind, chatId: string | undefined, userId: string | undefined, messageIds: string[], enabled: boolean) {
  const messageKey = JSON.stringify(messageIds);
  const scope = JSON.stringify([kind, chatId, userId, messageKey]);
  const [state, setState] = useState<State>({ scope, ids: new Set(), ready: false, pending: new Set(), error: null, feedback: null });
  const controller = useRef<Controller | null>(null);
  useEffect(() => {
    const current: Controller = { scope, alive: true, revision: 0, pending: new Set(), refresh: async () => {} };
    controller.current = current;
    const valid = () => current.alive && controller.current === current;
    setState({ scope, ids: new Set(), ready: false, pending: new Set(), error: null, feedback: null });
    if (!enabled || !chatId || !userId) return () => { current.alive = false; };
    current.refresh = async () => {
      if (!valid() || navigator.onLine === false) return;
      const revision = ++current.revision;
      try {
        const ids = await loadBookmarkStatus(userId, kind, chatId, JSON.parse(messageKey) as string[]);
        if (valid() && revision === current.revision) setState(previous => ({ ...previous, ids, ready: true, error: null }));
      } catch {
        if (valid() && revision === current.revision) setState(previous => ({ ...previous, ids: new Set(), ready: false, error: 'Markierungen konnten nicht geladen werden.' }));
      }
    };
    const stop = watchBookmarks(userId, () => void current.refresh());
    void current.refresh();
    return () => { current.alive = false; stop(); };
  }, [scope, enabled, kind, chatId, userId, messageKey]);
  const matching = enabled && state.scope === scope;
  const save = async (id: string, saved: boolean) => {
    const current = controller.current;
    if (!matching || !state.ready || !userId || !current?.alive || current.scope !== scope || current.pending.has(id) || navigator.onLine === false) return;
    current.pending.add(id); ++current.revision;
    setState(previous => ({ ...previous, pending: new Set(current.pending), error: null, feedback: null }));
    try {
      await setMessageBookmark(userId, kind, id, saved);
      if (current.alive && controller.current === current) {
        setState(previous => ({ ...previous, feedback: saved ? 'Nachricht gemerkt.' : 'Markierung entfernt.' }));
        await current.refresh();
      }
    } catch {
      if (current.alive && controller.current === current) setState(previous => ({ ...previous, error: 'Markierung nicht bestätigt. Prüfe deine Verbindung und deinen Chat-Zugriff und versuche es erneut.' }));
    } finally {
      current.pending.delete(id);
      if (current.alive && controller.current === current) setState(previous => ({ ...previous, pending: new Set(current.pending) }));
    }
  };
  return { ready: matching && state.ready, has: (id: string) => matching && state.ids.has(id), pending: (id: string) => matching && state.pending.has(id),
    error: matching ? state.error : null, feedback: matching ? state.feedback : null,
    set: (id: string, saved: boolean) => void save(id, saved), refresh: () => { if (controller.current?.scope === scope) void controller.current.refresh(); } };
}
