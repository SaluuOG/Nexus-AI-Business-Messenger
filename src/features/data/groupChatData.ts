import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

export type GroupChat = {
  group_id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  member_count: number;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
};

export type GroupMember = {
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  joined_at: string;
};

export type GroupMessage = {
  message_id: string;
  group_id: string;
  sender_id: string;
  sender_full_name: string | null;
  sender_username: string | null;
  sender_avatar_url: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_to_message_id: string | null;
  reply_body: string | null;
  reply_sender_id: string | null;
  reply_sender_name: string | null;
};

export async function createGroupChat(name: string, memberIds: string[]) {
  if (!supabase) return { data: null as string | null, error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('create_group_chat', {
    p_name: name.trim(),
    p_member_ids: memberIds,
  });
  return { data: (data as string | null) ?? null, error: error?.message ?? null };
}

export async function loadGroupChats() {
  if (!supabase) return { data: [] as GroupChat[], error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('get_my_group_chats');
  const normalized = ((data ?? []) as Array<Omit<GroupChat, 'member_count' | 'unread_count'> & { member_count: number | string; unread_count: number | string }>).map((group) => ({
    ...group,
    member_count: Number(group.member_count || 0),
    unread_count: Number(group.unread_count || 0),
  }));
  return { data: normalized, error: error?.message ?? null };
}

export async function loadGroupMembers(groupId: string) {
  if (!supabase) return { data: [] as GroupMember[], error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('get_group_members', { p_group_id: groupId });
  return { data: (data ?? []) as GroupMember[], error: error?.message ?? null };
}

export async function loadGroupMessages(groupId: string) {
  if (!supabase) return { data: [] as GroupMessage[], error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('get_group_messages', { p_group_id: groupId, p_limit: 200 });
  return { data: (data ?? []) as GroupMessage[], error: error?.message ?? null };
}

export async function sendGroupMessage(groupId: string, body: string, replyToMessageId?: string | null) {
  if (!supabase) return { data: null as string | null, error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('send_group_message', {
    p_group_id: groupId,
    p_body: body,
    p_reply_to_message_id: replyToMessageId ?? null,
  });
  return { data: (data as string | null) ?? null, error: error?.message ?? null };
}

export async function markGroupRead(groupId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('mark_group_read', { p_group_id: groupId });
  return { error: error?.message ?? null };
}

export async function editGroupMessage(messageId: string, body: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('edit_group_message', { p_message_id: messageId, p_body: body });
  return { error: error?.message ?? null };
}

export async function deleteGroupMessage(messageId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('delete_group_message', { p_message_id: messageId });
  return { error: error?.message ?? null };
}

export async function renameGroupChat(groupId: string, name: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('rename_group_chat', { p_group_id: groupId, p_name: name.trim() });
  return { error: error?.message ?? null };
}

export async function addGroupMember(groupId: string, userId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('add_group_member', { p_group_id: groupId, p_user_id: userId });
  return { error: error?.message ?? null };
}

export async function removeGroupMember(groupId: string, userId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('remove_group_member', { p_group_id: groupId, p_user_id: userId });
  return { error: error?.message ?? null };
}

export async function setGroupMemberRole(groupId: string, userId: string, role: 'admin' | 'member') {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('set_group_member_role', { p_group_id: groupId, p_user_id: userId, p_role: role });
  return { error: error?.message ?? null };
}

export async function leaveGroupChat(groupId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('leave_group_chat', { p_group_id: groupId });
  return { error: error?.message ?? null };
}

export function subscribeToGroupRealtime(groupId: string, onChanged: () => void): RealtimeChannel | null {
  if (!supabase) return null;
  return supabase
    .channel(`group-chat:${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, onChanged)
    .subscribe();
}

export async function unsubscribeGroupRealtime(channel: RealtimeChannel | null) {
  if (!supabase || !channel) return;
  await supabase.removeChannel(channel);
}
