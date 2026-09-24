import { useEffect, useState } from 'react';
import { ArrowLeft, MessageCircle, WifiOff } from 'lucide-react';
import { readSavedChat, syncOfflineChatAccount, type ChatKind } from '../features/offline/chatCache';
import { offlineStamp } from '../features/offline/chatReads';
import './offlineChats.css';

// Only local snapshots are accessible here; there is deliberately no Auth User,
// composer, membership authority, API client, presence or realtime subscription.
export function OfflineChatsPage({ account, onClear }: { account: string; onClear: () => Promise<void> }) {
  const [kind, setKind] = useState<ChatKind>('direct');
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof readSavedChat>>>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setSnapshot(null);
    void (async () => {
      await syncOfflineChatAccount(account);
      const result = await readSavedChat(account, kind, selected?.id || 'list');
      if (active) { setSnapshot(result); setLoading(false); }
    })();
    return () => { active = false; };
  }, [account, kind, selected?.id]);

  return <main className="offline-reader">
    <header><MessageCircle size={28} /><b>Nexus</b><span><WifiOff size={16} /> Offline</span></header>
    <div className="offline-reader-content">
      <h1>{selected?.name || 'Gespeicherte Chats'}</h1>
      <p>Du kannst bereits gespeicherte Textnachrichten lesen. Neue Nachrichten und deine Anmeldung werden mit Internet wieder geprüft.</p>
      {selected ? <button className="secondary" onClick={() => setSelected(null)}><ArrowLeft size={16} /> Alle Chats</button>
        : <nav aria-label="Gespeicherte Chats"><button className={kind === 'direct' ? 'primary' : 'secondary'} onClick={() => setKind('direct')}>Chats</button><button className={kind === 'group' ? 'primary' : 'secondary'} onClick={() => setKind('group')}>Gruppen</button></nav>}
      {snapshot && <p role="status">{offlineStamp(snapshot.at)} · Bis zu 100 zuletzt geladene Nachrichten je Chat.</p>}
      {loading ? <p role="status">Gespeicherte Nachrichten werden geladen…</p> : !snapshot?.rows.length ? <p>Hier sind noch keine Textnachrichten gespeichert. Öffne den Chat einmal mit Internet.</p> :
        <div className={selected ? 'offline-reader-messages' : 'offline-reader-list'}>
          {snapshot.rows.map(row => selected ? <article key={String(row.message_id)} className={row.sender_id === account ? 'offline-message mine' : 'offline-message'}>
            <b>{row.sender_id === account ? 'Du' : String(row.sender_full_name || row.sender_username || selected.name)}</b>
            <p>{row.deleted_at ? 'Nachricht gelöscht' : String(row.body || '')}</p>
            <small>{new Date(String(row.created_at)).toLocaleString('de-DE')}{row.edited_at && !row.deleted_at ? ' · bearbeitet' : ''}</small>
          </article> : <button key={String(row.conversation_id || row.group_id)} className="secondary" onClick={() => setSelected({ id: String(row.conversation_id || row.group_id), name: String(row.name || row.full_name || row.username || 'Nexus-Kontakt') })}>
            <b>{String(row.name || row.full_name || row.username || 'Nexus-Kontakt')}</b><span>{String(row.last_message || '')}</span>
          </button>)}
        </div>}
      <button className="secondary" disabled={clearing} onClick={() => {
        if (!window.confirm('Alle auf diesem Gerät gespeicherten Offline-Chats löschen?')) return;
        setClearing(true); void onClear().finally(() => setClearing(false));
      }}>Gespeicherte Chats löschen</button>
    </div>
  </main>;
}
