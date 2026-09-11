import {
  CheckCheck,
  FileText,
  MessageCircle,
  Paperclip,
  Pencil,
  RefreshCw,
  Reply,
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
  sendDirectAttachmentMessage,
  sendDirectMessage,
  setConversationTyping,
  subscribeToConversationRealtime,
  SUPPORTED_CHAT_ATTACHMENT_TYPES,
  unsubscribeConversationRealtime,
  validateChatAttachment,
  type ContactPresence,
  type DirectAttachment,
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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function messagePreview(message: DirectMessage) {
  if (message.deleted_at) return 'Nachricht gelöscht';
  if (message.body.trim()) return message.body;
  const attachment = message.attachments[0];
  if (!attachment) return 'Nachricht';
  return attachment.mime_type.startsWith('image/') ? 'Bild' : attachment.file_name;
}

function AttachmentView({ attachment }: { attachment: DirectAttachment }) {
  const isImage = attachment.mime_type.startsWith('image/');

  if (!attachment.signed_url) {
    return (
      <div className="attachment-unavailable">
        <FileText size={17} />
        <span><b>{attachment.file_name}</b><small>Datei konnte nicht geladen werden</small></span>
      </div>
    );
  }

  if (isImage) {
    return (
      <a className="chat-image-link" href={attachment.signed_url} target="_blank" rel="noreferrer" title={attachment.file_name}>
        <img className="chat-image" src={attachment.signed_url} alt={attachment.file_name} loading="lazy" />
      </a>
    );
  }

  return (
    <a className="file-attachment" href={attachment.signed_url} target="_blank" rel="noreferrer" download={attachment.file_name}>
      <span className="file-attachment-icon"><FileText size={19} /></span>
      <span className="file-attachment-info">
        <b>{attachment.file_name}</b>
        <small>{formatFileSize(attachment.file_size)}</small>
      </span>
    </a>
  );
}

export function ChatsPage({ currentUserId, requestedConversationId, onRequestedConversationHandled }: ChatsPageProps) {
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(requestedConversationId ?? null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
      setPendingFile(null);
      return;
    }

    setReplyingTo(null);
    setEditing(null);
    setDraft('');
    setPendingFile(null);
    setUploadStatus(null);
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

  const handleFileSelected = (file: File | null) => {
    if (!file) return;
    const validation = validateChatAttachment(file);
    if (validation.error) {
      setError(validation.error);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setError(null);
    setEditing(null);
    setPendingFile(file);
  };

  const clearPendingFile = () => {
    setPendingFile(null);
    setUploadStatus(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submitComposer = async () => {
    const body = draft.trim();
    if (!selectedId || sending) return;
    if (editing && !body) return;
    if (!editing && !body && !pendingFile) return;

    setSending(true);
    setError(null);

    let result: { data?: string | null; error: string | null } | { error: string | null };
    if (editing) {
      result = await editDirectMessage(editing.message_id, body);
    } else if (pendingFile) {
      if (!currentUserId) {
        setSending(false);
        setError('Nutzerkonto konnte nicht bestimmt werden.');
        return;
      }
      setUploadStatus('Datei wird sicher hochgeladen…');
      result = await sendDirectAttachmentMessage(
        selectedId,
        currentUserId,
        pendingFile,
        body,
        replyingTo?.message_id ?? null,
      );
    } else {
      result = await sendDirectMessage(selectedId, body, replyingTo?.message_id ?? null);
    }

    setSending(false);
    setUploadStatus(null);
    if (result.error) {
      setError(result.error);
      return;
    }

    setDraft('');
    clearPendingFile();
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
    clearPendingFile();
    setEditing(message);
    setDraft(message.body);
  };

  const removeMessage = async (message: DirectMessage) => {
    if (message.sender_id !== currentUserId || message.deleted_at) return;
    if (!window.confirm('Diese Nachricht wirklich löschen?')) return;

    setActionId(message.message_id);
    setError(null);
    const result = await deleteDirectMessage(
      message.message_id,
      message.attachments.map((attachment) => attachment.storage_path),
    );
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

  const canSend = Boolean(editing ? draft.trim() : draft.trim() || pendingFile) && !sending;

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
                          <span>{message.reply_body || 'Anhang'}</span>
                        </div>
                      )}

                      {!message.deleted_at && message.attachments.length > 0 && (
                        <div className="message-attachments">
                          {message.attachments.map((attachment) => (
                            <AttachmentView key={attachment.attachment_id} attachment={attachment} />
                          ))}
                        </div>
                      )}

                      {(message.deleted_at || message.body.trim()) && (
                        <span className={message.deleted_at ? 'deleted-message' : 'message-body'}>
                          {message.deleted_at ? 'Nachricht gelöscht' : message.body}
                        </span>
                      )}

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
                        <button title="Antworten" onClick={() => startReply(message)}><Reply size={13} /></button>
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
                  <span>{editing ? (editing.body || 'Beschriftung hinzufügen…') : replyingTo ? messagePreview(replyingTo) : ''}</span>
                </div>
                <button onClick={cancelComposerContext} title="Abbrechen"><X size={15} /></button>
              </div>
            )}

            {pendingFile && !editing && (
              <div className="pending-attachment">
                <span className="pending-attachment-icon"><Paperclip size={16} /></span>
                <span className="pending-attachment-info">
                  <b>{pendingFile.name}</b>
                  <small>{uploadStatus || `${formatFileSize(pendingFile.size)} · bereit zum Senden`}</small>
                </span>
                <button onClick={clearPendingFile} title="Anhang entfernen" disabled={sending}><X size={15} /></button>
              </div>
            )}

            <div className="composer attachment-composer">
              <input
                ref={fileInputRef}
                className="attachment-file-input"
                type="file"
                accept={SUPPORTED_CHAT_ATTACHMENT_TYPES.join(',')}
                onChange={(event) => handleFileSelected(event.target.files?.[0] ?? null)}
              />
              <button
                className="attach-button"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || Boolean(editing)}
                title={editing ? 'Beim Bearbeiten können keine Dateien angehängt werden' : 'Bild oder Datei anhängen'}
              >
                <Paperclip size={18} />
              </button>
              <input
                value={draft}
                onChange={(event) => handleDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submitComposer();
                  }
                }}
                placeholder={editing ? 'Bearbeitete Nachricht…' : pendingFile ? 'Beschriftung hinzufügen (optional)…' : 'Nachricht schreiben…'}
                maxLength={5000}
              />
              <button onClick={() => void submitComposer()} disabled={!canSend} title={editing ? 'Änderung speichern' : 'Nachricht senden'}><Send size={18} /></button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
