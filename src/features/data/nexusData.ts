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

export async function createBusinessProfile(name: string, ownerId: string, handle?: string) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const normalizedHandle = handle
    ?.trim()
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');

  const { data, error } = await supabase
    .from('business_profiles')
    .insert({
      owner_id: ownerId,
      name: name.trim(),
      handle: normalizedHandle || null,
    })
    .select('id, owner_id, name, handle, avatar_url, description')
    .single();

  return { data: data as NexusBusinessProfile | null, error: error?.message ?? null };
}

export async function loadWorkspaces() {
  if (!supabase) return { data: [], error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase
    .from('workspaces')
    .select('id, owner_id, name, slug, avatar_url')
    .order('created_at', { ascending: true });

  return { data: (data ?? []) as NexusWorkspace[], error: error?.message ?? null };
}

export async function loadWorkspaceMemberships(userId: string) {
  if (!supabase) return { data: [], error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, user_id, role, joined_at')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true });

  return {
    data: (data ?? []) as NexusWorkspaceMembership[],
    error: error?.message ?? null,
  };
}

export async function createWorkspace(name: string, ownerId: string) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const workspaceId = crypto.randomUUID();
  const normalizedName = name.trim();
  const slugBase = normalizedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const slug = `${slugBase || 'workspace'}-${crypto.randomUUID().slice(0, 8)}`;

  // Important: do not chain .select() to this INSERT. The workspace SELECT
  // policy requires membership, while the owner membership is created by the
  // AFTER INSERT trigger. Asking PostgREST to return the row can therefore
  // evaluate the SELECT policy before the membership is visible and reject an
  // otherwise valid owner insert. Generate the UUID client-side, insert only,
  // then use the known values locally; subsequent reads are protected by RLS.
  const { error } = await supabase.from('workspaces').insert({
    id: workspaceId,
    name: normalizedName,
    owner_id: ownerId,
    slug,
  });

  if (error) {
    return { data: null, error: error.message };
  }

  const workspace: NexusWorkspace = {
    id: workspaceId,
    owner_id: ownerId,
    name: normalizedName,
    slug,
    avatar_url: null,
  };

  return { data: workspace, error: null };
}
