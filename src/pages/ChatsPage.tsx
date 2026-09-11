import {
  CheckCheck,
  MessageCircle,
  Pencil,
  RefreshCw,
  Reply2,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '../components/Header';
import {
  deleteDirectMessage,
  editDirectMessage,
  loadContactPresence,
  loadConversationTyping,
  loadDirectConversations,
  loadDirectMessages,
  markDirectConversationRead,
  sendDirectMessage,
  setConversationTyping,
  subscribeToConversationRealtime,
  unsubscribeConversationRealtime,
  type ContactPresence,
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

function formatPresence(presence: ContactPresence | null) {
  if (!presence) return 'Status wird geladen…';
  if (presence.online) return 'Online';
  if (!presence.last_seen_at) return 'Noch kein Online-Status';

  const date = new Date(presence.last_seen_at);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `Zuletzt online heute ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `Zuletzt online ${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
}

export function ChatsPage({ currentUserId, requestedConversationId, onRequestedConversationHandled }: ChatsPageProps) {
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(requestedConversationId ?? null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<DirectMessage | null>(null);
  const [editing, setEditing] = useState<DirectMessage | null>(null);
  const [presence, setPresence] = useState<ContactPresence | null>(null);
  const [contactTyping, setContactTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingRecheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSignalRef = useRef(0);

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

  const refreshPresence = async (conversationId: string) => {
    const result = await loadContactPresence(conversationId);
    if (!result.error) setPresence(result.data);
  };

  const refreshTyping = async (conversationId: string) => {
    const result = await loadConversationTyping(conversationId);
    if (!result.error) setContactTyping(result.data);
  };

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setPresence(null);
      setContactTyping(false);
      return;
    }

    setReplyingTo(null);
    setEditing(null);
    setDraft('');
    setPresence(null);
    setContactTyping(false);

    void refreshMessages(selectedId);
    void refreshPresence(selectedId);
    void refreshTyping(selectedId);

    const channel = subscribeToConversationRealtime(selectedId, {
      onMessagesChanged: () => {
        void refreshMessages(selectedId).then(() => refreshConversations(selectedId));
      },
      onReadChanged: () => {
        void refreshMessages(selectedId, false);
      },
      onTypingChanged: () => {
        void refreshTyping(selectedId);
        if (typingRecheckRef.current) clearTimeout(typingRecheckRef.current);
        typingRecheckRef.current = setTimeout(() => void refreshTyping(selectedId), 6500);
      },
    });

    const presenceTimer = setInterval(() => void refreshPresence(selectedId), 20000);

    return () => {
      clearInterval(presenceTimer);
      if (typingStopRef.current) clearTimeout(typingStopRef.current);
      if (typingRecheckRef.current) clearTimeout(typingRecheckRef.current);
      void setConversationTyping(selectedId, false);
      void unsubscribeConversationRealtime(channel);
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

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (!selectedId) return;

    if (typingStopRef.current) clearTimeout(typingStopRef.current);

    if (!value.trim()) {
      void setConversationTyping(selectedId, false);
      lastTypingSignalRef.current = 0;
      return;
    }

    const now = Date.now();
    if (now - lastTypingSignalRef.current > 1200) {
      lastTypingSignalRef.current = now;
      void setConversationTyping(selectedId, true);
    }

    typingStopRef.current = setTimeout(() => {
      if (selectedId) void setConversationTyping(selectedId, false);
      lastTypingSignalRef.current = 0;
    }, 2500);
  };

  const submitComposer = async () => {
    const body = draft.trim();
    if (!selectedId || !body || sending) return;

    setSending(true);
    setError(null);

    const result = editing
      ? await editDirectMessage(editing.message_id, body)
      : await sendDirectMessage(selectedId, body, replyingTo?.message_id ?? null);

    setSending(false);
    if (result.error) {
      setError(result.error);
      return;
    }

    setDraft('');
    setReplyingTo(null);
    setEditing(null);
    void setConversationTyping(selectedId, false);
    lastTypingSignalRef.current = 0;
    await refreshMessages(selectedId);
    await refreshConversations(selectedId);
  };

  const startReply = (message: DirectMessage) => {
    if (message.deleted_at) return;
    setEditing(null);
    setReplyingTo(message);
  };

  const startEdit = (message: DirectMessage) => {
    if (message.sender_id !== currentUserId || message.deleted_at) return;
    setReplyingTo(null);
    setEditing(message);
    setDraft(message.body);
  };

  const removeMessage = async (message: DirectMessage) => {
    if (message.sender_id !== currentUserId || message.deleted_at) return;
    if (!window.confirm('Diese Nachricht wirklich löschen?')) return;

    setActionId(message.message_id);
    setError(null);
    const result = await deleteDirectMessage(message.message_id);
    setActionId(null);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (editing?.message_id === message.message_id) {
      setEditing(null);
      setDraft('');
    }
    if (replyingTo?.message_id === message.message_id) setReplyingTo(null);

    if (selectedId) {
      await refreshMessages(selectedId);
      await refreshConversations(selectedId);
    }
  };

  const cancelComposerContext = () => {
    setReplyingTo(null);
    if (editing) {
      setEditing(null);
      setDraft('');
    }
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
              <p>{chat.last_message || (chat.last_message_at ? 'Nachricht gelöscht' : 'Neuer Chat · Schreib die erste Nachricht')}</p>
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
                <div>
                  <b>{nameOf(currentChat)}</b>
                  <small className={contactTyping ? 'typing-status' : presence?.online ? 'online-status' : ''}>
                    {contactTyping ? 'schreibt gerade…' : formatPresence(presence)}
                  </small>
                </div>
              </div>
              <div className="project-pill">Privater 1:1-Chat</div>
            </div>

            <div className="messages">
              {messagesLoading && messages.length === 0 && <div className="messages-status">Nachrichten werden geladen…</div>}
              {!messagesLoading && messages.length === 0 && <div className="messages-status">Noch keine Nachrichten. Schreib die erste Nachricht.</div>}
              {messages.map((message) => {
                const mine = message.sender_id === currentUserId;
                const replyAuthor = message.reply_sender_id === currentUserId ? 'Du' : nameOf(currentChat);
                return (
                  <div key={message.message_id} className={`message-wrap${mine ? ' mine' : ''}`}>
                    <div className={mine ? 'bubble me' : 'bubble'}>
                      {message.reply_to_message_id && (
                        <div className="reply-preview">
                          <b>{replyAuthor}</b>
                          <span>{message.reply_body || 'Nachricht gelöscht'}</span>
                        </div>
                      )}
                      <span className={message.deleted_at ? 'deleted-message' : ''}>
                        {message.deleted_at ? 'Nachricht gelöscht' : message.body}
                      </span>
                      <div className="message-meta">
                        {message.edited_at && !message.deleted_at && <small>bearbeitet</small>}
                        <time>{formatTime(message.created_at)}</time>
                        {mine && !message.deleted_at && (
                          <span className={`message-receipt${message.read_at ? ' read' : ''}`} title={message.read_at ? 'Gelesen' : 'Gesendet'}>
                            {message.read_at ? <CheckCheck size={13} /> : '✓'}
                          </span>
                        )}
                      </div>
                    </div>

                    {!message.deleted_at && (
                      <div className="message-actions">
                        <button title="Antworten" onClick={() => startReply(message)}><Reply2 size={13} /></button>
                        {mine && <button title="Bearbeiten" onClick={() => startEdit(message)}><Pencil size={13} /></button>}
                        {mine && <button title="Löschen" onClick={() => void removeMessage(message)} disabled={actionId === message.message_id}><Trash2 size={13} /></button>}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {(replyingTo || editing) && (
              <div className="composer-context">
                <div>
                  <b>{editing ? 'Nachricht bearbeiten' : `Antwort an ${replyingTo?.sender_id === currentUserId ? 'dich selbst' : nameOf(currentChat)}`}</b>
                  <span>{editing ? editing.body : replyingTo?.body}</span>
                </div>
                <button onClick={cancelComposerContext} title="Abbrechen"><X size={15} /></button>
              </div>
            )}

            <div className="composer">
              <input
                value={draft}
                onChange={(event) => handleDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submitComposer();
                  }
                }}
                placeholder={editing ? 'Bearbeitete Nachricht…' : 'Nachricht schreiben…'}
                maxLength={5000}
              />
              <button onClick={() => void submitComposer()} disabled={!draft.trim() || sending} title={editing ? 'Änderung speichern' : 'Nachricht senden'}><Send size={18} /></button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
