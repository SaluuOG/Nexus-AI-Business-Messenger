import { AlarmClock, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNetworkStatus } from '../features/connection/useNetworkStatus';
import { bookmarkTarget } from '../features/data/messageBookmarks';
import { changeMessageReminder, loadMessageReminders, reminderDate, ReminderError, watchReminders, type MessageReminder, type ReminderIntent, type ReminderPage } from '../features/data/messageReminders';
import { MessageReminderDialog } from './MessageReminderDialog';
import '../message-reminders.css';

const empty = (): ReminderPage => ({ items: [], has_more: false, next_cursor: null, due_count: 0, server_now: new Date().toISOString() });
export function MessageReminders({ currentUserId }: { currentUserId: string }) {
  const online = useNetworkStatus();
  const [mode, setMode] = useState<'due' | 'all'>('due'), [revision, setRevision] = useState(0);
  const [page, setPage] = useState<ReminderPage>(empty), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<MessageReminder | null>(null), [writeError, setWriteError] = useState<string | null>(null), [pending, setPending] = useState(new Set<string>());
  const alive = useRef(false), generation = useRef(0), busy = useRef(false), writes = useRef(new Set<string>()), intents = useRef(new Map<string, ReminderIntent>());
  const scope = JSON.stringify([currentUserId, mode, online, revision]);
  const [resultScope, setResultScope] = useState(scope);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const token = ++generation.current;
    setPage(empty()); setError(null); setResultScope(scope); busy.current = false;
    if (!online) { setLoading(false); return; }
    busy.current = true; setLoading(true);
    void loadMessageReminders(currentUserId, mode).then(result => { if (generation.current === token) setPage(result); })
      .catch(reason => { if (generation.current === token) setError(reason.message); })
      .finally(() => { if (generation.current === token) { busy.current = false; setLoading(false); } });
    return () => { ++generation.current; };
  }, [scope, currentUserId, mode, online]);
  useEffect(() => online ? watchReminders(currentUserId, () => setRevision(n => n + 1)) : undefined, [currentUserId, online]);
  const loadMore = async () => {
    if (!online || busy.current || !page.next_cursor || resultScope !== scope) return;
    const token = generation.current; busy.current = true; setLoading(true); setError(null);
    try {
      const result = await loadMessageReminders(currentUserId, mode, page.next_cursor);
      if (token === generation.current) setPage(previous => ({ ...result, items: [...previous.items, ...result.items.filter(row => !previous.items.some(old => old.id === row.id))] }));
    } catch (reason) { if (token === generation.current) { setPage(empty()); setError(reason instanceof Error ? reason.message : 'Wiedervorlagen nicht erreichbar.'); } }
    finally { if (token === generation.current) { busy.current = false; setLoading(false); } }
  };
  const complete = async (row: MessageReminder) => {
    if (!online || writes.current.has(row.id)) return;
    // Freeze the version and request ID until a response confirms the result.
    const intent = intents.current.get(row.id) ?? { version: row.version, requestId: crypto.randomUUID(), dueAt: null };
    intents.current.set(row.id, intent); writes.current.add(row.id); setPending(new Set(writes.current)); setWriteError(null);
    try { await changeMessageReminder(currentUserId, row.kind, row.message_id, intent); intents.current.delete(row.id); }
    catch (reason) {
      if (reason instanceof ReminderError && ['40001','22023','42501'].includes(reason.code)) intents.current.delete(row.id);
      if (alive.current) setWriteError(reason instanceof Error ? reason.message : 'Änderung nicht bestätigt. Bitte erneut versuchen.');
    } finally { writes.current.delete(row.id); if (alive.current) setPending(new Set(writes.current)); }
  };
  const rows = online && scope === resultScope ? page.items : [];
  return <section className="panel message-reminders" aria-labelledby="message-reminders-heading">
    <header><div><h2 id="message-reminders-heading"><AlarmClock size={21} />Deine Wiedervorlagen{online && !loading && !error && scope === resultScope && <span>{page.due_count} fällig</span>}</h2><p>Persönliche Erinnerungen an Nachrichten aus deinen Chats.</p></div><button type="button" className="secondary" aria-label="Wiedervorlagen aktualisieren" disabled={!online || loading} onClick={() => { setWriteError(null); setRevision(n => n + 1); }}><RefreshCw size={18} /></button></header>
    <div className="reminder-filters" role="group" aria-label="Wiedervorlagen filtern"><button type="button" className="secondary" aria-pressed={mode === 'due'} onClick={() => setMode('due')}>Fällig</button><button type="button" className="secondary" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>Alle offenen</button></div>
    {!online ? <p role="status">Wiedervorlagen sind mit Internetverbindung verfügbar.</p> : <>
      {error && <p className="data-alert" role="alert">{error} <button type="button" className="secondary" onClick={() => setRevision(n => n + 1)}>Wiedervorlagen erneut laden</button></p>}
      {writeError && <p className="data-alert" role="alert">{writeError}</p>}
      {loading && <p role="status">Wiedervorlagen werden geladen…</p>}
      {!loading && !error && rows.length === 0 && <p className="reminder-empty">{mode === 'due' ? 'Keine fälligen Wiedervorlagen.' : 'Keine offenen Wiedervorlagen.'} Wähle bei einer Nachricht „Später erinnern“.</p>}
      <div className="reminder-list">{rows.map(row => <article className="reminder-card" key={row.id} data-reminder-id={row.id}>
        <header><strong>{row.chat_name}</strong><span className={Date.parse(row.due_at) <= Date.parse(page.server_now) ? 'is-due' : ''}>{reminderDate(row.due_at)}{Date.parse(row.due_at) <= Date.parse(page.server_now) ? ' · Fällig' : ''}</span></header>
        <small>{row.kind === 'group' ? 'Gruppe' : 'Einzelchat'} · {row.sender_name}</small>
        {row.preview && <p>{row.preview}</p>}{row.attachment_name && <p>Anhang: {row.attachment_name}</p>}
        <footer><Link className="secondary" to={bookmarkTarget(row)}>Zur Nachricht</Link><button type="button" className="secondary" disabled={pending.has(row.id)} onClick={() => setEdit(row)}>Verschieben</button><button type="button" className="primary" disabled={pending.has(row.id)} onClick={() => void complete(row)}>{pending.has(row.id) ? 'Speichert…' : 'Erledigen'}</button></footer>
      </article>)}</div>
      {page.has_more && scope === resultScope && !error && <button type="button" className="secondary" disabled={loading} onClick={() => void loadMore()}>Weitere Wiedervorlagen laden</button>}
    </>}
    {edit && <MessageReminderDialog key={currentUserId + ':' + edit.id} currentUserId={currentUserId} source={{ kind: edit.kind, messageId: edit.message_id, body: edit.preview, chatName: edit.chat_name, attachmentName: edit.attachment_name ?? undefined }} onClose={() => { setEdit(null); setRevision(n => n + 1); }} />}
  </section>;
}
