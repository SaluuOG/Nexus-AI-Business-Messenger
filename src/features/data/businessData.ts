import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { loadWorkspaceMembers, type NexusWorkspaceMember } from './nexusData';
import type { TaskStatus } from './projectTasks';
export { taskStatuses, type TaskStatus } from './projectTasks';

export const customerStatuses = ['lead', 'active', 'inactive'] as const;
export const projectStatuses = [
  'planning',
  'active',
  'review',
  'waiting_customer',
  'completed',
  'archived',
] as const;
export const projectPriorities = ['low', 'medium', 'high', 'urgent'] as const;

export type CustomerStatus = (typeof customerStatuses)[number];
export type ProjectStatus = (typeof projectStatuses)[number];
export type ProjectPriority = (typeof projectPriorities)[number];

export type NexusCustomer = {
  id: string;
  workspace_id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: CustomerStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type NexusProject = {
  id: string;
  workspace_id: string;
  customer_id: string | null;
  title: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  value_cents: number;
  currency: string;
  deadline: string | null;
  progress: number;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type NexusProjectTask = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  status: TaskStatus;
  priority: ProjectPriority;
  assigned_to: string | null;
  due_date: string | null;
  description: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerInput = Pick<NexusCustomer, 'name' | 'status'> &
  Partial<Pick<NexusCustomer, 'contact_name' | 'email' | 'phone' | 'website' | 'notes'>>;

export type ProjectInput = Pick<
  NexusProject,
  'title' | 'status' | 'priority' | 'value_cents' | 'deadline' | 'progress' | 'description'
> & {
  customer_id?: string | null;
};

export type ProjectTaskInput = Pick<
  NexusProjectTask,
  'project_id' | 'title' | 'status' | 'priority' | 'assigned_to' | 'due_date' | 'description'
>;

type DatabaseProject = Omit<NexusProject, 'value_cents' | 'progress'> & {
  value_cents: number | string;
  progress: number | string;
};

const customerColumns =
  'id, workspace_id, name, contact_name, email, phone, website, status, notes, created_by, created_at, updated_at';
const projectColumns =
  'id, workspace_id, customer_id, title, status, priority, value_cents, currency, deadline, progress, description, created_by, created_at, updated_at';
const taskColumns =
  'id, workspace_id, project_id, title, status, priority, assigned_to, due_date, description, completed_at, created_by, created_at, updated_at';

function nullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function normalizeProject(project: DatabaseProject): NexusProject {
  return {
    ...project,
    value_cents: Number(project.value_cents || 0),
    progress: Number(project.progress || 0),
  };
}

function publicBusinessError(message: string | undefined, fallback: string) {
  if (!message) return null;
  const normalized = message.toLowerCase();

  if (normalized.includes('row-level security') || normalized.includes('permission denied')) {
    return 'Deine Workspace-Rolle erlaubt diese Aktion nicht.';
  }
  if (normalized.includes('same workspace') || normalized.includes('selben workspace')) {
    return 'Die verknüpften Datensätze müssen zum selben Workspace gehören.';
  }
  if (normalized.includes('verantwortliche personen')) {
    return 'Die verantwortliche Person muss ein aktives Team-Mitglied mit Schreibrecht sein.';
  }
  if (normalized.includes('duplicate key')) {
    return 'Dieser Datensatz ist bereits vorhanden.';
  }

  return fallback;
}

export async function loadBusinessWorkspace(workspaceId: string) {
  if (!supabase) {
    return {
      customers: [] as NexusCustomer[],
      projects: [] as NexusProject[],
      tasks: [] as NexusProjectTask[],
      members: [] as NexusWorkspaceMember[],
      taskError: 'Supabase ist nicht konfiguriert.',
      error: 'Supabase ist nicht konfiguriert.',
    };
  }

  const [customerResult, projectResult, taskResult, memberResult] = await Promise.all([
    supabase
      .from('customers')
      .select(customerColumns)
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false }),
    loadWorkspaceProjects(workspaceId),
    loadProjectTasks(workspaceId),
    loadWorkspaceMembers(workspaceId),
  ]);

  return {
    customers: (customerResult.data ?? []) as NexusCustomer[],
    projects: ((projectResult.data ?? []) as DatabaseProject[]).map(normalizeProject).sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '') || a.id.localeCompare(b.id)),
    tasks: (taskResult.data ?? []) as NexusProjectTask[],
    members: memberResult.data,
    taskError: taskResult.error || (memberResult.error ? 'Das Team konnte nicht geladen werden. Bitte aktualisieren.' : null),
    error:
      publicBusinessError(customerResult.error?.message, 'Kunden konnten nicht geladen werden.') ||
      publicBusinessError(projectResult.error?.message, 'Projekte konnten nicht geladen werden.') ||
      null,
  };
}

async function loadWorkspaceProjects(workspaceId: string) {
  const projects: DatabaseProject[] = [];
  if (!supabase) return { data: projects, error: { message: 'Supabase ist nicht konfiguriert.' } };
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('projects').select(projectColumns)
      .eq('workspace_id', workspaceId).order('id').range(offset, offset + 499);
    if (error) return { data: [] as DatabaseProject[], error };
    projects.push(...(data ?? []) as DatabaseProject[]);
    if (!data || data.length < 500) return { data: projects, error: null };
  }
}

export async function loadTaskWorkspace(workspaceId: string) {
  const [projects, members] = await Promise.all([loadWorkspaceProjects(workspaceId), loadWorkspaceMembers(workspaceId)]);
  const error = projects.error || members.error;
  return {
    projects: error ? [] : projects.data.map(normalizeProject),
    members: error ? [] : members.data,
    error: error ? 'Projekte und Team konnten nicht geladen werden. Bitte erneut versuchen.' : null,
  };
}

export async function loadBriefingWorkspace(workspaceId: string, currentUserId: string) {
  const empty = { projects: [] as NexusProject[], tasks: [] as NexusProjectTask[] };
  if (!supabase) return { ...empty, error: 'Supabase ist nicht konfiguriert.' };
  const [projectResult, taskResult, memberResult] = await Promise.all([
    loadWorkspaceProjects(workspaceId), loadProjectTasks(workspaceId), loadWorkspaceMembers(workspaceId),
  ]);
  const error = publicBusinessError(projectResult.error?.message, 'Projekte konnten nicht geladen werden.') ||
    taskResult.error || (memberResult.error ? 'Dein Workspace-Zugriff konnte nicht geprüft werden.' : null);
  if (error) return { ...empty, error };
  if (!memberResult.data.some(member => member.user_id === currentUserId)) {
    return { ...empty, error: 'Du hast keinen Zugriff mehr auf diesen Workspace.' };
  }
  return { projects: projectResult.data.map(normalizeProject), tasks: taskResult.data, error: null };
}

async function loadProjectTasks(workspaceId: string) {
  const tasks: NexusProjectTask[] = [];
  if (!supabase) return { data: tasks, error: 'Supabase ist nicht konfiguriert.' };
  // Read every page so counters and filters never silently omit tasks at the API row limit.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('project_tasks').select(taskColumns)
      .eq('workspace_id', workspaceId).order('id').range(offset, offset + 499);
    if (error) return { data: [] as NexusProjectTask[], error: publicBusinessError(error.message, 'Aufgaben konnten nicht geladen werden.') };
    tasks.push(...(data ?? []) as NexusProjectTask[]);
    if (!data || data.length < 500) return { data: tasks, error: null };
  }
}

export async function createCustomer(workspaceId: string, input: CustomerInput) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase
    .from('customers')
    .insert({
      workspace_id: workspaceId,
      name: input.name.trim(),
      contact_name: nullableText(input.contact_name),
      email: nullableText(input.email),
      phone: nullableText(input.phone),
      website: nullableText(input.website),
      status: input.status,
      notes: nullableText(input.notes),
    })
    .select(customerColumns)
    .single();

  return {
    data: data as NexusCustomer | null,
    error: publicBusinessError(error?.message, 'Der Kunde konnte nicht angelegt werden.'),
  };
}

export async function updateCustomer(customerId: string, input: CustomerInput) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase
    .from('customers')
    .update({
      name: input.name.trim(),
      contact_name: nullableText(input.contact_name),
      email: nullableText(input.email),
      phone: nullableText(input.phone),
      website: nullableText(input.website),
      status: input.status,
      notes: nullableText(input.notes),
    })
    .eq('id', customerId)
    .select(customerColumns)
    .single();

  return {
    data: data as NexusCustomer | null,
    error: publicBusinessError(error?.message, 'Der Kunde konnte nicht gespeichert werden.'),
  };
}

export async function deleteCustomer(customerId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase
    .from('customers')
    .delete()
    .eq('id', customerId)
    .select('id')
    .maybeSingle();
  return {
    error:
      publicBusinessError(error?.message, 'Der Kunde konnte nicht gelöscht werden.') ||
      (!data ? 'Der Kunde wurde nicht gefunden oder darf nicht gelöscht werden.' : null),
  };
}

export async function createProject(workspaceId: string, input: ProjectInput) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase
    .from('projects')
    .insert({
      workspace_id: workspaceId,
      customer_id: input.customer_id || null,
      title: input.title.trim(),
      status: input.status,
      priority: input.priority,
      value_cents: Math.round(input.value_cents),
      currency: 'EUR',
      deadline: input.deadline || null,
      progress: Math.round(input.progress),
      description: nullableText(input.description),
    })
    .select(projectColumns)
    .single();

  return {
    data: data ? normalizeProject(data as DatabaseProject) : null,
    error: publicBusinessError(error?.message, 'Das Projekt konnte nicht angelegt werden.'),
  };
}

export async function updateProject(projectId: string, input: ProjectInput) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase
    .from('projects')
    .update({
      customer_id: input.customer_id || null,
      title: input.title.trim(),
      status: input.status,
      priority: input.priority,
      value_cents: Math.round(input.value_cents),
      deadline: input.deadline || null,
      progress: Math.round(input.progress),
      description: nullableText(input.description),
    })
    .eq('id', projectId)
    .select(projectColumns)
    .single();

  return {
    data: data ? normalizeProject(data as DatabaseProject) : null,
    error: publicBusinessError(error?.message, 'Das Projekt konnte nicht gespeichert werden.'),
  };
}

export async function deleteProject(projectId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)
    .select('id')
    .maybeSingle();
  return {
    error:
      publicBusinessError(error?.message, 'Das Projekt konnte nicht gelöscht werden.') ||
      (!data ? 'Das Projekt wurde nicht gefunden oder darf nicht gelöscht werden.' : null),
  };
}

export async function createProjectTask(workspaceId: string, input: ProjectTaskInput) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase
    .from('project_tasks')
    .insert({
      workspace_id: workspaceId,
      project_id: input.project_id,
      title: input.title.trim(),
      status: input.status,
      priority: input.priority,
      assigned_to: input.assigned_to || null,
      due_date: input.due_date || null,
      description: nullableText(input.description),
    })
    .select(taskColumns)
    .single();

  return {
    data: data as NexusProjectTask | null,
    error: publicBusinessError(error?.message, 'Die Aufgabe konnte nicht angelegt werden.'),
  };
}

export async function updateProjectTask(workspaceId: string, taskId: string, input: ProjectTaskInput, expectedUpdatedAt: string) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase
    .from('project_tasks')
    .update({
      project_id: input.project_id,
      title: input.title.trim(),
      status: input.status,
      priority: input.priority,
      assigned_to: input.assigned_to || null,
      due_date: input.due_date || null,
      description: nullableText(input.description),
    })
    .eq('id', taskId)
    .eq('workspace_id', workspaceId)
    .eq('updated_at', expectedUpdatedAt)
    .select(taskColumns)
    .maybeSingle();

  return {
    data: data as NexusProjectTask | null,
    error: publicBusinessError(error?.message, 'Die Aufgabe konnte nicht gespeichert werden.') || (!data ? taskConflictError : null),
  };
}

const taskConflictError = 'Die Aufgabe wurde inzwischen geändert oder entfernt, oder deine Berechtigung fehlt. Bitte aktualisiere und öffne sie erneut.';

export async function updateProjectTaskStatus(workspaceId: string, task: NexusProjectTask, status: TaskStatus) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.from('project_tasks').update({ status })
    .eq('id', task.id).eq('workspace_id', workspaceId).eq('updated_at', task.updated_at)
    .select('id').maybeSingle();
  return { error: publicBusinessError(error?.message, 'Der Aufgabenstatus konnte nicht gespeichert werden.') || (!data ? taskConflictError : null) };
}

export async function deleteProjectTask(workspaceId: string, task: NexusProjectTask) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase
    .from('project_tasks')
    .delete()
    .eq('id', task.id)
    .eq('workspace_id', workspaceId)
    .eq('updated_at', task.updated_at)
    .select('id')
    .maybeSingle();

  return {
    error:
      publicBusinessError(error?.message, 'Die Aufgabe konnte nicht gelöscht werden.') ||
      (!data ? taskConflictError : null),
  };
}

export type BusinessConnection = 'connecting' | 'connected' | 'disconnected';

export function subscribeToBusinessWorkspace(workspaceId: string, onChanged: () => void, onConnection?: (state: BusinessConnection) => void) {
  if (!supabase) return null;

  onConnection?.('connecting');
  const channel = supabase.channel(`business-workspace:${workspaceId}:${crypto.randomUUID()}`);
  for (const table of ['customers', 'projects', 'project_tasks', 'workspace_members']) {
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter: `workspace_id=eq.${workspaceId}` }, onChanged)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: `workspace_id=eq.${workspaceId}` }, onChanged)
      // DELETE payloads carry primary keys only under RLS. Refetch through the
      // authorized API; never depend on an unavailable workspace_id filter.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, onChanged);
  }
  return channel.subscribe(status => {
    if (status === 'SUBSCRIBED') { onConnection?.('connected'); onChanged(); }
    else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) onConnection?.('disconnected');
  });
}

export async function unsubscribeBusinessWorkspace(channel: RealtimeChannel | null) {
  if (!supabase || !channel) return;
  await supabase.removeChannel(channel);
}
