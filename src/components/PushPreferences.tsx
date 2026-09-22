import { useEffect, useRef, useState } from 'react';
import { BellRing, Smartphone } from 'lucide-react';
import { changePushOptions, defaultPushStatus, disablePush, enablePush, loadPushStatus, pushSupport, testPush, type ReminderOptions, type PushStatus } from '../features/notifications/push';

const options: { id: 'messages' | 'assignments' | 'comments' | 'previews'; label: string; detail: string }[] = [
  { id: 'messages', label: 'Chats und Gruppen', detail: 'Neue Nachrichten auf diesem Gerät.' },
  { id: 'assignments', label: 'Neue Zuweisungen', detail: 'Wenn dir jemand eine Aufgabe zuweist.' },
  { id: 'comments', label: 'Kommentare zu Aufgaben', detail: 'Bei deinen Aufgaben und Gesprächen, an denen du beteiligt bist.' },
  { id: 'previews', label: 'Inhalte auf dem Sperrbildschirm', detail: 'Namen und eine kurze Vorschau anzeigen. Standardmäßig ausgeschaltet.' },
];

function ReminderPreferences({ status, busy, save }: { status: PushStatus; busy: boolean; save: (value: ReminderOptions) => void }) {
  const [draft, setDraft] = useState<ReminderOptions>({ deadlines: status.deadlines, reminder_before: status.reminder_before,
    reminder_due: status.reminder_due, reminder_time: status.reminder_time,
    reminder_timezone: status.reminder_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
  const zones = [...new Set([draft.reminder_timezone, 'Europe/Berlin', 'UTC', ...(Intl.supportedValuesOf?.('timeZone') || [])])].sort();
  const valid = !draft.deadlines || draft.reminder_before || draft.reminder_due;
  return <form className="push-reminders" onSubmit={event => { event.preventDefault(); if (valid && !busy) save(draft); }}>
    <fieldset disabled={busy}>
      <legend>Aufgaben-Erinnerungen</legend>
      <label className="notification-option"><span><b>Fristerinnerungen auf diesem Gerät</b><small>Für offene Aufgaben, die dir zugewiesen sind – auch bei geschlossener App.</small></span>
        <input type="checkbox" role="switch" checked={draft.deadlines} onChange={e => setDraft({ ...draft, deadlines: e.target.checked })} /></label>
      {draft.deadlines && <div className="reminder-fields">
        <label className="reminder-check"><input type="checkbox" checked={draft.reminder_before} onChange={e => setDraft({ ...draft, reminder_before: e.target.checked })} />Am Vortag</label>
        <label className="reminder-check"><input type="checkbox" checked={draft.reminder_due} onChange={e => setDraft({ ...draft, reminder_due: e.target.checked })} />Am Fälligkeitstag</label>
        <label>Uhrzeit<input type="time" required step="60" value={draft.reminder_time} onChange={e => setDraft({ ...draft, reminder_time: e.target.value })} /></label>
        <label>Zeitzone<select value={draft.reminder_timezone} onChange={e => setDraft({ ...draft, reminder_timezone: e.target.value })}>{zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></label>
        <p className="push-note">Die gewählte Zeitzone bleibt auch auf Reisen erhalten. Erledigte Aufgaben und geänderte Termine werden vor dem Versand berücksichtigt. „Fällige Aufgaben“ unter „Deine Hinweise“ muss eingeschaltet sein.</p>
        {!valid && <p role="alert" className="form-feedback error">Wähle mindestens einen Erinnerungstag.</p>}
      </div>}
      <button className="secondary" type="submit" disabled={!valid}>Erinnerungen speichern</button>
    </fieldset>
  </form>;
}

export function PushPreferences({ userId }: { userId: string }) {
  const support = pushSupport();
  const [status, setStatus] = useState<PushStatus>(defaultPushStatus);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const mounted = useRef(true);
  const working = useRef(false);
  useEffect(() => {
    let active = true; mounted.current = true;
    if (support === 'supported') {
      void loadPushStatus(userId).then(value => { if (active) setStatus(value); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    } else setBusy(false);
    return () => { active = false; mounted.current = false; };
  }, [userId, support]);
  const run = async (action: () => Promise<PushStatus | void>, message = '') => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setFeedback('');
    try {
      const next = await action();
      if (mounted.current) { if (next) setStatus(next); setFeedback(message); }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Bitte erneut versuchen.'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="panel push-preferences" aria-labelledby="push-title">
    <h3 id="push-title"><Smartphone size={20} aria-hidden="true" /> Auf diesem Gerät</h3>
    <p>Erhalte Hinweise auch dann, wenn Nexus geschlossen ist. Push wird für jedes Gerät einzeln aktiviert.</p>
    {support === 'install' ? <p>Öffne Nexus in Safari → Teilen → Zum Home-Bildschirm. Starte Nexus anschließend über das App-Symbol und aktiviere hier die Benachrichtigungen. Dafür brauchst du mindestens iOS / iPadOS 16.4.</p>
      : support === 'unavailable' ? <p>Dieser Browser unterstützt Push hier nicht. Öffne Nexus in einem aktuellen Browser. Deine Hinweise innerhalb von Nexus bleiben verfügbar.</p>
      : <>
        <p className="push-state"><BellRing size={17} aria-hidden="true" />{busy ? 'Wird geprüft …' : status.enabled ? 'Push ist auf diesem Gerät aktiv.' : 'Push ist auf diesem Gerät ausgeschaltet.'}</p>
        {status.enabled ? <>
          <div className="notification-options">{options.map(option => <label key={option.id} className="notification-option">
            <span><b>{option.label}</b><small>{option.detail}</small></span>
            <input type="checkbox" role="switch" aria-label={option.label} checked={status[option.id]} disabled={busy} onChange={e => void run(() => changePushOptions(userId, { [option.id]: e.target.checked }), 'Geräteeinstellung gespeichert.')} />
          </label>)}</div>
          <ReminderPreferences key={JSON.stringify([status.deadlines, status.reminder_before, status.reminder_due, status.reminder_time, status.reminder_timezone])}
            status={status} busy={busy} save={value => void run(() => changePushOptions(userId, value), 'Erinnerungen gespeichert.')} />
          <div className="push-actions">
            <button className="secondary" disabled={busy} onClick={() => void run(() => testPush(userId), 'Test angefordert. Prüfe jetzt die Mitteilungen auf deinem Gerät.')}>Test senden</button>
            <button className="secondary" disabled={busy} onClick={() => void run(() => disablePush(userId), 'Push wurde auf diesem Gerät ausgeschaltet.')}>Auf diesem Gerät ausschalten</button>
          </div>
        </> : <button className="primary" disabled={busy} onClick={() => void run(() => enablePush(userId), 'Push aktiviert. Mit „Test senden“ kannst du die Zustellung prüfen.')}>Push aktivieren</button>}
        <p className="push-note">Die Kontoeinstellungen unter „Deine Hinweise“ gelten zusätzlich. Bereits gelesene Hinweise werden vor dem Versand übersprungen. Beim Abmelden wird dieses Gerät getrennt.</p>
      </>}
    {error && <p className="form-feedback error" role="alert">{error}</p>}
    {feedback && <p className="notification-saved" role="status">{feedback}</p>}
  </section>;
}
