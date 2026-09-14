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
};
const memberships = [
  { workspace_id: 'w1', user_id: 'me', role: 'member' },
  { workspace_id: 'w2', user_id: 'me', role: 'guest' },
];
const user = { id: 'me', email: 'nexus-test@example.invalid', user_metadata: { full_name: 'Test Nutzer' } };
export const backendConfigured = true;
export const supabaseConfig = { url: 'https://example.invalid', publishableKey: 'test-only' };
export const initialAuthCallback = { isRecovery: false, hasError: false, hasPkceCode: false, marker: null };

state.emit = (table = 'project_tasks', event = 'UPDATE') => {
  for (const channel of state.channels.filter(c => c.active)) {
    for (const entry of channel.entries) if (entry.filter.table === table && entry.filter.event === event) entry.callback({});
  }
};
state.connection = status => {
  for (const channel of state.channels.filter(c => c.active)) channel.statusCallback?.(status);
};
window.nexusTest = state;

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { user } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
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
            : table === 'workspaces' ? [{ id: 'w1', name: 'Erstes Team' }, { id: 'w2', name: 'Zweites Team' }]
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
