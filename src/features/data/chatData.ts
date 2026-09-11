import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

export type DirectConversation = {
  conversation_id: string;
  contact_user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
};

export type DirectMessage = {
  message_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export async function openDirectConversation(contactUserId: string) {
  if (!supabase) return { data: null as string | null, error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('open_direct_conversation', {
    p_contact_user_id: contactUserId,
  });
  return { data: (data as string | null) ?? null, error: error?.message ?? null };
}

export async function loadDirectConversations() {
  if (!supabase) return { data: [] as DirectConversation[], error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('get_direct_conversations');
  return {
    data: ((data ?? []) as Array<Omit<DirectConversation, 'unread_count'> & { unread_count: number | string }>).map((item) => ({
      ...item,
      unread_count: Number(item.unread_count || 0),
    })),
    error: error?.message ?? null,
  };
}

export async function loadDirectMessages(conversationId: string) {
  if (!supabase) return { data: [] as DirectMessage[], error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('get_direct_messages', {
    p_conversation_id: conversationId,
    p_limit: 200,
  });
  return { data: (data ?? []) as DirectMessage[], error: error?.message ?? null };
}

export async function sendDirectMessage(conversationId: string, body: string) {
  if (!supabase) return { data: null as string | null, error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('send_direct_message', {
    p_conversation_id: conversationId,
    p_body: body,
  });
  return { data: (data as string | null) ?? null, error: error?.message ?? null };
}

export async function markDirectConversationRead(conversationId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('mark_direct_conversation_read', {
    p_conversation_id: conversationId,
  });
  return { error: error?.message ?? null };
}

export function subscribeToDirectMessages(
  conversationId: string,
  onChange: () => void,
): RealtimeChannel | null {
  if (!supabase) return null;
  return supabase
    .channel(`direct-messages:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      () => onChange(),
    )
    .subscribe();
}

export async function unsubscribeDirectMessages(channel: RealtimeChannel | null) {
  if (!supabase || !channel) return;
  await supabase.removeChannel(channel);
}