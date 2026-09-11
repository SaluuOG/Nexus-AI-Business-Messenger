import { supabase } from '../../lib/supabase';

export type NexusContact = {
  contact_user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  connected_at: string;
};

export type NexusContactRequest = {
  request_id: string;
  direction: 'incoming' | 'outgoing';
  other_user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  created_at: string;
};

export type NexusUserSearchResult = {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  relationship: 'none' | 'contact' | 'incoming' | 'outgoing';
};

function firstRpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  if (data && typeof data === 'object') return data as T;
  return null;
}

export async function loadNexusContacts() {
  if (!supabase) return { data: [] as NexusContact[], error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase.rpc('get_my_contacts');
  return {
    data: (data ?? []) as NexusContact[],
    error: error?.message ?? null,
  };
}

export async function loadContactRequests() {
  if (!supabase) {
    return { data: [] as NexusContactRequest[], error: 'Supabase ist nicht konfiguriert.' };
  }

  const { data, error } = await supabase.rpc('get_my_contact_requests');
  return {
    data: (data ?? []) as NexusContactRequest[],
    error: error?.message ?? null,
  };
}

export async function searchNexusUser(username: string) {
  if (!supabase) return { data: null, error: 'Supabase ist nicht konfiguriert.' };

  const { data, error } = await supabase.rpc('search_nexus_user', {
    p_username: username.trim(),
  });

  return {
    data: firstRpcRow<NexusUserSearchResult>(data),
    error: error?.message ?? null,
  };
}

export async function sendContactRequest(userId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };

  const { error } = await supabase.rpc('send_contact_request', {
    p_user_id: userId,
  });

  return { error: error?.message ?? null };
}

export async function respondContactRequest(requestId: string, accept: boolean) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };

  const { error } = await supabase.rpc('respond_contact_request', {
    p_request_id: requestId,
    p_accept: accept,
  });

  return { error: error?.message ?? null };
}

export async function cancelContactRequest(requestId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };

  const { error } = await supabase.rpc('cancel_contact_request', {
    p_request_id: requestId,
  });

  return { error: error?.message ?? null };
}

export async function removeNexusContact(userId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };

  const { error } = await supabase.rpc('remove_contact', {
    p_user_id: userId,
  });

  return { error: error?.message ?? null };
}
