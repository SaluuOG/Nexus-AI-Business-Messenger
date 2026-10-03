import { Bookmark, BookmarkMinus, RefreshCw, Search } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '../components/Header';
import { useNetworkStatus } from '../features/connection/useNetworkStatus';
import { bookmarkTarget, loadMessageBookmarks, setMessageBookmark, watchBookmarks, type BookmarkPage, type MessageBookmark } from '../features/data/messageBookmarks';
import '../message-bookmarks.css';

const empty = (): BookmarkPage => ({ items: [], has_more: false, next_cursor: null });
const formatDate = (date: string) => new Date(date).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export function MessageBookmarksPage({ currentUserId }: { currentUserId?: string }) {
  const online = useNetworkStatus();
  const [input, setInput] = useState(''), [query, setQuery] = useState(''), [revision, setRevision] = useState(0);
  const [page, setPage] = useState<BookmarkPage>(empty), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set()), [writeError, setWriteError] = useState<string | null>(null);
  const generation = useRef(0), busy = useRef(false), writes = useRef(new Set<string>());
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const scope = JSON.stringify([currentUserId, query, online, revision]);
  const activeScope = useRef(scope); activeScope.current = scope;
  const [resultScope, setResultScope] = useState(scope);

  useEffect(() => {
    const token = ++generation.current;
    setPage(empty()); setError(null); setWriteError(null); setResultScope(scope);
    busy.current = false;
    if (!online || !currentUserId) { setLoading(false); return; }
    busy.current = true; setLoading(true);
    void loadMessageBookmarks(currentUserId, query).then(result => {
      if (generation.current === token) setPage(result);
    }).catch(() => { if (generation.current === token) setError('Gemerkte Nachrichten konnten nicht geladen werden. Bitte versuche es erneut.'); })
      .finally(() => { if (generation.current === token) { busy.current = false; setLoading(false); } });
    return () => { ++generation.current; };
  }, [scope, currentUserId, query, online]);
  useEffect(() => currentUserId && online ? watchBookmarks(currentUserId, () => setRevision(n => n + 1)) : undefined, [currentUserId, online]);
  const submit = (event: FormEvent) => { event.preventDefault(); setQuery(input.trim()); setRevision(n => n + 1); };
  const loadMore = async () => {
    if (!currentUserId || !online || busy.current || !page.next_cursor || resultScope !== scope) return;
    const token = generation.current;
    busy.current = true; setLoading(true); setError(null);
    try {
      const result = await loadMessageBookmarks(currentUserId, query, page.next_cursor);
      if (generation.current === token) setPage(previous => ({ ...result, items: [...previous.items, ...result.items.filter(item => !previous.items.some(old => old.id === item.id))] }));
    } catch {
      // Clearing previews avoids retaining entries after access was lost.
      if (generation.current === token) { setPage(empty()); setError('Gemerkte Nachrichten konnten nicht geladen werden. Bitte versuche es erneut.'); }
    } finally { if (generation.current === token) { busy.current = false; setLoading(false); } }
  };
  const remove = async (row: MessageBookmark) => {
    if (!currentUserId || !online || writes.current.has(row.id)) return;
    const originScope = scope;
    writes.current.add(row.id); setPending(new Set(writes.current)); setWriteError(null);
    try { await setMessageBookmark(currentUserId, row.kind, row.message_id, false); }
    catch { if (alive.current && activeScope.current === originScope) setWriteError('Markierung nicht bestätigt. Bitte versuche das Entfernen erneut.'); }
    finally { writes.current.delete(row.id); if (alive.current) setPending(new Set(writes.current)); }
  };
  const rows = online && resultScope === scope ? page.items : [];
  return <section className="page bookmarks-page">
    <Header kicker="DEINE MERKLISTE" title="Gemerkte Nachrichten" sub="Wichtige Nachrichten aus deinen Chats – nur für dich sichtbar." />
    <form className="panel bookmarks-search" onSubmit={submit}>
      <label htmlFor="bookmark-query">Merkliste durchsuchen</label>
      <div><input id="bookmark-query" type="search" maxLength={100} value={input} onChange={event => setInput(event.target.value)} placeholder="Text, Chat oder Dateiname" disabled={!online} /><button className="primary" type="submit" disabled={!online || loading}><Search size={18} />Suchen</button></div>
    </form>
    <div className="bookmarks-tools"><button type="button" className="secondary" disabled={!online || loading} onClick={() => setRevision(n => n + 1)}><RefreshCw size={17} />Aktualisieren</button>{query && <button type="button" className="secondary" onClick={() => { setInput(''); setQuery(''); }}>Suche zurücksetzen</button>}</div>
    {!online ? <div className="data-alert" role="status">Keine Internetverbindung. Verbinde dich mit dem Internet, um deine Merkliste zu laden.</div> : <>
      {error && <div className="data-alert" role="alert">{error} <button type="button" className="secondary" onClick={() => setRevision(n => n + 1)}>Erneut laden</button></div>}
      {writeError && <p className="data-alert" role="alert">{writeError}</p>}
      {loading && <p role="status">Merkliste wird geladen…</p>}
      {!loading && !error && rows.length === 0 && <div className="panel bookmarks-empty"><Bookmark size={30} /><h2>{query ? 'Keine passenden Nachrichten' : 'Noch keine gemerkten Nachrichten'}</h2><p>{query ? 'Versuche einen anderen Suchbegriff.' : 'Öffne in einem Chat das Drei-Punkte-Menü einer Nachricht und wähle „Nachricht merken“.'}</p></div>}
      <div className="bookmarks-list">{rows.map(row => <article className="panel bookmark-card" key={row.id} data-bookmark-id={row.id}>
        <header><div><h2>{row.chat_name}</h2><small>{row.kind === 'group' ? 'Gruppe' : 'Einzelchat'} · {row.sender_name}</small></div><Bookmark size={18} aria-label="Gemerkt" /></header>
        {row.preview && <p className="bookmark-preview">{row.preview}</p>}
        {row.attachment_name && <p className="bookmark-attachment">Anhang: {row.attachment_name}</p>}
        <small>Nachricht vom {formatDate(row.created_at)}</small>
        <footer><Link className="secondary" to={bookmarkTarget(row)}>Zur Nachricht</Link><button type="button" className="secondary" disabled={pending.has(row.id)} onClick={() => void remove(row)}><BookmarkMinus size={16} />{pending.has(row.id) ? 'Entfernt…' : 'Markierung entfernen'}</button></footer>
      </article>)}</div>
      {page.has_more && resultScope === scope && !error && <button type="button" className="secondary bookmarks-more" disabled={loading} onClick={() => void loadMore()}>Weitere laden</button>}
    </>}
  </section>;
}
