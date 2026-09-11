import { supabase } from '../../lib/supabase';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

export type NexusProfile = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
};

export type NexusBusinessProfile = {
  id: string;
  owner_id: string;
  name: string;
  handle: string | null;
  avatar_url: string | null;
  description: string | null;
};

export type NexusWorkspace = {
  id: string;
  owner_id: string;
  name: string;
  slug: string | null;
  avatar_url: string | null;
};

export type NexusWorkspaceMembership = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  joined_at: string;
};

export async function loadOwnProfile(userId: string) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url, bio')
    .eq('id', userId)
    .maybeSingle();

  return { data: data as NexusProfile | null, error: error?.message ?? null };
}

export async function updateOwnProfile(
  userId: string,
  patch: Partial<Pick<NexusProfile, 'full_name' | 'username' | 'avatar_url' | 'bio'>>,
) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('id, full_name, username, avatar_url, bio')
    .single();

  return { data: data as NexusProfile | null, error: error?.message ?? null };
}

export async function loadBusinessProfiles() {
  if (!supabase) return { data: [], error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase
    .from('business_profiles')
    .select('id, owner_id, name, handle, avatar_url, description')
    .order('created_at', { ascending: true });

  return { data: (data ?? []) as NexusBusinessProfile[], error: error?.message ?? null };
}

export async function loadWorkspaces() {
  if (!supabase) return { data: [], error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase
    .from('workspaces')
    .select('id, owner_id, name, slug, avatar_url')
    .order('created_at', { ascending: true });

  return { data: (data ?? []) as NexusWorkspace[], error: error?.message ?? null };
}

export async function createWorkspace(name: string, ownerId: string) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const slugBase = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const slug = `${slugBase || 'workspace'}-${crypto.randomUUID().slice(0, 8)}`;

  const { data, error } = await supabase
    .from('workspaces')
    .insert({ name: name.trim(), owner_id: ownerId, slug })
    .select('id, owner_id, name, slug, avatar_url')
    .single();

  return { data: data as NexusWorkspace | null, error: error?.message ?? null };
}
