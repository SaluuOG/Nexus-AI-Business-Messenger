// Synthetic browser service only. Database permissions are independently tested
// against real Postgres in tests/sql/task-collaboration-rls.sql.
export function createCollaborationService(state, getUser) {
  const tables = ['task_comments', 'task_checklist_items', 'task_activity', 'task_attachments'];
  const saved = JSON.parse(sessionStorage.getItem('nexusTest.collaboration') || '{}');
  state.collaboration = Object.fromEntries(tables.map(table => [table, saved[table] ?? []]));
  state.collaborationWrites = 0;
  state.collaborationDelay = 0;
  state.collaborationWriteDelay = 0;
  state.collaborationPending = 0;
  state.loseCollaborationResponse = false;
  state.mentionNotifications = [];
  const persist = () => sessionStorage.setItem('nexusTest.collaboration', JSON.stringify(state.collaboration));
  const role = workspaceId => state.revoked ? undefined : state.memberships.find(m => m.user_id === getUser().id && m.workspace_id === workspaceId)?.role;
  const canWrite = workspaceId => ['owner', 'admin', 'member'].includes(role(workspaceId));
  const record = (row, event, fields = []) => {
    state.collaboration.task_activity.push({ id: crypto.randomUUID(), workspace_id: row.workspace_id, task_id: row.task_id ?? row.id,
      actor_id: getUser().id, event_type: event, changed_fields: fields, created_at: new Date().toISOString() });
    persist();
    queueMicrotask(() => state.emit('task_activity', 'INSERT'));
  };
  state.persistCollaboration = persist;
  return {
    tables,
    taskChanged(before, after) {
      const fields = ['title','description','status','priority','assigned_to','due_date','project_id'].filter(key => before[key] !== after[key]);
      if (fields.length) record(after, 'task_updated', fields);
    },
    from(table) {
      const q = { operation: 'select', filters: [], orders: [], single: false };
      return {
        select() { return this; },
        eq(key,value) { q.filters.push([key,value]); return this; },
        gt(key,value) { q.gt = [key,value]; return this; },
        or(value) { q.or = value; return this; },
        order(key,options) { q.orders.push([key,options?.ascending !== false]); return this; },
        limit(value) { q.limit = value; return this; },
        abortSignal() { return this; }, // Deliberately allow late replies to test UI generation guards.
        maybeSingle() { q.single = true; return this; },
        single() { q.single = true; return this; },
        insert(value) { q.operation = 'insert'; q.value = value; return this; },
        update(value) { q.operation = 'update'; q.value = value; return this; },
        delete() { q.operation = 'delete'; return this; },
        async then(resolve,reject) {
          state.collaborationPending++;
          try {
            if (state.failure === table) return resolve({data:null,error:{message:'Test offline'}});
            let rows = state.collaboration[table].filter(row => role(row.workspace_id)
              && state.tasks.some(t => t.id === row.task_id && t.workspace_id === row.workspace_id)
              && q.filters.every(([key,value]) => row[key] === value));
            if (q.operation === 'insert') {
              if (!canWrite(q.value.workspace_id)) return resolve({data:null,error:{code:'42501'}});
              if (!state.tasks.some(t => t.id === q.value.task_id && t.workspace_id === q.value.workspace_id)) return resolve({data:null,error:{code:'23503'}});
              if (state.collaboration[table].some(row => row.id === q.value.id)) return resolve({data:null,error:{code:'23505'}});
              const mentionIds = table === 'task_comments' ? [...new Set(q.value.mentioned_user_ids ?? [])].sort() : [];
              if (table === 'task_comments' && (mentionIds.length > 20 || mentionIds.includes(getUser().id) || mentionIds.some(id => !state.memberships.some(member => member.workspace_id === q.value.workspace_id && member.user_id === id)))) {
                return resolve({data:null,error:{code:'42501'}});
              }
              const row = {...q.value,...(table === 'task_comments' ? {mentioned_user_ids:mentionIds} : {}),created_by:getUser().id,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),revision:1};
              if (table === 'task_checklist_items') row.is_completed = false;
              state.collaboration[table].push(row); rows = [row];
              if (table === 'task_comments') state.mentionNotifications.push(...mentionIds.map(user_id => ({user_id,comment_id:row.id})));
              record(row, table === 'task_comments' ? 'comment_created' : 'checklist_added');
            } else if (q.operation !== 'select') {
              rows = rows.filter(row => canWrite(row.workspace_id) && (table !== 'task_comments' || row.created_by === getUser().id || q.operation === 'delete' && ['owner','admin'].includes(role(row.workspace_id))));
              for (const row of rows) {
                if (q.operation === 'delete') {
                  state.collaboration[table] = state.collaboration[table].filter(r => r.id !== row.id);
                  if (table === 'task_comments') state.collaboration.task_attachments = state.collaboration.task_attachments.filter(f => f.comment_id !== row.id);
                  record(row, table === 'task_comments' ? 'comment_deleted' : 'checklist_deleted');
                } else {
                  const changed = Object.keys(q.value).filter(key => row[key] !== q.value[key]);
                  if (changed.length) {
                    Object.assign(row,q.value,{revision:row.revision+1,updated_at:new Date().toISOString()});
                    record(row,table === 'task_comments' ? 'comment_updated' : 'checklist_updated',table === 'task_comments' ? [] : changed);
                  }
                }
              }
            }
            if (q.operation !== 'select') {
              state.collaborationWrites += rows.length;
              persist();
              queueMicrotask(() => state.emit(table,q.operation === 'insert' ? 'INSERT' : q.operation === 'delete' ? 'DELETE' : 'UPDATE'));
            }
            if (q.gt) rows = rows.filter(row => row[q.gt[0]] > q.gt[1]);
            if (q.or) {
              const match = /^created_at.lt.(.*),and\(created_at.eq.(.*),id.lt.(.*)\)$/.exec(q.or);
              rows = rows.filter(row => row.created_at < match[1] || row.created_at === match[2] && row.id < match[3]);
            }
            rows = [...rows].sort((a,b) => {
              for (const [key,ascending] of q.orders) { const cmp = String(a[key]).localeCompare(String(b[key])); if (cmp) return ascending ? cmp : -cmp; }
              return 0;
            });
            if (q.limit) rows = rows.slice(0,q.limit);
            const result = structuredClone({data:q.single ? rows[0] ?? null : rows,error:null});
            const delay = q.operation === 'select' ? state.collaborationDelay : state.collaborationWriteDelay;
            if (delay) await new Promise(r => setTimeout(r,delay));
            if (q.operation === 'insert' && state.loseCollaborationResponse) {
              state.loseCollaborationResponse = false;
              return resolve({data:null,error:{message:'Response lost after commit'}});
            }
            resolve(result);
          } catch(error) { reject(error); }
          finally { state.collaborationPending--; }
        },
      };
    },
  };
}
