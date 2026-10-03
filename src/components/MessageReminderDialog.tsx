import { X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNetworkStatus } from '../features/connection/useNetworkStatus';
import { changeMessageReminder, loadMessageReminder, localReminderInput, parseReminderInput, reminderDate, reminderPreset, ReminderError, type ReminderIntent, type ReminderState } from '../features/data/messageReminders';
import type { MessageTaskOrigin } from '../features/data/messageTasks';
import '../message-reminders.css';

export function MessageReminderDialog({ source, currentUserId, onClose }: { source: MessageTaskOrigin; currentUserId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(false), busy = useRef(false), intent = useRef<ReminderIntent | null>(null);
  const heading = useId(), online = useNetworkStatus();
  const [current, setCurrent] = useState<ReminderState | null | undefined>();
  const [value, setValue] = useState(() => reminderPreset('twoHours'));
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0), [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false), [success, setSuccess] = useState<ReminderState | null>(null), [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => { alive.current = true; const node = dialog.current; node?.showModal(); return () => { alive.current = false; node?.close(); }; }, []);
  useEffect(() => {
    if (!online || attempted || success) return;
    let active = true; setLoading(true); setCurrent(undefined); setError(null);
    void loadMessageReminder(currentUserId, source.kind, source.messageId).then(result => {
      if (active) { setCurrent(result); if (result?.due_at) setValue(localReminderInput(new Date(result.due_at))); }
    }).catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentUserId, source.kind, source.messageId, revision, online, attempted, success]);
  const reload = () => { intent.current = null; setAttempted(false); setRevision(n => n + 1); };
  const save = async (complete = false) => {
    if (!online || busy.current || loading || current === undefined || success) return;
    setError(null);
    try {
      if (!intent.current) intent.current = { version: current?.version ?? null, requestId: crypto.randomUUID(), dueAt: complete ? null : parseReminderInput(value) };
      busy.current = true; setSaving(true); setAttempted(true);
      const result = await changeMessageReminder(currentUserId, source.kind, source.messageId, intent.current);
      if (alive.current) setSuccess(result);
    } catch (reason) {
      if (alive.current) {
        setError(reason instanceof Error ? reason.message : 'Änderung nicht bestätigt. Bitte erneut versuchen.');
        if (reason instanceof ReminderError && ['40001','22023','42501'].includes(reason.code)) { intent.current = null; setCurrent(undefined); }
      }
    } finally { busy.current = false; if (alive.current) setSaving(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void save(); };
  return createPortal(<dialog ref={dialog} className="message-reminder-dialog" aria-labelledby={heading} onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }}>
    <header><h2 id={heading}>{success ? success.due_at ? 'Wiedervorlage gespeichert' : 'Wiedervorlage erledigt' : 'Später erinnern'}</h2><button type="button" aria-label="Wiedervorlage schließen" disabled={saving} onClick={onClose}><X size={21} /></button></header>
    {success ? <><p role="status">{success.due_at ? 'Termin: ' + reminderDate(success.due_at) : 'Die Nachricht bleibt im Chat erhalten.'}</p><button type="button" className="primary" onClick={onClose}>Schließen</button></> : <>
      <p>Nur für dich. Fällige Wiedervorlagen erscheinen im Tagesbriefing, wenn du Nexus öffnest.</p>
      {!online && <p className="data-alert" role="status">Keine Internetverbindung. Änderungen sind wieder möglich, sobald du online bist.</p>}
      {loading && online && <p role="status">Wiedervorlage wird geladen…</p>}
      {error && <p className="data-alert" role="alert">{error} <button type="button" className="secondary" disabled={saving || !online} onClick={reload}>Aktuellen Stand laden</button></p>}
      {current !== undefined && <form onSubmit={submit}>
        <p className="reminder-source">{source.chatName}{current?.due_at && <small>Aktueller Termin: {reminderDate(current.due_at)}</small>}</p>
        <div className="reminder-presets"><button type="button" className="secondary" disabled={!online || attempted} onClick={() => setValue(reminderPreset('twoHours'))}>In zwei Stunden</button><button type="button" className="secondary" disabled={!online || attempted} onClick={() => setValue(reminderPreset('tomorrow'))}>Morgen um 09:00</button></div>
        <label htmlFor={heading + '-time'}>Datum und Uhrzeit<input id={heading + '-time'} type="datetime-local" value={value} onChange={event => setValue(event.target.value)} required disabled={!online || attempted} /></label>
        <p className="reminder-timezone">Ortszeit: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
        <footer>{current?.due_at && !attempted && <button type="button" className="secondary" disabled={!online || saving} onClick={() => void save(true)}>Erledigen</button>}<button type="submit" className="primary" disabled={!online || saving || loading}>{saving ? 'Speichert…' : attempted ? 'Erneut versuchen' : 'Termin speichern'}</button></footer>
      </form>}
    </>}
  </dialog>, document.body);
}
