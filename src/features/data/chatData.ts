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
  reply_to_message_id: string | null;
  reply_sender_id: string | null;
  reply_body: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  read_at: string | null;
};

export type ContactPresence = {
  contact_user_id: string;
  last_seen_at: string | null;
  online: boolean;
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

export async function sendDirectMessage(conversationId: string, body: string, replyToMessageId?: string | null) {
  if (!supabase) return { data: null as string | null, error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('send_direct_message_v2', {
    p_conversation_id: conversationId,
    p_body: body,
    p_reply_to_message_id: replyToMessageId ?? null,
  });
  return { data: (data as string | null) ?? null, error: error?.message ?? null };
}

export async function editDirectMessage(messageId: string, body: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('edit_direct_message', {
    p_message_id: messageId,
    p_body: body,
  });
  return { error: error?.message ?? null };
}

export async function deleteDirectMessage(messageId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('delete_direct_message', {
    p_message_id: messageId,
  });
  return { error: error?.message ?? null };
}

export async function markDirectConversationRead(conversationId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('mark_direct_conversation_read', {
    p_conversation_id: conversationId,
  });
  return { error: error?.message ?? null };
}

export async function touchUserPresence() {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('touch_user_presence');
  return { error: error?.message ?? null };
}

export async function loadContactPresence(conversationId: string) {
  if (!supabase) return { data: null as ContactPresence | null, error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('get_contact_presence', {
    p_conversation_id: conversationId,
  });
  const first = Array.isArray(data) ? data[0] : data;
  return {
    data: (first as ContactPresence | undefined) ?? null,
    error: error?.message ?? null,
  };
}

export async function setConversationTyping(conversationId: string, isTyping: boolean) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('set_conversation_typing', {
    p_conversation_id: conversationId,
    p_is_typing: isTyping,
  });
  return { error: error?.message ?? null };
}

export async function loadConversationTyping(conversationId: string) {
  if (!supabase) return { data: false, error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('get_conversation_typing', {
    p_conversation_id: conversationId,
  });
  return {
    data: Array.isArray(data) && data.length > 0,
    error: error?.message ?? null,
  };
}

export function subscribeToConversationRealtime(
  conversationId: string,
  handlers: {
    onMessagesChanged?: () => void;
    onReadChanged?: () => void;
    onTypingChanged?: () => void;
  },
): RealtimeChannel | null {
  if (!supabase) return null;

  return supabase
    .channel(`direct-conversation:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'direct_messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      () => handlers.onMessagesChanged?.(),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'direct_conversation_reads',
        filter: `conversation_id=eq.${conversationId}`,
      },
      () => handlers.onReadChanged?.(),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'conversation_typing',
        filter: `conversation_id=eq.${conversationId}`,
      },
      () => handlers.onTypingChanged?.(),
    )
    .subscribe();
}

export async function unsubscribeConversationRealtime(channel: RealtimeChannel | null) {
  if (!supabase || !channel) return;
  await supabase.removeChannel(channel);
}
