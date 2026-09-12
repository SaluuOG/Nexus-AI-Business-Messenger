import { CheckCheck, Crown, FileText, MessageCircle, Mic, Paperclip, Pencil, Plus, RefreshCw, Reply, Search, Send, ShieldCheck, Square, Trash2, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '../components/Header';
import { SUPPORTED_CHAT_ATTACHMENT_TYPES, validateChatAttachment } from '../features/data/chatData';
import { loadNexusContacts, type NexusContact } from '../features/data/contactsData';
import {
  createGroupChat,
  deleteGroupMessage,
  editGroupMessage,
  loadGroupActivity,
  loadGroupChats,
  loadGroupMembers,
  loadGroupMessages,
  markGroupRead,
  sendGroupAttachmentMessage,
  sendGroupMessage,
  setGroupTyping,
  subscribeToGroupRealtime,
  unsubscribeGroupRealtime,
  type GroupActivity,
  type GroupAttachment,
  type GroupChat,
  type GroupMember,
  type GroupMessage,
} from '../features/data/groupChatData';

type GroupChatsPageProps = { currentUserId?: string };

type NexusMediaRecorder = MediaRecorder & { __cancel?: boolean };

const groupInitials = (name: string) => name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
const personName = (member: GroupMember) => member.full_name || (member.username ? `@${member.username}` : 'Nexus Nutzer');
const activityName = (member: GroupActivity) => member.full_name || (member.username ? `@${member.username}` : 'Nexus Nutzer');
const contactName = (contact: NexusContact) => contact.full_name || (contact.username ? `@${contact.username}` : 'Nexus Nutzer');
const roleLabel = (role: GroupChat['role'] | GroupMember['role']) => role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Mitglied';

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

function GroupAttachmentView({ attachment }: { attachment: GroupAttachment }) {
  const image = attachment.mime_type.startsWith('image/');
  const audio = attachment.mime_type.startsWith('audio/');
  if (!attachment.signed_url) {
    return <div className="attachment-unavailable"><FileText size={17} /><span><b>{attachment.file_name}</b><small>Datei konnte nicht geladen werden</small></span></div>;
  }
  if (image) {
    return <a className="chat-image-link" href={attachment.signed_url} target="_blank" rel="noreferrer"><img className="chat-image" src={attachment.signed_url} alt={attachment.file_name} /></a>;
  }
  if (audio) {
    return <div className="voice-message"><Mic size={18} /><audio controls preload="metadata" src={attachment.signed_url} /></div>;
  }
  return <a className="file-attachment" href={attachment.signed_url} target="_blank" rel="noreferrer" download={attachment.file_name}><span className="file-attachment-icon"><FileText size={19} /></span><span className="file-attachment-info"><b>{attachment.file_name}</b><small>{formatFileSize(attachment.file_size)}</small></span></a>;
}

export function GroupChatsPage({ currentUserId }: GroupChatsPageProps) {
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [contacts, setContacts] = useState<NexusContact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
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
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingRecheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingRef = useRef(0);

  const pendingIsAudio = Boolean(pendingFile?.type.startsWith('audio/'));
  const pendingAudioUrl = useMemo(
    () => pendingFile && pendingIsAudio ? URL.createObjectURL(pendingFile) : null,
    [pendingFile, pendingIsAudio],
  );

  useEffect(() => () => {
    if (pendingAudioUrl) URL.revokeObjectURL(pendingAudioUrl);
  }, [pendingAudioUrl]);

  const refreshGroups = async (preferred?: string | null) => {
    setLoading(true);
    const result = await loadGroupChats();
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setGroups(result.data);
    setSelectedId((current) => {
      const target = preferred || current;
      return target && result.data.some((group) => group.group_id === target)
        ? target
        : result.data[0]?.group_id ?? null;
    });
  };

  const refreshActivity = async (groupId: string) => {
    const result = await loadGroupActivity(groupId);
    if (result.error) {
      setError(result.error);
      return;
    }
    setActivity(result.data);
  };

  const refreshGroup = async (groupId: string, markRead = true) => {
    setMessagesLoading(true);
    const [messageResult, memberResult] = await Promise.all([
      loadGroupMessages(groupId),
      loadGroupMembers(groupId),
    ]);
    setMessagesLoading(false);
    if (messageResult.error || memberResult.error) {
      setError(messageResult.error || memberResult.error);
      return;
    }
    setMessages(messageResult.data);
    setMembers(memberResult.data);
    if (markRead) {
      await markGroupRead(groupId);
      setGroups((current) => current.map((group) => group.group_id === groupId ? { ...group, unread_count: 0 } : group));
    }
  };

  useEffect(() => {
    void refreshGroups();
    void loadNexusContacts().then((result) => {
      if (result.error) setError(result.error);
      else setContacts(result.data);
    });
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setMembers([]);
      setActivity([]);
      return;
    }
    setDraft('');
    setPendingFile(null);
    setUploadStatus(null);
    setReplyingTo(null);
    setEditing(null);
    setShowMembers(false);
    setActivity([]);
    void refreshGroup(selectedId);
    void refreshActivity(selectedId);
    const channel = subscribeToGroupRealtime(selectedId, {
      onMessagesChanged: () => {
        void refreshGroup(selectedId).then(() => refreshGroups(selectedId));
      },
      onReadChanged: () => {
        void refreshGroup(selectedId, false);
      },
      onTypingChanged: () => {
        void refreshActivity(selectedId);
        if (typingRecheckRef.current) clearTimeout(typingRecheckRef.current);
        typingRecheckRef.current = setTimeout(() => void refreshActivity(selectedId), 6500);
      },
    });
    const activityInterval = window.setInterval(() => void refreshActivity(selectedId), 20000);
    return () => {
      window.clearInterval(activityInterval);
      if (typingStopRef.current) clearTimeout(typingStopRef.current);
      if (typingRecheckRef.current) clearTimeout(typingRecheckRef.current);
      lastTypingRef.current = 0;
      void setGroupTyping(selectedId, false);
      void unsubscribeGroupRealtime(channel);
    };
  }, [selectedId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    if (typingRecheckRef.current) clearTimeout(typingRecheckRef.current);
    const recorder = recorderRef.current as NexusMediaRecorder | null;
    if (recorder && recorder.state !== 'inactive') {
      recorder.__cancel = true;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((group) => `${group.name} ${group.last_message || ''}`.toLowerCase().includes(needle));
  }, [groups, query]);

  const currentGroup = groups.find((group) => group.group_id === selectedId) || null;
  const typingMembers = activity.filter((member) => member.user_id !== currentUserId && member.typing);
  const onlineCount = activity.filter((member) => member.online).length;
  const groupStatus = typingMembers.length
    ? typingMembers.length === 1
      ? `${activityName(typingMembers[0])} schreibt gerade…`
      : `${activityName(typingMembers[0])} + ${typingMembers.length - 1} weitere schreiben…`
    : `${onlineCount} online · ${currentGroup?.member_count ?? members.length} Mitglieder`;

  const toggleContact = (userId: string) => {
    setSelectedContacts((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  };

  const draftChange = (value: string) => {
    setDraft(value);
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
    if (!file) return;
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
    if (recording || saving || editing || !selectedId) return;
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
  };

  const submit = async () => {
    const body = draft.trim();
    if (!selectedId || saving || recording || (editing && !body) || (!editing && !body && !pendingFile)) return;
    setSaving(true);
    setError(null);
    let result: { error: string | null } | { data: string | null; error: string | null };
    if (editing) {
      result = await editGroupMessage(editing.message_id, body);
    } else if (pendingFile) {
      if (!currentUserId) {
        setSaving(false);
        setError('Nutzerkonto konnte nicht bestimmt werden.');
        return;
      }
      setUploadStatus(pendingIsAudio ? 'Sprachnachricht wird sicher hochgeladen…' : 'Datei wird sicher hochgeladen…');
      result = await sendGroupAttachmentMessage(selectedId, currentUserId, pendingFile, body, replyingTo?.message_id ?? null);
    } else {
      result = await sendGroupMessage(selectedId, body, replyingTo?.message_id ?? null);
    }
    setSaving(false);
    setUploadStatus(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDraft('');
    clearPendingFile();
    setEditing(null);
    setReplyingTo(null);
    void setGroupTyping(selectedId, false);
    lastTypingRef.current = 0;
    await refreshGroup(selectedId);
    await refreshGroups(selectedId);
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
      await refreshGroup(selectedId);
      await refreshGroups(selectedId);
    }
  };

  const canSend = Boolean(editing ? draft.trim() : draft.trim() || pendingFile) && !saving && !recording;

  return (
    <div className="chat-layout real-chat-layout group-chat-layout">
      <section className="chat-list">
        <div className="chat-list-title">
          <Header kicker="PHASE 2.5" title="Gruppen" sub="Echte Gruppen- und Team-Chats." />
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
        {loading && groups.length === 0 && <div className="chat-list-empty">Gruppen werden geladen…</div>}
        {!loading && groups.length === 0 && <div className="chat-list-empty"><UsersRound size={24} /><b>Noch keine Gruppen</b><span>Erstelle deine erste Gruppe mit einem Nexus-Kontakt.</span></div>}
        {filteredGroups.map((group) => (
          <button className={`chat${selectedId === group.group_id ? ' active' : ''}`} onClick={() => setSelectedId(group.group_id)} key={group.group_id}>
            <div className="avatar group-avatar"><UsersRound size={16} /></div>
            <span><b>{group.name}</b><small>{group.member_count} Mitglieder · {roleLabel(group.role)}</small><p>{group.last_message || 'Neue Gruppe'}</p></span>
            <em>{formatTime(group.last_message_at)}{group.unread_count > 0 && <i>{group.unread_count > 99 ? '99+' : group.unread_count}</i>}</em>
          </button>
        ))}
      </section>

      <section className="conversation">
        {error && <div className="chat-error">{error}</div>}
        {!currentGroup ? (
          <div className="conversation-empty"><UsersRound size={42} /><h2>Team-Messenger</h2><p>Wähle eine Gruppe aus oder erstelle eine neue.</p></div>
        ) : (
          <>
            <div className="chat-head">
              <div className="chat-head-person">
                <div className="avatar group-avatar"><UsersRound size={17} /></div>
                <div><b>{currentGroup.name}</b><small className={typingMembers.length ? 'typing-status' : onlineCount > 0 ? 'online-status' : ''}>{groupStatus}</small></div>
              </div>
              <button className={`project-pill group-members-toggle${showMembers ? ' active' : ''}`} onClick={() => setShowMembers((value) => !value)}><UsersRound size={13} /> Mitglieder</button>
            </div>

            {showMembers && (
              <div className="group-members-panel">
                {members.map((member) => {
                  const memberActivity = activity.find((item) => item.user_id === member.user_id);
                  return (
                    <div className="group-member" key={member.user_id}>
                      <span className="avatar">{groupInitials(personName(member))}</span>
                      <span>
                        <b>{personName(member)}{member.user_id === currentUserId ? ' · Du' : ''}</b>
                        <small>{member.username ? `@${member.username}` : 'Nexus Nutzer'}</small>
                        <small className={memberActivity?.online ? 'group-member-online' : ''}>{memberActivity?.typing ? 'schreibt gerade…' : formatPresence(memberActivity)}</small>
                      </span>
                      <em>{member.role === 'owner' ? <Crown size={13} /> : member.role === 'admin' ? <ShieldCheck size={13} /> : null}{roleLabel(member.role)}</em>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="messages">
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
                  <div key={message.message_id} className={`message-wrap group-message-wrap${mine ? ' mine' : ''}`}>
                    {!mine && !message.deleted_at && <small className="group-message-sender">{sender}</small>}
                    <div className={mine ? 'bubble me' : 'bubble'}>
                      {message.reply_to_message_id && (
                        <div className="reply-preview"><b>{message.reply_sender_id === currentUserId ? 'Du' : message.reply_sender_name || 'Nexus Nutzer'}</b><span>{message.reply_body || 'Anhang'}</span></div>
                      )}
                      {!message.deleted_at && message.attachments?.length > 0 && <div className="message-attachments">{message.attachments.map((attachment) => <GroupAttachmentView key={attachment.attachment_id} attachment={attachment} />)}</div>}
                      {(message.deleted_at || message.body.trim()) && <span className={message.deleted_at ? 'deleted-message' : 'message-body'}>{message.deleted_at ? 'Nachricht gelöscht' : message.body}</span>}
                      <div className="message-meta">
                        {message.edited_at && !message.deleted_at && <small>bearbeitet</small>}
                        <time>{formatTime(message.created_at)}</time>
                        {mine && !message.deleted_at && <span className={`message-receipt${fullyRead ? ' read' : ''}`} title={readTitle}>{message.read_count > 0 ? <CheckCheck size={13} /> : '✓'}</span>}
                      </div>
                    </div>
                    {!message.deleted_at && (
                      <div className="message-actions">
                        <button onClick={() => { setEditing(null); setReplyingTo(message); }}><Reply size={13} /></button>
                        {mine && message.body.trim() && <button onClick={() => { setReplyingTo(null); clearPendingFile(); setEditing(message); setDraft(message.body); }}><Pencil size={13} /></button>}
                        {mine && <button onClick={() => void remove(message)} disabled={saving}><Trash2 size={13} /></button>}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            {(replyingTo || editing) && (
              <div className="composer-context">
                <div><b>{editing ? 'Nachricht bearbeiten' : 'Antworten'}</b><span>{editing ? editing.body : messagePreview(replyingTo)}</span></div>
                <button onClick={() => { setReplyingTo(null); if (editing) { setEditing(null); setDraft(''); } }}><X size={15} /></button>
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

            <div className="composer group-composer attachment-composer">
              <input ref={fileRef} className="attachment-file-input" type="file" accept={SUPPORTED_CHAT_ATTACHMENT_TYPES.join(',')} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
              <button className="attach-button" onClick={() => fileRef.current?.click()} disabled={saving || recording || Boolean(editing)} title="Datei oder Bild anhängen"><Paperclip size={18} /></button>
              <button className={`attach-button mic-button${recording ? ' recording' : ''}`} onClick={() => void startRecording()} disabled={saving || recording || Boolean(editing)} title="Sprachnachricht aufnehmen"><Mic size={18} /></button>
              <input value={draft} onChange={(event) => draftChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder={editing ? 'Bearbeitete Nachricht…' : pendingIsAudio ? 'Text zur Sprachnachricht (optional)…' : pendingFile ? 'Nachricht zum Anhang (optional)…' : 'Nachricht an die Gruppe…'} maxLength={5000} />
              <button onClick={() => void submit()} disabled={!canSend}><Send size={18} /></button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
