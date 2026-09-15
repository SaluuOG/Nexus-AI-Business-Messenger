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

export type NexusWorkspaceMember = {
  user_id: string;
  role: WorkspaceRole;
  joined_at: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

export type NexusWorkspaceInvitation = {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
};

export type AcceptedWorkspaceInvitation = {
  workspace_id: string;
  workspace_name: string;
  role: WorkspaceRole;
};

function firstRpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  if (data && typeof data === 'object') return data as T;
  return null;
}

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

  // Do not chain .select() to this INSERT. The workspace SELECT policy requires
  // membership, while the owner membership is created by the AFTER INSERT trigger.
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

export async function renameWorkspace(workspaceId: string, name: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };

  const { error } = await supabase.rpc('rename_workspace', {
    p_workspace_id: workspaceId,
    p_name: name.trim(),
  });

  return { error: error?.message ?? null };
}

export async function transferWorkspaceOwnership(workspaceId: string, newOwnerId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };

  const { error } = await supabase.rpc('transfer_workspace_ownership', {
    p_workspace_id: workspaceId,
    p_new_owner_id: newOwnerId,
  });

  return { error: error?.message ?? null };
}

export async function leaveWorkspace(workspaceId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };

  const { error } = await supabase.rpc('leave_workspace', {
    p_workspace_id: workspaceId,
  });

  return { error: error?.message ?? null };
}

export async function deleteWorkspace(workspaceId: string, confirmation: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };

  const { error } = await supabase.rpc('delete_workspace', {
    p_workspace_id: workspaceId,
    p_confirmation: confirmation,
  });

  return { error: error?.message ?? null };
}

export async function loadWorkspaceMembers(workspaceId: string) {
  if (!supabase) return { data: [], error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase.rpc('get_workspace_members', {
    p_workspace_id: workspaceId,
  });

  return {
    data: (data ?? []) as NexusWorkspaceMember[],
    error: error?.message ?? null,
  };
}

export async function loadWorkspaceInvitations(workspaceId: string) {
  if (!supabase) return { data: [], error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase.rpc('get_workspace_invitations', {
    p_workspace_id: workspaceId,
  });

  return {
    data: (data ?? []) as NexusWorkspaceInvitation[],
    error: error?.message ?? null,
  };
}

export async function createWorkspaceInvitation(
  workspaceId: string,
  email: string,
  role: Exclude<WorkspaceRole, 'owner'>,
) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase.rpc('create_workspace_invitation', {
    p_workspace_id: workspaceId,
    p_email: email.trim(),
    p_role: role,
  });

  return {
    data: firstRpcRow<NexusWorkspaceInvitation>(data),
    error: error?.message ?? null,
  };
}

export async function acceptWorkspaceInvitation(token: string) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase.rpc('accept_workspace_invitation', {
    p_token: token,
  });

  return {
    data: firstRpcRow<AcceptedWorkspaceInvitation>(data),
    error: error?.message ?? null,
  };
}

export async function revokeWorkspaceInvitation(invitationId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };

  const { error } = await supabase.rpc('revoke_workspace_invitation', {
    p_invitation_id: invitationId,
  });

  return { error: error?.message ?? null };
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  role: Exclude<WorkspaceRole, 'owner'>,
) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };

  const { error } = await supabase.rpc('update_workspace_member_role', {
    p_workspace_id: workspaceId,
    p_user_id: userId,
    p_role: role,
  });

  return { error: error?.message ?? null };
}

export async function removeWorkspaceMember(workspaceId: string, userId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };

  const { error } = await supabase.rpc('remove_workspace_member', {
    p_workspace_id: workspaceId,
    p_user_id: userId,
  });

  return { error: error?.message ?? null };
}
