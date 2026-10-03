import { useState } from 'react';
import { defaultNativePushOptions, parseNativePushOptions, type NativePushOptions } from '../features/notifications/nativePush';

const choices: { key: keyof NativePushOptions; label: string }[] = [
  { key: 'messages', label: 'Nachrichten aus Chats und Gruppen' },
  { key: 'assignments', label: 'Neue Aufgabenzuweisungen' },
  { key: 'comments', label: 'Kommentare und Erwähnungen zu Aufgaben' },
  { key: 'previews', label: 'Inhalte auf dem Sperrbildschirm anzeigen' },
];
export function NativePushPreparation({ userId }: { userId: string }) {
  const key = `nexus-native-push-draft-v1:${userId}`;
  const [options, setOptions] = useState(() => {
    try { return parseNativePushOptions(JSON.parse(localStorage.getItem(key) || 'null')); }
    catch { return { ...defaultNativePushOptions }; }
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  return <div>
    <p>Push für die iPhone-App ist noch nicht freigeschaltet. Du kannst deine Auswahl für dieses Gerät bereits vormerken. Es werden dadurch noch keine Mitteilungen gesendet.</p>
    <div className="notification-options">{choices.map(choice => <label className="notification-option" key={choice.key}>
      <span>{choice.label}</span>
      <input type="checkbox" checked={options[choice.key]} onChange={event => {
        setOptions(current => ({ ...current, [choice.key]: event.target.checked })); setSaved(false); setError(false);
      }} />
    </label>)}</div>
    <p className="push-note">Inhaltsvorschauen sind standardmäßig aus. Deine Hinweise innerhalb von Nexus bleiben verfügbar.</p>
    <button className="secondary" onClick={() => {
      try { localStorage.setItem(key, JSON.stringify(options)); setSaved(true); setError(false); }
      catch { setError(true); setSaved(false); }
    }}>Auswahl vormerken</button>
    {saved && <p role="status">Auswahl auf diesem Gerät vorgemerkt. Push bleibt bis zur Freischaltung ausgeschaltet.</p>}
    {error && <p role="alert">Die Auswahl konnte auf diesem Gerät nicht gespeichert werden.</p>}
  </div>;
}
