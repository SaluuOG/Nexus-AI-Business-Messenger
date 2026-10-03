import { useEffect, useRef, useState } from 'react';
import { loadMessagePins, setMessagePin, subscribeMessagePins, type MessagePin, type PinKind } from './messagePins';

type State = { scope: string; rows: MessagePin[]; ready: boolean; error: string | null; writeError: string | null; pending: Set<string> };
type Controller = { scope: string; alive: boolean; revision: number; pending: Set<string>; refresh: () => Promise<void> };
const noPins: MessagePin[] = [];

export function useMessagePins(kind: PinKind, chatId: string | undefined, userId: string | undefined, enabled: boolean, canManage: boolean) {
  const scope = JSON.stringify([kind, chatId, userId]);
  const [state, setState] = useState<State>({ scope, rows: [], ready: false, error: null, writeError: null, pending: new Set() });
  const controller = useRef<Controller | null>(null);
  useEffect(() => {
    const current: Controller = { scope, alive: true, revision: 0, pending: new Set(), refresh: async () => {} };
    controller.current = current;
    const valid = () => current.alive && controller.current === current;
    setState({ scope, rows: [], ready: false, error: null, writeError: null, pending: new Set() });
    if (!enabled || !chatId || !userId) return () => { current.alive = false; };
    current.refresh = async () => {
      if (!valid() || navigator.onLine === false) return;
      const revision = ++current.revision;
      try {
        const rows = await loadMessagePins(kind, chatId);
        if (valid() && revision === current.revision) setState(previous => ({ ...previous, rows, ready: true, error: null }));
      } catch {
        // Do not retain previews if membership/access was revoked.
        if (valid() && revision === current.revision) setState(previous => ({ ...previous, rows: [], ready: false, error: 'Angeheftete Nachrichten konnten nicht geladen werden.' }));
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void current.refresh(), 80); };
    const resume = () => { if (document.visibilityState === 'visible') schedule(); };
    const unsubscribe = subscribeMessagePins(kind, chatId, schedule);
    const interval = setInterval(resume, 30_000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', schedule);
    void current.refresh();
    return () => {
      current.alive = false; clearTimeout(timer); clearInterval(interval); unsubscribe();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', schedule);
    };
  }, [scope, kind, chatId, userId, enabled]);
  const matching = enabled && state.scope === scope;
  const rows = matching ? state.rows : noPins;
  const ready = matching && state.ready;
  const save = async (messageId: string, pinned: boolean) => {
    const current = controller.current;
    if (!ready || !canManage || !chatId || !current?.alive || current.scope !== scope || current.pending.has(messageId) || navigator.onLine === false) return;
    current.pending.add(messageId); current.revision++;
    setState(previous => ({ ...previous, writeError: null, pending: new Set(current.pending) }));
    try {
      await setMessagePin(kind, chatId, messageId, pinned);
      if (current.alive && controller.current === current) await current.refresh();
    } catch {
      if (current.alive && controller.current === current) setState(previous => ({ ...previous, writeError: 'Anheftung konnte nicht gespeichert werden. Prüfe deine Verbindung und deine Berechtigung.' }));
    } finally {
      current.pending.delete(messageId);
      if (current.alive && controller.current === current) setState(previous => ({ ...previous, pending: new Set(current.pending) }));
    }
  };
  return {
    rows, ready,
    error: matching ? state.writeError || state.error : null,
    pending: (id: string) => matching && state.pending.has(id),
    isPinned: (id: string) => rows.some(row => row.message_id === id),
    set: (id: string, value: boolean) => void save(id, value),
    refresh: () => { if (controller.current?.scope === scope) { setState(previous => ({ ...previous, writeError: null })); void controller.current.refresh(); } },
  };
}
