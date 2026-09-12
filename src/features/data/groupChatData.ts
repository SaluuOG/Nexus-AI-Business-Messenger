import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { validateChatAttachment } from './chatData';

const ATTACHMENT_BUCKET = 'nexus-chat-attachments';
const groupTypingPollers = new WeakMap<RealtimeChannel, number>();

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

export type GroupActivity = {
  user_id: string;
  full_name: string | null;
  username: string | null;
  last_seen_at: string | null;
  online: boolean;
  typing: boolean;
};

export type GroupAttachment = {
  attachment_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  signed_url: string | null;
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
  attachments: GroupAttachment[];
  read_count: number;
  recipient_count: number;
};

function extensionForFile(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
  return ext && ext.length <= 10 ? `.${ext}` : '';
}

function createGroupObjectPath(groupId: string, userId: string, file: File) {
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `groups/${groupId}/${userId}/${randomId}${extensionForFile(file)}`;
}

async function signGroupAttachments(messages: GroupMessage[]) {
  if (!supabase) return messages;
  return Promise.all(messages.map(async (message) => {
    const attachments = await Promise.all((message.attachments || []).map(async (attachment) => {
      const { data, error } = await supabase!.storage.from(ATTACHMENT_BUCKET).createSignedUrl(attachment.storage_path, 3600);
      return { ...attachment, file_size: Number(attachment.file_size || 0), signed_url: error ? null : data?.signedUrl ?? null };
    }));
    return { ...message, attachments };
  }));
}

export async function createGroupChat(name: string, memberIds: string[]) {
  if (!supabase) return { data: null as string | null, error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('create_group_chat', { p_name: name.trim(), p_member_ids: memberIds });
  return { data: (data as string | null) ?? null, error: error?.message ?? null };
}

export async function loadGroupChats() {
  if (!supabase) return { data: [] as GroupChat[], error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('get_my_group_chats');
  const normalized = ((data ?? []) as Array<Omit<GroupChat, 'member_count' | 'unread_count'> & { member_count: number | string; unread_count: number | string }>).map((group) => ({ ...group, member_count: Number(group.member_count || 0), unread_count: Number(group.unread_count || 0) }));
  return { data: normalized, error: error?.message ?? null };
}

export async function loadGroupMembers(groupId: string) {
  if (!supabase) return { data: [] as GroupMember[], error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('get_group_members', { p_group_id: groupId });
  return { data: (data ?? []) as GroupMember[], error: error?.message ?? null };
}

export async function loadGroupActivity(groupId: string) {
  if (!supabase) return { data: [] as GroupActivity[], error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('get_group_activity', { p_group_id: groupId });
  return { data: (data ?? []) as GroupActivity[], error: error?.message ?? null };
}

export async function loadGroupMessages(groupId: string) {
  if (!supabase) return { data: [] as GroupMessage[], error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('get_group_messages', { p_group_id: groupId, p_limit: 200 });
  if (error) return { data: [] as GroupMessage[], error: error.message };
  const normalized = ((data ?? []) as Array<Omit<GroupMessage, 'attachments' | 'read_count' | 'recipient_count'> & { attachments?: GroupAttachment[] | null; read_count?: number | string; recipient_count?: number | string }>).map((message) => ({
    ...message,
    read_count: Number(message.read_count || 0),
    recipient_count: Number(message.recipient_count || 0),
    attachments: Array.isArray(message.attachments) ? message.attachments.map((attachment) => ({ ...attachment, file_size: Number(attachment.file_size || 0), signed_url: null })) : [],
  }));
  return { data: await signGroupAttachments(normalized), error: null as string | null };
}

export async function sendGroupMessage(groupId: string, body: string, replyToMessageId?: string | null) {
  if (!supabase) return { data: null as string | null, error: 'Supabase ist nicht konfiguriert.' };
  const { data, error } = await supabase.rpc('send_group_message', { p_group_id: groupId, p_body: body, p_reply_to_message_id: replyToMessageId ?? null });
  return { data: (data as string | null) ?? null, error: error?.message ?? null };
}

export async function sendGroupAttachmentMessage(groupId: string, currentUserId: string, file: File, body: string, replyToMessageId?: string | null) {
  if (!supabase) return { data: null as string | null, error: 'Supabase ist nicht konfiguriert.' };
  const validation = validateChatAttachment(file);
  if (validation.error) return { data: null as string | null, error: validation.error };
  const storagePath = createGroupObjectPath(groupId, currentUserId, file);
  const upload = await supabase.storage.from(ATTACHMENT_BUCKET).upload(storagePath, file, { cacheControl: '3600', contentType: validation.mimeType, upsert: false });
  if (upload.error) return { data: null as string | null, error: `Upload fehlgeschlagen: ${upload.error.message}` };
  const { data, error } = await supabase.rpc('send_group_attachment_message', {
    p_group_id: groupId,
    p_storage_path: storagePath,
    p_file_name: file.name.trim(),
    p_mime_type: validation.mimeType,
    p_file_size: file.size,
    p_body: body.trim(),
    p_reply_to_message_id: replyToMessageId ?? null,
  });
  if (error) {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([storagePath]);
    return { data: null as string | null, error: error.message };
  }
  return { data: (data as string | null) ?? null, error: null as string | null };
}

export async function markGroupRead(groupId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('mark_group_read', { p_group_id: groupId });
  return { error: error?.message ?? null };
}

export async function setGroupTyping(groupId: string, isTyping: boolean) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('set_group_typing', { p_group_id: groupId, p_is_typing: isTyping });
  return { error: error?.message ?? null };
}

export async function editGroupMessage(messageId: string, body: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('edit_group_message', { p_message_id: messageId, p_body: body });
  return { error: error?.message ?? null };
}

export async function deleteGroupMessage(messageId: string, attachmentPaths: string[] = []) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  if (attachmentPaths.length) {
    const storageResult = await supabase.storage.from(ATTACHMENT_BUCKET).remove(attachmentPaths);
    if (storageResult.error) return { error: `Anhang konnte nicht gelöscht werden: ${storageResult.error.message}` };
  }
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

export function subscribeToGroupRealtime(groupId: string, handlers: { onMessagesChanged?: () => void; onReadChanged?: () => void; onTypingChanged?: () => void }): RealtimeChannel | null {
  if (!supabase) return null;
  const channel = supabase.channel(`group-chat:${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, () => handlers.onMessagesChanged?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_reads', filter: `group_id=eq.${groupId}` }, () => handlers.onReadChanged?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_typing', filter: `group_id=eq.${groupId}` }, () => handlers.onTypingChanged?.())
    .subscribe();

  if (handlers.onTypingChanged && typeof window !== 'undefined') {
    const poller = window.setInterval(() => handlers.onTypingChanged?.(), 1500);
    groupTypingPollers.set(channel, poller);
  }

  return channel;
}

export async function unsubscribeGroupRealtime(channel: RealtimeChannel | null) {
  if (!supabase || !channel) return;
  const poller = groupTypingPollers.get(channel);
  if (poller !== undefined && typeof window !== 'undefined') {
    window.clearInterval(poller);
    groupTypingPollers.delete(channel);
  }
  await supabase.removeChannel(channel);
}
