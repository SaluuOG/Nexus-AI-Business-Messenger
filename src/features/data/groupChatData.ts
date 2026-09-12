import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { validateChatAttachment } from './chatData';

const ATTACHMENT_BUCKET = 'nexus-chat-attachments';
const GROUP_AVATAR_BUCKET = 'nexus-group-avatars';
const MAX_GROUP_AVATAR_BYTES = 5 * 1024 * 1024;
const GROUP_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const groupTypingPollers = new WeakMap<RealtimeChannel, number>();

export type GroupChat = {
  group_id: string;
  name: string;
  avatar_path: string | null;
  avatar_url: string | null;
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

function createGroupAvatarPath(groupId: string, userId: string, file: File) {
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${groupId}/${userId}/${randomId}${extensionForFile(file)}`;
}

function validateGroupAvatar(file: File) {
  const mimeType = file.type.toLowerCase();
  if (!file.size) return { mimeType, error: 'Das Gruppenbild ist leer.' };
  if (file.size > MAX_GROUP_AVATAR_BYTES) return { mimeType, error: 'Das Gruppenbild ist größer als 5 MB.' };
  if (!GROUP_AVATAR_TYPES.includes(mimeType as (typeof GROUP_AVATAR_TYPES)[number])) {
    return { mimeType, error: 'Bitte verwende JPEG, PNG, WebP oder GIF als Gruppenbild.' };
  }
  return { mimeType, error: null as string | null };
}

async function signGroupAvatars(groups: GroupChat[]) {
  if (!supabase) return groups;
  return Promise.all(groups.map(async (group) => {
    if (!group.avatar_path) return { ...group, avatar_url: null };
    const { data, error } = await supabase!.storage
      .from(GROUP_AVATAR_BUCKET)
      .createSignedUrl(group.avatar_path, 3600);
    return { ...group, avatar_url: error ? null : data?.signedUrl ?? null };
  }));
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
  if (error) return { data: [] as GroupChat[], error: error.message };
  const normalized = ((data ?? []) as Array<Omit<GroupChat, 'avatar_url' | 'member_count' | 'unread_count'> & { member_count: number | string; unread_count: number | string }>).map((group) => ({
    ...group,
    avatar_url: null,
    member_count: Number(group.member_count || 0),
    unread_count: Number(group.unread_count || 0),
  }));
  return { data: await signGroupAvatars(normalized), error: null as string | null };
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

export async function updateGroupAvatar(groupId: string, currentUserId: string, file: File) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.', warning: null as string | null };
  const validation = validateGroupAvatar(file);
  if (validation.error) return { error: validation.error, warning: null as string | null };

  const storagePath = createGroupAvatarPath(groupId, currentUserId, file);
  const upload = await supabase.storage.from(GROUP_AVATAR_BUCKET).upload(storagePath, file, {
    cacheControl: '3600',
    contentType: validation.mimeType,
    upsert: false,
  });
  if (upload.error) return { error: `Gruppenbild-Upload fehlgeschlagen: ${upload.error.message}`, warning: null as string | null };

  const { data: previousPath, error } = await supabase.rpc('update_group_avatar', {
    p_group_id: groupId,
    p_storage_path: storagePath,
  });
  if (error) {
    await supabase.storage.from(GROUP_AVATAR_BUCKET).remove([storagePath]);
    return { error: error.message, warning: null as string | null };
  }

  let warning: string | null = null;
  if (typeof previousPath === 'string' && previousPath && previousPath !== storagePath) {
    const cleanup = await supabase.storage.from(GROUP_AVATAR_BUCKET).remove([previousPath]);
    if (cleanup.error) warning = 'Das neue Gruppenbild ist gespeichert; das alte Bild konnte nicht automatisch bereinigt werden.';
  }
  return { error: null as string | null, warning };
}

export async function removeGroupAvatar(groupId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.', warning: null as string | null };
  const { data: previousPath, error } = await supabase.rpc('remove_group_avatar', { p_group_id: groupId });
  if (error) return { error: error.message, warning: null as string | null };
  if (typeof previousPath === 'string' && previousPath) {
    const cleanup = await supabase.storage.from(GROUP_AVATAR_BUCKET).remove([previousPath]);
    if (cleanup.error) {
      return { error: null as string | null, warning: 'Das Gruppenbild wurde entfernt; die alte Datei konnte nicht automatisch bereinigt werden.' };
    }
  }
  return { error: null as string | null, warning: null as string | null };
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

export async function transferGroupOwnership(groupId: string, newOwnerId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('transfer_group_ownership', {
    p_group_id: groupId,
    p_new_owner_id: newOwnerId,
  });
  return { error: error?.message ?? null };
}

export async function leaveGroupChat(groupId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { error } = await supabase.rpc('leave_group_chat', { p_group_id: groupId });
  return { error: error?.message ?? null };
}

type GroupStoragePath = { bucket_id: string; storage_path: string };

async function removeStoragePaths(bucket: string, paths: string[]) {
  if (!supabase || paths.length === 0) return null;
  for (let offset = 0; offset < paths.length; offset += 100) {
    const result = await supabase.storage.from(bucket).remove(paths.slice(offset, offset + 100));
    if (result.error) return result.error.message;
  }
  return null;
}

export async function deleteGroupChat(groupId: string) {
  if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' };
  const { data, error: pathsError } = await supabase.rpc('get_group_storage_paths_for_deletion', { p_group_id: groupId });
  if (pathsError) return { error: pathsError.message };

  const paths = (data ?? []) as GroupStoragePath[];
  const attachmentError = await removeStoragePaths(
    ATTACHMENT_BUCKET,
    paths.filter((item) => item.bucket_id === ATTACHMENT_BUCKET).map((item) => item.storage_path),
  );
  if (attachmentError) return { error: `Gruppenanhänge konnten nicht gelöscht werden: ${attachmentError}` };

  const avatarError = await removeStoragePaths(
    GROUP_AVATAR_BUCKET,
    paths.filter((item) => item.bucket_id === GROUP_AVATAR_BUCKET).map((item) => item.storage_path),
  );
  if (avatarError) return { error: `Das Gruppenbild konnte nicht gelöscht werden: ${avatarError}` };

  const { error } = await supabase.rpc('delete_group_chat', { p_group_id: groupId });
  return { error: error?.message ?? null };
}

export function subscribeToGroupRealtime(groupId: string, handlers: {
  onMessagesChanged?: () => void;
  onReadChanged?: () => void;
  onTypingChanged?: () => void;
  onGroupChanged?: () => void;
  onMembersChanged?: () => void;
}): RealtimeChannel | null {
  if (!supabase) return null;
  const channel = supabase.channel(`group-chat:${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, () => handlers.onMessagesChanged?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_reads', filter: `group_id=eq.${groupId}` }, () => handlers.onReadChanged?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_typing', filter: `group_id=eq.${groupId}` }, () => handlers.onTypingChanged?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_conversations', filter: `id=eq.${groupId}` }, () => handlers.onGroupChanged?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` }, () => handlers.onMembersChanged?.())
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
