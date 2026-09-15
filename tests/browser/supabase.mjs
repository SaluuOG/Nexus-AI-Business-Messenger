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
const state = {
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
  hideRecentSource: false, loseCreateResponse: false, createDelay: 0,
  resetRequests: [], passwordUpdates: [], authFailure: null, signOutCount: 0,
  notifications: JSON.parse(sessionStorage.getItem('nexusTest.notifications') || '[]'),
  notificationPreferences: JSON.parse(sessionStorage.getItem('nexusTest.notificationPreferences') || '{}'),
  notificationDelay: 0, notificationReadDelay: 0, notificationCalls: [],
  chatScanAvailable: true, chatScanCalls: [], chatScanAborts: [], chatScanFailure: null,
  chatScanDeferred: false, chatScanPending: [], chatScanResult: null,
  conversations: [{ conversation_id: 'c1', contact_user_id: 'other', full_name: 'Test Kontakt', username: 'test', unread_count: 0, last_message: 'Bitte das Angebot prüfen!' }],
  directMessages: [{ message_id: 'dm1', sender_id: 'other', body: 'Bitte das Angebot prüfen!\nDetails für das Team.', created_at: '2025-09-14T08:00:00Z', deleted_at: null, attachments: [] }],
  groupMessages: [{ message_id: 'gm1', group_id: 'g1', sender_id: 'other', sender_full_name: 'Team Kontakt', body: 'Startseite für den Kunden vorbereiten!', created_at: '2025-09-14T08:00:00Z', deleted_at: null, attachments: [] }],
};
state.projects.push(project('p5', 'Drittes Projekt', 'w3', null));
state.tasks.push(...JSON.parse(sessionStorage.getItem('nexusTest.created') || '[]'));
const memberships = [
  { workspace_id: 'w1', user_id: 'me', role: 'member' },
  { workspace_id: 'w2', user_id: 'me', role: 'guest' },
  { workspace_id: 'w3', user_id: 'me', role: 'admin' },
];
let user = { id: 'me', email: 'nexus-test@example.invalid', user_metadata: { full_name: 'Test Nutzer' } };
export const backendConfigured = true;
export const supabaseConfig = { url: 'https://example.invalid', publishableKey: 'test-only' };
export const initialAuthCallback = { isRecovery: false, hasError: false, hasPkceCode: false, marker: null };

state.emit = (table = 'project_tasks', event = 'UPDATE') => {
  for (const channel of state.channels.filter(c => c.active)) {
    for (const entry of channel.entries) if (entry.filter.table === table && (entry.filter.event === event || entry.filter.event === '*')) entry.callback({});
  }
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

export const supabase = {
  functions: {
    async invoke(name, { body, signal } = {}) {
      if (name !== 'chat-scan') throw new Error('Unexpected test function: ' + name);
      const call = { name, body: structuredClone(body), userId: user.id };
      state.chatScanCalls.push(call);
      signal?.addEventListener('abort', () => state.chatScanAborts.push(call), { once: true });
      const failure = state.chatScanFailure;
      const result = failure
        ? { data: null, error: { message: failure, context: new Response(JSON.stringify({ error: failure, code: failure }), { status: 503, headers: { 'content-type': 'application/json' } }) } }
        : { data: body.action === 'status'
          ? { available: state.chatScanAvailable, providerLabel: 'Test KI' }
          : structuredClone(state.chatScanResult ?? chatScanResult(body.kind, body.chatId)), error: null };
      // Ignore the AbortSignal here on purpose: even an uncooperative late
      // response must never repopulate a closed dialog or a different chat.
      if (state.chatScanDeferred) await new Promise(resolve => state.chatScanPending.push(resolve));
      return result;
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
            : table === 'workspaces' ? [{ id: 'w1', name: 'Erstes Team' }, { id: 'w2', name: 'Zweites Team' }, { id: 'w3', name: 'Drittes Team' }]
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
  async rpc(name, args) {
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
    if (name === 'get_direct_conversations') return { data: state.conversations, error: null };
    if (name === 'get_direct_messages') return { data: state.hideRecentSource ? [] : state.directMessages, error: null };
    if (name === 'get_my_group_chats') return { data: [{ group_id: 'g1', name: 'Projektgruppe', role: 'member', member_count: 2, unread_count: 0, last_message: 'Startseite vorbereiten' }], error: null };
    if (name === 'get_group_messages') return { data: state.hideRecentSource ? [] : state.groupMessages, error: null };
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
    if (name === 'get_workspace_members') return {
      data: state.revoked ? [] : memberships.filter(m => m.workspace_id === args.p_workspace_id).map(m => ({ ...m, full_name: 'Test Nutzer' })), error: null,
    };
    return { data: [], error: null };
  },
  channel() {
    const channel = {
      active: true, entries: [],
      on(type, filter, callback) { this.entries.push({ filter, callback }); return this; },
      subscribe(callback) { this.statusCallback = callback; queueMicrotask(() => { if (this.active) callback?.('SUBSCRIBED'); }); return this; },
    };
    state.channels.push(channel);
    return channel;
  },
  async removeChannel(channel) { if (channel) channel.active = false; },
};
