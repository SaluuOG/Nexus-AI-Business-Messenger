import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

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

export type CustomerInput = Pick<NexusCustomer, 'name' | 'status'> &
  Partial<Pick<NexusCustomer, 'contact_name' | 'email' | 'phone' | 'website' | 'notes'>>;

export type ProjectInput = Pick<
  NexusProject,
  'title' | 'status' | 'priority' | 'value_cents' | 'deadline' | 'progress' | 'description'
> & {
  customer_id?: string | null;
};

type DatabaseProject = Omit<NexusProject, 'value_cents' | 'progress'> & {
  value_cents: number | string;
  progress: number | string;
};

const customerColumns =
  'id, workspace_id, name, contact_name, email, phone, website, status, notes, created_by, created_at, updated_at';
const projectColumns =
  'id, workspace_id, customer_id, title, status, priority, value_cents, currency, deadline, progress, description, created_by, created_at, updated_at';

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
    return 'Kunde und Projekt müssen zum selben Workspace gehören.';
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
      error: 'Supabase ist nicht konfiguriert.',
    };
  }

  const [customerResult, projectResult] = await Promise.all([
    supabase
      .from('customers')
      .select(customerColumns)
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false }),
    supabase
      .from('projects')
      .select(projectColumns)
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false }),
  ]);

  return {
    customers: (customerResult.data ?? []) as NexusCustomer[],
    projects: ((projectResult.data ?? []) as DatabaseProject[]).map(normalizeProject),
    error:
      publicBusinessError(customerResult.error?.message, 'Kunden konnten nicht geladen werden.') ||
      publicBusinessError(projectResult.error?.message, 'Projekte konnten nicht geladen werden.') ||
      null,
  };
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

export function subscribeToBusinessWorkspace(workspaceId: string, onChanged: () => void) {
  if (!supabase) return null;

  return supabase
    .channel(`business-workspace:${workspaceId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'customers', filter: `workspace_id=eq.${workspaceId}` },
      onChanged,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'projects', filter: `workspace_id=eq.${workspaceId}` },
      onChanged,
    )
    .subscribe();
}

export async function unsubscribeBusinessWorkspace(channel: RealtimeChannel | null) {
  if (!supabase || !channel) return;
  await supabase.removeChannel(channel);
}
