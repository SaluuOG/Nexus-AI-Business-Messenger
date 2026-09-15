import {
  ArrowRight,
  CalendarDays,
  Filter,
  MessageCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { routes } from '../app/routes';
import { Header } from '../components/Header';
import {
  searchAccessibleMessages,
  type MessageCursor,
  type MessageSearchKind,
  type MessageSearchResult,
} from '../features/data/messageSearchData';

type KindFilter = 'all' | MessageSearchKind;

type SearchCriteria = {
  query: string;
  kind: KindFilter;
  contextQuery: string;
  fromDate: string;
  toDate: string;
};

const PAGE_SIZE = 30;
const SEARCH_LOAD_ERROR = 'Die Nachrichtensuche konnte nicht geladen werden. Bitte versuche es erneut.';

type PendingSearch = {
  criteria: SearchCriteria;
  cursor: MessageCursor | null;
  append: boolean;
};

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
}

function resultTarget(result: MessageSearchResult) {
  const path = result.kind === 'direct' ? routes.chats : routes.groups;
  const chatKey = result.kind === 'direct' ? 'conversation' : 'group';
  const parameters = new URLSearchParams({
    [chatKey]: result.chat_id,
    message: result.message_id,
  });
  return `${path}?${parameters.toString()}`;
}

function senderLabel(result: MessageSearchResult) {
  if (result.sender_name?.trim()) return result.sender_name.trim();
  if (result.sender_username?.trim()) return formatUsername(result.sender_username);
  return 'Nexus Nutzer';
}

function senderDetail(result: MessageSearchResult) {
  if (!result.sender_name?.trim() || !result.sender_username?.trim()) return null;
  return formatUsername(result.sender_username);
}

function formatUsername(value: string) {
  const username = value.trim();
  return username.startsWith('@') ? username : `@${username}`;
}

export function MessageSearchPage() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [contextQuery, setContextQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null);
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [cursor, setCursor] = useState<MessageCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryRequest, setRetryRequest] = useState<PendingSearch | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    document.querySelector('.app > main')?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
    return () => {
      requestId.current += 1;
    };
  }, []);

  const executeSearch = async (
    nextCriteria: SearchCriteria,
    nextCursor: MessageCursor | null,
    append: boolean,
  ) => {
    const currentRequest = ++requestId.current;
    setError(null);
    setRetryRequest(null);
    if (append) setLoadingMore(true);
    else setLoading(true);

    let response: Awaited<ReturnType<typeof searchAccessibleMessages>>;
    try {
      response = await searchAccessibleMessages({
        query: nextCriteria.query,
        kind: nextCriteria.kind === 'all' ? null : nextCriteria.kind,
        scopeQuery: nextCriteria.contextQuery || null,
        fromDate: nextCriteria.fromDate || null,
        toDate: nextCriteria.toDate || null,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
    } catch {
      if (currentRequest !== requestId.current) return;
      setLoading(false);
      setLoadingMore(false);
      setError(SEARCH_LOAD_ERROR);
      setRetryRequest({ criteria: nextCriteria, cursor: nextCursor, append });
      return;
    }

    if (currentRequest !== requestId.current) return;
    setLoading(false);
    setLoadingMore(false);

    if (response.error) {
      setError(SEARCH_LOAD_ERROR);
      setRetryRequest({ criteria: nextCriteria, cursor: nextCursor, append });
      return;
    }

    setResults((current) => {
      if (!append) return response.data.results;
      const knownIds = new Set(current.map((result) => `${result.kind}:${result.message_id}`));
      return [...current, ...response.data.results.filter((result) => !knownIds.has(`${result.kind}:${result.message_id}`))];
    });
    setCursor(response.data.next_cursor);
    setHasMore(response.data.has_more);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextCriteria: SearchCriteria = {
      query: query.trim(),
      kind,
      contextQuery: contextQuery.trim(),
      fromDate,
      toDate,
    };

    if (Array.from(nextCriteria.query).length < 2) {
      setError('Gib mindestens zwei Zeichen für die Suche ein.');
      setRetryRequest(null);
      return;
    }
    if (nextCriteria.fromDate && nextCriteria.toDate && nextCriteria.fromDate > nextCriteria.toDate) {
      setError('Das Startdatum muss vor dem Enddatum liegen.');
      setRetryRequest(null);
      return;
    }

    setCriteria(nextCriteria);
    setResults([]);
    setCursor(null);
    setHasMore(false);
    void executeSearch(nextCriteria, null, false);
  };

  const clearSearch = () => {
    requestId.current += 1;
    setQuery('');
    setKind('all');
    setContextQuery('');
    setFromDate('');
    setToDate('');
    setCriteria(null);
    setResults([]);
    setCursor(null);
    setHasMore(false);
    setLoading(false);
    setLoadingMore(false);
    setError(null);
    setRetryRequest(null);
  };

  const loadMore = () => {
    if (!criteria || !cursor || loading || loadingMore) return;
    void executeSearch(criteria, cursor, true);
  };

  const hasInput = Boolean(query || contextQuery || fromDate || toDate || kind !== 'all');
  const searchedWithoutResults = Boolean(criteria && !loading && !error && results.length === 0);

  return (
    <section className="page message-search-page">
      <Header
        kicker="NACHRICHTENARCHIV"
        title="Nachrichten durchsuchen"
        sub="Finde Inhalte in allen Direkt- und Gruppenchats, auf die du aktuell Zugriff hast."
      />

      <div className="message-search-privacy" role="note">
        <ShieldCheck size={18} aria-hidden="true" />
        <span><b>Privat und zugriffsgeschützt.</b> Die Suche läuft serverseitig und zeigt ausschließlich deine zugänglichen Chats.</span>
      </div>

      <form className="panel message-search-form" onSubmit={submitSearch} noValidate>
        <div className="message-search-main-field">
          <label htmlFor="message-search-query">Suchbegriff</label>
          <div className="message-search-input">
            <Search size={18} aria-hidden="true" />
            <input
              id="message-search-query"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="z. B. Angebot, Termin oder Rechnung"
              minLength={2}
              maxLength={100}
              autoComplete="off"
              enterKeyHint="search"
              aria-describedby="message-search-hint"
              aria-invalid={error === 'Gib mindestens zwei Zeichen für die Suche ein.'}
            />
          </div>
          <small id="message-search-hint">Mindestens zwei Zeichen. Es werden vollständige Nachrichteninhalte durchsucht.</small>
        </div>

        <div className="message-search-filter-heading">
          <SlidersHorizontal size={16} aria-hidden="true" />
          <b>Filter</b>
          <span>optional</span>
        </div>

        <div className="message-search-filters">
          <label>
            <span>Chat-Art</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as KindFilter)}>
              <option value="all">Alle Chats</option>
              <option value="direct">Direktchats</option>
              <option value="group">Gruppenchats</option>
            </select>
          </label>

          <label className="message-search-context-filter">
            <span>Gespräch oder Person</span>
            <div>
              <Filter size={15} aria-hidden="true" />
              <input
                value={contextQuery}
                onChange={(event) => setContextQuery(event.target.value)}
                placeholder="Name, Gruppe oder @username"
                maxLength={100}
                autoComplete="off"
              />
            </div>
          </label>

          <label>
            <span>Von</span>
            <div className="message-search-date-input">
              <CalendarDays size={15} aria-hidden="true" />
              <input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} aria-invalid={error === 'Das Startdatum muss vor dem Enddatum liegen.'} />
            </div>
          </label>

          <label>
            <span>Bis</span>
            <div className="message-search-date-input">
              <CalendarDays size={15} aria-hidden="true" />
              <input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} aria-invalid={error === 'Das Startdatum muss vor dem Enddatum liegen.'} />
            </div>
          </label>
        </div>

        <div className="message-search-actions">
          <button type="submit" className="primary" disabled={loading || loadingMore}>
            <Search size={16} aria-hidden="true" />
            {loading ? 'Suche läuft…' : 'Nachrichten suchen'}
          </button>
          <button type="button" className="secondary" onClick={clearSearch} disabled={!hasInput && !criteria && !error}>
            <X size={15} aria-hidden="true" /> Zurücksetzen
          </button>
        </div>
      </form>

      <div className="message-search-live" aria-live="polite" aria-atomic="true">
        {loading && <p role="status">Nachrichten werden sicher durchsucht…</p>}
        {!loading && criteria && !error && (
          <p>{results.length === 0 ? `Keine Treffer für „${criteria.query}“.` : `${results.length}${hasMore ? '+' : ''} Treffer für „${criteria.query}“ geladen.`}</p>
        )}
      </div>

      {error && (
        <div className="data-alert message-search-error" role="alert">
          <span>{error}</span>
          {retryRequest && !loading && !loadingMore && (
            <button type="button" className="secondary" onClick={() => void executeSearch(retryRequest.criteria, retryRequest.cursor, retryRequest.append)}>
              Erneut versuchen
            </button>
          )}
        </div>
      )}

      {!criteria && !loading && (
        <div className="panel message-search-empty">
          <Search size={30} aria-hidden="true" />
          <h2>Was möchtest du wiederfinden?</h2>
          <p>Suche nach Absprachen, Namen, Terminen oder Stichwörtern. Filter helfen dir, den passenden Chat schneller einzugrenzen.</p>
        </div>
      )}

      {searchedWithoutResults && (
        <div className="panel message-search-empty">
          <Filter size={30} aria-hidden="true" />
          <h2>Keine passende Nachricht gefunden</h2>
          <p>Prüfe den Suchbegriff oder entferne einzelne Filter. Gelöschte Nachrichten und Chats ohne deinen Zugriff bleiben ausgeschlossen.</p>
        </div>
      )}

      {results.length > 0 && (
        <ul className="message-search-results" aria-label="Gefundene Nachrichten" aria-busy={loading || loadingMore}>
          {results.map((result) => {
            const Icon = result.kind === 'direct' ? MessageCircle : UsersRound;
            const sender = senderLabel(result);
            const detail = senderDetail(result);
            return (
              <li key={`${result.kind}:${result.message_id}`} className="message-search-result">
                <span className={`message-search-kind kind-${result.kind}`} aria-hidden="true"><Icon size={20} /></span>
                <div className="message-search-result-copy">
                  <div className="message-search-result-meta">
                    <span className="message-search-chat-name">{result.chat_name || 'Unbenannter Chat'}</span>
                    <span>{result.kind === 'direct' ? 'Direktchat' : 'Gruppe'}</span>
                    <time dateTime={result.created_at}>{formatDate(result.created_at)}</time>
                  </div>
                  <div className="message-search-sender"><b>{sender}</b>{detail && <span>{detail}</span>}</div>
                  <p>{result.body}</p>
                  {result.edited_at && <small>Bearbeitet</small>}
                </div>
                <Link
                  className="message-search-open"
                  to={resultTarget(result)}
                  aria-label={`Nachricht von ${sender} in ${result.chat_name || 'Unbenannter Chat'} öffnen`}
                >
                  <span>Im Chat öffnen</span><ArrowRight size={17} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && !error && (
        <button type="button" className="secondary message-search-more" onClick={loadMore} disabled={loading || loadingMore}>
          {loadingMore ? 'Weitere Treffer werden geladen…' : 'Weitere Treffer laden'}
        </button>
      )}
    </section>
  );
}
