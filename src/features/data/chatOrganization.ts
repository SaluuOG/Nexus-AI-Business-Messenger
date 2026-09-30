import { supabase } from '../../lib/supabase';

import type { OrganizationKind, ChatOrganization, OrganizationField } from './chatOrganizationView';
export * from './chatOrganizationView';

export async function withChatOrganization<T extends ChatOrganization>(kind: OrganizationKind, load: () => PromiseLike<{ data: T[] | null; error: {message: string} | null }>, id: (row: T) => string) {
  const [list, organization] = await Promise.allSettled([load(), loadChatOrganization(kind)]);
  if (list.status === 'rejected') return {data: [] as T[], error: 'Chats konnten nicht geladen werden. Bitte erneut versuchen.'};
  if (list.value.error) return {data: [] as T[], error: list.value.error.message};
  if (organization.status === 'rejected') return {data: [] as T[], error: organization.reason instanceof Error ? organization.reason.message : 'Chat-Einstellungen nicht verfügbar.'};
  return {data: (list.value.data ?? []).map(row => ({...row, favorite: false, archived: false, ...organization.value.get(id(row))})), error: null};
}

export async function loadChatOrganization(kind: OrganizationKind) {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.');
  const { data, error } = await supabase.rpc('get_chat_organization', { p_kind: kind });
  if (error || !Array.isArray(data)) throw new Error('Deine Chat-Einstellungen konnten nicht geladen werden. Bitte erneut aktualisieren.');
  const states = new Map<string, Required<ChatOrganization>>();
  for (const row of data) {
    if (!row || typeof row.chat_id !== 'string' || !row.chat_id || typeof row.favorite !== 'boolean' || typeof row.archived !== 'boolean' || states.has(row.chat_id)) {
      throw new Error('Deine Chat-Einstellungen konnten nicht sicher geladen werden.');
    }
    states.set(row.chat_id, { favorite: row.favorite, archived: row.archived });
  }
  return states;
}

export async function setChatOrganization(kind: OrganizationKind, chatId: string, field: OrganizationField, value: boolean) {
  if (!supabase || (typeof navigator !== 'undefined' && navigator.onLine === false)) throw new Error('Keine Verbindung.');
  const { error } = await supabase.rpc('set_chat_organization', { p_kind: kind, p_chat_id: chatId, p_field: field, p_value: value });
  if (error) throw new Error('Chat-Einstellung konnte nicht gespeichert werden. Bitte erneut versuchen.');
}

export function subscribeChatOrganization(kind: OrganizationKind, userId: string | undefined, onChanged: () => void) {
  if (!supabase || !userId) return () => {};
  const channel = supabase.channel(`chat-organization:${kind}:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: `${kind}_chat_preferences`, filter: `user_id=eq.${userId}` }, onChanged)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: `${kind}_chat_preferences`, filter: `user_id=eq.${userId}` }, onChanged)
    .subscribe(status => { if (status === 'SUBSCRIBED') onChanged(); });
  return () => { void supabase?.removeChannel(channel); };
}
