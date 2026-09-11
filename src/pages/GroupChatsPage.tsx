import { Crown, MessageCircle, Pencil, Plus, RefreshCw, Reply, Search, Send, ShieldCheck, Trash2, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '../components/Header';
import { loadNexusContacts, type NexusContact } from '../features/data/contactsData';
import {
  createGroupChat,
  deleteGroupMessage,
  editGroupMessage,
  loadGroupChats,
  loadGroupMembers,
  loadGroupMessages,
  markGroupRead,
  sendGroupMessage,
  subscribeToGroupRealtime,
  unsubscribeGroupRealtime,
  type GroupChat,
  type GroupMember,
  type GroupMessage,
} from '../features/data/groupChatData';

type GroupChatsPageProps = { currentUserId?: string };

const groupInitials = (name: string) => name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
const personName = (member: GroupMember) => member.full_name || (member.username ? `@${member.username}` : 'Nexus Nutzer');
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

export function GroupChatsPage({ currentUserId }: GroupChatsPageProps) {
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [contacts, setContacts] = useState<NexusContact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<GroupMessage | null>(null);
  const [editing, setEditing] = useState<GroupMessage | null>(null);
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [showMembers, setShowMembers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

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
      return;
    }
    setDraft('');
    setReplyingTo(null);
    setEditing(null);
    setShowMembers(false);
    void refreshGroup(selectedId);
    const channel = subscribeToGroupRealtime(selectedId, () => {
      void refreshGroup(selectedId).then(() => refreshGroups(selectedId));
    });
    return () => { void unsubscribeGroupRealtime(channel); };
  }, [selectedId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((group) => `${group.name} ${group.last_message || ''}`.toLowerCase().includes(needle));
  }, [groups, query]);

  const currentGroup = groups.find((group) => group.group_id === selectedId) || null;

  const toggleContact = (userId: string) => {
    setSelectedContacts((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
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
    if (!selectedId || !body || saving) return;
    setSaving(true);
    setError(null);
    const result = editing
      ? await editGroupMessage(editing.message_id, body)
      : await sendGroupMessage(selectedId, body, replyingTo?.message_id ?? null);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDraft('');
    setEditing(null);
    setReplyingTo(null);
    await refreshGroup(selectedId);
    await refreshGroups(selectedId);
  };

  const remove = async (message: GroupMessage) => {
    if (message.sender_id !== currentUserId || message.deleted_at || !window.confirm('Diese Nachricht wirklich löschen?')) return;
    setSaving(true);
    const result = await deleteGroupMessage(message.message_id);
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
                <div><b>{currentGroup.name}</b><small>{currentGroup.member_count} Mitglieder · {roleLabel(currentGroup.role)}</small></div>
              </div>
              <button className={`project-pill group-members-toggle${showMembers ? ' active' : ''}`} onClick={() => setShowMembers((value) => !value)}><UsersRound size={13} /> Mitglieder</button>
            </div>

            {showMembers && (
              <div className="group-members-panel">
                {members.map((member) => (
                  <div className="group-member" key={member.user_id}>
                    <span className="avatar">{groupInitials(personName(member))}</span>
                    <span><b>{personName(member)}{member.user_id === currentUserId ? ' · Du' : ''}</b><small>{member.username ? `@${member.username}` : 'Nexus Nutzer'}</small></span>
                    <em>{member.role === 'owner' ? <Crown size={13} /> : member.role === 'admin' ? <ShieldCheck size={13} /> : null}{roleLabel(member.role)}</em>
                  </div>
                ))}
              </div>
            )}

            <div className="messages">
              {messagesLoading && messages.length === 0 && <div className="messages-status">Gruppennachrichten werden geladen…</div>}
              {!messagesLoading && messages.length === 0 && <div className="messages-status group-empty-messages"><MessageCircle size={24} /><b>Noch keine Nachrichten</b><span>Schreib die erste Nachricht in diese Gruppe.</span></div>}
              {messages.map((message) => {
                const mine = message.sender_id === currentUserId;
                const sender = message.sender_full_name || (message.sender_username ? `@${message.sender_username}` : 'Nexus Nutzer');
                return (
                  <div key={message.message_id} className={`message-wrap group-message-wrap${mine ? ' mine' : ''}`}>
                    {!mine && !message.deleted_at && <small className="group-message-sender">{sender}</small>}
                    <div className={mine ? 'bubble me' : 'bubble'}>
                      {message.reply_to_message_id && (
                        <div className="reply-preview"><b>{message.reply_sender_id === currentUserId ? 'Du' : message.reply_sender_name || 'Nexus Nutzer'}</b><span>{message.reply_body || 'Nachricht'}</span></div>
                      )}
                      <span className={message.deleted_at ? 'deleted-message' : 'message-body'}>{message.deleted_at ? 'Nachricht gelöscht' : message.body}</span>
                      <div className="message-meta">{message.edited_at && !message.deleted_at && <small>bearbeitet</small>}<time>{formatTime(message.created_at)}</time></div>
                    </div>
                    {!message.deleted_at && (
                      <div className="message-actions">
                        <button onClick={() => { setEditing(null); setReplyingTo(message); }}><Reply size={13} /></button>
                        {mine && <button onClick={() => { setReplyingTo(null); setEditing(message); setDraft(message.body); }}><Pencil size={13} /></button>}
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
                <div><b>{editing ? 'Nachricht bearbeiten' : 'Antworten'}</b><span>{editing ? editing.body : replyingTo?.body || 'Nachricht'}</span></div>
                <button onClick={() => { setReplyingTo(null); if (editing) { setEditing(null); setDraft(''); } }}><X size={15} /></button>
              </div>
            )}

            <div className="composer group-composer">
              <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder={editing ? 'Bearbeitete Nachricht…' : 'Nachricht an die Gruppe…'} maxLength={5000} />
              <button onClick={() => void submit()} disabled={saving || !draft.trim()}><Send size={18} /></button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
