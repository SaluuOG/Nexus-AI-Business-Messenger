import { Check, Forward, Search, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useNetworkStatus } from '../features/connection/useNetworkStatus';
import { forwardTargetKey, forwardTextMessage, loadForwardTargets, type ForwardTarget, type ForwardTargets } from '../features/data/messageForwarding';
import type { MessageTaskOrigin } from '../features/data/messageTasks';
import '../message-forwarding.css';

export function ForwardedLabel() {
  return <small className="message-forwarded-label"><Forward size={13} aria-hidden="true" />Weitergeleitet</small>;
}

export function MessageForwardDialog({ source, currentUserId, onClose }: { source: MessageTaskOrigin; currentUserId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), busy = useRef(false), alive = useRef(false);
  const heading = useId(), navigate = useNavigate(), online = useNetworkStatus();
  const [snapshot] = useState(() => ({ ...source }));
  const [requestId] = useState(() => crypto.randomUUID());
  const [query, setQuery] = useState(''), [revision, setRevision] = useState(0);
  const [targets, setTargets] = useState<ForwardTargets>({ items: [], has_more: false });
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<ForwardTarget | null>(null);
  const [confirming, setConfirming] = useState(false), [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false), [sent, setSent] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const changed = source.body !== snapshot.body || source.attachmentName !== snapshot.attachmentName;

  useLayoutEffect(() => {
    alive.current = true;
    const node = dialog.current; node?.showModal();
    return () => { alive.current = false; node?.close(); };
  }, []);
  useEffect(() => {
    if (confirming || !online) return;
    let active = true;
    setLoading(true); setLoadError(false); setSelected(null); setTargets({ items: [], has_more: false });
    const timer = setTimeout(() => {
      void loadForwardTargets(query).then(result => { if (active) setTargets(result); })
        .catch(() => { if (active) setLoadError(true); })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 200 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query, revision, confirming, online, currentUserId]);

  const send = async () => {
    if (busy.current || !selected || !confirming || !online || sent || (changed && !attempted)) return;
    busy.current = true; setSending(true); setAttempted(true); setError(null);
    // One immutable preview, destination and request ID for all manual retries.
    const result = await forwardTextMessage(currentUserId, snapshot, selected, requestId);
    if (!alive.current) return;
    busy.current = false; setSending(false);
    if (result.id) setSent(result.id); else setError(result.error);
  };

  return createPortal(<dialog ref={dialog} className="message-forward-dialog" aria-labelledby={heading} onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }}>
    <header><h2 id={heading}>{sent ? 'Nachricht weitergeleitet' : 'Nachricht weiterleiten'}</h2><button type="button" aria-label="Weiterleitung schließen" disabled={sending} onClick={onClose}><X size={21} /></button></header>
    {sent && selected ? <section className="forward-success" role="status"><Check size={30} aria-hidden="true" /><p>An <strong>{selected.name}</strong> gesendet.</p><footer><button type="button" className="secondary" onClick={onClose}>Zurück zum Chat</button><button type="button" className="primary" onClick={() => { onClose(); navigate(`/app/${selected.kind === 'group' ? 'groups?group=' : 'chats?conversation='}${encodeURIComponent(selected.chat_id)}&message=${encodeURIComponent(sent)}`); }}>Zielchat öffnen</button></footer></section> : <>
      {!online && <p className="data-alert" role="alert">Keine Internetverbindung. Weiterleiten ist wieder möglich, sobald du online bist.</p>}
      {changed && !attempted && <p className="data-alert" role="alert">Die Nachricht wurde geändert. Schließe die Vorschau und öffne sie erneut.</p>}
      {confirming && selected ? <>
        <p className="forward-destination">An <strong>{selected.name}</strong> · {selected.kind === 'group' ? 'Gruppe' : 'Einzelchat'}</p>
        <p>Dieser Text wird für die Teilnehmer des Zielchats sichtbar:</p>
        <div className="forward-preview"><ForwardedLabel /><p>{snapshot.body}</p></div>
        {error && <p className="data-alert" role="alert">{error}</p>}
        <footer><button type="button" className="secondary" disabled={sending} onClick={attempted ? onClose : () => setConfirming(false)}>{attempted ? 'Schließen' : 'Zurück'}</button><button type="button" className="primary" disabled={sending || !online || (changed && !attempted)} onClick={() => void send()}>{sending ? 'Sendet…' : attempted ? 'Erneut versuchen' : 'Jetzt weiterleiten'}</button></footer>
      </> : <>
        <p>Wähle einen bestehenden Chat. Im nächsten Schritt prüfst du die Vorschau.</p>
        <label className="forward-search" htmlFor={heading + '-query'}><Search size={18} aria-hidden="true" /><span className="sr-only">Zielchat suchen</span><input id={heading + '-query'} type="search" placeholder="Zielchat suchen" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} disabled={!online} autoFocus /></label>
        {loading && online ? <p role="status">Chats werden geladen…</p> : loadError ? <p className="data-alert" role="alert">Chats konnten nicht geladen werden. <button type="button" disabled={!online} onClick={() => setRevision(value => value + 1)}>Erneut laden</button></p> : !targets.items.length ? <p role="status">Keine passenden Chats gefunden.</p> : null}
        <div className="forward-targets" role="group" aria-label="Zielchat auswählen">{!loading && !loadError && targets.items.map(target => <button type="button" key={forwardTargetKey(target)} aria-pressed={selected && forwardTargetKey(selected) === forwardTargetKey(target) || false} disabled={!online} onClick={() => setSelected(target)}><strong>{target.name}</strong><small>{target.kind === 'group' ? 'Gruppe' : 'Einzelchat'}</small></button>)}</div>
        {targets.has_more && <p>Weitere Chats vorhanden. Grenze die Suche über den Namen ein.</p>}
        <footer><button type="button" className="secondary" onClick={onClose}>Abbrechen</button><button type="button" className="primary" disabled={!selected || loading || !online || changed} onClick={() => setConfirming(true)}>Vorschau</button></footer>
      </>}
    </>}
  </dialog>, document.body);
}
