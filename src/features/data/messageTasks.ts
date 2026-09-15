import { supabase } from '../../lib/supabase';
import type { NexusProjectTask, ProjectTaskInput } from './businessData';

export type MessageTaskOrigin = {
  kind: 'direct' | 'group';
  messageId: string;
  body: string;
  chatName: string;
  attachmentName?: string;
};
export type AccessibleTaskSource = { task_id: string; kind: MessageTaskOrigin['kind'] };
export type TaskMessageSource = {
  task_id: string; workspace_id: string; kind: MessageTaskOrigin['kind'];
  chat_id: string; message_id: string; body: string; created_at: string; edited_at: string | null;
};

export function messageTaskDraft(source: MessageTaskOrigin): ProjectTaskInput {
  const body = source.body.trim();
  return {
    title: Array.from(body.split('\n').find(line => line.trim())?.trim() || (source.attachmentName ? 'Anhang prüfen: ' + source.attachmentName : 'Nachricht bearbeiten')).slice(0, 180).join(''),
    description: body || null, project_id: '', status: 'todo', priority: 'medium', assigned_to: null, due_date: null,
  };
}

export async function createTaskFromMessage(workspaceId: string, source: MessageTaskOrigin, input: ProjectTaskInput, requestId: string) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('create_task_from_message', {
    p_request_id: requestId, p_workspace_id: workspaceId, p_project_id: input.project_id,
    p_kind: source.kind, p_message_id: source.messageId, p_title: input.title.trim(),
    p_description: input.description?.trim() || null, p_priority: input.priority,
    p_assigned_to: input.assigned_to || null, p_due_date: input.due_date || null,
  });
  return { data: (data ?? null) as NexusProjectTask | null, error: error?.message ?? null };
}

export async function loadAccessibleTaskSources(workspaceId: string) {
  const rows: AccessibleTaskSource[] = [];
  if (!supabase) return { data: rows, error: 'Supabase ist nicht konfiguriert.' };
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('project_task_sources').select('task_id, kind')
      .eq('workspace_id', workspaceId).order('task_id').range(offset, offset + 499);
    if (error) return { data: [] as AccessibleTaskSource[], error: 'Nachrichtenquellen konnten nicht geprüft werden.' };
    rows.push(...(data ?? []) as AccessibleTaskSource[]);
    if (!data || data.length < 500) return { data: rows, error: null };
  }
}

export async function loadTaskMessageSource(taskId: string) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('get_task_message_source', { p_task_id: taskId });
  return { data: (data ?? null) as TaskMessageSource | null, error: error ? 'Die Ursprungsnachricht konnte nicht geladen werden. Bitte erneut versuchen.' : null };
}
