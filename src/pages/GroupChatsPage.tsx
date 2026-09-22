import { Camera, CheckCheck, Crown, FileText, LogOut, MessageCircle, Mic, Paperclip, Pencil, Plus, RefreshCw, Reply, Search, Send, ShieldCheck, Square, Trash2, UserMinus, UserPlus, UsersRound, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useMobileLayout } from '../features/mobile/useMobileLayout';
import { ChatScanAction } from '../components/ChatScanAction';
import { ChatStatusBadge, ChatStatusFilter, matchesChatStatus, type ChatStatusFilterValue } from '../components/ChatStatusFilter';
import { useChatScanWorkflows } from '../features/ai/useChatScanWorkflows';
import { MessageTaskAction } from '../components/MessageTaskAction';
import { TaskMessageContext } from '../components/TaskMessageContext';
import { Header } from '../components/Header';
import { SUPPORTED_CHAT_ATTACHMENT_TYPES, validateChatAttachment } from '../features/data/chatData';
import { loadNexusContacts, type NexusContact } from '../features/data/contactsData';
import {
  addGroupMember,
  createGroupChat,
  deleteGroupChat,
  deleteGroupMessage,
  editGroupMessage,
  leaveGroupChat,
  loadGroupActivity,
  loadGroupChats,
  loadGroupMessageContext,
  loadGroupMessagePage,
  loadGroupMembers,
  markGroupRead,
  removeGroupMember,
  removeGroupAvatar,
  renameGroupChat,
  sendGroupAttachmentMessage,
  sendGroupMessage,
  setGroupMemberRole,
  setGroupTyping,
  subscribeToGroupMessagesRealtime,
  subscribeToGroupRealtime,
  unsubscribeGroupRealtime,
  transferGroupOwnership,
  updateGroupAvatar,
  type GroupActivity,
  type GroupAttachment,
  type GroupChat,
  type GroupMember,
  type GroupMessage,
} from '../features/data/groupChatData';
import type { MessageCursor } from '../features/data/messageSearchData';
import { clearChatDraftAfterSuccessfulSend, readChatDraft, saveChatDraft, type ChatDraftScope } from '../features/drafts/chatDrafts';
import { createTextClientRequestId, createTextSendRetryStore, type TextSendRetrySnapshot } from '../features/drafts/textSendRetry';

type GroupChatsPageProps = { currentUserId?: string; workspaceId?: string | null };

type NexusMediaRecorder = MediaRecorder & { __cancel?: boolean };

type PendingScrollAction =
  | { kind: 'bottom' }
  | { kind: 'preserve'; messageId: string; viewportOffset: number }
  | { kind: 'anchor'; messageId: string };

type MessageScrollLock = { messageId: string; viewportOffset: number; expiresAt: number };

const groupInitials = (name: string) => name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
const personName = (member: GroupMember) => member.full_name || (member.username ? `@${member.username}` : 'Nexus Nutzer');
const activityName = (member: GroupActivity) => member.full_name || (member.username ? `@${member.username}` : 'Nexus Nutzer');
const contactName = (contact: NexusContact) => contact.full_name || (contact.username ? `@${contact.username}` : 'Nexus Nutzer');
const roleLabel = (role: GroupChat['role'] | GroupMember['role']) => role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Mitglied';
const lostGroupAccess = (message: string | null) => Boolean(message && /Gruppe nicht gefunden|kein Gruppenzugriff|kein Zugriff/i.test(message));

function mergeGroupMessages(current: GroupMessage[], incoming: GroupMessage[]) {
  const byId = new Map(current.map((message) => [message.message_id, message]));
  incoming.forEach((message) => byId.set(message.message_id, message));
  return Array.from(byId.values()).sort((left, right) => {
    const byTime = left.created_at.localeCompare(right.created_at);
    return byTime || left.message_id.localeCompare(right.message_id);
  });
}

function GroupAvatar({ group, size = 17 }: { group: GroupChat; size?: number }) {
  return group.avatar_url
    ? <img src={group.avatar_url} alt="" />
    : <UsersRound size={size} />;
}

function formatTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function formatPresence(member: GroupActivity | undefined) {
  if (!member) return 'Status wird geladen…';
  if (member.online) return 'Online';
  if (!member.last_seen_at) return 'Offline';
  const date = new Date(member.last_seen_at);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? `Zuletzt heute ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
    : `Zuletzt ${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
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

function messagePreview(message: GroupMessage | null) {
  if (!message) return 'Nachricht';
  if (message.deleted_at) return 'Nachricht gelöscht';
  if (message.body.trim()) return message.body;
  const attachment = message.attachments?.[0];
  if (!attachment) return 'Nachricht';
  if (attachment.mime_type.startsWith('image/')) return 'Bild';
  if (attachment.mime_type.startsWith('audio/')) return 'Sprachnachricht';
  return attachment.file_name;
}

function GroupAttachmentView({ attachment, onContentSettled }: { attachment: GroupAttachment; onContentSettled?: () => void }) {
  const image = attachment.mime_type.startsWith('image/');
  const audio = attachment.mime_type.startsWith('audio/');
  if (!attachment.signed_url) {
    return <div className="attachment-unavailable"><FileText size={17} /><span><b>{attachment.file_name}</b><small>Datei konnte nicht geladen werden</small></span></div>;
  }
  if (image) {
    return <a className="chat-image-link" href={attachment.signed_url} target="_blank" rel="noreferrer"><img className="chat-image" src={attachment.signed_url} alt={attachment.file_name} onLoad={onContentSettled} /></a>;
  }
  if (audio) {
    return <div className="voice-message"><Mic size={18} /><audio controls preload="metadata" src={attachment.signed_url} onLoadedMetadata={onContentSettled} /></div>;
  }
  return <a className="file-attachment" href={attachment.signed_url} target="_blank" rel="noreferrer" download={attachment.file_name}><span className="file-attachment-icon"><FileText size={19} /></span><span className="file-attachment-info"><b>{attachment.file_name}</b><small>{formatFileSize(attachment.file_size)}</small></span></a>;
}

export function GroupChatsPage({ currentUserId, workspaceId }: GroupChatsPageProps) {
  const [chatSearch, setChatSearch] = useSearchParams();
  const linkedGroupId = chatSearch.get('group');
  const linkedMessageId = chatSearch.get('message');
  const isMobile = useMobileLayout();
  const selectedRef = useRef<string | null>(null);
  const messageRequest = useRef(0);
  const olderMessageRequest = useRef(0);
  const activityRequest = useRef(0);
  const groupListRequest = useRef(0);
  const visibleGroupListRequest = useRef(0);
  const messageHistoryInitializedRef = useRef(false);
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [contacts, setContacts] = useState<NexusContact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const previousMobile = useRef(isMobile);
  const continuingDesktopChat = isMobile && !previousMobile.current && Boolean(selectedId);
  const mobileConversationOpen = Boolean(linkedGroupId || chatSearch.get('task') || continuingDesktopChat);
  const mobileListOnly = isMobile && !mobileConversationOpen;
  const mobileListOnlyRef = useRef(mobileListOnly);
  mobileListOnlyRef.current = mobileListOnly;
  useEffect(() => {
    if (continuingDesktopChat && selectedId && !linkedGroupId && !chatSearch.get('task')) {
      setChatSearch({ group: selectedId }, { replace: true });
    }
    previousMobile.current = isMobile;
  }, [isMobile, continuingDesktopChat, selectedId, linkedGroupId]);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderCursor, setOlderCursor] = useState<MessageCursor | null>(null);
  const [viewHasNewerMessages, setViewHasNewerMessages] = useState(false);
  const [hasNewMessagesNotice, setHasNewMessagesNotice] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [scanRevision, setScanRevision] = useState(0);
  const [groupListRevision, setGroupListRevision] = useState(0);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [activity, setActivity] = useState<GroupActivity[]>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<GroupMessage | null>(null);
  const [editing, setEditing] = useState<GroupMessage | null>(null);
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [showMembers, setShowMembers] = useState(false);
  const [managementName, setManagementName] = useState('');
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [managing, setManaging] = useState(false);
  const [managementNotice, setManagementNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [contextWarning, setContextWarning] = useState<string | null>(null);
  const [failedTextSend, setFailedTextSend] = useState<TextSendRetrySnapshot | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const groupMessagesDataRef = useRef<GroupMessage[]>([]);
  const realtimeMessageRequestRef = useRef(new Map<string, number>());
  const realtimeGenerationRef = useRef(0);
  const messageElementsRef = useRef(new Map<string, HTMLDivElement>());
  const pendingScrollActionRef = useRef<PendingScrollAction | null>(null);
  const scrollLockRef = useRef<MessageScrollLock | null>(null);
  const scrollTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const viewHasNewerRef = useRef(false);
  const messageContextRef = useRef(false);
  const draftRef = useRef('');
  const retryStoreRef = useRef(createTextSendRetryStore());
  const retryReplyTargetsRef = useRef(new Map<string, string | null>());
  const previousUserRef = useRef<string | undefined>(currentUserId);
  const replyingToRef = useRef<GroupMessage | null>(null);
  const editingRef = useRef<GroupMessage | null>(null);
  const markingReadRef = useRef(new Set<string>());
  const queuedReadRef = useRef(new Map<string, boolean>());
  const lastMarkReadRef = useRef(new Map<string, number>());
  const markReadTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const refreshGroupsRef = useRef<(
    preferred?: string | null,
    silent?: boolean,
    shouldApply?: () => boolean,
  ) => Promise<GroupChat[] | null>>(async () => null);
  const groupListRefreshInFlightRef = useRef(false);
  const groupListRefreshQueuedRef = useRef(false);
  const groupListHistoryChangedRef = useRef(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const avatarRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingRecheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingRef = useRef(0);

  const draftScope = useMemo<ChatDraftScope | null>(() => currentUserId && selectedId
    ? { userId: currentUserId, kind: 'group', chatId: selectedId }
    : null, [currentUserId, selectedId]);

  draftRef.current = draft;
  groupMessagesDataRef.current = messages;
  viewHasNewerRef.current = viewHasNewerMessages;
  replyingToRef.current = replyingTo;
  editingRef.current = editing;
  const isMessageContext = Boolean(linkedMessageId && linkedGroupId === selectedId);
  messageContextRef.current = isMessageContext;

  const pendingIsAudio = Boolean(pendingFile?.type.startsWith('audio/'));
  const pendingAudioUrl = useMemo(
    () => pendingFile && pendingIsAudio ? URL.createObjectURL(pendingFile) : null,
    [pendingFile, pendingIsAudio],
  );

  useEffect(() => () => {
    if (pendingAudioUrl) URL.revokeObjectURL(pendingAudioUrl);
  }, [pendingAudioUrl]);

  selectedRef.current = selectedId;

  const refreshGroups = async (
    preferred?: string | null,
    silent = false,
    shouldApply?: () => boolean,
  ) => {
    if (shouldApply && !shouldApply()) return null;
    const request = ++groupListRequest.current;
    if (!silent) {
      visibleGroupListRequest.current = request;
      setLoading(true);
    }
    const result = await loadGroupChats();
    if (!silent && visibleGroupListRequest.current === request && (!shouldApply || shouldApply())) setLoading(false);
    if (request !== groupListRequest.current || (shouldApply && !shouldApply())) return null;
    if (result.error) {
      if (!silent) setError(result.error);
      return null;
    }
    if (!silent) setError(null);
    setGroups(result.data);
    if (!silent && linkedGroupId && !result.data.some(group => group.group_id === linkedGroupId)) setError('Die verlinkte Gruppe ist nicht mehr verfügbar.');
    setSelectedId((current) => {
      if (mobileListOnlyRef.current) return null;
      const target = preferred || linkedGroupId || current;
      return target && result.data.some((group) => group.group_id === target)
        ? target
        : linkedGroupId ? null : result.data[0]?.group_id ?? null;
    });
    return result.data;
  };

  refreshGroupsRef.current = refreshGroups;

  useEffect(() => {
    if (mobileListOnly) setSelectedId(null);
    else if (linkedGroupId) setSelectedId(linkedGroupId);
    void refreshGroups(linkedGroupId);
  }, [linkedGroupId, mobileListOnly]);

  const refreshActivity = async (groupId: string, shouldApply?: () => boolean) => {
    if (shouldApply && !shouldApply()) return;
    const request = ++activityRequest.current;
    const result = await loadGroupActivity(groupId);
    if (selectedRef.current !== groupId
      || request !== activityRequest.current
      || (shouldApply && !shouldApply())) return;
    if (result.error) {
      if (lostGroupAccess(result.error)) {
        setError(null);
        setSelectedId(null);
        setChatSearch({}, { replace: true });
        void refreshGroups();
        return;
      }
      setError(result.error);
      return;
    }
    setActivity(result.data);
  };

  const clearScrollTimers = () => {
    scrollTimersRef.current.forEach((timer) => clearTimeout(timer));
    scrollTimersRef.current = [];
  };

  const restoreScrollLock = () => {
    const lock = scrollLockRef.current;
    const container = messagesRef.current;
    if (!lock || !container || lock.expiresAt < Date.now()) {
      scrollLockRef.current = null;
      return;
    }
    const target = messageElementsRef.current.get(lock.messageId);
    if (!target) return;
    const currentOffset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop += currentOffset - lock.viewportOffset;
  };

  const scheduleScrollLockChecks = () => {
    clearScrollTimers();
    scrollTimersRef.current = [80, 240, 700].map((delay) => setTimeout(restoreScrollLock, delay));
  };

  const markSelectedGroupRead = async (groupId: string, forceForLatestOpen = false) => {
    const container = messagesRef.current;
    const nearBottom = !container || container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    if (document.visibilityState !== 'visible'
      || selectedRef.current !== groupId
      || messageContextRef.current
      || viewHasNewerRef.current
      || (!forceForLatestOpen && !nearBottom)) return;

    const queueTrailingRead = (force: boolean, delay: number) => {
      queuedReadRef.current.set(groupId, Boolean(queuedReadRef.current.get(groupId) || force));
      if (markReadTimersRef.current.has(groupId)) return;
      const timer = setTimeout(() => {
        markReadTimersRef.current.delete(groupId);
        const queuedForce = queuedReadRef.current.get(groupId) ?? false;
        queuedReadRef.current.delete(groupId);
        void markSelectedGroupRead(groupId, queuedForce);
      }, Math.max(0, delay));
      markReadTimersRef.current.set(groupId, timer);
    };

    if (markingReadRef.current.has(groupId)) {
      queuedReadRef.current.set(groupId, Boolean(queuedReadRef.current.get(groupId) || forceForLatestOpen));
      return;
    }
    const now = Date.now();
    const remainingThrottle = 750 - (now - (lastMarkReadRef.current.get(groupId) ?? 0));
    if (remainingThrottle > 0) {
      queueTrailingRead(forceForLatestOpen, remainingThrottle);
      return;
    }

    markingReadRef.current.add(groupId);
    lastMarkReadRef.current.set(groupId, now);
    let succeeded = false;
    try {
      const result = await markGroupRead(groupId);
      succeeded = !result.error;
    } catch {
      succeeded = false;
    } finally {
      markingReadRef.current.delete(groupId);
    }
    if (succeeded && selectedRef.current === groupId) {
      setGroups((current) => current.map((group) => group.group_id === groupId ? { ...group, unread_count: 0 } : group));
    }
    if (queuedReadRef.current.has(groupId)) {
      const queuedForce = queuedReadRef.current.get(groupId) ?? false;
      queueTrailingRead(queuedForce, 750 - (Date.now() - (lastMarkReadRef.current.get(groupId) ?? 0)));
    }
  };

  const refreshGroup = async (groupId: string, options: {
    replace?: boolean;
    markRead?: boolean;
    scrollToBottom?: boolean;
    shouldApply?: () => boolean;
  } = {}) => {
    const {
      replace = true,
      markRead = true,
      scrollToBottom = replace,
      shouldApply,
    } = options;
    if (shouldApply && !shouldApply()) return;
    const request = ++messageRequest.current;
    if (replace) setMessagesLoading(true);
    const [messageResult, memberResult] = await Promise.all([
      loadGroupMessagePage(groupId),
      loadGroupMembers(groupId),
    ]);
    if (selectedRef.current !== groupId
      || request !== messageRequest.current
      || (shouldApply && !shouldApply())) return;
    setMessagesLoading(false);
    if (messageResult.error || memberResult.error) {
      if (replace) {
        setMessages([]);
        setMembers([]);
        setHasOlderMessages(false);
        setOlderCursor(null);
      }
      const groupError = messageResult.error || memberResult.error;
      if (lostGroupAccess(groupError)) {
        setError(null);
        setSelectedId(null);
        setChatSearch({}, { replace: true });
        void refreshGroups();
        return;
      }
      setError(groupError);
      return;
    }
    setError(null);
    setMembers(memberResult.data);
    if (scrollToBottom) pendingScrollActionRef.current = { kind: 'bottom' };
    if (replace) {
      messageHistoryInitializedRef.current = true;
      setMessages(messageResult.data.messages);
      setHasOlderMessages(messageResult.data.has_more);
      setOlderCursor(messageResult.data.next_cursor);
      setViewHasNewerMessages(false);
      setHasNewMessagesNotice(false);
      setHighlightedMessageId(null);
    } else {
      setMessages((current) => mergeGroupMessages(current, messageResult.data.messages));
      if (!messageHistoryInitializedRef.current) {
        messageHistoryInitializedRef.current = true;
        setHasOlderMessages(messageResult.data.has_more);
        setOlderCursor(messageResult.data.next_cursor);
      }
    }
    if (markRead && (!shouldApply || shouldApply())) void markSelectedGroupRead(groupId, scrollToBottom);
  };

  const openLinkedGroupMessage = async (groupId: string, messageId: string) => {
    const request = ++messageRequest.current;
    setMessagesLoading(true);
    setContextWarning(null);
    const [messageResult, memberResult] = await Promise.all([
      loadGroupMessageContext(groupId, messageId),
      loadGroupMembers(groupId),
    ]);
    if (selectedRef.current !== groupId || request !== messageRequest.current) return;
    setMessagesLoading(false);
    if (messageResult.error || memberResult.error || !messageResult.data) {
      const groupError = messageResult.error || memberResult.error || 'Die verlinkte Nachricht ist nicht mehr verfügbar.';
      if (/(?:Die )?Nachricht (?:nicht gefunden|konnte nicht geladen werden)/i.test(groupError)) {
        setError(null);
        setContextWarning('Die verlinkte Nachricht ist nicht mehr verfügbar. Stattdessen werden die neuesten Nachrichten angezeigt.');
        setChatSearch({ group: groupId }, { replace: true });
        return;
      }
      setMessages([]);
      setMembers([]);
      setHasOlderMessages(false);
      setOlderCursor(null);
      setViewHasNewerMessages(false);
      if (lostGroupAccess(groupError)) {
        setError(null);
        setSelectedId(null);
        setChatSearch({}, { replace: true });
        void refreshGroups();
        return;
      }
      setError(groupError);
      return;
    }
    setError(null);
    setContextWarning(null);
    messageHistoryInitializedRef.current = true;
    setMembers(memberResult.data);
    setHasOlderMessages(messageResult.data.has_older);
    setOlderCursor(messageResult.data.oldest_cursor);
    setViewHasNewerMessages(messageResult.data.has_newer);
    setHasNewMessagesNotice(false);
    setHighlightedMessageId(messageResult.data.anchor_message_id);
    pendingScrollActionRef.current = { kind: 'anchor', messageId: messageResult.data.anchor_message_id };
    setMessages(messageResult.data.messages);
  };

  const loadOlderMessages = async () => {
    if (!selectedId || !olderCursor || loadingOlderMessages) return;
    const groupId = selectedId;
    const request = ++olderMessageRequest.current;
    setLoadingOlderMessages(true);
    const result = await loadGroupMessagePage(groupId, olderCursor);
    if (selectedRef.current !== groupId || request !== olderMessageRequest.current) return;
    setLoadingOlderMessages(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    const container = messagesRef.current;
    if (container) {
      const containerTop = container.getBoundingClientRect().top;
      const firstVisible = messages.find((message) => {
        const node = messageElementsRef.current.get(message.message_id);
        return Boolean(node && node.getBoundingClientRect().bottom >= containerTop);
      }) ?? messages[0];
      const target = firstVisible ? messageElementsRef.current.get(firstVisible.message_id) : null;
      if (target) {
        pendingScrollActionRef.current = {
          kind: 'preserve',
          messageId: firstVisible.message_id,
          viewportOffset: target.getBoundingClientRect().top - containerTop,
        };
      }
    }
    setError(null);
    setHasOlderMessages(result.data.has_more);
    setOlderCursor(result.data.next_cursor);
    setMessages((current) => mergeGroupMessages(result.data.messages, current));
  };

  const clearDeletedMessageContext = (messageId: string) => {
    if (replyingToRef.current?.message_id === messageId) {
      replyingToRef.current = null;
      setReplyingTo(null);
    }
    if (editingRef.current?.message_id === messageId) {
      editingRef.current = null;
      setEditing(null);
      const restoredDraft = draftScope ? readChatDraft(draftScope) : '';
      draftRef.current = restoredDraft;
      setDraft(restoredDraft);
    }
  };

  const removeRealtimeMessage = (messageId: string) => {
    realtimeMessageRequestRef.current.set(messageId, (realtimeMessageRequestRef.current.get(messageId) ?? 0) + 1);
    setMessages((current) => {
      if (!current.some((message) => message.message_id === messageId)) return current;
      const next = current.filter((message) => message.message_id !== messageId);
      groupMessagesDataRef.current = next;
      return next;
    });
    setHighlightedMessageId((current) => current === messageId ? null : current);
    clearDeletedMessageContext(messageId);
  };

  const refreshLoadedRealtimeMessage = async (groupId: string, messageId: string, generation: number) => {
    const request = (realtimeMessageRequestRef.current.get(messageId) ?? 0) + 1;
    realtimeMessageRequestRef.current.set(messageId, request);
    const result = await loadGroupMessageContext(groupId, messageId, 1);
    if (selectedRef.current !== groupId
      || realtimeGenerationRef.current !== generation
      || realtimeMessageRequestRef.current.get(messageId) !== request
      || !groupMessagesDataRef.current.some((message) => message.message_id === messageId)) return;
    if (result.error || !result.data) {
      if (/Nachricht nicht gefunden|kein Zugriff/i.test(result.error ?? '')) removeRealtimeMessage(messageId);
      return;
    }
    const refreshed = result.data.messages.find((message) => message.message_id === messageId);
    if (!refreshed) return;
    setMessages((current) => {
      if (!current.some((message) => message.message_id === messageId)) return current;
      const next = mergeGroupMessages(current, [refreshed]);
      groupMessagesDataRef.current = next;
      return next;
    });
    if (refreshed.deleted_at) clearDeletedMessageContext(messageId);
  };

  useEffect(() => {
    void loadNexusContacts().then((result) => {
      if (result.error) setError(result.error);
      else setContacts(result.data);
    });
  }, []);

  useEffect(() => {
    if (previousUserRef.current && previousUserRef.current !== currentUserId) {
      retryStoreRef.current.clearUser(previousUserRef.current);
      retryReplyTargetsRef.current.clear();
    }
    previousUserRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    const activeRecorder = recorderRef.current as NexusMediaRecorder | null;
    if (activeRecorder && activeRecorder.state !== 'inactive') {
      activeRecorder.__cancel = true;
      activeRecorder.stop();
    }
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setRecording(false); setRecordSeconds(0);
    messageRequest.current++;
    olderMessageRequest.current++;
    activityRequest.current++;
    messageHistoryInitializedRef.current = false;
    setMessages([]);
    setMembers([]);
    setActivity([]);
    setHasOlderMessages(false);
    setOlderCursor(null);
    setViewHasNewerMessages(false);
    setHasNewMessagesNotice(false);
    setHighlightedMessageId(null);
    setLoadingOlderMessages(false);
    setMessagesLoading(false);
    setDraft(draftScope ? readChatDraft(draftScope) : '');
    setFailedTextSend(draftScope ? retryStoreRef.current.get(draftScope) : null);
    setPendingFile(null);
    setUploadStatus(null);
    setReplyingTo(null);
    setEditing(null);
    setShowMembers(false);
    setShowAddMembers(false);
    setManagementNotice(null);
    setContextWarning(null);
    clearScrollTimers();
    scrollLockRef.current = null;
    pendingScrollActionRef.current = null;
  }, [selectedId, currentUserId]);

  useEffect(() => {
    if (!selectedId) return;
    olderMessageRequest.current++;
    setLoadingOlderMessages(false);
    clearScrollTimers();
    scrollLockRef.current = null;
    pendingScrollActionRef.current = null;
    const messageId = linkedGroupId === selectedId ? linkedMessageId : null;
    if (messageId) void openLinkedGroupMessage(selectedId, messageId);
    else void refreshGroup(selectedId);
    void refreshActivity(selectedId);
  }, [selectedId, linkedGroupId, linkedMessageId]);

  useEffect(() => {
    if (!selectedId) return;
    const realtimeGeneration = ++realtimeGenerationRef.current;
    const isCurrentRealtime = () => (
      selectedRef.current === selectedId
      && realtimeGenerationRef.current === realtimeGeneration
    );
    const channel = subscribeToGroupRealtime(selectedId, {
      onMessagesChanged: (change) => {
        if (!isCurrentRealtime()) return;
        const loadedMessage = Boolean(change.messageId
          && groupMessagesDataRef.current.some((message) => message.message_id === change.messageId));
        const belongsToSelected = change.scopeId ? change.scopeId === selectedId : loadedMessage;
        if (change.event === 'UPDATE' && !belongsToSelected) return;
        setScanRevision(revision => revision + 1);
        void refreshGroupsRef.current(selectedId, true, isCurrentRealtime);
        if (change.event === 'UPDATE' && change.messageId) {
          if (loadedMessage) void refreshLoadedRealtimeMessage(selectedId, change.messageId, realtimeGeneration);
          return;
        }
        const nearBottom = Boolean(messagesRef.current && messagesRef.current.scrollHeight - messagesRef.current.scrollTop - messagesRef.current.clientHeight < 90);
        if (!messageContextRef.current && !viewHasNewerRef.current) {
          void refreshGroup(selectedId, {
            replace: false,
            markRead: nearBottom,
            scrollToBottom: nearBottom,
            shouldApply: isCurrentRealtime,
          });
          setHasNewMessagesNotice(!nearBottom);
        } else {
          setHasNewMessagesNotice(true);
        }
      },
      onReadChanged: () => {
        if (!isCurrentRealtime()) return;
        if (!messageContextRef.current && !viewHasNewerRef.current) {
          void refreshGroup(selectedId, {
            replace: false,
            markRead: false,
            scrollToBottom: false,
            shouldApply: isCurrentRealtime,
          });
        }
      },
      onTypingChanged: () => {
        if (!isCurrentRealtime()) return;
        void refreshActivity(selectedId, isCurrentRealtime);
        if (!isCurrentRealtime()) return;
        if (typingRecheckRef.current) clearTimeout(typingRecheckRef.current);
        typingRecheckRef.current = setTimeout(() => {
          if (!isCurrentRealtime()) return;
          void refreshActivity(selectedId, isCurrentRealtime);
        }, 6500);
      },
      onGroupChanged: () => {
        if (!isCurrentRealtime()) return;
        void refreshGroupsRef.current(selectedId, true, isCurrentRealtime);
      },
      onMembersChanged: () => {
        if (!isCurrentRealtime()) return;
        setScanRevision(revision => revision + 1);
        void refreshGroupsRef.current(selectedId, true, isCurrentRealtime).then((nextGroups) => {
          if (!isCurrentRealtime()) return;
          if (!nextGroups?.some((group) => group.group_id === selectedId)) {
            setChatSearch({}, { replace: true });
            return;
          }
          if (!messageContextRef.current && !viewHasNewerRef.current) {
            void refreshGroup(selectedId, {
              replace: false,
              markRead: false,
              scrollToBottom: false,
              shouldApply: isCurrentRealtime,
            });
          } else {
            if (!isCurrentRealtime()) return;
            void loadGroupMembers(selectedId).then((result) => {
              if (!result.error && isCurrentRealtime()) setMembers(result.data);
            });
          }
          if (!isCurrentRealtime()) return;
          void refreshActivity(selectedId, isCurrentRealtime);
        });
      },
    });
    const activityInterval = window.setInterval(() => {
      if (!isCurrentRealtime()) return;
      void refreshActivity(selectedId, isCurrentRealtime);
    }, 20000);
    return () => {
      realtimeGenerationRef.current += 1;
      messageRequest.current++;
      window.clearInterval(activityInterval);
      if (typingStopRef.current) clearTimeout(typingStopRef.current);
      if (typingRecheckRef.current) clearTimeout(typingRecheckRef.current);
      lastTypingRef.current = 0;
      void setGroupTyping(selectedId, false);
      void unsubscribeGroupRealtime(channel);
    };
  }, [selectedId]);

  useEffect(() => {
    let active = true;
    const runRefresh = () => {
      groupListRefreshInFlightRef.current = true;
      const historyChanged = groupListHistoryChangedRef.current;
      groupListHistoryChangedRef.current = false;
      const selectedBeforeRefresh = selectedRef.current;
      const refresh = refreshGroupsRef.current(selectedBeforeRefresh, true);
      void refresh.then((nextGroups) => {
        if (!active) return;
        if (selectedBeforeRefresh && nextGroups && !nextGroups.some((group) => group.group_id === selectedBeforeRefresh)) {
          setChatSearch({}, { replace: true });
        }
      }).catch(() => null).finally(() => {
        if (!active) return;
        if (historyChanged) setGroupListRevision((revision) => revision + 1);
        groupListRefreshInFlightRef.current = false;
        if (groupListRefreshQueuedRef.current) {
          groupListRefreshQueuedRef.current = false;
          runRefresh();
        }
      });
    };
    const scheduleRefresh = (historyChanged = false) => {
      if (historyChanged) groupListHistoryChangedRef.current = true;
      if (groupListRefreshInFlightRef.current) {
        groupListRefreshQueuedRef.current = true;
        return;
      }
      runRefresh();
    };
    const channel = subscribeToGroupMessagesRealtime(() => scheduleRefresh(true));
    const onFocus = () => {
      scheduleRefresh();
      if (document.visibilityState === 'visible' && selectedRef.current) void markSelectedGroupRead(selectedRef.current, true);
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      scheduleRefresh();
      if (selectedRef.current) void markSelectedGroupRead(selectedRef.current, true);
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    }, 30000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      groupListRefreshInFlightRef.current = false;
      groupListRefreshQueuedRef.current = false;
      groupListHistoryChangedRef.current = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      void unsubscribeGroupRealtime(channel);
    };
  }, []);

  useLayoutEffect(() => {
    const container = messagesRef.current;
    const action = pendingScrollActionRef.current;
    if (!container || !action) return;
    pendingScrollActionRef.current = null;
    if (action.kind === 'bottom') {
      clearScrollTimers();
      scrollLockRef.current = null;
      container.scrollTop = container.scrollHeight;
      if (selectedRef.current) void markSelectedGroupRead(selectedRef.current);
      return;
    }
    const target = messageElementsRef.current.get(action.messageId);
    if (!target) return;
    if (action.kind === 'anchor') {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      container.scrollTop += targetRect.top - containerRect.top - Math.max(24, (container.clientHeight - targetRect.height) / 2);
      scrollLockRef.current = {
        messageId: action.messageId,
        viewportOffset: target.getBoundingClientRect().top - container.getBoundingClientRect().top,
        expiresAt: Date.now() + 1200,
      };
      scheduleScrollLockChecks();
      return;
    }
    scrollLockRef.current = {
      messageId: action.messageId,
      viewportOffset: action.viewportOffset,
      expiresAt: Date.now() + 1200,
    };
    restoreScrollLock();
    scheduleScrollLockChecks();
  }, [messages]);

  useEffect(() => () => {
    selectedRef.current = null;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    if (typingRecheckRef.current) clearTimeout(typingRecheckRef.current);
    clearScrollTimers();
    markReadTimersRef.current.forEach((timer) => clearTimeout(timer));
    markReadTimersRef.current.clear();
    const recorder = recorderRef.current as NexusMediaRecorder | null;
    if (recorder && recorder.state !== 'inactive') {
      recorder.__cancel = true;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const [statusFilter, setStatusFilter] = useState<ChatStatusFilterValue>('all');
  const workflowHistoryVersion = JSON.stringify([groupListRevision, groups.map(group => [group.group_id, group.last_message_at, group.last_message])]);
  const workflows = useChatScanWorkflows('group', currentUserId, workflowHistoryVersion);
  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups.filter(group => (!needle || `${group.name} ${group.last_message || ''}`.toLowerCase().includes(needle)) &&
      matchesChatStatus(workflows.states.get(group.group_id), statusFilter));
  }, [groups, query, workflows.states, statusFilter]);

  const currentGroup = groups.find((group) => group.group_id === selectedId) || null;
  const scanHistoryVersion = useMemo(
    () => JSON.stringify([scanRevision, currentGroup?.last_message_at ?? null, currentGroup?.last_message ?? null]),
    [scanRevision, currentGroup?.last_message_at, currentGroup?.last_message],
  );
  const typingMembers = activity.filter((member) => member.user_id !== currentUserId && member.typing);
  const onlineCount = activity.filter((member) => member.online).length;
  const groupStatus = typingMembers.length
    ? typingMembers.length === 1
      ? `${activityName(typingMembers[0])} schreibt gerade…`
      : `${activityName(typingMembers[0])} + ${typingMembers.length - 1} weitere schreiben…`
    : `${onlineCount} online · ${currentGroup?.member_count ?? members.length} Mitglieder`;
  const canManageGroup = currentGroup?.role === 'owner' || currentGroup?.role === 'admin';
  const isGroupOwner = currentGroup?.role === 'owner';
  const memberIds = useMemo(() => new Set(members.map((member) => member.user_id)), [members]);
  const addableContacts = useMemo(
    () => contacts.filter((contact) => !memberIds.has(contact.contact_user_id)),
    [contacts, memberIds],
  );

  useEffect(() => {
    setManagementName(currentGroup?.name ?? '');
    setShowAddMembers(false);
    setManagementNotice(null);
  }, [currentGroup?.group_id, currentGroup?.name]);

  const toggleContact = (userId: string) => {
    setSelectedContacts((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  };

  const refreshManagedGroup = async () => {
    if (!selectedId) return;
    await Promise.all([
      viewHasNewerRef.current
        ? Promise.resolve()
        : refreshGroup(selectedId, { replace: false, markRead: false, scrollToBottom: false }),
      refreshActivity(selectedId),
      refreshGroups(selectedId),
    ]);
  };

  const saveGroupName = async () => {
    const name = managementName.trim();
    if (!selectedId || !canManageGroup || managing || name.length < 2 || name === currentGroup?.name) return;
    setManaging(true);
    setError(null);
    const result = await renameGroupChat(selectedId, name);
    setManaging(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    await refreshManagedGroup();
  };

  const changeGroupAvatar = async (file: File | null) => {
    if (!file || !selectedId || !currentUserId || !canManageGroup || managing) return;
    setManaging(true);
    setError(null);
    setManagementNotice(null);
    const result = await updateGroupAvatar(selectedId, currentUserId, file);
    setManaging(false);
    if (avatarRef.current) avatarRef.current.value = '';
    if (result.error) {
      setError(result.error);
      return;
    }
    setManagementNotice(result.warning || 'Gruppenbild wurde aktualisiert.');
    await refreshManagedGroup();
  };

  const clearGroupAvatar = async () => {
    if (!selectedId || !currentGroup?.avatar_path || !canManageGroup || managing) return;
    setManaging(true);
    setError(null);
    setManagementNotice(null);
    const result = await removeGroupAvatar(selectedId);
    setManaging(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setManagementNotice(result.warning || 'Gruppenbild wurde entfernt.');
    await refreshManagedGroup();
  };

  const addMember = async (userId: string) => {
    if (!selectedId || !canManageGroup || managing) return;
    setManaging(true);
    setError(null);
    const result = await addGroupMember(selectedId, userId);
    setManaging(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    await refreshManagedGroup();
  };

  const removeMember = async (member: GroupMember) => {
    if (!selectedId || !currentGroup || managing || member.user_id === currentUserId || member.role === 'owner') return;
    const allowed = currentGroup.role === 'owner' || (currentGroup.role === 'admin' && member.role === 'member');
    if (!allowed || !window.confirm(`${personName(member)} wirklich aus der Gruppe entfernen?`)) return;
    setManaging(true);
    setError(null);
    const result = await removeGroupMember(selectedId, member.user_id);
    setManaging(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    await refreshManagedGroup();
  };

  const changeMemberRole = async (member: GroupMember) => {
    if (!selectedId || !isGroupOwner || managing || member.role === 'owner') return;
    const nextRole = member.role === 'admin' ? 'member' : 'admin';
    setManaging(true);
    setError(null);
    const result = await setGroupMemberRole(selectedId, member.user_id, nextRole);
    setManaging(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    await refreshManagedGroup();
  };

  const transferOwnership = async (member: GroupMember) => {
    if (!selectedId || !isGroupOwner || managing || member.user_id === currentUserId || member.role === 'owner') return;
    if (!window.confirm(`${personName(member)} wirklich zum neuen Owner machen? Du wirst anschließend Admin.`)) return;
    setManaging(true);
    setError(null);
    setManagementNotice(null);
    const result = await transferGroupOwnership(selectedId, member.user_id);
    setManaging(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setManagementNotice(`${personName(member)} ist jetzt Owner. Du bist weiterhin Admin.`);
    await refreshManagedGroup();
  };

  const leaveCurrentGroup = async () => {
    if (!selectedId || isGroupOwner || managing || !window.confirm('Diese Gruppe wirklich verlassen?')) return;
    setManaging(true);
    setError(null);
    const result = await leaveGroupChat(selectedId);
    setManaging(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSelectedId(null);
    setShowMembers(false);
    setChatSearch({}, { replace: true });
    await refreshGroups();
  };

  const deleteCurrentGroup = async () => {
    if (!selectedId || !currentGroup || !isGroupOwner || managing) return;
    const confirmed = window.confirm(`„${currentGroup.name}“ endgültig löschen? Alle Nachrichten und Anhänge dieser Gruppe werden entfernt.`);
    if (!confirmed) return;
    setManaging(true);
    setError(null);
    setManagementNotice(null);
    const result = await deleteGroupChat(selectedId);
    setManaging(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSelectedId(null);
    setShowMembers(false);
    setChatSearch({}, { replace: true });
    await refreshGroups();
  };

  const draftChange = (value: string) => {
    setDraft(value);
    draftRef.current = value;
    if (draftScope && !editing) saveChatDraft(draftScope, value);
    if (!selectedId || editing) return;
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    if (!value.trim()) {
      void setGroupTyping(selectedId, false);
      lastTypingRef.current = 0;
      return;
    }
    if (Date.now() - lastTypingRef.current > 1200) {
      lastTypingRef.current = Date.now();
      void setGroupTyping(selectedId, true);
    }
    typingStopRef.current = setTimeout(() => {
      void setGroupTyping(selectedId, false);
      lastTypingRef.current = 0;
    }, 2500);
  };

  const clearPendingFile = () => {
    setPendingFile(null);
    setUploadStatus(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const chooseFile = (file: File | null) => {
    if (!file || failedTextSend) return;
    const validation = validateChatAttachment(file);
    if (validation.error) {
      setError(validation.error);
      return;
    }
    setError(null);
    setEditing(null);
    setPendingFile(file);
  };

  const stopRecording = (cancel = false) => {
    const recorder = recorderRef.current as NexusMediaRecorder | null;
    if (!recorder) return;
    recorder.__cancel = cancel;
    if (recorder.state !== 'inactive') recorder.stop();
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setRecording(false);
  };

  const startRecording = async () => {
    if (recording || saving || editing || failedTextSend || !selectedId) return;
    const recordingChatId = selectedId;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Sprachaufnahme wird von diesem Browser nicht unterstützt.');
      return;
    }
    try {
      setError(null);
      void setGroupTyping(selectedId, false);
      lastTypingRef.current = 0;
      clearPendingFile();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (selectedRef.current !== recordingChatId) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined) as NexusMediaRecorder;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const cancelled = recorder.__cancel;
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
        recorderRef.current = null;
        setRecordSeconds(0);
      };
      recorder.start(250);
      setRecordSeconds(0);
      setRecording(true);
      recordTimerRef.current = setInterval(() => setRecordSeconds((seconds) => seconds + 1), 1000);
    } catch (recordError) {
      setError(recordError instanceof DOMException && recordError.name === 'NotAllowedError'
        ? 'Mikrofonzugriff wurde nicht erlaubt. Bitte erlaube Nexus den Mikrofonzugriff.'
        : 'Mikrofon konnte nicht gestartet werden.');
    }
  };

  const create = async () => {
    if (saving || groupName.trim().length < 2 || selectedContacts.length === 0) return;
    setSaving(true);
    setError(null);
    const result = await createGroupChat(groupName, selectedContacts);
    setSaving(false);
    if (result.error || !result.data) {
      setError(result.error || 'Gruppe konnte nicht erstellt werden.');
      return;
    }
    setCreating(false);
    setGroupName('');
    setSelectedContacts([]);
    await refreshGroups(result.data);
    setSelectedId(result.data);
    setChatSearch({ group: result.data });
  };

  const returnToLatestMessages = () => {
    if (!selectedId) return;
    if (linkedMessageId) {
      setChatSearch({ group: selectedId }, { replace: true });
      return;
    }
    void refreshGroup(selectedId);
  };

  const showNewestAvailableMessages = () => {
    if (!selectedId) return;
    if (messageContextRef.current || viewHasNewerRef.current) {
      returnToLatestMessages();
      return;
    }
    setHasNewMessagesNotice(false);
    void refreshGroup(selectedId, { replace: false, markRead: true, scrollToBottom: true });
  };

  const discardFailedText = () => {
    if (!draftScope || !failedTextSend) return;
    retryStoreRef.current.discard(draftScope, failedTextSend.payload.id);
    retryReplyTargetsRef.current.delete(failedTextSend.payload.id);
    setFailedTextSend(null);
    setError(null);
  };

  const retryFailedText = async () => {
    if (!selectedId || !draftScope || !failedTextSend || saving || failedTextSend.status !== 'ready') return;
    const groupId = selectedId;
    const scope = draftScope;
    const retry = retryStoreRef.current.beginRetry(draftScope, failedTextSend.payload.id);
    if (!retry) return;
    setFailedTextSend(retryStoreRef.current.get(draftScope));
    setSaving(true);
    setError(null);
    const result = await sendGroupMessage(
      groupId,
      retry.text,
      retryReplyTargetsRef.current.get(retry.id) ?? null,
      retry.clientRequestId,
    );
    setSaving(false);
    retryStoreRef.current.finishRetry(scope, retry.id, !result.error);
    if (selectedRef.current === groupId) setFailedTextSend(retryStoreRef.current.get(scope));
    if (result.error) {
      if (selectedRef.current === groupId) setError(result.error);
      return;
    }
    retryReplyTargetsRef.current.delete(retry.id);
    if (readChatDraft(scope).trim() === retry.text) clearChatDraftAfterSuccessfulSend(scope);
    if (selectedRef.current === groupId) {
      if (draftRef.current.trim() === retry.text) {
        draftRef.current = '';
        setDraft('');
      }
      setReplyingTo(null);
      void setGroupTyping(groupId, false);
      lastTypingRef.current = 0;
      if (linkedMessageId) setChatSearch({ group: groupId }, { replace: true });
      else await refreshGroup(groupId);
    }
    await refreshGroups(selectedRef.current, true);
  };

  const submit = async () => {
    const body = draft.trim();
    if (!selectedId || saving || recording || (editing && !body) || (!editing && !body && !pendingFile)) return;
    if (failedTextSend) {
      setError('Diese Nachricht wartet auf deine manuelle Wiederholung. Nutze dafür „Erneut senden“.');
      return;
    }
    const groupId = selectedId;
    const scope = draftScope;
    const editingMessage = editing;
    const sendingFile = pendingFile;
    setSaving(true);
    setError(null);
    let result: { error: string | null } | { data: string | null; error: string | null };
    let textClientRequestId: string | null = null;
    let textReplyTarget: string | null = null;
    if (editingMessage) {
      result = await editGroupMessage(editingMessage.message_id, body);
    } else if (sendingFile) {
      if (!currentUserId) {
        setSaving(false);
        setError('Nutzerkonto konnte nicht bestimmt werden.');
        return;
      }
      setUploadStatus(pendingIsAudio ? 'Sprachnachricht wird sicher hochgeladen…' : 'Datei wird sicher hochgeladen…');
      result = await sendGroupAttachmentMessage(groupId, currentUserId, sendingFile, body, replyingTo?.message_id ?? null);
    } else {
      textClientRequestId = createTextClientRequestId();
      textReplyTarget = replyingTo?.message_id ?? null;
      result = await sendGroupMessage(groupId, body, textReplyTarget, textClientRequestId);
    }
    setSaving(false);
    setUploadStatus(null);
    if (result.error) {
      if (!editingMessage && !sendingFile && scope && textClientRequestId) {
        const failed = retryStoreRef.current.rememberFailure(scope, body, textClientRequestId);
        if (failed) {
          retryReplyTargetsRef.current.set(failed.id, textReplyTarget);
          if (selectedRef.current === groupId) setFailedTextSend(retryStoreRef.current.get(scope));
        }
      }
      if (selectedRef.current === groupId) setError(result.error);
      return;
    }
    if (selectedRef.current !== groupId) {
      if (!editingMessage && scope) clearChatDraftAfterSuccessfulSend(scope);
      await refreshGroups(selectedRef.current, true);
      return;
    }
    if (editingMessage) {
      const restoredDraft = scope ? readChatDraft(scope) : '';
      draftRef.current = restoredDraft;
      setDraft(restoredDraft);
    } else {
      if (scope) {
        clearChatDraftAfterSuccessfulSend(scope);
      }
      draftRef.current = '';
      setDraft('');
    }
    clearPendingFile();
    setEditing(null);
    setReplyingTo(null);
    void setGroupTyping(groupId, false);
    lastTypingRef.current = 0;
    if (linkedMessageId) setChatSearch({ group: groupId }, { replace: true });
    else await refreshGroup(groupId);
    await refreshGroups(groupId, true);
  };

  const remove = async (message: GroupMessage) => {
    if (message.sender_id !== currentUserId || message.deleted_at || !window.confirm('Diese Nachricht wirklich löschen?')) return;
    setSaving(true);
    const result = await deleteGroupMessage(message.message_id, (message.attachments || []).map((attachment) => attachment.storage_path));
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (selectedId) {
      if (viewHasNewerRef.current && linkedMessageId) await openLinkedGroupMessage(selectedId, linkedMessageId);
      else await refreshGroup(selectedId, { replace: false, markRead: false, scrollToBottom: false });
      await refreshGroups(selectedId, true);
    }
  };

  const awaitingManualRetry = Boolean(failedTextSend);
  const canSend = Boolean(editing ? draft.trim() : draft.trim() || pendingFile) && !saving && !recording && !awaitingManualRetry;

  return (
    <div className="chat-layout real-chat-layout group-chat-layout" data-mobile-pane={mobileConversationOpen ? 'conversation' : 'list'}>
      <section className="chat-list">
        <div className="chat-list-title">
          <Header kicker="PHASE 3.7" title="Gruppen" sub="Echte Gruppen- und Team-Chats mit vollständigem Verlauf." />
          <div className="group-title-actions">
            <button className="chat-refresh" onClick={() => void refreshGroups(selectedId)} title="Aktualisieren"><RefreshCw size={15} /></button>
            <button className="chat-refresh group-create-toggle" onClick={() => setCreating((value) => !value)} title="Neue Gruppe"><Plus size={16} /></button>
          </div>
        </div>

        {creating && (
          <div className="group-create-panel">
            <div className="group-create-head"><b>Neue Gruppe</b><button onClick={() => setCreating(false)}><X size={14} /></button></div>
            <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Gruppenname" maxLength={80} />
            <small>Kontakte auswählen</small>
            <div className="group-contact-picker">
              {contacts.length === 0 && <span>Du brauchst mindestens einen bestätigten Kontakt.</span>}
              {contacts.map((contact) => {
                const active = selectedContacts.includes(contact.contact_user_id);
                return (
                  <button key={contact.contact_user_id} className={active ? 'selected' : ''} onClick={() => toggleContact(contact.contact_user_id)}>
                    <span className="avatar">{groupInitials(contactName(contact))}</span>
                    <span><b>{contactName(contact)}</b><small>{contact.username ? `@${contact.username}` : 'Nexus Kontakt'}</small></span>
                    <i>{active ? '✓' : '+'}</i>
                  </button>
                );
              })}
            </div>
            <button className="primary group-create-submit" disabled={saving || groupName.trim().length < 2 || selectedContacts.length === 0} onClick={() => void create()}>
              <UsersRound size={15} /> {saving ? 'Wird erstellt…' : `Gruppe erstellen${selectedContacts.length ? ` (${selectedContacts.length + 1})` : ''}`}
            </button>
          </div>
        )}

        <div className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Gruppen durchsuchen" /></div>
        <ChatStatusFilter value={statusFilter} onChange={setStatusFilter} ready={workflows.ready} error={workflows.error} onRetry={workflows.refresh} />
        {mobileListOnly && error && <div className="chat-error" role="alert">{error}</div>}
        {!loading && groups.length > 0 && filteredGroups.length === 0 && <div className="chat-list-empty">Keine Gruppen für diese Auswahl.</div>}
        {loading && groups.length === 0 && <div className="chat-list-empty">Gruppen werden geladen…</div>}
        {!loading && groups.length === 0 && <div className="chat-list-empty"><UsersRound size={24} /><b>Noch keine Gruppen</b><span>Erstelle deine erste Gruppe mit einem Nexus-Kontakt.</span></div>}
        {filteredGroups.map((group) => (
          <button className={`chat${selectedId === group.group_id ? ' active' : ''}`} onClick={() => { setContextWarning(null); setSelectedId(group.group_id); setChatSearch({ group: group.group_id }); }} key={group.group_id}>
            <div className="avatar group-avatar"><GroupAvatar group={group} size={16} /></div>
            <span><b>{group.name}</b><small>{group.member_count} Mitglieder · {roleLabel(group.role)}</small><p>{group.last_message || 'Neue Gruppe'}</p><ChatStatusBadge state={workflows.states.get(group.group_id)} /></span>
            <em>{formatTime(group.last_message_at)}{group.unread_count > 0 && <i>{group.unread_count > 99 ? '99+' : group.unread_count}</i>}</em>
          </button>
        ))}
      </section>

      <section className="conversation">
        <div className="mobile-chat-backbar"><button type="button" onClick={() => { setSelectedId(null); setError(null); setContextWarning(null); setChatSearch({}); }}><ArrowLeft size={20} /> Alle Gruppen</button></div>
        <TaskMessageContext kind="group" onChatResolved={id => { setSelectedId(id); void refreshGroups(id); }} />
        {(error || contextWarning) && <div className="chat-error">{error || contextWarning}</div>}
        {!currentGroup ? (
          <div className="conversation-empty"><UsersRound size={42} /><h2>Team-Messenger</h2><p>Wähle eine Gruppe aus oder erstelle eine neue.</p></div>
        ) : (
          <>
            <div className="chat-head">
              <div className="chat-head-person">
                <div className="avatar group-avatar"><GroupAvatar group={currentGroup} /></div>
                <div><b>{currentGroup.name}</b><small className={typingMembers.length ? 'typing-status' : onlineCount > 0 ? 'online-status' : ''}>{groupStatus}</small></div>
              </div>
              <button className={`project-pill group-members-toggle${showMembers ? ' active' : ''}`} onClick={() => setShowMembers((value) => !value)}><UsersRound size={13} /> Mitglieder</button>
            </div>

            {showMembers && (
              <div className="group-members-panel">
                <div className="group-management">
                  <div className="group-management-title">
                    <div><b>Gruppenverwaltung</b><small>Deine Rolle: {roleLabel(currentGroup.role)}</small></div>
                    {!isGroupOwner && <button className="group-leave-button" onClick={() => void leaveCurrentGroup()} disabled={managing}><LogOut size={13} /> Gruppe verlassen</button>}
                    {isGroupOwner && <button className="group-delete-button" onClick={() => void deleteCurrentGroup()} disabled={managing}><Trash2 size={13} /> Gruppe löschen</button>}
                  </div>

                  {managementNotice && <div className="group-management-notice">{managementNotice}</div>}

                  {canManageGroup && (
                    <>
                      <div className="group-avatar-management">
                        <div className="avatar group-avatar group-avatar-preview"><GroupAvatar group={currentGroup} size={21} /></div>
                        <span><b>Gruppenbild</b><small>JPEG, PNG, WebP oder GIF · maximal 5 MB</small></span>
                        <input
                          ref={avatarRef}
                          className="group-avatar-input"
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          onChange={(event) => void changeGroupAvatar(event.target.files?.[0] ?? null)}
                        />
                        <button onClick={() => avatarRef.current?.click()} disabled={managing}><Camera size={13} /> {currentGroup.avatar_path ? 'Ändern' : 'Hochladen'}</button>
                        {currentGroup.avatar_path && <button className="danger" onClick={() => void clearGroupAvatar()} disabled={managing} title="Gruppenbild entfernen"><Trash2 size={13} /></button>}
                      </div>
                      <div className="group-rename-row">
                        <input value={managementName} onChange={(event) => setManagementName(event.target.value)} maxLength={80} aria-label="Gruppenname" />
                        <button onClick={() => void saveGroupName()} disabled={managing || managementName.trim().length < 2 || managementName.trim() === currentGroup.name}><Pencil size={13} /> Speichern</button>
                      </div>
                      <div className="group-add-member-head">
                        <span><b>Mitglied hinzufügen</b><small>Nur bestätigte Nexus-Kontakte</small></span>
                        <button onClick={() => setShowAddMembers((value) => !value)}><UserPlus size={13} /> {showAddMembers ? 'Schließen' : 'Hinzufügen'}</button>
                      </div>
                      {showAddMembers && (
                        <div className="group-add-member-list">
                          {addableContacts.length === 0 && <span>Alle deine Kontakte sind bereits in dieser Gruppe.</span>}
                          {addableContacts.map((contact) => (
                            <button key={contact.contact_user_id} onClick={() => void addMember(contact.contact_user_id)} disabled={managing}>
                              <span className="avatar">{groupInitials(contactName(contact))}</span>
                              <span><b>{contactName(contact)}</b><small>{contact.username ? `@${contact.username}` : 'Nexus Kontakt'}</small></span>
                              <UserPlus size={14} />
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {isGroupOwner && <small className="group-owner-note">Als Owner kannst du Admins verwalten, die Ownership übertragen oder die Gruppe endgültig löschen.</small>}
                </div>

                <div className="group-member-grid">
                  {members.map((member) => {
                    const memberActivity = activity.find((item) => item.user_id === member.user_id);
                    const canRemove = member.user_id !== currentUserId
                      && member.role !== 'owner'
                      && (currentGroup.role === 'owner' || (currentGroup.role === 'admin' && member.role === 'member'));
                    const canChangeRole = isGroupOwner && member.user_id !== currentUserId && member.role !== 'owner';
                    return (
                      <div className="group-member" key={member.user_id}>
                        <span className="avatar">{groupInitials(personName(member))}</span>
                        <span>
                          <b>{personName(member)}{member.user_id === currentUserId ? ' · Du' : ''}</b>
                          <small>{member.username ? `@${member.username}` : 'Nexus Nutzer'}</small>
                          <small className={memberActivity?.online ? 'group-member-online' : ''}>{memberActivity?.typing ? 'schreibt gerade…' : formatPresence(memberActivity)}</small>
                        </span>
                        <div className="group-member-side">
                          <em>{member.role === 'owner' ? <Crown size={13} /> : member.role === 'admin' ? <ShieldCheck size={13} /> : null}{roleLabel(member.role)}</em>
                          {(canRemove || canChangeRole) && (
                            <div className="group-member-actions">
                              {canChangeRole && <button onClick={() => void changeMemberRole(member)} disabled={managing} title={member.role === 'admin' ? 'Zum Mitglied machen' : 'Zum Admin machen'}><ShieldCheck size={12} /> {member.role === 'admin' ? 'Mitglied' : 'Admin'}</button>}
                              {canChangeRole && <button onClick={() => void transferOwnership(member)} disabled={managing} title="Ownership übertragen"><Crown size={12} /> Owner</button>}
                              {canRemove && <button className="danger" onClick={() => void removeMember(member)} disabled={managing} title="Mitglied entfernen"><UserMinus size={12} /></button>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div
              className="messages"
              ref={messagesRef}
              onScroll={(event) => {
                const container = event.currentTarget;
                if (!messageContextRef.current && !viewHasNewerRef.current && container.scrollHeight - container.scrollTop - container.clientHeight < 80 && selectedRef.current) {
                  setHasNewMessagesNotice(false);
                  void markSelectedGroupRead(selectedRef.current);
                }
              }}
            >
              {hasOlderMessages && olderCursor && (
                <button
                  className="secondary messages-history-button"
                  data-testid="group-load-older"
                  disabled={loadingOlderMessages}
                  onClick={() => void loadOlderMessages()}
                >
                  <RefreshCw size={13} className={loadingOlderMessages ? 'spinning' : ''} /> {loadingOlderMessages ? 'Ältere Nachrichten werden geladen…' : 'Ältere Nachrichten laden'}
                </button>
              )}
              {messagesLoading && messages.length === 0 && <div className="messages-status">Gruppennachrichten werden geladen…</div>}
              {!messagesLoading && messages.length === 0 && <div className="messages-status group-empty-messages"><MessageCircle size={24} /><b>Noch keine Nachrichten</b><span>Schreib die erste Nachricht in diese Gruppe.</span></div>}
              {messages.map((message) => {
                const mine = message.sender_id === currentUserId;
                const sender = message.sender_full_name || (message.sender_username ? `@${message.sender_username}` : 'Nexus Nutzer');
                const fullyRead = message.recipient_count > 0 && message.read_count >= message.recipient_count;
                const readTitle = message.recipient_count > 0
                  ? `${message.read_count} von ${message.recipient_count} haben gelesen`
                  : 'Gesendet';
                return (
                  <div
                    key={message.message_id}
                    className={`message-wrap group-message-wrap${mine ? ' mine' : ''}${highlightedMessageId === message.message_id ? ' message-highlighted' : ''}`}
                    data-message-id={message.message_id}
                    data-highlighted={highlightedMessageId === message.message_id ? 'true' : undefined}
                    ref={(node) => {
                      if (node) messageElementsRef.current.set(message.message_id, node);
                      else messageElementsRef.current.delete(message.message_id);
                    }}
                    style={highlightedMessageId === message.message_id ? { outline: '2px solid #8f87ff', outlineOffset: 5, borderRadius: 12 } : undefined}
                  >
                    {!mine && !message.deleted_at && <small className="group-message-sender">{sender}</small>}
                    <div className={mine ? 'bubble me' : 'bubble'}>
                      {message.reply_to_message_id && (
                        <div className="reply-preview"><b>{message.reply_sender_id === currentUserId ? 'Du' : message.reply_sender_name || 'Nexus Nutzer'}</b><span>{message.reply_body || 'Anhang'}</span></div>
                      )}
                      {!message.deleted_at && message.attachments?.length > 0 && <div className="message-attachments">{message.attachments.map((attachment) => <GroupAttachmentView key={attachment.attachment_id} attachment={attachment} onContentSettled={restoreScrollLock} />)}</div>}
                      {(message.deleted_at || message.body.trim()) && <span className={message.deleted_at ? 'deleted-message' : 'message-body'}>{message.deleted_at ? 'Nachricht gelöscht' : message.body}</span>}
                      <div className="message-meta">
                        {message.edited_at && !message.deleted_at && <small>bearbeitet</small>}
                        <time>{formatTime(message.created_at)}</time>
                        {mine && !message.deleted_at && <span className={`message-receipt${fullyRead ? ' read' : ''}`} title={readTitle}>{message.read_count > 0 ? <CheckCheck size={13} /> : '✓'}</span>}
                      </div>
                    </div>
                    {!message.deleted_at && (
                      <div className="message-actions">
                        <MessageTaskAction currentUserId={currentUserId} workspaceId={workspaceId} source={{ kind: 'group', messageId: message.message_id, body: message.body, chatName: currentGroup.name, attachmentName: message.attachments?.[0]?.file_name }} />
                        <button disabled={awaitingManualRetry} onClick={() => {
                          if (editing) {
                            const restoredDraft = draftScope ? readChatDraft(draftScope) : '';
                            draftRef.current = restoredDraft;
                            setDraft(restoredDraft);
                          }
                          setEditing(null);
                          setReplyingTo(message);
                        }}><Reply size={13} /></button>
                        {mine && message.body.trim() && <button disabled={awaitingManualRetry} onClick={() => { setReplyingTo(null); clearPendingFile(); setEditing(message); setDraft(message.body); }}><Pencil size={13} /></button>}
                        {mine && <button onClick={() => void remove(message)} disabled={saving}><Trash2 size={13} /></button>}
                      </div>
                    )}
                  </div>
                );
              })}
              {(isMessageContext || viewHasNewerMessages || hasNewMessagesNotice) && (
                <div
                  className="newer-messages-notice"
                  data-testid={isMessageContext || viewHasNewerMessages ? 'group-history-context' : 'group-new-messages'}
                  role="status"
                >
                  <span>{isMessageContext || viewHasNewerMessages ? 'Du siehst eine frühere Stelle im Gruppenchat.' : 'Neue Nachrichten sind eingegangen.'}{hasNewMessagesNotice && (isMessageContext || viewHasNewerMessages) ? ' Weitere Nachrichten sind verfügbar.' : ''}</span>
                  <button
                    className="secondary"
                    data-testid={isMessageContext || viewHasNewerMessages ? 'group-return-latest' : 'group-show-new-messages'}
                    onClick={showNewestAvailableMessages}
                  >
                    Zu den neuesten Nachrichten
                  </button>
                </div>
              )}
            </div>

            {(replyingTo || editing) && (
              <div className="composer-context">
                <div><b>{editing ? 'Nachricht bearbeiten' : 'Antworten'}</b><span>{editing ? editing.body : messagePreview(replyingTo)}</span></div>
                <button disabled={awaitingManualRetry} onClick={() => {
                  setReplyingTo(null);
                  if (editing) {
                    const restoredDraft = draftScope ? readChatDraft(draftScope) : '';
                    setEditing(null);
                    draftRef.current = restoredDraft;
                    setDraft(restoredDraft);
                  }
                }}><X size={15} /></button>
              </div>
            )}

            {recording && (
              <div className="voice-recording">
                <span className="record-dot" />
                <b>Aufnahme läuft</b>
                <span>{formatDuration(recordSeconds)}</span>
                <button onClick={() => stopRecording(true)} title="Aufnahme abbrechen"><Trash2 size={15} /></button>
                <button className="voice-stop" onClick={() => stopRecording(false)} title="Aufnahme beenden"><Square size={14} /></button>
              </div>
            )}

            {pendingFile && !editing && (
              <div className={`pending-attachment${pendingIsAudio ? ' voice-pending' : ''}`}>
                <span className="pending-attachment-icon">{pendingIsAudio ? <Mic size={17} /> : <FileText size={17} />}</span>
                <span className="pending-attachment-info">
                  <b>{pendingIsAudio ? 'Sprachnachricht' : pendingFile.name}</b>
                  <small>{formatFileSize(pendingFile.size)}{uploadStatus ? ` · ${uploadStatus}` : ''}</small>
                  {pendingIsAudio && pendingAudioUrl && <audio controls preload="metadata" src={pendingAudioUrl} />}
                </span>
                <button onClick={clearPendingFile} disabled={saving} title="Anhang entfernen"><X size={15} /></button>
              </div>
            )}

            {failedTextSend && (
              <div
                className="text-send-retry"
                data-testid="group-text-retry"
                role="alert"
              >
                <div><b>Textnachricht wurde noch nicht bestätigt</b><span>Erneut senden verwendet dieselbe sichere Nachrichten-ID und erzeugt kein Duplikat.</span></div>
                <button className="secondary" data-testid="group-text-retry-discard" disabled={saving || failedTextSend.status === 'retrying'} onClick={discardFailedText}>Verwerfen</button>
                <button className="primary" data-testid="group-text-retry-submit" disabled={saving || failedTextSend.status === 'retrying'} onClick={() => void retryFailedText()}>
                  <RefreshCw size={13} /> {failedTextSend.status === 'retrying' ? 'Wird erneut gesendet…' : 'Erneut senden'}
                </button>
              </div>
            )}

            <ChatScanAction
              key={`${currentUserId}:group:${currentGroup.group_id}`}
              currentUserId={currentUserId}
              kind="group"
              chatId={currentGroup.group_id}
              chatName={currentGroup.name}
              historyVersion={scanHistoryVersion}
            />

            <div className="composer group-composer attachment-composer">
              <input ref={fileRef} className="attachment-file-input" type="file" accept={SUPPORTED_CHAT_ATTACHMENT_TYPES.join(',')} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} disabled={awaitingManualRetry} />
              <button className="attach-button" onClick={() => fileRef.current?.click()} disabled={saving || recording || Boolean(editing) || awaitingManualRetry} title="Datei oder Bild anhängen"><Paperclip size={18} /></button>
              <button className={`attach-button mic-button${recording ? ' recording' : ''}`} onClick={() => void startRecording()} disabled={saving || recording || Boolean(editing) || awaitingManualRetry} title="Sprachnachricht aufnehmen"><Mic size={18} /></button>
              <input aria-label="Gruppennachricht" value={draft} disabled={saving || recording || awaitingManualRetry} onChange={(event) => draftChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder={editing ? 'Bearbeitete Nachricht…' : pendingIsAudio ? 'Text zur Sprachnachricht (optional)…' : pendingFile ? 'Nachricht zum Anhang (optional)…' : 'Nachricht an die Gruppe…'} maxLength={5000} />
              <button onClick={() => void submit()} disabled={!canSend}><Send size={18} /></button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
