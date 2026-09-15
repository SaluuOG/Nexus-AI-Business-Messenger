// Test-only in-memory service, injected by the browser test's Vite plugin.
// It is never imported by the production application.
const project = (id, title, workspace_id, deadline, status = 'active') => ({
  id, title, workspace_id, deadline, status, priority: 'medium', progress: 35,
  value_cents: 10000, currency: 'EUR', customer_id: null, description: 'Vollständige Projektbeschreibung',
  created_at: '2026-09-14T08:00:00Z', updated_at: '2026-09-14T08:00:00Z',
});
const task = (id, title, patch = {}) => ({
  id, title, workspace_id: 'w1', project_id: 'p1', status: 'todo', priority: 'medium',
  assigned_to: 'me', due_date: '2026-09-14', description: 'Details <script>window.unsafe = true</script>',
  created_at: '2026-09-14T08:00:00Z', updated_at: '2026-09-14T08:00:00Z', completed_at: null, ...patch,
});
const messageHistoryFixture = sessionStorage.getItem('nexusTest.messageHistoryFixture') === '1';
const workspaceLifecycleFixture = sessionStorage.getItem('nexusTest.workspaceLifecycleFixture') === '1';
const workspace = (id, name, owner_id) => ({
  id, name, owner_id, slug: `${id}-slug`, avatar_url: null,
  created_at: '2026-01-01T08:00:00Z', updated_at: '2026-01-01T08:00:00Z',
});
const defaultWorkspaces = [
  workspace('w1', 'Erstes Team', 'owner-one'),
  workspace('w2', 'Zweites Team', 'owner-two'),
  workspace('w3', 'Drittes Team', 'owner-three'),
];
const lifecycleWorkspaces = [
  workspace('w-owner', 'Nordstern Studio', 'me'),
  workspace('w-member', 'Partner Workspace', 'member-owner'),
  workspace('w-delete', 'Archiv Workspace', 'me'),
];
const membership = (workspace_id, user_id, role, full_name, username) => ({
  workspace_id, user_id, role, full_name, username, avatar_url: null,
  joined_at: '2026-01-01T08:00:00Z',
});
const defaultMemberships = [
  membership('w1', 'me', 'member', 'Test Nutzer', 'nexus-test'),
  membership('w2', 'me', 'guest', 'Test Nutzer', 'nexus-test'),
  membership('w3', 'me', 'admin', 'Test Nutzer', 'nexus-test'),
];
const lifecycleMemberships = [
  membership('w-owner', 'me', 'owner', 'Test Nutzer', 'nexus-test'),
  membership('w-owner', 'next-owner', 'admin', 'Alex Admin', 'alex-admin'),
  membership('w-owner', 'team-member', 'member', 'Mira Member', 'mira-member'),
  membership('w-owner', 'team-guest', 'guest', 'Gast Nutzer', 'gast'),
  membership('w-member', 'member-owner', 'owner', 'Partner Owner', 'partner-owner'),
  membership('w-member', 'me', 'member', 'Test Nutzer', 'nexus-test'),
  membership('w-delete', 'me', 'owner', 'Test Nutzer', 'nexus-test'),
  membership('w-delete', 'delete-member', 'member', 'Archiv Mitglied', 'archiv-member'),
];
const historyConversations = [
  { conversation_id: 'c1', contact_user_id: 'other', full_name: 'Test Kontakt', username: 'test', avatar_url: null, unread_count: 0, last_message: 'Historie 129', last_message_at: '2026-01-01T02:09:00.000Z' },
  { conversation_id: 'c2', contact_user_id: 'second', full_name: 'Zweiter Kontakt', username: 'second', avatar_url: null, unread_count: 2, last_message: 'Vorherige Vorschau', last_message_at: '2026-03-10T09:00:00.000Z' },
];
const historyDirectMessages = [
  ...Array.from({ length: 130 }, (_, index) => ({
    message_id: `dm-history-${String(index).padStart(3, '0')}`,
    conversation_id: 'c1', sender_id: index % 2 ? 'me' : 'other',
    body: index === 8 ? 'Meilenstein Direkt vertraulich' : `Historie ${index}`,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    edited_at: null, deleted_at: null, read_at: null, attachments: [],
  })),
  { message_id: 'dm-second-search', conversation_id: 'c2', sender_id: 'second', body: 'Meilenstein Zweitgespräch', created_at: '2026-03-10T09:00:00.000Z', edited_at: null, deleted_at: null, read_at: null, attachments: [] },
];
const historyGroupChats = [
  { group_id: 'g1', name: 'Projektgruppe', role: 'member', member_count: 2, unread_count: 0, last_message: 'Gruppenverlauf', last_message_at: '2026-02-15T10:00:00.000Z' },
  { group_id: 'g2', name: 'Zweite Gruppe', role: 'member', member_count: 2, unread_count: 1, last_message: 'Alte Gruppenvorschau', last_message_at: '2026-02-16T10:00:00.000Z' },
];
const historyGroupMessages = [
  ...Array.from({ length: 130 }, (_, index) => ({
    message_id: index === 8 ? 'gm-search-anchor' : `gm-history-${String(index).padStart(3, '0')}`,
    group_id: 'g1', sender_id: index % 2 ? 'me' : 'other',
    sender_full_name: index % 2 ? 'Test Nutzer' : 'Team Kontakt',
    sender_username: index % 2 ? 'nexus-test' : 'team',
    body: index === 8 ? 'Meilenstein Gruppe vertraulich' : `Gruppenverlauf ${index}`,
    created_at: new Date(Date.UTC(2026, 1, 15, 0, index)).toISOString(),
    edited_at: null, deleted_at: null, attachments: [],
  })),
  { message_id: 'gm-second', group_id: 'g2', sender_id: 'other', sender_full_name: 'Zweiter Kontakt', sender_username: 'second', body: 'Nachricht in zweiter Gruppe', created_at: '2026-02-16T10:00:00.000Z', deleted_at: null, attachments: [] },
];
const state = {
  workspaces: structuredClone(workspaceLifecycleFixture ? lifecycleWorkspaces : defaultWorkspaces),
  memberships: structuredClone(workspaceLifecycleFixture ? lifecycleMemberships : defaultMemberships),
  projects: [project('p1', 'Überfälliges Projekt', 'w1', '2026-09-13'), project('p2', 'Kommendes Projekt', 'w1', '2026-09-16'), project('p3', 'Abgeschlossenes Projekt', 'w1', null, 'completed'), project('p4', 'Zweites Team', 'w2', null)],
  tasks: [
    task('mine', 'Meine heutige Aufgabe'), task('past', 'Meine überfällige Aufgabe', { due_date: '2026-09-13' }),
    task('future', 'Meine morgige Aufgabe', { due_date: '2026-09-15' }),
    task('other', 'Aufgabe einer anderen Person', { assigned_to: 'other' }),
    task('done', 'Bereits erledigt', { status: 'done' }),
    ...Array.from({ length: 8 }, (_, i) => task('unassigned-' + i, 'Teamaufgabe ' + (i + 1), { assigned_to: null, status: i === 0 ? 'blocked' : 'todo' })),
    task('second', 'Aufgabe im zweiten Team', { workspace_id: 'w2', project_id: 'p4', assigned_to: null }),
  ],
  failure: null, revoked: false, delayWorkspace: null, writes: 0, channels: [], revision: 0,
  sources: JSON.parse(sessionStorage.getItem('nexusTest.sources') || '[]'), sourceDenied: false,
  hideRecentSource: false, loseCreateResponse: false, createDelay: 0, directMessageDelay: 0,
  resetRequests: [], passwordUpdates: [], authFailure: null, signOutCount: 0,
  notifications: JSON.parse(sessionStorage.getItem('nexusTest.notifications') || '[]'),
  notificationPreferences: JSON.parse(sessionStorage.getItem('nexusTest.notificationPreferences') || '{}'),
  notificationDelay: 0, notificationReadDelay: 0, notificationCalls: [],
  chatScanAvailable: true, chatScanCalls: [], chatScanAborts: [], chatScanFailure: null,
  chatScanDeferred: false, chatScanPending: [], chatScanResult: null,
  chatScanStateCalls: [], chatScanStateDelay: 0, chatScanRejections: [],
  chatScanCacheDeferred: false, chatScanCachePending: [],
  chatScanRecords: JSON.parse(sessionStorage.getItem('nexusTest.chatScanRecords') || '{}'),
  chatHistoryRevisions: JSON.parse(sessionStorage.getItem('nexusTest.chatHistoryRevisions') || '{}'),
  conversations: messageHistoryFixture ? historyConversations : [{ conversation_id: 'c1', contact_user_id: 'other', full_name: 'Test Kontakt', username: 'test', unread_count: 0, last_message: 'Bitte das Angebot prüfen!' }],
  directMessages: messageHistoryFixture ? historyDirectMessages : [{ message_id: 'dm1', conversation_id: 'c1', sender_id: 'other', body: 'Bitte das Angebot prüfen!\nDetails für das Team.', created_at: '2025-09-14T08:00:00Z', deleted_at: null, attachments: [] }],
  groupChats: messageHistoryFixture ? historyGroupChats : [{ group_id: 'g1', name: 'Projektgruppe', role: 'member', member_count: 2, unread_count: 0, last_message: 'Startseite vorbereiten' }],
  groupMessages: messageHistoryFixture ? historyGroupMessages : [{ message_id: 'gm1', group_id: 'g1', sender_id: 'other', sender_full_name: 'Team Kontakt', body: 'Startseite für den Kunden vorbereiten!', created_at: '2025-09-14T08:00:00Z', deleted_at: null, attachments: [] }],
  searchCalls: [], textSendCalls: [], textSendWrites: 0, loseTextSendResponse: false,
  groupChatListLoads: 0, groupChatListDelay: 0,
  uploadCalls: [], failAttachmentUpload: false,
  lifecycleCalls: [], lifecycleDelay: 0,
};
state.projects.push(project('p5', 'Drittes Projekt', 'w3', null));
state.tasks.push(...JSON.parse(sessionStorage.getItem('nexusTest.created') || '[]'));
const memberships = state.memberships;
let user = { id: 'me', email: 'nexus-test@example.invalid', user_metadata: { full_name: 'Test Nutzer' } };
export const backendConfigured = true;
export const supabaseConfig = { url: 'https://example.invalid', publishableKey: 'test-only' };
export const initialAuthCallback = { isRecovery: false, hasError: false, hasPkceCode: false, marker: null };

state.emit = (table = 'project_tasks', event = 'UPDATE', payload = null) => {
  let delivered = 0;
  for (const channel of state.channels.filter(c => c.active)) {
    for (const entry of channel.entries) {
      if (entry.filter.table !== table || (entry.filter.event !== event && entry.filter.event !== '*')) continue;
      if (payload && entry.filter.filter) {
        const match = /^([^=]+)=eq\.(.+)$/.exec(entry.filter.filter);
        const row = event === 'DELETE' ? payload.old : payload.new;
        if (match && String(row?.[match[1]]) !== match[2]) continue;
      }
      entry.callback(payload ?? {});
      delivered++;
    }
  }
  return delivered;
};
state.connection = status => {
  for (const channel of state.channels.filter(c => c.active)) channel.statusCallback?.(status);
};
window.nexusTest = state;
const authListeners = new Set();
state.switchUser = id => {
  user = { id, email: id + '@example.invalid', user_metadata: { full_name: 'Other Test User' } };
  for (const listener of authListeners) listener('SIGNED_IN', { user });
};
const notificationCategory = kind => ({ direct_message: 'messages', group_message: 'messages', contact_request: 'contacts', workspace_invitation: 'invitations', task_assigned: 'assignments', task_due: 'deadlines', task_overdue: 'deadlines' })[kind];
const notificationPrefs = id => ({ messages: true, contacts: true, invitations: true, assignments: true, deadlines: true, ...state.notificationPreferences[id] });
state.persistNotifications = () => {
  sessionStorage.setItem('nexusTest.notifications', JSON.stringify(state.notifications));
  sessionStorage.setItem('nexusTest.notificationPreferences', JSON.stringify(state.notificationPreferences));
};
state.finishChatScans = () => {
  for (const finish of state.chatScanPending.splice(0)) finish();
};
state.finishChatScanCacheReads = () => {
  for (const finish of state.chatScanCachePending.splice(0)) finish();
};

// Synthetic personal workflow state. These records simulate server persistence,
// so a page reload cannot turn a processed chat into another billable scan.
const chatHistoryKey = (kind, chatId) => `${kind}:${chatId}`;
const chatRecordKey = (kind, chatId, userId) => `${userId}:${kind}:${chatId}`;
const chatHistoryRevision = (kind, chatId) => state.chatHistoryRevisions[chatHistoryKey(kind, chatId)] ?? 1;
const chatRecord = (kind, chatId, userId) => state.chatScanRecords[chatRecordKey(kind, chatId, userId)] ?? { done: false, version: 0, last_scanned_at: null, scannedHistory: null, result: null };
const saveChatRecord = (kind, chatId, userId, value) => {
  state.chatScanRecords[chatRecordKey(kind, chatId, userId)] = value;
  sessionStorage.setItem('nexusTest.chatScanRecords', JSON.stringify(state.chatScanRecords));
};
state.chatScanState = (kind, chatId, userId = user.id) => {
  const entry = chatRecord(kind, chatId, userId);
  const history = chatHistoryRevision(kind, chatId);
  const status = entry.done ? 'done' : entry.scannedHistory === history && entry.result ? 'processed' : entry.last_scanned_at ? 'updated' : 'open';
  return { chat_id: chatId, status, last_scanned_at: entry.last_scanned_at,
    revision: history.toString(16).padStart(16, '0') + entry.version.toString(16).padStart(16, '0'),
    can_scan: status === 'open' || status === 'updated' };
};
state.changeChatHistory = (kind, chatId) => {
  const key = chatHistoryKey(kind, chatId);
  state.chatHistoryRevisions[key] = chatHistoryRevision(kind, chatId) + 1;
  sessionStorage.setItem('nexusTest.chatHistoryRevisions', JSON.stringify(state.chatHistoryRevisions));
  // Changes to older messages outside the viewport must invalidate the scan.
  state.emit(kind === 'direct' ? 'direct_messages' : 'group_messages');
};
state.setChatDone = (kind, chatId, done, userId = user.id) => {
  const entry = chatRecord(kind, chatId, userId);
  saveChatRecord(kind, chatId, userId, { ...entry, done, version: entry.version + 1 });
  state.emit('chat_scan_states');
  return state.chatScanState(kind, chatId, userId);
};
const scanFailure = (code, status = 409) => {
  state.chatScanRejections.push(code);
  return { data: null, error: { message: code,
    context: new Response(JSON.stringify({ error: code, code }), { status, headers: { 'content-type': 'application/json' } }) } };
};

// The scan deliberately includes an old source outside the one-message chat
// viewport. UI tests prove that coverage and sources come from the server's
// complete-history result instead of analyzing only loaded message bubbles.
const chatScanResult = (kind, chatId) => ({
  scanId: 'scan-test', chatKind: kind, chatId,
  summary: 'Das Team bereitet die neue Kundenwebseite vor.',
  facts: [{ text: 'Das vereinbarte Budget beträgt 2.500 Euro.', sourceIds: ['old-source'] }],
  decisions: [{ text: 'Der Start erfolgt nach der Freigabe.', sourceIds: ['recent-source'] }],
  tasks: [{ text: 'Angebot bis Freitag vorbereiten.', sourceIds: ['recent-source'] }],
  questions: [{ text: 'Wer liefert die Produktbilder?', sourceIds: ['old-source'] }],
  sources: [
    { id: 'old-source', sender: 'Test Kontakt', createdAt: '2025-01-01T09:00:00Z', excerpt: 'Unser Budget beträgt 2.500 Euro. Wer liefert die Produktbilder?' },
    { id: 'recent-source', sender: 'Test Nutzer', createdAt: '2025-09-14T08:00:00Z', excerpt: 'Das Angebot ist bis Freitag fertig. Danach geben wir den Start frei.' },
  ],
  coverage: { messageCount: 250, from: '2025-01-01T09:00:00Z', to: '2025-09-14T08:00:00Z', attachmentsExcluded: 2, complete: true },
});

const messageOrder = (left, right) => {
  const byTime = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  return byTime || String(left.message_id).localeCompare(String(right.message_id));
};
const beforeCursor = (message, createdAt, messageId) => !createdAt || messageOrder(message, { created_at: createdAt, message_id: messageId }) < 0;
const directChatId = message => message.conversation_id ?? 'c1';
const normalizedDirectMessage = message => ({
  reply_to_message_id: null, reply_sender_id: null, reply_body: null,
  edited_at: null, deleted_at: null, read_at: null, attachments: [],
  ...message,
});
const normalizedGroupMessage = message => ({
  sender_full_name: null, sender_username: null, sender_avatar_url: null,
  edited_at: null, deleted_at: null, reply_to_message_id: null,
  reply_body: null, reply_sender_id: null, reply_sender_name: null,
  attachments: [], read_count: 0, recipient_count: 1,
  ...message,
});
const messagePage = (rows, args, chatKey) => {
  const chatId = args.p_conversation_id ?? args.p_group_id;
  const limit = Math.max(1, Math.min(Number(args.p_limit ?? 100), 200));
  const eligible = rows
    .filter(message => chatKey(message) === chatId)
    .filter(message => beforeCursor(message, args.p_before_created_at, args.p_before_message_id))
    .sort(messageOrder)
    .reverse();
  const newestFirst = eligible.slice(0, limit);
  const messages = newestFirst.reverse();
  const oldest = messages[0];
  return {
    messages: structuredClone(messages),
    has_more: eligible.length > limit,
    next_cursor: oldest ? { created_at: oldest.created_at, message_id: oldest.message_id } : null,
  };
};
const messageContext = (rows, args, chatKey) => {
  const chatId = args.p_conversation_id ?? args.p_group_id;
  const radius = Math.max(1, Math.min(Number(args.p_radius ?? 30), 50));
  const all = rows.filter(message => chatKey(message) === chatId).sort(messageOrder);
  const target = all.findIndex(message => message.message_id === args.p_message_id);
  if (target < 0) return { data: null, error: { message: 'Nachricht nicht gefunden oder kein Zugriff.' } };
  const from = Math.max(0, target - radius);
  const to = Math.min(all.length, target + radius + 1);
  const messages = all.slice(from, to);
  return { data: structuredClone({
    messages,
    anchor_message_id: args.p_message_id,
    has_older: from > 0,
    has_newer: to < all.length,
    oldest_cursor: messages[0] ? { created_at: messages[0].created_at, message_id: messages[0].message_id } : null,
    newest_cursor: messages.at(-1) ? { created_at: messages.at(-1).created_at, message_id: messages.at(-1).message_id } : null,
  }), error: null };
};
const conversationName = id => state.conversations.find(conversation => conversation.conversation_id === id)?.full_name ?? 'Direktchat';
const directSender = message => message.sender_id === 'me'
  ? { name: 'Test Nutzer', username: 'nexus-test' }
  : { name: conversationName(directChatId(message)), username: state.conversations.find(conversation => conversation.conversation_id === directChatId(message))?.username ?? 'test' };
const searchMessages = args => {
  const needle = String(args.p_query ?? '').trim().toLocaleLowerCase('de');
  const terms = needle.split(/\s+/).filter(Boolean);
  const kind = args.p_kind && args.p_kind !== 'all' ? args.p_kind : null;
  const scope = String(args.p_scope_query ?? args.p_sender_query ?? '').trim().toLocaleLowerCase('de');
  const matchesText = message => terms.length > 0 && terms.every(term => message.body.toLocaleLowerCase('de').includes(term));
  const matchesDate = message => (!args.p_from_date || new Date(message.created_at).getTime() >= new Date(args.p_from_date).getTime())
    && (!args.p_to_date || new Date(message.created_at).getTime() < new Date(args.p_to_date).getTime());
  const direct = kind === 'group' ? [] : state.directMessages.flatMap(message => {
    const sender = directSender(message);
    const chatId = directChatId(message);
    const haystack = `${sender.name} ${sender.username} ${conversationName(chatId)}`.toLocaleLowerCase('de');
    if (message.deleted_at || !message.body?.trim() || !matchesText(message) || !matchesDate(message)
      || (args.p_chat_id && args.p_chat_id !== chatId) || (args.p_sender_id && args.p_sender_id !== message.sender_id)
      || (scope && !haystack.includes(scope))) return [];
    return [{ kind: 'direct', chat_id: chatId, chat_name: conversationName(chatId), message_id: message.message_id,
      sender_id: message.sender_id, sender_name: sender.name, sender_username: sender.username,
      body: message.body, created_at: message.created_at, edited_at: message.edited_at ?? null }];
  });
  const group = kind === 'direct' ? [] : state.groupMessages.flatMap(message => {
    const chat = state.groupChats.find(item => item.group_id === message.group_id);
    const senderName = message.sender_full_name ?? (message.sender_id === 'me' ? 'Test Nutzer' : 'Team Kontakt');
    const senderUsername = message.sender_username ?? (message.sender_id === 'me' ? 'nexus-test' : 'team');
    const haystack = `${senderName} ${senderUsername} ${chat?.name ?? ''}`.toLocaleLowerCase('de');
    if (message.deleted_at || !message.body?.trim() || !matchesText(message) || !matchesDate(message)
      || (args.p_chat_id && args.p_chat_id !== message.group_id) || (args.p_sender_id && args.p_sender_id !== message.sender_id)
      || (scope && !haystack.includes(scope))) return [];
    return [{ kind: 'group', chat_id: message.group_id, chat_name: chat?.name ?? 'Gruppe', message_id: message.message_id,
      sender_id: message.sender_id, sender_name: senderName, sender_username: senderUsername,
      body: message.body, created_at: message.created_at, edited_at: message.edited_at ?? null }];
  });
  const limit = Math.max(1, Math.min(Number(args.p_limit ?? 50), 100));
  const eligible = [...direct, ...group]
    .filter(message => beforeCursor(message, args.p_before_created_at, args.p_before_message_id))
    .sort(messageOrder)
    .reverse();
  const results = eligible.slice(0, limit);
  const oldest = results.at(-1);
  return { results: structuredClone(results), has_more: eligible.length > limit,
    next_cursor: oldest ? { created_at: oldest.created_at, message_id: oldest.message_id } : null };
};
const sendTextMessage = (kind, args) => {
  const chatId = args.p_conversation_id ?? args.p_group_id;
  const clientRequestId = args.p_client_request_id;
  state.textSendCalls.push({ kind, args: structuredClone(args), userId: user.id });
  const rows = kind === 'direct' ? state.directMessages : state.groupMessages;
  const existing = rows.find(message => message.sender_id === user.id && message.client_request_id === clientRequestId);
  if (existing) return { data: existing.message_id, error: null };
  const messageId = `${kind}-sent-${state.textSendWrites + 1}`;
  const createdAt = new Date(Date.UTC(2026, 8, 15, 12, 0, state.textSendWrites)).toISOString();
  const message = kind === 'direct'
    ? normalizedDirectMessage({ message_id: messageId, conversation_id: chatId, sender_id: user.id,
      body: String(args.p_body ?? '').trim(), created_at: createdAt, client_request_id: clientRequestId,
      reply_to_message_id: args.p_reply_to_message_id ?? null })
    : normalizedGroupMessage({ message_id: messageId, group_id: chatId, sender_id: user.id,
      sender_full_name: 'Test Nutzer', sender_username: 'nexus-test', body: String(args.p_body ?? '').trim(),
      created_at: createdAt, client_request_id: clientRequestId, reply_to_message_id: args.p_reply_to_message_id ?? null });
  rows.push(message);
  state.textSendWrites++;
  if (kind === 'direct') {
    const chat = state.conversations.find(item => item.conversation_id === chatId);
    if (chat) Object.assign(chat, { last_message: message.body, last_message_at: createdAt });
  } else {
    const chat = state.groupChats.find(item => item.group_id === chatId);
    if (chat) Object.assign(chat, { last_message: message.body, last_message_at: createdAt });
  }
  queueMicrotask(() => state.emit(kind === 'direct' ? 'direct_messages' : 'group_messages', 'INSERT'));
  if (state.loseTextSendResponse) {
    state.loseTextSendResponse = false;
    return { data: null, error: { message: 'Verbindung wurde nach dem Senden unterbrochen.' } };
  }
  return { data: messageId, error: null };
};
const lifecycleError = message => ({ data: null, error: { message, code: 'P0001' } });
const lifecycleCall = async (name, args) => {
  state.lifecycleCalls.push({ name, args: structuredClone(args), userId: user.id });
  if (state.lifecycleDelay > 0) await new Promise(resolve => setTimeout(resolve, state.lifecycleDelay));
  if (state.failure === name) return lifecycleError('Simulierter Lifecycle-Fehler.');
  return null;
};
const currentMembership = workspaceId => memberships.find(member => member.workspace_id === workspaceId && member.user_id === user.id);

export const supabase = {
  functions: {
    async invoke(name, { body, signal } = {}) {
      if (name !== 'chat-scan') throw new Error('Unexpected test function: ' + name);
      const call = { name, body: structuredClone(body), userId: user.id };
      state.chatScanCalls.push(call);
      signal?.addEventListener('abort', () => state.chatScanAborts.push(call), { once: true });
      if (body.action === 'status') return { data: {
        available: state.chatScanAvailable, providerLabel: 'Test KI',
        workflow: state.chatScanState(body.kind, body.chatId, call.userId),
      }, error: null };
      const initial = state.chatScanState(body.kind, body.chatId, call.userId);
      if (body.expectedRevision && body.expectedRevision !== initial.revision) return scanFailure('status_changed');
      if (initial.status === 'done') return scanFailure('chat_done');
      if (initial.status === 'processed') return { data: structuredClone(chatRecord(body.kind, body.chatId, call.userId).result), error: null };
      const failure = state.chatScanFailure;
      const result = structuredClone(state.chatScanResult ?? chatScanResult(body.kind, body.chatId));
      // Ignore AbortSignal while waiting on purpose: an uncooperative late
      // transport may still finish, but cancelled work must not restore output.
      if (state.chatScanDeferred) await new Promise(resolve => state.chatScanPending.push(resolve));
      if (failure) return scanFailure(failure, 503);
      if (state.chatScanState(body.kind, body.chatId, call.userId).revision !== initial.revision) return scanFailure('status_changed');
      if (!signal?.aborted) {
        const entry = chatRecord(body.kind, body.chatId, call.userId);
        saveChatRecord(body.kind, body.chatId, call.userId, { ...entry, version: entry.version + 1,
          last_scanned_at: new Date().toISOString(), scannedHistory: chatHistoryRevision(body.kind, body.chatId), result });
      }
      return { data: result, error: null };
    },
  },
  storage: {
    from(bucket) {
      return {
        async createSignedUrl(path) { return { data: { signedUrl: `https://files.example.invalid/${bucket}/${path}` }, error: null }; },
        async upload(path, file) {
          state.uploadCalls.push({ bucket, path, name: file.name, type: file.type, size: file.size });
          if (state.failAttachmentUpload) return { data: null, error: { message: 'Simulierter Uploadfehler' } };
          return { data: { path }, error: null };
        },
        async remove(paths) { return { data: paths, error: null }; },
      };
    },
  },
  auth: {
    getSession: async () => ({ data: { session: { user } }, error: null }),
    onAuthStateChange: listener => { authListeners.add(listener); return { data: { subscription: { unsubscribe() { authListeners.delete(listener); } } } }; },
    resetPasswordForEmail: async (email, options) => {
      state.resetRequests.push({ email, options });
      return { error: state.authFailure ? { message: state.authFailure } : null };
    },
    updateUser: async ({ password }) => {
      state.passwordUpdates.push(password);
      return { data: { user }, error: state.authFailure ? { message: state.authFailure } : null };
    },
    signOut: async () => {
      state.signOutCount++;
      if (state.authFailure) return { error: { message: state.authFailure } };
      for (const listener of authListeners) listener('SIGNED_OUT', null);
      return { error: null };
    },
  },
  from(table) {
    const request = { operation: 'select', filters: [], range: null, single: false };
    const builder = {
      select() { return this; }, order() { return this; },
      eq(...filter) { request.filters.push(filter); return this; },
      range(a, b) { request.range = [a, b]; return this; },
      maybeSingle() { request.single = true; return this; }, single() { request.single = true; return this; },
      update(value) { request.operation = 'update'; request.value = value; return this; },
      insert(value) { request.operation = 'insert'; request.value = value; return this; },
      delete() { request.operation = 'delete'; return this; },
      async then(resolve, reject) {
        try {
          if (state.failure === table) return resolve({ data: null, error: { message: 'connection failed' } });
          let rows = table === 'projects' ? state.projects : table === 'project_tasks' ? state.tasks
            : table === 'workspace_members' ? memberships
            : table === 'project_task_sources' ? state.sources.filter(s => !state.sourceDenied && !state.revoked && (s.kind === 'direct' ? state.directMessages : state.groupMessages).some(m => m.message_id === s.message_id && !m.deleted_at))
            : table === 'workspaces' ? state.workspaces.filter(workspace => !workspaceLifecycleFixture || memberships.some(member => member.workspace_id === workspace.id && member.user_id === user.id))
            : table === 'profiles' ? [{ id: 'me', full_name: 'Test Nutzer' }] : [];
          rows = rows.filter(row => request.filters.every(([key, value]) => row[key] === value));
          if (request.operation !== 'select') {
            state.writes++;
            if (request.operation !== 'update' || table !== 'project_tasks') throw new Error('Unexpected test mutation');
            rows.forEach(row => Object.assign(row, request.value, { updated_at: 'revision-' + (++state.revision) }));
          }
          if (request.range) rows = rows.slice(request.range[0], request.range[1] + 1);
          const result = structuredClone({ data: request.single ? rows[0] ?? null : rows, error: null });
          if (request.filters.some(([key, value]) => key === 'workspace_id' && value === state.delayWorkspace)) await new Promise(r => setTimeout(r, 700));
          resolve(result);
        } catch (error) { reject(error); }
      },
    };
    return builder;
  },
  rpc(name, args) {
    const query = this.rpcResult(name, args);
    // The test transport deliberately permits late replies after abort; callers
    // must also guard scope/revision instead of relying on a cooperative network.
    query.abortSignal = () => query;
    return query;
  },
  async rpcResult(name, args) {
    if (['get_my_chat_scan_state', 'get_my_chat_scan_states', 'set_my_chat_scan_done', 'get_my_chat_scan_result'].includes(name)) {
      const userId = user.id;
      state.chatScanStateCalls.push({ name, args: structuredClone(args), userId });
      if (state.failure === name) return { data: null, error: { message: 'offline' } };
      const current = args.p_chat_id ? state.chatScanState(args.p_kind, args.p_chat_id, userId) : null;
      let data;
      if (name === 'get_my_chat_scan_states') {
        const ids = args.p_kind === 'direct'
          ? state.conversations.map(c => c.conversation_id)
          : state.groupChats.map(group => group.group_id);
        data = ids.map(id => state.chatScanState(args.p_kind, id, userId));
      } else if (name === 'set_my_chat_scan_done') {
        if (args.p_expected_revision !== current.revision) return { data: null, error: { message: 'status_changed', code: 'P0001' } };
        data = state.setChatDone(args.p_kind, args.p_chat_id, args.p_done, userId);
      } else if (name === 'get_my_chat_scan_result') {
        data = current.status === 'processed' ? chatRecord(args.p_kind, args.p_chat_id, userId).result : null;
      } else data = current;
      const result = { data: structuredClone(data), error: null };
      if (name === 'get_my_chat_scan_result' && state.chatScanCacheDeferred) await new Promise(resolve => state.chatScanCachePending.push(resolve));
      if (state.chatScanStateDelay) await new Promise(resolve => setTimeout(resolve, state.chatScanStateDelay));
      return result;
    }
    if (name === 'get_my_notifications') {
      state.notificationCalls.push({ name, args, userId: user.id });
      if (state.failure === name) return { data: null, error: { message: 'offline' } };
      const preferences = notificationPrefs(user.id);
      const visible = state.notifications.filter(n => n.recipient_id === user.id && !n.revoked && preferences[notificationCategory(n.kind)]).sort((a, b) => Number(b.id) - Number(a.id));
      const filtered = visible.filter(n => !args.p_unread_only || !n.read_at);
      const paged = filtered.filter(n => !args.p_before || BigInt(n.id) < BigInt(args.p_before));
      const items = paged.slice(0, args.p_limit);
      const result = structuredClone({ data: { items, preferences, unread_count: visible.filter(n => !n.read_at).length, total_count: filtered.length, through_id: visible[0]?.id ?? '0', has_more: paged.length > items.length }, error: null });
      if (state.notificationDelay) await new Promise(r => setTimeout(r, state.notificationDelay));
      return result;
    }
    if (name === 'mark_notifications_read') {
      state.notificationCalls.push({ name, args, userId: user.id });
      if (state.failure === name) return { data: null, error: { message: 'offline' } };
      if (state.notificationReadDelay) await new Promise(r => setTimeout(r, state.notificationReadDelay));
      const preferences = notificationPrefs(user.id);
      for (const n of state.notifications) if (n.recipient_id === user.id && !n.revoked && preferences[notificationCategory(n.kind)] && BigInt(n.id) <= BigInt(args.p_through) && (!args.p_id || n.id === args.p_id)) n.read_at = new Date().toISOString();
      state.persistNotifications(); state.emit('notifications');
      return { data: null, error: null };
    }
    if (name === 'set_notification_preference') {
      if (state.failure === name) return { data: null, error: { message: 'offline' } };
      state.notificationPreferences[user.id] = { ...notificationPrefs(user.id), [args.p_category]: args.p_enabled };
      state.persistNotifications(); state.emit('notification_preferences');
      return { data: null, error: null };
    }
    if (name === 'get_direct_conversations') return { data: structuredClone(state.conversations), error: null };
    if (name === 'get_direct_messages') return { data: state.hideRecentSource ? [] : structuredClone(state.directMessages.filter(message => directChatId(message) === args.p_conversation_id).map(normalizedDirectMessage)), error: null };
    if (name === 'get_direct_message_page') {
      if (state.directMessageDelay) await new Promise(r => setTimeout(r, state.directMessageDelay));
      return { data: state.hideRecentSource
        ? { messages: [], has_more: false, next_cursor: null }
        : messagePage(state.directMessages.map(normalizedDirectMessage), args, directChatId), error: null };
    }
    if (name === 'get_direct_message_context') {
      if (state.directMessageDelay) await new Promise(r => setTimeout(r, state.directMessageDelay));
      return state.hideRecentSource
        ? { data: null, error: { message: 'Nachricht nicht gefunden oder kein Zugriff.' } }
        : messageContext(state.directMessages.map(normalizedDirectMessage), args, directChatId);
    }
    if (name === 'get_my_group_chats') {
      state.groupChatListLoads++;
      if (state.groupChatListDelay) await new Promise(r => setTimeout(r, state.groupChatListDelay));
      return { data: structuredClone(state.groupChats), error: null };
    }
    if (name === 'get_group_messages') return { data: state.hideRecentSource ? [] : structuredClone(state.groupMessages.filter(message => message.group_id === args.p_group_id).map(normalizedGroupMessage)), error: null };
    if (name === 'get_group_message_page') return { data: state.hideRecentSource
      ? { messages: [], has_more: false, next_cursor: null }
      : messagePage(state.groupMessages.map(normalizedGroupMessage), args, message => message.group_id), error: null };
    if (name === 'get_group_message_context') return state.hideRecentSource
      ? { data: null, error: { message: 'Nachricht nicht gefunden oder kein Zugriff.' } }
      : messageContext(state.groupMessages.map(normalizedGroupMessage), args, message => message.group_id);
    if (name === 'search_accessible_messages') {
      state.searchCalls.push(structuredClone(args));
      return { data: searchMessages(args), error: null };
    }
    if (name === 'send_direct_message_v3') return sendTextMessage('direct', args);
    if (name === 'send_group_message_v2') return sendTextMessage('group', args);
    if (name === 'get_group_members') return { data: [{ user_id: 'me', full_name: 'Test Nutzer', role: 'member' }, { user_id: 'other', full_name: 'Team Kontakt', role: 'owner' }], error: null };
    if (name === 'get_task_message_source') {
      if (state.failure === name) return { data: null, error: { message: 'offline' } };
      const source = state.sources.find(s => s.task_id === args.p_task_id);
      const message = source && (source.kind === 'direct' ? state.directMessages : state.groupMessages).find(m => m.message_id === source.message_id);
      return { data: !source || !message || message.deleted_at || state.sourceDenied || state.revoked ? null : { ...source, body: message.body, created_at: message.created_at, edited_at: message.edited_at ?? null }, error: null };
    }
    if (name === 'create_task_from_message') {
      if (state.createDelay) await new Promise(r => setTimeout(r, state.createDelay));
      const member = memberships.find(m => m.workspace_id === args.p_workspace_id);
      if (state.revoked || !member || member.role === 'guest') return { data: null, error: { message: 'Du hast in diesem Workspace kein Schreibrecht.' } };
      const message = (args.p_kind === 'direct' ? state.directMessages : state.groupMessages).find(m => m.message_id === args.p_message_id);
      if (!message || message.deleted_at || state.sourceDenied) return { data: null, error: { message: 'Die Nachricht wurde entfernt oder du hast keinen Zugriff mehr darauf.' } };
      const existing = state.sources.find(s => s.request_id === args.p_request_id);
      if (existing) return { data: structuredClone(state.tasks.find(t => t.id === existing.task_id)), error: null };
      const created = task(crypto.randomUUID(), args.p_title, { workspace_id: args.p_workspace_id, project_id: args.p_project_id, description: args.p_description, priority: args.p_priority, assigned_to: args.p_assigned_to, due_date: args.p_due_date, created_by: 'me', fromMessage: true });
      state.tasks.push(created); state.writes++;
      state.sources.push({ task_id: created.id, workspace_id: created.workspace_id, request_id: args.p_request_id, kind: args.p_kind, message_id: args.p_message_id, chat_id: args.p_kind === 'direct' ? 'c1' : 'g1' });
      sessionStorage.setItem('nexusTest.created', JSON.stringify(state.tasks.filter(t => t.fromMessage)));
      sessionStorage.setItem('nexusTest.sources', JSON.stringify(state.sources));
      state.emit('project_tasks', 'INSERT');
      if (state.loseCreateResponse) { state.loseCreateResponse = false; throw new Error('Simulated response loss after commit'); }
      return { data: structuredClone(created), error: null };
    }
    if (name === 'rename_workspace') {
      const failed = await lifecycleCall(name, args);
      if (failed) return failed;
      const target = state.workspaces.find(workspace => workspace.id === args.p_workspace_id);
      const member = currentMembership(args.p_workspace_id);
      if (!target || !member) return lifecycleError('Workspace nicht gefunden oder kein Zugriff.');
      if (!['owner', 'admin'].includes(member.role)) return lifecycleError('Nur Owner und Admins können den Workspace umbenennen.');
      const normalizedName = String(args.p_name ?? '').trim();
      if (normalizedName.length < 2 || normalizedName.length > 80) return lifecycleError('Der Workspace-Name muss zwischen 2 und 80 Zeichen lang sein.');
      target.name = normalizedName;
      target.updated_at = new Date().toISOString();
      state.writes++;
      queueMicrotask(() => state.emit('workspaces', 'UPDATE', { new: structuredClone(target), old: null }));
      return { data: null, error: null };
    }
    if (name === 'transfer_workspace_ownership') {
      const failed = await lifecycleCall(name, args);
      if (failed) return failed;
      const target = state.workspaces.find(workspace => workspace.id === args.p_workspace_id);
      const ownerMembership = currentMembership(args.p_workspace_id);
      const successor = memberships.find(member => member.workspace_id === args.p_workspace_id && member.user_id === args.p_new_owner_id);
      if (!target || !ownerMembership || target.owner_id !== user.id || ownerMembership.role !== 'owner') return lifecycleError('Nur der aktuelle Owner kann die Ownership übertragen.');
      if (!successor || !['admin', 'member'].includes(successor.role)) return lifecycleError('Der neue Owner muss aktiver Admin oder Member sein.');
      if (successor.user_id === user.id) return lifecycleError('Du bist bereits Owner dieses Workspaces.');
      ownerMembership.role = 'admin';
      successor.role = 'owner';
      target.owner_id = successor.user_id;
      target.updated_at = new Date().toISOString();
      state.writes++;
      queueMicrotask(() => {
        state.emit('workspace_members', 'UPDATE', { new: structuredClone(successor), old: null });
        state.emit('workspaces', 'UPDATE', { new: structuredClone(target), old: null });
      });
      return { data: null, error: null };
    }
    if (name === 'leave_workspace') {
      const failed = await lifecycleCall(name, args);
      if (failed) return failed;
      const memberIndex = memberships.findIndex(member => member.workspace_id === args.p_workspace_id && member.user_id === user.id);
      if (memberIndex < 0) return lifecycleError('Workspace nicht gefunden oder kein Zugriff.');
      if (memberships[memberIndex].role === 'owner') return lifecycleError('Owner können den Workspace nicht verlassen. Übertrage zuerst die Ownership.');
      const [removed] = memberships.splice(memberIndex, 1);
      for (const item of state.tasks) if (item.workspace_id === args.p_workspace_id && item.assigned_to === user.id) item.assigned_to = null;
      state.writes++;
      queueMicrotask(() => state.emit('workspace_members', 'DELETE', { new: null, old: structuredClone(removed) }));
      return { data: null, error: null };
    }
    if (name === 'delete_workspace') {
      const failed = await lifecycleCall(name, args);
      if (failed) return failed;
      const workspaceIndex = state.workspaces.findIndex(workspace => workspace.id === args.p_workspace_id);
      const target = state.workspaces[workspaceIndex];
      const member = currentMembership(args.p_workspace_id);
      if (!target || !member || target.owner_id !== user.id || member.role !== 'owner') return lifecycleError('Nur der Owner kann den Workspace löschen.');
      if (String(args.p_confirmation ?? '') !== target.name) return lifecycleError('Der Workspace-Name stimmt nicht überein.');
      const [removed] = state.workspaces.splice(workspaceIndex, 1);
      for (let index = memberships.length - 1; index >= 0; index--) if (memberships[index].workspace_id === removed.id) memberships.splice(index, 1);
      state.projects = state.projects.filter(project => project.workspace_id !== removed.id);
      state.tasks = state.tasks.filter(task => task.workspace_id !== removed.id);
      state.writes++;
      queueMicrotask(() => state.emit('workspaces', 'DELETE', { new: null, old: structuredClone(removed) }));
      return { data: null, error: null };
    }
    if (name === 'get_workspace_members') return {
      data: state.revoked ? [] : memberships.filter(m => m.workspace_id === args.p_workspace_id).map(m => ({
        ...m,
        full_name: m.full_name ?? 'Test Nutzer',
        username: m.username ?? null,
        avatar_url: m.avatar_url ?? null,
      })), error: null,
    };
    return { data: [], error: null };
  },
  channel(name) {
    const channel = {
      name, active: true, entries: [],
      on(type, filter, callback) { this.entries.push({ filter, callback }); return this; },
      subscribe(callback) { this.statusCallback = callback; queueMicrotask(() => { if (this.active) callback?.('SUBSCRIBED'); }); return this; },
    };
    state.channels.push(channel);
    return channel;
  },
  async removeChannel(channel) { if (channel) channel.active = false; },
};
