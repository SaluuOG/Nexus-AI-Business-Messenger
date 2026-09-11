import {
  Check,
  Clock3,
  MessageCircle,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Header } from '../components/Header';
import {
  cancelContactRequest,
  loadContactRequests,
  loadNexusContacts,
  removeNexusContact,
  respondContactRequest,
  searchNexusUser,
  sendContactRequest,
  type NexusContact,
  type NexusContactRequest,
  type NexusUserSearchResult,
} from '../features/data/contactsData';
import type { Contact } from '../types';

type ContactsPageProps = {
  contacts?: Contact[];
  setContacts?: (contacts: Contact[]) => void;
};

function initials(name: string | null, username: string | null) {
  const source = name || username || 'N';
  return source
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => value[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function displayName(name: string | null, username: string | null) {
  return name || (username ? `@${username}` : 'Nexus Nutzer');
}

export function ContactsPage(_: ContactsPageProps) {
  const [contacts, setContacts] = useState<NexusContact[]>([]);
  const [requests, setRequests] = useState<NexusContactRequest[]>([]);
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<NexusUserSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const incoming = requests.filter((request) => request.direction === 'incoming');
  const outgoing = requests.filter((request) => request.direction === 'outgoing');

  const refresh = async () => {
    setLoading(true);
    setError(null);

    const [contactsResult, requestsResult] = await Promise.all([
      loadNexusContacts(),
      loadContactRequests(),
    ]);

    setContacts(contactsResult.data);
    setRequests(requestsResult.data);
    setError(contactsResult.error || requestsResult.error || null);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const runSearch = async (username = query) => {
    const normalized = username.trim();
    if (!normalized) return;

    setSearching(true);
    setFeedback(null);
    setSearchResult(null);

    const result = await searchNexusUser(normalized);
    setSearching(false);

    if (result.error) {
      setFeedback(result.error);
      return;
    }

    if (!result.data) {
      setFeedback('Kein Nexus-Nutzer mit diesem Username gefunden.');
      return;
    }

    setSearchResult(result.data);
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void runSearch();
  };

  const requestContact = async (userId: string) => {
    setActionId(userId);
    setFeedback(null);
    const result = await sendContactRequest(userId);
    setActionId(null);

    if (result.error) {
      setFeedback(result.error);
      return;
    }

    setFeedback('Kontaktanfrage gesendet.');
    await refresh();
    await runSearch(query);
  };

  const answerRequest = async (requestId: string, accept: boolean) => {
    setActionId(requestId);
    setFeedback(null);
    const result = await respondContactRequest(requestId, accept);
    setActionId(null);

    if (result.error) {
      setFeedback(result.error);
      return;
    }

    setFeedback(accept ? 'Kontaktanfrage angenommen.' : 'Kontaktanfrage abgelehnt.');
    await refresh();
    if (query.trim()) await runSearch(query);
  };

  const cancelRequest = async (requestId: string) => {
    setActionId(requestId);
    setFeedback(null);
    const result = await cancelContactRequest(requestId);
    setActionId(null);

    if (result.error) {
      setFeedback(result.error);
      return;
    }

    setFeedback('Kontaktanfrage zurückgezogen.');
    await refresh();
    if (query.trim()) await runSearch(query);
  };

  const removeContact = async (contact: NexusContact) => {
    const name = displayName(contact.full_name, contact.username);
    if (!window.confirm(`${name} wirklich aus deinen Kontakten entfernen?`)) return;

    setActionId(contact.contact_user_id);
    setFeedback(null);
    const result = await removeNexusContact(contact.contact_user_id);
    setActionId(null);

    if (result.error) {
      setFeedback(result.error);
      return;
    }

    setFeedback('Kontakt entfernt.');
    await refresh();
    if (query.trim()) await runSearch(query);
  };

  const relationshipLabel = (relationship: NexusUserSearchResult['relationship']) => {
    if (relationship === 'contact') return 'Bereits Kontakt';
    if (relationship === 'incoming') return 'Anfrage von dieser Person erhalten';
    if (relationship === 'outgoing') return 'Kontaktanfrage gesendet';
    return null;
  };

  return (
    <section className="page contacts-page">
      <div className="title-row">
        <Header
          kicker="IDENTITÄT & NETZWERK"
          title="Kontakte"
          sub="Echte Nexus-Nutzer finden, Kontaktanfragen verwalten und dein Netzwerk aufbauen."
        />
        <button className="secondary contacts-refresh" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={15} /> {loading ? 'Lädt…' : 'Aktualisieren'}
        </button>
      </div>

      {error && <div className="data-alert">Backend: {error}</div>}
      {feedback && <div className="contact-feedback">{feedback}</div>}

      <div className="contact-search-panel panel">
        <div>
          <Search size={20} />
          <div>
            <h3>Nexus-Nutzer finden</h3>
            <p>Suche aus Datenschutzgründen exakt nach dem Nexus-Username, z. B. <b>@darlynovic</b>.</p>
          </div>
        </div>
        <form className="contact-search-form" onSubmit={submitSearch}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="@username"
            autoComplete="off"
          />
          <button className="primary" disabled={searching || !query.trim()}>
            <Search size={15} /> {searching ? 'Sucht…' : 'Suchen'}
          </button>
        </form>

        {searchResult && (
          <div className="contact-search-result">
            <div className="avatar big">{initials(searchResult.full_name, searchResult.username)}</div>
            <div className="contact-person-copy">
              <b>{displayName(searchResult.full_name, searchResult.username)}</b>
              <span>{searchResult.username ? `@${searchResult.username}` : 'Kein Username'}</span>
              {relationshipLabel(searchResult.relationship) && (
                <small>{relationshipLabel(searchResult.relationship)}</small>
              )}
            </div>
            {searchResult.relationship === 'none' ? (
              <button
                className="primary"
                onClick={() => void requestContact(searchResult.user_id)}
                disabled={actionId === searchResult.user_id}
              >
                <UserPlus size={15} /> Anfrage senden
              </button>
            ) : (
              <span className="contact-status-pill">{relationshipLabel(searchResult.relationship)}</span>
            )}
          </div>
        )}
      </div>

      <div className="contacts-summary">
        <div className="stat"><b>{contacts.length}</b><span>Kontakte</span></div>
        <div className="stat"><b>{incoming.length}</b><span>Eingehende Anfragen</span></div>
        <div className="stat"><b>{outgoing.length}</b><span>Gesendete Anfragen</span></div>
      </div>

      {(incoming.length > 0 || outgoing.length > 0) && (
        <div className="contact-requests-grid">
          <div className="panel">
            <h3>Eingehende Anfragen</h3>
            {incoming.length === 0 && <p className="contact-empty">Keine offenen Anfragen.</p>}
            {incoming.map((request) => (
              <div className="contact-request-row" key={request.request_id}>
                <div className="avatar">{initials(request.full_name, request.username)}</div>
                <div className="contact-person-copy">
                  <b>{displayName(request.full_name, request.username)}</b>
                  <span>{request.username ? `@${request.username}` : 'Nexus Nutzer'}</span>
                </div>
                <div className="contact-request-actions">
                  <button
                    className="contact-icon-button accept"
                    title="Annehmen"
                    onClick={() => void answerRequest(request.request_id, true)}
                    disabled={actionId === request.request_id}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    className="contact-icon-button"
                    title="Ablehnen"
                    onClick={() => void answerRequest(request.request_id, false)}
                    disabled={actionId === request.request_id}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="panel">
            <h3>Gesendete Anfragen</h3>
            {outgoing.length === 0 && <p className="contact-empty">Keine offenen Anfragen.</p>}
            {outgoing.map((request) => (
              <div className="contact-request-row" key={request.request_id}>
                <div className="avatar">{initials(request.full_name, request.username)}</div>
                <div className="contact-person-copy">
                  <b>{displayName(request.full_name, request.username)}</b>
                  <span>{request.username ? `@${request.username}` : 'Nexus Nutzer'}</span>
                  <small><Clock3 size={12} /> wartet auf Antwort</small>
                </div>
                <button
                  className="contact-icon-button"
                  title="Anfrage zurückziehen"
                  onClick={() => void cancelRequest(request.request_id)}
                  disabled={actionId === request.request_id}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="contacts-section-heading">
        <div>
          <h2>Meine Kontakte</h2>
          <p>Diese Kontakte sind echt in Supabase gespeichert und für beide Accounts sichtbar.</p>
        </div>
      </div>

      {loading && contacts.length === 0 ? (
        <div className="panel contact-empty-state">Kontakte werden geladen…</div>
      ) : contacts.length === 0 ? (
        <div className="panel contact-empty-state">
          <UserPlus size={28} />
          <b>Noch keine Nexus-Kontakte</b>
          <span>Suche oben nach einem Username und sende deine erste Kontaktanfrage.</span>
        </div>
      ) : (
        <div className="contact-grid real-contacts">
          {contacts.map((contact) => (
            <div className="contact" key={contact.contact_user_id}>
              <div className="avatar big">{initials(contact.full_name, contact.username)}</div>
              <b>{displayName(contact.full_name, contact.username)}</b>
              <span>{contact.username ? `@${contact.username}` : 'Nexus Nutzer'}</span>
              <small>Nexus-Kontakt</small>
              <div className="contact-card-actions">
                <button disabled title="Echte 1:1-Chats folgen im nächsten Messenger-Schritt">
                  <MessageCircle size={14} /> Chat folgt
                </button>
                <button
                  className="contact-remove"
                  title="Kontakt entfernen"
                  onClick={() => void removeContact(contact)}
                  disabled={actionId === contact.contact_user_id}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
