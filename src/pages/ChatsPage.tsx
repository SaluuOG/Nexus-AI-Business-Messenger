import {
  CheckCheck,
  FileText,
  MessageCircle,
  Mic,
  Paperclip,
  Pencil,
  RefreshCw,
  Reply,
  Search,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChatScanAction } from '../components/ChatScanAction';
import {
  ChatStatusBadge,
  ChatStatusFilter,
  matchesChatStatus,
  type ChatStatusFilterValue,
} from '../components/ChatStatusFilter';
import { Header } from '../components/Header';
import { MessageTaskAction } from '../components/MessageTaskAction';
import { TaskMessageContext } from '../components/TaskMessageContext';
import { useChatScanWorkflows } from '../features/ai/useChatScanWorkflows';
import {
  deleteDirectMessage,
  editDirectMessage,
  loadContactPresence,
  loadConversationTyping,
  loadDirectConversations,
  loadDirectMessageContext,
  loadDirectMessagePage,
  markDirectConversationRead,
  sendDirectAttachmentMessage,
  sendDirectMessage,
  setConversationTyping,
  subscribeToConversationRealtime,
  subscribeToDirectMessagesRealtime,
  SUPPORTED_CHAT_ATTACHMENT_TYPES,
  unsubscribeConversationRealtime,
  validateChatAttachment,
  type ContactPresence,
  type DirectAttachment,
  type DirectConversation,
  type DirectMessage,
  type MessageCursor,
} from '../features/data/chatData';
import {
  clearChatDraftAfterSuccessfulSend,
  readChatDraft,
  saveChatDraft,
  type ChatDraftScope,
} from '../features/drafts/chatDrafts';
import {
  createTextClientRequestId,
  createTextSendRetryStore,
  type TextSendRetrySnapshot,
} from '../features/drafts/textSendRetry';

type ChatsPageProps = {
  currentUserId?: string;
  workspaceId?: string | null;
  requestedConversationId?: string | null;
  onRequestedConversationHandled?: () => void;
};

type PendingScroll =
  | { kind: 'bottom' }
  | { kind: 'anchor'; messageId: string }
  | { kind: 'preserve'; messageId: string; viewportOffset: number };

type ScrollLock = { messageId: string; viewportOffset: number; expiresAt: number };

const initials = (name: string | null, username: string | null) => (name || username || 'N')
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase();

const nameOf = (conversation: DirectConversation) => conversation.full_name
  || (conversation.username ? `@${conversation.username}` : 'Nexus Nutzer');

function formatTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function formatPresence(presence: ContactPresence | null) {
  if (!presence) return 'Status wird geladen…';
  if (presence.online) return 'Online';
  if (!presence.last_seen_at) return 'Noch kein Online-Status';
  const date = new Date(presence.last_seen_at);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? `Zuletzt online heute ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
    : `Zuletzt online ${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function preview(message: DirectMessage) {
  if (message.deleted_at) return 'Nachricht gelöscht';
  if (message.body.trim()) return message.body;
  const attachment = message.attachments[0];
  if (!attachment) return 'Nachricht';
  if (attachment.mime_type.startsWith('image/')) return 'Bild';
  if (attachment.mime_type.startsWith('audio/')) return 'Sprachnachricht';
  return attachment.file_name;
}

function compareMessages(left: DirectMessage, right: DirectMessage) {
  const byDate = left.created_at.localeCompare(right.created_at);
  return byDate || left.message_id.localeCompare(right.message_id);
}

function mergeMessages(existing: DirectMessage[], incoming: DirectMessage[]) {
  const byId = new Map(existing.map((message) => [message.message_id, message]));
  for (const message of incoming) byId.set(message.message_id, message);
  return [...byId.values()].sort(compareMessages);
}

function AttachmentView({
  attachment,
  onContentSettled,
}: {
  attachment: DirectAttachment;
  onContentSettled?: () => void;
}) {
  const image = attachment.mime_type.startsWith('image/');
  const audio = attachment.mime_type.startsWith('audio/');
  if (!attachment.signed_url) {
    return (
      <div className="attachment-unavailable">
        <FileText size={17} />
        <span><b>{attachment.file_name}</b><small>Datei konnte nicht geladen werden</small></span>
      </div>
    );
  }
  if (image) {
    return (
      <a className="chat-image-link" href={attachment.signed_url} target="_blank" rel="noreferrer">
        <img className="chat-image" src={attachment.signed_url} alt={attachment.file_name} onLoad={onContentSettled} />
      </a>
    );
  }
  if (audio) {
    return (
      <div className="voice-message">
        <Mic size={18} />
        <audio controls preload="metadata" src={attachment.signed_url} onLoadedMetadata={onContentSettled} />
      </div>
    );
  }
  return (
    <a className="file-attachment" href={attachment.signed_url} target="_blank" rel="noreferrer" download={attachment.file_name}>
      <span className="file-attachment-icon"><FileText size={19} /></span>
      <span className="file-attachment-info"><b>{attachment.file_name}</b><small>{formatFileSize(attachment.file_size)}</small></span>
    </a>
  );
}

export function ChatsPage({
  currentUserId,
  workspaceId,
  requestedConversationId,
  onRequestedConversationHandled,
}: ChatsPageProps) {
  const [chatSearch, setChatSearch] = useSearchParams();
  const linkedConversationId = chatSearch.get('conversation');
  const linkedMessageId = chatSearch.get('message');
  const selectedRef = useRef<string | null>(null);
  const linkedConversationRef = useRef<string | null>(linkedConversationId);
  const messageRequestRef = useRef(0);
  const conversationListRequestRef = useRef(0);
  const conversationRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const olderRequestRef = useRef(0);
  const olderLoadingChatRef = useRef<string | null>(null);
  const messageCountRef = useRef(0);
  const hasNewerRef = useRef(false);
  const contextMessageRef = useRef<string | null>(null);
  const messagesElementRef = useRef<HTMLDivElement | null>(null);
  const messageElementsRef = useRef(new Map<string, HTMLDivElement>());
  const pendingScrollRef = useRef<PendingScroll | null>(null);
  const scrollLockRef = useRef<ScrollLock | null>(null);
  const scrollTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadInFlightRef = useRef(new Set<string>());
  const lastMarkReadRef = useRef(new Map<string, number>());
  const markReadTimerRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const retryStoreRef = useRef(createTextSendRetryStore());
  const retryReplyRef = useRef(new Map<string, string | null>());
  const previousUserRef = useRef(currentUserId);

  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(requestedConversationId ?? null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [oldestCursor, setOldestCursor] = useState<MessageCursor | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [hasUnseenLatest, setHasUnseenLatest] = useState(false);
  const [contextMessageId, setContextMessageId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [textRetry, setTextRetry] = useState<TextSendRetrySnapshot | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<DirectMessage | null>(null);
  const [editing, setEditing] = useState<DirectMessage | null>(null);
  const [presence, setPresence] = useState<ContactPresence | null>(null);
  const [contactTyping, setContactTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextWarning, setContextWarning] = useState<string | null>(null);
  const [contextRetryMessageId, setContextRetryMessageId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [workflowRevision, setWorkflowRevision] = useState(0);
  const [currentHistoryRevision, setCurrentHistoryRevision] = useState(0);
  const [statusFilter, setStatusFilter] = useState<ChatStatusFilterValue>('all');

  const fileRef = useRef<HTMLInputElement | null>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingRecheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  selectedRef.current = selectedId;
  linkedConversationRef.current = linkedConversationId;
  messageCountRef.current = messages.length;
  hasNewerRef.current = hasNewer;

  const pendingIsAudio = Boolean(pendingFile?.type.startsWith('audio/'));
  const pendingAudioUrl = useMemo(
    () => pendingFile && pendingIsAudio ? URL.createObjectURL(pendingFile) : null,
    [pendingFile, pendingIsAudio],
  );

  const draftScope = (chatId: string | null): ChatDraftScope | null => currentUserId && chatId
    ? { userId: currentUserId, kind: 'direct', chatId }
    : null;

  const nearBottom = () => {
    const element = messagesElementRef.current;
    return !element || element.scrollHeight - element.scrollTop - element.clientHeight <= 96;
  };

  const restoreScrollLock = () => {
    const lock = scrollLockRef.current;
    const container = messagesElementRef.current;
    if (!lock || !container || lock.expiresAt < Date.now()) {
      scrollLockRef.current = null;
      return;
    }
    const target = messageElementsRef.current.get(lock.messageId);
    if (!target) return;
    const currentOffset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop += currentOffset - lock.viewportOffset;
  };

  const clearScrollTimers = () => {
    for (const timer of scrollTimersRef.current) clearTimeout(timer);
    scrollTimersRef.current = [];
  };

  const scheduleScrollLockChecks = () => {
    clearScrollTimers();
    scrollTimersRef.current = [80, 240, 700].map((delay) => setTimeout(restoreScrollLock, delay));
  };

  useLayoutEffect(() => {
    const instruction = pendingScrollRef.current;
    const container = messagesElementRef.current;
    if (!instruction || !container) return;
    pendingScrollRef.current = null;

    if (instruction.kind === 'bottom') {
      scrollLockRef.current = null;
      container.scrollTop = container.scrollHeight;
      return;
    }

    const target = messageElementsRef.current.get(instruction.messageId);
    if (!target) return;
    if (instruction.kind === 'anchor') {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      container.scrollTop += targetRect.top - containerRect.top - Math.max(12, (container.clientHeight - target.offsetHeight) / 2);
      scrollLockRef.current = {
        messageId: instruction.messageId,
        viewportOffset: target.getBoundingClientRect().top - container.getBoundingClientRect().top,
        expiresAt: Date.now() + 1200,
      };
      scheduleScrollLockChecks();
      setHighlightedMessageId(instruction.messageId);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlightedMessageId(null), 4200);
      return;
    }

    scrollLockRef.current = {
      messageId: instruction.messageId,
      viewportOffset: instruction.viewportOffset,
      expiresAt: Date.now() + 1200,
    };
    restoreScrollLock();
    scheduleScrollLockChecks();
  }, [messages]);

  const markReadIfAllowed = async (conversationId: string, forceForLatestOpen = false) => {
    if (document.visibilityState !== 'visible') return;
    if (selectedRef.current !== conversationId || hasNewerRef.current || contextMessageRef.current) return;
    if (!forceForLatestOpen && !nearBottom()) return;
    const now = Date.now();
    const queueRetry = (delay: number) => {
      if (markReadTimerRef.current.has(conversationId)) return;
      const timer = setTimeout(() => {
        markReadTimerRef.current.delete(conversationId);
        void markReadIfAllowed(conversationId, forceForLatestOpen);
      }, delay);
      markReadTimerRef.current.set(conversationId, timer);
    };
    if (markReadInFlightRef.current.has(conversationId)) {
      queueRetry(140);
      return;
    }
    const remainingThrottle = 800 - (now - (lastMarkReadRef.current.get(conversationId) ?? 0));
    if (remainingThrottle > 0) {
      queueRetry(remainingThrottle + 20);
      return;
    }
    const queued = markReadTimerRef.current.get(conversationId);
    if (queued) clearTimeout(queued);
    markReadTimerRef.current.delete(conversationId);
    markReadInFlightRef.current.add(conversationId);
    lastMarkReadRef.current.set(conversationId, now);
    let succeeded = false;
    try {
      const result = await markDirectConversationRead(conversationId);
      succeeded = !result.error;
    } catch {
      succeeded = false;
    } finally {
      markReadInFlightRef.current.delete(conversationId);
    }
    if (succeeded && selectedRef.current === conversationId) {
      setConversations((current) => current.map((conversation) => conversation.conversation_id === conversationId
        ? { ...conversation, unread_count: 0 }
        : conversation));
    }
  };

  const reloadConversationList = async () => {
    const request = ++conversationListRequestRef.current;
    const result = await loadDirectConversations();
    if (request !== conversationListRequestRef.current) return;
    setLoading(false);
    if (result.error) return;
    setConversations(result.data);
    setSelectedId((current) => {
      const target = linkedConversationRef.current || current;
      if (target && result.data.some((conversation) => conversation.conversation_id === target)) return target;
      return linkedConversationRef.current ? null : result.data[0]?.conversation_id ?? null;
    });
  };

  const scheduleConversationListRefresh = () => {
    if (conversationRefreshTimerRef.current) return;
    conversationRefreshTimerRef.current = setTimeout(() => {
      conversationRefreshTimerRef.current = null;
      void reloadConversationList();
    }, 120);
  };

  const refreshConversations = async (preferred?: string | null) => {
    const request = ++conversationListRequestRef.current;
    setLoading(true);
    const result = await loadDirectConversations();
    if (request !== conversationListRequestRef.current) return;
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setConversations(result.data);
    if (linkedConversationId && !result.data.some((conversation) => conversation.conversation_id === linkedConversationId)) {
      setError('Der verlinkte Chat ist nicht mehr verfügbar.');
    }
    setSelectedId((current) => {
      const target = preferred || linkedConversationId || current;
      return target && result.data.some((conversation) => conversation.conversation_id === target)
        ? target
        : linkedConversationId ? null : result.data[0]?.conversation_id ?? null;
    });
  };

  const refreshLatestMessages = async (
    conversationId: string,
    options: { replace?: boolean; stickToBottom?: boolean; markRead?: boolean } = {},
  ) => {
    const request = ++messageRequestRef.current;
    setMessagesLoading(true);
    const result = await loadDirectMessagePage(conversationId);
    if (selectedRef.current !== conversationId || request !== messageRequestRef.current) return false;
    setMessagesLoading(false);
    if (result.error) {
      setError(result.error);
      if (options.replace !== false) setMessages([]);
      return false;
    }
    setError(null);
    setContextRetryMessageId(null);
    if (options.stickToBottom) pendingScrollRef.current = { kind: 'bottom' };
    hasNewerRef.current = false;
    contextMessageRef.current = null;
    setHasNewer(false);
    setContextMessageId(null);
    setHighlightedMessageId(null);
    if (options.replace !== false || messageCountRef.current === 0) {
      setHasOlder(result.data.has_more);
      setOldestCursor(result.data.next_cursor);
    }
    if (options.stickToBottom || options.replace !== false) setHasUnseenLatest(false);
    setMessages((current) => options.replace === false
      ? mergeMessages(current, result.data.messages)
      : result.data.messages);
    if (options.markRead) void markReadIfAllowed(conversationId, true);
    return true;
  };

  const refreshMessageContext = async (conversationId: string, messageId: string) => {
    const request = ++messageRequestRef.current;
    contextMessageRef.current = messageId;
    setMessagesLoading(true);
    const result = await loadDirectMessageContext(conversationId, messageId);
    if (selectedRef.current !== conversationId || request !== messageRequestRef.current) return false;
    setMessagesLoading(false);
    if (result.error || !result.data) {
      const contextError = result.error || 'Die verlinkte Nachricht konnte nicht geladen werden.';
      const permanentlyUnavailable = /(?:Nachricht|Chat) nicht gefunden|kein Zugriff/i.test(contextError);
      if (permanentlyUnavailable) {
        contextMessageRef.current = null;
        setError(null);
        setContextRetryMessageId(null);
        setContextWarning('Die verlinkte Nachricht ist nicht mehr verfügbar. Stattdessen werden die neuesten Nachrichten angezeigt.');
        setChatSearch({ conversation: conversationId }, { replace: true });
      } else {
        setContextWarning(null);
        setContextRetryMessageId(messageId);
        setError(contextError);
      }
      return false;
    }
    setError(null);
    setContextWarning(null);
    setContextRetryMessageId(null);
    pendingScrollRef.current = { kind: 'anchor', messageId: result.data.anchor_message_id };
    hasNewerRef.current = result.data.has_newer;
    contextMessageRef.current = result.data.anchor_message_id;
    setMessages(result.data.messages);
    setHasOlder(result.data.has_older);
    setHasNewer(result.data.has_newer);
    setHasUnseenLatest(false);
    setOldestCursor(result.data.oldest_cursor);
    setContextMessageId(result.data.anchor_message_id);
    return true;
  };

  const refreshVisibleMessages = async (conversationId: string) => {
    const anchorId = contextMessageRef.current;
    if (anchorId) return refreshMessageContext(conversationId, anchorId);
    const stickToBottom = nearBottom();
    return refreshLatestMessages(conversationId, {
      replace: false,
      stickToBottom,
      markRead: stickToBottom,
    });
  };

  const loadOlderMessages = async () => {
    if (!selectedId || !oldestCursor || !hasOlder || olderLoadingChatRef.current === selectedId) return;
    const container = messagesElementRef.current;
    const firstVisible = messages.find((message) => {
      const node = messageElementsRef.current.get(message.message_id);
      if (!node || !container) return false;
      return node.getBoundingClientRect().bottom >= container.getBoundingClientRect().top;
    }) ?? messages[0];
    if (container && firstVisible) {
      const node = messageElementsRef.current.get(firstVisible.message_id);
      if (node) {
        pendingScrollRef.current = {
          kind: 'preserve',
          messageId: firstVisible.message_id,
          viewportOffset: node.getBoundingClientRect().top - container.getBoundingClientRect().top,
        };
      }
    }
    const request = ++olderRequestRef.current;
    olderLoadingChatRef.current = selectedId;
    setLoadingOlder(true);
    const conversationId = selectedId;
    const result = await loadDirectMessagePage(conversationId, oldestCursor);
    if (request !== olderRequestRef.current || selectedRef.current !== conversationId) return;
    olderLoadingChatRef.current = null;
    setLoadingOlder(false);
    if (result.error) {
      pendingScrollRef.current = null;
      setError(result.error);
      return;
    }
    setMessages((current) => mergeMessages(result.data.messages, current));
    setHasOlder(result.data.has_more);
    setOldestCursor(result.data.next_cursor);
  };

  useEffect(() => {
    if (previousUserRef.current && previousUserRef.current !== currentUserId) {
      retryStoreRef.current.clearUser(previousUserRef.current);
      retryReplyRef.current.clear();
    }
    previousUserRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    void refreshConversations(linkedConversationId || requestedConversationId);
  }, [linkedConversationId]);

  useEffect(() => {
    if (!requestedConversationId) return;
    setSelectedId(requestedConversationId);
    void refreshConversations(requestedConversationId);
    onRequestedConversationHandled?.();
  }, [requestedConversationId]);

  useEffect(() => {
    const channel = subscribeToDirectMessagesRealtime(() => {
      setWorkflowRevision((revision) => revision + 1);
      scheduleConversationListRefresh();
    });
    const onFocus = () => { scheduleConversationListRefresh(); };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      scheduleConversationListRefresh();
      if (selectedRef.current) void markReadIfAllowed(selectedRef.current, true);
    };
    const interval = setInterval(() => { if (document.visibilityState === 'visible') scheduleConversationListRefresh(); }, 30000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      if (conversationRefreshTimerRef.current) {
        clearTimeout(conversationRefreshTimerRef.current);
        conversationRefreshTimerRef.current = null;
      }
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      void unsubscribeConversationRealtime(channel);
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!selectedId) {
      messageRequestRef.current += 1;
      messageCountRef.current = 0;
      setMessages([]);
      setDraft('');
      setTextRetry(null);
      return;
    }

    messageCountRef.current = 0;
    setMessages([]);
    setOldestCursor(null);
    hasNewerRef.current = false;
    contextMessageRef.current = null;
    setHasOlder(false);
    setHasNewer(false);
    setHasUnseenLatest(false);
    setContextMessageId(null);
    setContextWarning(null);
    setContextRetryMessageId(null);
    setHighlightedMessageId(null);
    setReplyingTo(null);
    setEditing(null);
    setPendingFile(null);
    setUploadStatus(null);
    setLoadingOlder(false);
    setPresence(null);
    setContactTyping(false);
    setCurrentHistoryRevision(0);
    clearScrollTimers();
    pendingScrollRef.current = null;
    scrollLockRef.current = null;
    const activeRecorder = recorderRef.current;
    if (activeRecorder?.state && activeRecorder.state !== 'inactive') {
      (activeRecorder as MediaRecorder & { __cancel?: boolean }).__cancel = true;
      activeRecorder.stop();
    }
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
    setRecordSeconds(0);

    const scope = draftScope(selectedId);
    setDraft(scope ? readChatDraft(scope) : '');
    setTextRetry(scope ? retryStoreRef.current.get(scope) : null);

    const messageId = linkedConversationId === selectedId ? linkedMessageId : null;
    if (messageId) void refreshMessageContext(selectedId, messageId);
    else void refreshLatestMessages(selectedId, { replace: true, stickToBottom: true, markRead: true });

    void loadContactPresence(selectedId).then((result) => { if (!result.error && selectedRef.current === selectedId) setPresence(result.data); });
    void loadConversationTyping(selectedId).then((result) => { if (!result.error && selectedRef.current === selectedId) setContactTyping(result.data); });

    const channel = subscribeToConversationRealtime(selectedId, {
      onMessagesChanged: () => {
        setCurrentHistoryRevision((revision) => revision + 1);
        scheduleConversationListRefresh();
        if (hasNewerRef.current || contextMessageRef.current) {
          hasNewerRef.current = true;
          setHasNewer(true);
          return;
        }
        if (!nearBottom()) setHasUnseenLatest(true);
        void refreshVisibleMessages(selectedId);
      },
      onReadChanged: () => {
        if (!hasNewerRef.current && !contextMessageRef.current) void refreshVisibleMessages(selectedId);
      },
      onTypingChanged: () => {
        void loadConversationTyping(selectedId).then((result) => {
          if (!result.error && selectedRef.current === selectedId) setContactTyping(result.data);
        });
        if (typingRecheckRef.current) clearTimeout(typingRecheckRef.current);
        typingRecheckRef.current = setTimeout(() => {
          void loadConversationTyping(selectedId).then((result) => {
            if (!result.error && selectedRef.current === selectedId) setContactTyping(result.data);
          });
        }, 6500);
      },
    });
    const presenceTimer = setInterval(() => {
      void loadContactPresence(selectedId).then((result) => {
        if (!result.error && selectedRef.current === selectedId) setPresence(result.data);
      });
    }, 20000);

    return () => {
      messageRequestRef.current += 1;
      olderRequestRef.current += 1;
      olderLoadingChatRef.current = null;
      clearInterval(presenceTimer);
      if (typingStopRef.current) clearTimeout(typingStopRef.current);
      if (typingRecheckRef.current) clearTimeout(typingRecheckRef.current);
      void setConversationTyping(selectedId, false);
      void unsubscribeConversationRealtime(channel);
    };
  }, [selectedId, linkedConversationId, linkedMessageId, currentUserId]);

  useEffect(() => () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    clearScrollTimers();
    for (const timer of markReadTimerRef.current.values()) clearTimeout(timer);
    markReadTimerRef.current.clear();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => () => {
    if (pendingAudioUrl) URL.revokeObjectURL(pendingAudioUrl);
  }, [pendingAudioUrl]);

  const workflowHistoryVersion = JSON.stringify([
    workflowRevision,
    conversations.map((conversation) => [conversation.conversation_id, conversation.last_message_at, conversation.last_message]),
  ]);
  const workflows = useChatScanWorkflows('direct', currentUserId, workflowHistoryVersion);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return conversations.filter((conversation) => (
      !normalized
      || `${conversation.full_name || ''} ${conversation.username || ''} ${conversation.last_message || ''}`.toLowerCase().includes(normalized)
    ) && matchesChatStatus(workflows.states.get(conversation.conversation_id), statusFilter));
  }, [conversations, query, workflows.states, statusFilter]);
  const currentChat = conversations.find((conversation) => conversation.conversation_id === selectedId) || null;
  const scanHistoryVersion = JSON.stringify([
    currentHistoryRevision,
    currentChat?.conversation_id,
    currentChat?.last_message_at,
    currentChat?.last_message,
  ]);

  const draftChange = (value: string) => {
    setDraft(value);
    if (!selectedId) return;
    if (!editing) {
      const scope = draftScope(selectedId);
      if (scope) saveChatDraft(scope, value);
    }
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    if (!value.trim()) {
      void setConversationTyping(selectedId, false);
      lastTypingRef.current = 0;
      return;
    }
    if (Date.now() - lastTypingRef.current > 1200) {
      lastTypingRef.current = Date.now();
      void setConversationTyping(selectedId, true);
    }
    typingStopRef.current = setTimeout(() => {
      void setConversationTyping(selectedId, false);
      lastTypingRef.current = 0;
    }, 2500);
  };

  const clearPending = () => {
    setPendingFile(null);
    setUploadStatus(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const chooseFile = (file: File | null) => {
    if (!file) return;
    const validation = validateChatAttachment(file);
    if (validation.error) {
      setError(validation.error);
      return;
    }
    setError(null);
    if (editing && selectedId) {
      setEditing(null);
      const scope = draftScope(selectedId);
      setDraft(scope ? readChatDraft(scope) : '');
    }
    setPendingFile(file);
  };

  const stopRecording = (cancel = false) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    (recorder as MediaRecorder & { __cancel?: boolean }).__cancel = cancel;
    if (recorder.state !== 'inactive') recorder.stop();
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setRecording(false);
  };

  const startRecording = async () => {
    if (recording || sending || editing) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Sprachaufnahme wird von diesem Browser nicht unterstützt.');
      return;
    }
    try {
      setError(null);
      clearPending();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const cancelled = (recorder as MediaRecorder & { __cancel?: boolean }).__cancel;
        if (!cancelled && chunksRef.current.length) {
          const type = (recorder.mimeType || 'audio/webm').split(';')[0];
          const extension = type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm';
          const blob = new Blob(chunksRef.current, { type });
          const file = new File([blob], `sprachnachricht-${Date.now()}.${extension}`, { type });
          const validation = validateChatAttachment(file);
          if (validation.error) setError(validation.error);
          else setPendingFile(file);
        }
        chunksRef.current = [];
        setRecordSeconds(0);
      };
      recorder.start(250);
      setRecordSeconds(0);
      setRecording(true);
      recordTimerRef.current = setInterval(() => setRecordSeconds((seconds) => seconds + 1), 1000);
    } catch (recordingError) {
      setError(recordingError instanceof DOMException && recordingError.name === 'NotAllowedError'
        ? 'Mikrofonzugriff wurde nicht erlaubt. Bitte erlaube Nexus den Mikrofonzugriff.'
        : 'Mikrofon konnte nicht gestartet werden.');
    }
  };

  const restoreSavedDraft = (chatId: string) => {
    const scope = draftScope(chatId);
    setDraft(scope ? readChatDraft(scope) : '');
  };

  const clearSuccessfulComposer = (conversationId: string) => {
    const scope = draftScope(conversationId);
    if (scope) clearChatDraftAfterSuccessfulSend(scope);
    setDraft('');
    clearPending();
    setReplyingTo(null);
    setEditing(null);
    void setConversationTyping(conversationId, false);
  };

  const switchToLatestRoute = (conversationId: string) => {
    const hasLinkedAnchor = linkedConversationId === conversationId && Boolean(linkedMessageId);
    if (!hasLinkedAnchor && !contextMessageRef.current && !hasNewerRef.current) return false;
    setError(null);
    setContextWarning(null);
    setContextRetryMessageId(null);
    setChatSearch({ conversation: conversationId }, { replace: true });
    return true;
  };

  const submit = async () => {
    const body = draft.trim();
    if (!selectedId || sending || recording || textRetry || (!editing && !body && !pendingFile) || (editing && !body)) return;
    const conversationId = selectedId;
    const scope = draftScope(conversationId);
    const replyToMessageId = replyingTo?.message_id ?? null;
    setSending(true);
    setError(null);

    let result: { data?: string | null; error: string | null } | { error: string | null };
    let clientRequestId: string | null = null;
    if (editing) {
      result = await editDirectMessage(editing.message_id, body);
    } else if (pendingFile) {
      if (!currentUserId) {
        setSending(false);
        setError('Nutzerkonto konnte nicht bestimmt werden.');
        return;
      }
      setUploadStatus(pendingFile.type.startsWith('audio/')
        ? 'Sprachnachricht wird sicher hochgeladen…'
        : 'Datei wird sicher hochgeladen…');
      result = await sendDirectAttachmentMessage(conversationId, currentUserId, pendingFile, body, replyToMessageId);
    } else {
      clientRequestId = createTextClientRequestId();
      result = await sendDirectMessage(conversationId, body, replyToMessageId, clientRequestId);
    }

    setSending(false);
    setUploadStatus(null);
    if (result.error) {
      if (!editing && !pendingFile && scope && clientRequestId) {
        const failed = retryStoreRef.current.rememberFailure(scope, body, clientRequestId);
        if (failed) {
          retryReplyRef.current.set(failed.id, replyToMessageId);
          if (selectedRef.current === conversationId) setTextRetry(retryStoreRef.current.get(scope));
        }
      }
      if (selectedRef.current === conversationId) setError(result.error);
      return;
    }

    if (!editing && scope) clearChatDraftAfterSuccessfulSend(scope);
    if (selectedRef.current !== conversationId) return;
    if (editing) {
      setEditing(null);
      setReplyingTo(null);
      restoreSavedDraft(conversationId);
    } else {
      clearSuccessfulComposer(conversationId);
    }
    if (editing && contextMessageRef.current) await refreshMessageContext(conversationId, contextMessageRef.current);
    else if (!switchToLatestRoute(conversationId)) {
      await refreshLatestMessages(conversationId, {
        replace: false,
        stickToBottom: true,
        markRead: true,
      });
    }
    await reloadConversationList();
  };

  const retryFailedText = async () => {
    if (!selectedId || !textRetry || sending) return;
    const scope = draftScope(selectedId);
    if (!scope) return;
    const retry = retryStoreRef.current.beginRetry(scope, textRetry.payload.id);
    if (!retry) return;
    setTextRetry(retryStoreRef.current.get(scope));
    setSending(true);
    setError(null);
    const replyToMessageId = retryReplyRef.current.get(retry.id) ?? null;
    const result = await sendDirectMessage(selectedId, retry.text, replyToMessageId, retry.clientRequestId);
    setSending(false);
    retryStoreRef.current.finishRetry(scope, retry.id, !result.error);
    if (!result.error) {
      clearChatDraftAfterSuccessfulSend(scope);
      retryReplyRef.current.delete(retry.id);
    }
    if (selectedRef.current !== selectedId) return;
    if (result.error) {
      setError(result.error);
      setTextRetry(retryStoreRef.current.get(scope));
      return;
    }
    setTextRetry(null);
    clearSuccessfulComposer(selectedId);
    if (!switchToLatestRoute(selectedId)) {
      await refreshLatestMessages(selectedId, {
        replace: false,
        stickToBottom: true,
        markRead: true,
      });
    }
    await reloadConversationList();
  };

  const discardFailedText = () => {
    if (!selectedId || !textRetry) return;
    const scope = draftScope(selectedId);
    if (!scope) return;
    retryStoreRef.current.discard(scope, textRetry.payload.id);
    retryReplyRef.current.delete(textRetry.payload.id);
    setTextRetry(null);
    setError(null);
  };

  const remove = async (message: DirectMessage) => {
    if (message.sender_id !== currentUserId || message.deleted_at || !confirm('Diese Nachricht wirklich löschen?')) return;
    setActionId(message.message_id);
    const result = await deleteDirectMessage(message.message_id, message.attachments.map((attachment) => attachment.storage_path));
    setActionId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (selectedId) {
      await refreshVisibleMessages(selectedId);
      await reloadConversationList();
    }
  };

  const showLatestMessages = () => {
    if (!selectedId) return;
    if (switchToLatestRoute(selectedId)) return;
    const container = messagesElementRef.current;
    container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    setHasUnseenLatest(false);
    void markReadIfAllowed(selectedId);
  };

  const handleMessageScroll = () => {
    if (!nearBottom()) return;
    if (!contextMessageRef.current && !hasNewerRef.current) setHasUnseenLatest(false);
    if (selectedId) void markReadIfAllowed(selectedId);
  };

  const cancelComposerContext = () => {
    setReplyingTo(null);
    if (editing && selectedId) {
      setEditing(null);
      restoreSavedDraft(selectedId);
    }
  };

  const canSend = Boolean(editing ? draft.trim() : draft.trim() || pendingFile)
    && !sending
    && !recording
    && !textRetry;

  return (
    <div className="chat-layout real-chat-layout">
      <section className="chat-list">
        <div className="chat-list-title">
          <Header kicker="MESSENGER" title="Chats" sub="Echte 1:1-Nachrichten zwischen deinen Nexus-Kontakten." />
          <button className="chat-refresh" onClick={() => void refreshConversations(selectedId)} title="Chats aktualisieren"><RefreshCw size={15} /></button>
        </div>
        <div className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Chats durchsuchen" /></div>
        <ChatStatusFilter value={statusFilter} onChange={setStatusFilter} ready={workflows.ready} error={workflows.error} onRetry={workflows.refresh} />
        {!loading && conversations.length > 0 && filtered.length === 0 && <div className="chat-list-empty">Keine Chats für diese Auswahl.</div>}
        {loading && conversations.length === 0 && <div className="chat-list-empty">Chats werden geladen…</div>}
        {!loading && conversations.length === 0 && <div className="chat-list-empty"><MessageCircle size={24} /><b>Noch keine Chats</b></div>}
        {filtered.map((conversation) => (
          <button className={`chat${selectedId === conversation.conversation_id ? ' active' : ''}`} onClick={() => { setError(null); setContextWarning(null); setContextRetryMessageId(null); setSelectedId(conversation.conversation_id); setChatSearch({}); }} key={conversation.conversation_id}>
            <div className="avatar">{initials(conversation.full_name, conversation.username)}</div>
            <span>
              <b>{nameOf(conversation)}</b>
              <small>{conversation.username ? `@${conversation.username}` : 'Nexus-Kontakt'}</small>
              <p>{conversation.last_message || 'Neuer Chat'}</p>
              <ChatStatusBadge state={workflows.states.get(conversation.conversation_id)} />
            </span>
            <em>{formatTime(conversation.last_message_at)}{conversation.unread_count > 0 && <i>{conversation.unread_count > 99 ? '99+' : conversation.unread_count}</i>}</em>
          </button>
        ))}
      </section>

      <section className="conversation">
        <TaskMessageContext kind="direct" onChatResolved={(id) => { setError(null); setContextWarning(null); setContextRetryMessageId(null); setChatSearch({}); setSelectedId(id); void refreshConversations(id); }} />
        {contextWarning && <div className="chat-error chat-context-warning" role="status">{contextWarning}</div>}
        {error && (
          <div className={`chat-error${contextRetryMessageId ? ' chat-context-retry' : ''}`} role="alert">
            <span>{error}</span>
            {contextRetryMessageId && selectedId && (
              <button
                className="secondary"
                data-action="retry-message-context"
                onClick={() => void refreshMessageContext(selectedId, contextRetryMessageId)}
                disabled={messagesLoading}
              >
                <RefreshCw size={13} />
                {messagesLoading ? 'Wird erneut geladen…' : 'Erneut laden'}
              </button>
            )}
          </div>
        )}
        {!currentChat ? (
          <div className="conversation-empty"><MessageCircle size={42} /><h2>Nexus Messenger</h2><p>Wähle einen Chat aus.</p></div>
        ) : (
          <>
            <div className="chat-head">
              <div className="chat-head-person">
                <div className="avatar">{initials(currentChat.full_name, currentChat.username)}</div>
                <div>
                  <b>{nameOf(currentChat)}</b>
                  <small className={contactTyping ? 'typing-status' : presence?.online ? 'online-status' : ''}>{contactTyping ? 'schreibt gerade…' : formatPresence(presence)}</small>
                </div>
              </div>
              <div className="project-pill">Privater 1:1-Chat</div>
            </div>

            <div className="messages" ref={messagesElementRef} onScroll={handleMessageScroll}>
              {hasOlder && (
                <button className="secondary messages-history-button" onClick={() => void loadOlderMessages()} disabled={loadingOlder} data-action="load-older-messages">
                  <RefreshCw size={14} className={loadingOlder ? 'spinning' : ''} />
                  {loadingOlder ? 'Ältere Nachrichten werden geladen…' : 'Ältere Nachrichten laden'}
                </button>
              )}
              {messagesLoading && messages.length === 0 && <div className="messages-status">Nachrichten werden geladen…</div>}
              {!messagesLoading && messages.length === 0 && <div className="messages-status">Noch keine Nachrichten.</div>}
              {messages.map((message) => {
                const mine = message.sender_id === currentUserId;
                const highlighted = highlightedMessageId === message.message_id;
                return (
                  <div
                    key={message.message_id}
                    ref={(element) => {
                      if (element) messageElementsRef.current.set(message.message_id, element);
                      else messageElementsRef.current.delete(message.message_id);
                    }}
                    data-message-id={message.message_id}
                    aria-current={highlighted ? 'true' : undefined}
                    className={`message-wrap${mine ? ' mine' : ''}${highlighted ? ' message-anchor-highlight' : ''}`}
                    style={highlighted ? { outline: '2px solid #8f87ff', outlineOffset: 6, borderRadius: 12 } : undefined}
                  >
                    <div className={mine ? 'bubble me' : 'bubble'}>
                      {message.reply_to_message_id && <div className="reply-preview"><b>{message.reply_sender_id === currentUserId ? 'Du' : nameOf(currentChat)}</b><span>{message.reply_body || 'Anhang'}</span></div>}
                      {!message.deleted_at && message.attachments.length > 0 && (
                        <div className="message-attachments">
                          {message.attachments.map((attachment) => <AttachmentView key={attachment.attachment_id} attachment={attachment} onContentSettled={restoreScrollLock} />)}
                        </div>
                      )}
                      {(message.deleted_at || message.body.trim()) && <span className={message.deleted_at ? 'deleted-message' : 'message-body'}>{message.deleted_at ? 'Nachricht gelöscht' : message.body}</span>}
                      <div className="message-meta">
                        {message.edited_at && !message.deleted_at && <small>bearbeitet</small>}
                        <time>{formatTime(message.created_at)}</time>
                        {mine && !message.deleted_at && <span className={`message-receipt${message.read_at ? ' read' : ''}`}>{message.read_at ? <CheckCheck size={13} /> : '✓'}</span>}
                      </div>
                    </div>
                    {!message.deleted_at && (
                      <div className="message-actions">
                        <MessageTaskAction currentUserId={currentUserId} workspaceId={workspaceId} source={{ kind: 'direct', messageId: message.message_id, body: message.body, chatName: nameOf(currentChat), attachmentName: message.attachments[0]?.file_name }} />
                        <button onClick={() => { setEditing(null); restoreSavedDraft(currentChat.conversation_id); setReplyingTo(message); }} disabled={Boolean(textRetry)} title="Antworten"><Reply size={13} /></button>
                        {mine && message.body.trim() && <button onClick={() => { setReplyingTo(null); clearPending(); setEditing(message); setDraft(message.body); }} disabled={Boolean(textRetry)} title="Bearbeiten"><Pencil size={13} /></button>}
                        {mine && <button onClick={() => void remove(message)} disabled={actionId === message.message_id} title="Löschen"><Trash2 size={13} /></button>}
                      </div>
                    )}
                  </div>
                );
              })}
              {(contextMessageId || hasNewer || hasUnseenLatest) && (
                <div className="newer-messages-notice" role="status">
                  <span>{contextMessageId || hasNewer ? 'Du siehst eine frühere Stelle im Chat.' : 'Neue Nachrichten sind eingegangen.'}</span>
                  <button className="secondary" data-action="show-latest" onClick={showLatestMessages}>Zu den neuesten Nachrichten</button>
                </div>
              )}
            </div>

            {(replyingTo || editing) && <div className="composer-context"><div><b>{editing ? 'Nachricht bearbeiten' : 'Antworten'}</b><span>{editing ? editing.body : replyingTo ? preview(replyingTo) : ''}</span></div><button onClick={cancelComposerContext} disabled={Boolean(textRetry)}><X size={15} /></button></div>}
            {recording && <div className="voice-recording"><span className="record-dot" /><b>Aufnahme läuft</b><span>{formatDuration(recordSeconds)}</span><button onClick={() => stopRecording(true)} title="Abbrechen"><Trash2 size={15} /></button><button className="voice-stop" onClick={() => stopRecording(false)} title="Aufnahme beenden"><Square size={14} /></button></div>}
            {pendingFile && !editing && (
              <div className={`pending-attachment${pendingIsAudio ? ' voice-pending' : ''}`}>
                <span className="pending-attachment-icon">{pendingIsAudio ? <Mic size={16} /> : <Paperclip size={16} />}</span>
                <span className="pending-attachment-info"><b>{pendingIsAudio ? 'Sprachnachricht' : pendingFile.name}</b><small>{uploadStatus || `${formatFileSize(pendingFile.size)} · bereit zum Senden`}</small>{pendingIsAudio && pendingAudioUrl && <audio controls src={pendingAudioUrl} />}</span>
                <button onClick={clearPending} disabled={sending}><X size={15} /></button>
              </div>
            )}
            {textRetry && (
              <div className="text-send-retry" role="alert">
                <div><b>Textnachricht wurde noch nicht bestätigt</b><span>Erneut senden verwendet dieselbe sichere Nachrichten-ID und erzeugt kein Duplikat.</span></div>
                <button className="secondary" data-action="discard-text-retry" onClick={discardFailedText} disabled={textRetry.status === 'retrying' || sending}>Verwerfen</button>
                <button className="primary" data-action="retry-text-send" onClick={() => void retryFailedText()} disabled={textRetry.status === 'retrying' || sending}><RefreshCw size={14} />{textRetry.status === 'retrying' ? 'Wird erneut gesendet…' : 'Erneut senden'}</button>
              </div>
            )}
            <ChatScanAction key={`${currentUserId}:direct:${currentChat.conversation_id}`} currentUserId={currentUserId} kind="direct" chatId={currentChat.conversation_id} chatName={nameOf(currentChat)} historyVersion={scanHistoryVersion} />
            <div className="composer attachment-composer">
              <input ref={fileRef} className="attachment-file-input" type="file" accept={SUPPORTED_CHAT_ATTACHMENT_TYPES.filter((type) => !type.startsWith('audio/')).join(',')} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} disabled={Boolean(textRetry)} />
              <button className="attach-button" onClick={() => fileRef.current?.click()} disabled={sending || Boolean(editing) || recording || Boolean(textRetry)} title="Datei anhängen"><Paperclip size={18} /></button>
              <button className={`attach-button mic-button${recording ? ' recording' : ''}`} onClick={() => void startRecording()} disabled={sending || Boolean(editing) || recording || Boolean(textRetry)} title="Sprachnachricht aufnehmen"><Mic size={18} /></button>
              <input
                data-testid="direct-message-composer"
                value={draft}
                onChange={(event) => draftChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }}
                placeholder={editing ? 'Bearbeitete Nachricht…' : pendingFile ? 'Beschriftung hinzufügen (optional)…' : 'Nachricht schreiben…'}
                maxLength={5000}
                disabled={recording || sending || Boolean(textRetry)}
              />
              <button onClick={() => void submit()} disabled={!canSend}><Send size={18} /></button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
