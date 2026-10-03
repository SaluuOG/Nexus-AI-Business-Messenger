import { useEffect, useRef, useState } from 'react';
import { loadMessageReactions, setMessageReaction, subscribeMessageReactions, type MessageReaction, type ReactionEmoji, type ReactionKind } from './messageReactions';

type State = { scope: string; rows: MessageReaction[]; loaded: boolean; error: string | null; writeError: string | null; pending: Set<string> };
type Controller = { scope: string; alive: boolean; refresh: () => Promise<void>; pending: Set<string>; revision: number };
const emptyRows: MessageReaction[] = [];

export function useMessageReactions(kind: ReactionKind, chatId: string | undefined, userId: string | undefined, messageIds: string[], enabled: boolean) {
  const scope = JSON.stringify([kind, chatId, userId]);
  const idsKey = JSON.stringify([...new Set(messageIds)].sort());
  const [state, setState] = useState<State>({ scope, rows: [], loaded: false, error: null, writeError: null, pending: new Set() });
  const controller = useRef<Controller | null>(null);

  useEffect(() => {
    const ids = JSON.parse(idsKey) as string[];
    const current: Controller = { scope, alive: true, refresh: async () => {}, pending: new Set(), revision: 0 };
    controller.current = current;
    const valid = () => current.alive && controller.current === current;
    setState(previous => ({ scope, rows: previous.scope === scope ? previous.rows.filter(row => ids.includes(row.message_id)) : [], loaded: false, error: null, writeError: null, pending: new Set() }));
    if (!enabled || !chatId || !userId || !ids.length) return () => { current.alive = false; };
    current.refresh = async () => {
      if (!valid() || navigator.onLine === false) return;
      const revision = ++current.revision;
      try {
        const rows = await loadMessageReactions(kind, chatId, ids);
        if (valid() && revision === current.revision) setState(previous => ({ ...previous, scope, rows, loaded: true, error: null }));
      } catch {
        if (valid() && revision === current.revision) setState(previous => ({ ...previous, scope, loaded: false, error: 'Reaktionen konnten nicht geladen werden.' }));
      }
    };
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(scheduled);
      scheduled = setTimeout(() => { void current.refresh(); }, 80);
    };
    const unsubscribe = subscribeMessageReactions(kind, chatId, schedule);
    const resume = () => { if (document.visibilityState === 'visible') schedule(); };
    const interval = setInterval(resume, 30_000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', schedule);
    void current.refresh();
    return () => {
      current.alive = false;
      clearTimeout(scheduled); clearInterval(interval); unsubscribe();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', schedule);
    };
  }, [scope, kind, chatId, userId, idsKey, enabled]);

  const matching = state.scope === scope;
  const ready = Boolean(enabled && matching && state.loaded);
  const rows = matching ? state.rows : emptyRows;
  const save = async (messageId: string, emoji: ReactionEmoji | null) => {
    const current = controller.current;
    if (!ready || !chatId || !current?.alive || current.scope !== scope || current.pending.has(messageId) || !messageIds.includes(messageId) || navigator.onLine === false) return;
    current.pending.add(messageId); current.revision++;
    setState(previous => ({ ...previous, pending: new Set(current.pending), writeError: null }));
    try {
      await setMessageReaction(kind, chatId, messageId, emoji);
      if (current.alive && controller.current === current) await current.refresh();
    } catch {
      if (current.alive && controller.current === current) setState(previous => ({ ...previous, writeError: 'Die Reaktion konnte nicht gespeichert werden. Bitte versuche es erneut.' }));
    } finally {
      current.pending.delete(messageId);
      if (current.alive && controller.current === current) setState(previous => ({ ...previous, pending: new Set(current.pending) }));
    }
  };
  return {
    ready,
    error: enabled && matching ? state.writeError || state.error : null,
    refresh: () => { if (controller.current?.scope === scope) { setState(previous => ({ ...previous, writeError: null })); void controller.current.refresh(); } },
    forMessage: (id: string) => rows.filter(row => row.message_id === id),
    pending: (id: string) => matching && state.pending.has(id),
    choose: (id: string, emoji: ReactionEmoji) => void save(id, rows.some(row => row.message_id === id && row.emoji === emoji && row.mine) ? null : emoji),
    like: (id: string) => { if (!rows.some(row => row.message_id === id && row.emoji === '❤️' && row.mine)) void save(id, '❤️'); },
  };
}
