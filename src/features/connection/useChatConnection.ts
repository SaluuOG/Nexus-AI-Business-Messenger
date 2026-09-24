import { useCallback, useEffect, useState } from 'react';

export function useChatConnection(scope: string | null) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [channel, setChannel] = useState({ scope, status: 'CONNECTING', interrupted: false });
  useEffect(() => {
    const offline = () => { setOnline(false); setChannel({ scope, status: 'CONNECTING', interrupted: true }); };
    const restored = () => setOnline(true);
    window.addEventListener('offline', offline);
    window.addEventListener('online', restored);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', restored); };
  }, [scope]);
  const onStatus = useCallback((status: string) => setChannel(previous => ({
    scope, status, interrupted: (previous.scope === scope && previous.interrupted) || status !== 'SUBSCRIBED',
  })), [scope]);
  useEffect(() => {
    if (channel.scope !== scope || channel.status !== 'SUBSCRIBED' || !channel.interrupted) return;
    const timer = setTimeout(() => setChannel(previous => previous === channel ? { ...previous, interrupted: false } : previous), 5000);
    return () => clearTimeout(timer);
  }, [channel, scope]);
  const status = channel.scope === scope ? channel.status : 'CONNECTING';
  const message = !online
    ? !scope ? 'Keine Internetverbindung. Chats können gerade nicht aktualisiert werden.' : 'Keine Internetverbindung. Dein Nachrichtentext bleibt erhalten. Fehlgeschlagene Nachrichten kannst du später mit „Erneut senden“ abschicken.'
    : !scope ? null : status === 'SUBSCRIBED'
      ? channel.interrupted ? 'Live-Verbindung wiederhergestellt. Fehlgeschlagene Nachrichten bitte mit „Erneut senden“ abschicken.' : null
      : status === 'CONNECTING'
        ? 'Live-Verbindung wird hergestellt …'
        : 'Live-Verbindung unterbrochen. Die Verbindung wird erneut aufgebaut. Dein Nachrichtentext bleibt erhalten.';
  return { message, onStatus, online };
}
