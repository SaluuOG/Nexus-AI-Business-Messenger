import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

export type TaskComment = {
  id: string; workspace_id: string; task_id: string; body: string;
  created_by: string | null; created_at: string; updated_at: string; revision: number;
};
export type TaskChecklistItem = {
  id: string; workspace_id: string; task_id: string; label: string; is_completed: boolean;
  created_by: string | null; created_at: string; updated_at: string; revision: number;
};
export type TaskActivity = {
  id: string; workspace_id: string; task_id: string; actor_id: string | null;
  event_type: string; changed_fields: string[]; created_at: string;
};
export type TaskCollaboration = {
  comments: TaskComment[]; checklist: TaskChecklistItem[]; activity: TaskActivity[];
  moreComments: boolean; moreActivity: boolean;
};
export const emptyTaskCollaboration: TaskCollaboration = {
  comments: [], checklist: [], activity: [], moreComments: false, moreActivity: false,
};
export const collaborationPageSize = 40;
const commentColumns = 'id,workspace_id,task_id,body,created_by,created_at,updated_at,revision';
const checklistColumns = 'id,workspace_id,task_id,label,is_completed,created_by,created_at,updated_at,revision';
const activityColumns = 'id,workspace_id,task_id,actor_id,event_type,changed_fields,created_at';
const unavailable = 'Die Aufgabe ist nicht mehr verfügbar oder dein Zugriff wurde entzogen.';
const conflict = 'Der Eintrag wurde inzwischen geändert oder entfernt, oder deine Berechtigung fehlt. Bitte prüfe den aktuellen Stand.';

function publicError(error: { code?: string } | null | undefined, fallback: string) {
  if (!error) return null;
  if (error.code === '42501') return 'Deine aktuelle Rolle erlaubt diese Aktion nicht.';
  if (error.code === '23503') return unavailable;
  if (error.code === '23514') return 'Bitte prüfe die Länge und den Inhalt deiner Eingabe.';
  return fallback;
}

// Reload the whole visible window through stable cursors. Offset pagination can
// skip records when another teammate inserts or deletes a comment between pages.
async function readStream<T extends { id: string; created_at: string }>(
  table: string, columns: string, workspaceId: string, taskId: string, count: number, signal?: AbortSignal,
) {
  const rows: T[] = [];
  let cursor: T | undefined;
  const target = Math.max(collaborationPageSize, count);
  while (rows.length <= target) {
    let query = supabase!.from(table).select(columns).eq('workspace_id', workspaceId).eq('task_id', taskId)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(Math.min(collaborationPageSize, target + 1 - rows.length));
    if (cursor) {
      if (!/^[a-zA-Z0-9-]+$/.test(cursor.id) || !/^[\dT:.+Z-]+$/.test(cursor.created_at)) throw new Error('Invalid cursor');
      query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    }
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as unknown as T[];
    const requested = Math.min(collaborationPageSize, target + 1 - rows.length);
    rows.push(...page);
    if (page.length < requested) break;
    cursor = page.at(-1);
  }
  return { rows: rows.slice(0, target), more: rows.length > target };
}

async function readChecklist(workspaceId: string, taskId: string, signal?: AbortSignal) {
  const rows: TaskChecklistItem[] = [];
  let cursor: string | undefined;
  for (;;) {
    let query = supabase!.from('task_checklist_items').select(checklistColumns)
      .eq('workspace_id', workspaceId).eq('task_id', taskId).order('id').limit(200);
    if (cursor) query = query.gt('id', cursor);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as TaskChecklistItem[];
    rows.push(...page);
    if (page.length < 200) break;
    cursor = page.at(-1)!.id;
  }
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export async function loadTaskCollaboration(workspaceId: string, taskId: string,
  counts = { comments: collaborationPageSize, activity: collaborationPageSize }, signal?: AbortSignal,
): Promise<{ data: TaskCollaboration; error: string | null }> {
  if (!supabase) return { data: emptyTaskCollaboration, error: 'Supabase ist nicht konfiguriert.' };
  try {
    let taskQuery = supabase.from('project_tasks').select('id').eq('workspace_id', workspaceId).eq('id', taskId);
    if (signal) taskQuery = taskQuery.abortSignal(signal);
    const [task, comments, checklist, activity] = await Promise.all([
      taskQuery.maybeSingle(),
      readStream<TaskComment>('task_comments', commentColumns, workspaceId, taskId, counts.comments, signal),
      readChecklist(workspaceId, taskId, signal),
      readStream<TaskActivity>('task_activity', activityColumns, workspaceId, taskId, counts.activity, signal),
    ]);
    if (task.error) throw task.error;
    if (!task.data) return { data: emptyTaskCollaboration, error: unavailable };
    return { data: { comments: comments.rows, checklist, activity: activity.rows, moreComments: comments.more, moreActivity: activity.more }, error: null };
  } catch {
    // Clear previously visible records after every failed permission/network check.
    return { data: emptyTaskCollaboration, error: 'Die Zusammenarbeit konnte nicht geladen werden. Bitte erneut versuchen.' };
  }
}

async function createEntry(table: 'task_comments' | 'task_checklist_items', workspaceId: string, taskId: string,
  userId: string, id: string, text: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const field = table === 'task_comments' ? 'body' : 'label';
  const value = text.trim();
  if (!value || value.length > (field === 'body' ? 4000 : 240)) return { error: 'Bitte prüfe die Länge und den Inhalt deiner Eingabe.' };
  const { data, error } = await supabase.from(table).insert({ id, workspace_id: workspaceId, task_id: taskId, [field]: value }).select('id').maybeSingle();
  if (error?.code === '23505') {
    // A lost response may be retried with the same intent ID. Never overwrite an
    // existing row or accept an ID belonging to another task, author or input.
    const existing = await supabase.from(table).select(`id,${field},created_by`)
      .eq('id', id).eq('workspace_id', workspaceId).eq('task_id', taskId).maybeSingle();
    if (!existing.error && existing.data && existing.data.created_by === userId && (existing.data as unknown as Record<string, unknown>)[field] === value) return { error: null };
  }
  return { error: publicError(error, 'Speichern fehlgeschlagen. Bitte erneut versuchen.') || (!data ? conflict : null) };
}

export const addTaskComment = (workspaceId: string, taskId: string, userId: string, id: string, body: string) =>
  createEntry('task_comments', workspaceId, taskId, userId, id, body);
export const addChecklistItem = (workspaceId: string, taskId: string, userId: string, id: string, label: string) =>
  createEntry('task_checklist_items', workspaceId, taskId, userId, id, label);

export async function changeTaskEntry(table: 'task_comments' | 'task_checklist_items', workspaceId: string, taskId: string,
  entry: { id: string; revision: number }, change: { body?: string; label?: string; is_completed?: boolean } | 'delete') {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const values = table === 'task_comments' ? { body: change !== 'delete' ? change.body?.trim() : undefined }
    : change !== 'delete' && change.label !== undefined ? { label: change.label.trim() } : { is_completed: change !== 'delete' ? change.is_completed : undefined };
  const query = change === 'delete' ? supabase.from(table).delete() : supabase.from(table).update(values);
  const { data, error } = await query.eq('workspace_id', workspaceId).eq('task_id', taskId).eq('id', entry.id).eq('revision', entry.revision).select('id').maybeSingle();
  return { error: publicError(error, 'Die Änderung konnte nicht gespeichert werden.') || (!data ? conflict : null) };
}

export function subscribeTaskCollaboration(workspaceId: string, taskId: string, onChange: () => void) {
  if (!supabase) return null;
  const channel = supabase.channel(`task-collaboration:${taskId}:${crypto.randomUUID()}`);
  for (const table of ['task_comments', 'task_checklist_items', 'task_activity', 'project_tasks', 'workspace_members']) {
    const filter = table === 'workspace_members' ? `workspace_id=eq.${workspaceId}` : table === 'project_tasks' ? `id=eq.${taskId}` : `task_id=eq.${taskId}`;
    channel.on('postgres_changes', { schema: 'public', table, event: 'INSERT', filter }, onChange)
      .on('postgres_changes', { schema: 'public', table, event: 'UPDATE', filter }, onChange)
      .on('postgres_changes', { schema: 'public', table, event: 'DELETE' }, onChange);
  }
  return channel.subscribe(status => { if (status === 'SUBSCRIBED') onChange(); });
}
export async function unsubscribeTaskCollaboration(channel: RealtimeChannel | null) {
  if (supabase && channel) await supabase.removeChannel(channel);
}

const eventLabels: Record<string, string> = {
  task_created: 'Aufgabe angelegt', task_updated: 'Aufgabe geändert',
  comment_created: 'Kommentar hinzugefügt', comment_updated: 'Kommentar bearbeitet', comment_deleted: 'Kommentar entfernt',
  checklist_added: 'Checklistenpunkt hinzugefügt', checklist_updated: 'Checklistenpunkt geändert', checklist_deleted: 'Checklistenpunkt entfernt',
};
const fieldLabels: Record<string, string> = {
  title: 'Titel', description: 'Beschreibung', status: 'Status', priority: 'Priorität', assigned_to: 'Zuständigkeit',
  due_date: 'Deadline', project_id: 'Projekt', label: 'Text', is_completed: 'Erledigt-Status',
};
export function taskActivityLabel(activity: Pick<TaskActivity, 'event_type' | 'changed_fields'>) {
  const details = activity.changed_fields.map(field => fieldLabels[field]).filter(Boolean);
  return (eventLabels[activity.event_type] ?? 'Aufgabe aktualisiert') + (details.length ? ` · ${details.join(', ')}` : '');
}
