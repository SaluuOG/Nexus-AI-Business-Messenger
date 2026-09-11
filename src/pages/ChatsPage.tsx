import { MessageCircle, RefreshCw, Search, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '../components/Header';
import {
  loadDirectConversations,
  loadDirectMessages,
  markDirectConversationRead,
  sendDirectMessage,
  subscribeToDirectMessages,
  unsubscribeDirectMessages,
  type DirectConversation,
  type DirectMessage,
} from '../features/data/chatData';

type ChatsPageProps = {
  currentUserId?: string;
  requestedConversationId?: string | null;
  onRequestedConversationHandled?: () => void;
};

function initials(name: string | null, username: string | null) {
  return (name || username || 'N')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function nameOf(chat: DirectConversation) {
  return chat.full_name || (chat.username ? `@${chat.username}` : 'Nexus Nutzer');
}

function formatTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

export function ChatsPage({ currentUserId, requestedConversationId, onRequestedConversationHandled }: ChatsPageProps) {
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(requestedConversationId ?? null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const refreshConversations = async (preferredId?: string | null) => {
    setLoading(true);
    const result = await loadDirectConversations();
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setConversations(result.data);
    setSelectedId((current) => {
      const target = preferredId || current;
      if (target && result.data.some((chat) => chat.conversation_id === target)) return target;
      return result.data[0]?.conversation_id ?? null;
    });
  };

  useEffect(() => {
    void refreshConversations(requestedConversationId);
  }, []);

  useEffect(() => {
    if (!requestedConversationId) return;
    setSelectedId(requestedConversationId);
    void refreshConversations(requestedConversationId);
    onRequestedConversationHandled?.();
  }, [requestedConversationId]);

  const refreshMessages = async (conversationId: string, markRead = true) => {
    setMessagesLoading(true);
    const result = await loadDirectMessages(conversationId);
    setMessagesLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessages(result.data);
    if (markRead) {
      await markDirectConversationRead(conversationId);
      setConversations((current) => current.map((chat) =>
        chat.conversation_id === conversationId ? { ...chat, unread_count: 0 } : chat,
      ));
    }
  };

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }

    void refreshMessages(selectedId);
    const channel = subscribeToDirectMessages(selectedId, () => {
      void refreshMessages(selectedId).then(() => refreshConversations(selectedId));
    });

    return () => {
      void unsubscribeDirectMessages(channel);
    };
  }, [selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((chat) =>
      `${chat.full_name || ''} ${chat.username || ''} ${chat.last_message || ''}`.toLowerCase().includes(needle),
    );
  }, [conversations, query]);

  const currentChat = conversations.find((chat) => chat.conversation_id === selectedId) ?? null;

  const send = async () => {
    const body = draft.trim();
    if (!selectedId || !body || sending) return;
    setSending(true);
    setError(null);
    const result = await sendDirectMessage(selectedId, body);
    setSending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDraft('');
    await refreshMessages(selectedId);
    await refreshConversations(selectedId);
  };

  return (
    <div className="chat-layout real-chat-layout">
      <section className="chat-list">
        <div className="chat-list-title">
          <Header kicker="MESSENGER" title="Chats" sub="Echte 1:1-Nachrichten zwischen deinen Nexus-Kontakten." />
          <button className="chat-refresh" onClick={() => void refreshConversations(selectedId)} title="Chats aktualisieren">
            <RefreshCw size={15} />
          </button>
        </div>
        <div className="search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Chats durchsuchen" />
        </div>

        {loading && conversations.length === 0 && <div className="chat-list-empty">Chats werden geladen…</div>}
        {!loading && conversations.length === 0 && (
          <div className="chat-list-empty"><MessageCircle size={24} /><b>Noch keine Chats</b><span>Öffne einen Nexus-Kontakt und starte dort den ersten Chat.</span></div>
        )}
        {filtered.map((chat) => (
          <button className={`chat${selectedId === chat.conversation_id ? ' active' : ''}`} onClick={() => setSelectedId(chat.conversation_id)} key={chat.conversation_id}>
            <div className="avatar">{initials(chat.full_name, chat.username)}</div>
            <span>
              <b>{nameOf(chat)}</b>
              <small>{chat.username ? `@${chat.username}` : 'Nexus-Kontakt'}</small>
              <p>{chat.last_message || 'Neuer Chat · Schreib die erste Nachricht'}</p>
            </span>
            <em>{formatTime(chat.last_message_at)}{chat.unread_count > 0 && <i>{chat.unread_count > 99 ? '99+' : chat.unread_count}</i>}</em>
          </button>
        ))}
      </section>

      <section className="conversation">
        {error && <div className="chat-error">{error}</div>}
        {!currentChat ? (
          <div className="conversation-empty"><MessageCircle size={42} /><h2>Nexus Messenger</h2><p>Wähle einen Chat aus oder starte einen neuen Chat über Kontakte.</p></div>
        ) : (
          <>
            <div className="chat-head">
              <div className="chat-head-person">
                <div className="avatar">{initials(currentChat.full_name, currentChat.username)}</div>
                <div><b>{nameOf(currentChat)}</b><small>{currentChat.username ? `@${currentChat.username}` : 'Nexus-Kontakt'}</small></div>
              </div>
              <div className="project-pill">Privater 1:1-Chat</div>
            </div>

            <div className="messages">
              {messagesLoading && messages.length === 0 && <div className="messages-status">Nachrichten werden geladen…</div>}
              {!messagesLoading && messages.length === 0 && <div className="messages-status">Noch keine Nachrichten. Schreib die erste Nachricht.</div>}
              {messages.map((message) => (
                <div key={message.message_id} className={message.sender_id === currentUserId ? 'bubble me' : 'bubble'}>
                  <span>{message.body}</span>
                  <time>{formatTime(message.created_at)}</time>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="composer">
              <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Nachricht schreiben…" maxLength={5000} />
              <button onClick={() => void send()} disabled={!draft.trim() || sending} title="Nachricht senden"><Send size={18} /></button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}