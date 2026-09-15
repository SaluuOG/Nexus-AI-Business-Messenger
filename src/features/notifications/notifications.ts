import { routes } from '../../app/routes';
import { businessSearch } from '../../app/businessNavigation';
import { supabase } from '../../lib/supabase';

export const notificationCategories = [
  { id: 'messages', label: 'Nachrichten', description: 'Neue Nachrichten in Einzel- und Gruppenchats.' },
  { id: 'contacts', label: 'Kontaktanfragen', description: 'Neue Anfragen von anderen Nexus-Nutzern.' },
  { id: 'invitations', label: 'Workspace-Einladungen', description: 'Einladungen für die bestätigte E-Mail-Adresse deines Kontos.' },
  { id: 'assignments', label: 'Aufgabenzuweisungen', description: 'Aufgaben, die dir jemand aus deinem Team zuweist.' },
  { id: 'deadlines', label: 'Fällige Aufgaben', description: 'Deine heute fälligen und überfälligen Aufgaben.' },
] as const;
export type NotificationCategory = typeof notificationCategories[number]['id'];
export type NotificationPreferences = Record<NotificationCategory, boolean>;
export const defaultNotificationPreferences: NotificationPreferences = { messages: true, contacts: true, invitations: true, assignments: true, deadlines: true };
export type NotificationKind = 'direct_message' | 'group_message' | 'contact_request' | 'workspace_invitation' | 'task_assigned' | 'task_due' | 'task_overdue';
export type NexusNotification = {
  id: string; kind: NotificationKind; created_at: string; read_at: string | null;
  details: { title: string; detail: string; chat_id?: string; invite_token?: string; workspace_id?: string; project_id?: string; task_id?: string; due_date?: string | null };
};
export type NotificationFeed = {
  items: NexusNotification[]; unread_count: number; total_count: number;
  through_id: string; has_more: boolean; preferences: NotificationPreferences;
};
export const emptyNotificationFeed = (): NotificationFeed => ({ items: [], unread_count: 0, total_count: 0, through_id: '0', has_more: false, preferences: { ...defaultNotificationPreferences } });
export function notificationTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
export function notificationTarget(item: NexusNotification): string | null {
  const d = item.details;
  if (item.kind === 'direct_message' && d.chat_id) return routes.chats + '?' + new URLSearchParams({ conversation: d.chat_id });
  if (item.kind === 'group_message' && d.chat_id) return routes.groups + '?' + new URLSearchParams({ group: d.chat_id });
  if (item.kind === 'contact_request') return routes.contacts;
  if (item.kind === 'workspace_invitation' && d.invite_token) return routes.settings + '?' + new URLSearchParams({ category: 'workspace', invite: d.invite_token });
  if (['task_assigned', 'task_due', 'task_overdue'].includes(item.kind) && d.workspace_id && d.project_id && d.task_id) {
    return routes.business + '?' + businessSearch(d.workspace_id, { view: 'tasks', projectId: d.project_id, taskId: d.task_id });
  }
  return null;
}
export const notificationLabels: Record<NotificationKind, string> = {
  direct_message: 'Nachricht', group_message: 'Gruppennachricht', contact_request: 'Kontaktanfrage',
  workspace_invitation: 'Einladung', task_assigned: 'Dir zugewiesen', task_due: 'Heute fällig', task_overdue: 'Überfällig',
};

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Bitte melde dich an, um Benachrichtigungen zu verwenden.');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function loadNotifications(limit = 25, unreadOnly = false): Promise<NotificationFeed> {
  const timezone = notificationTimezone();
  let before: string | null = null;
  let result: NotificationFeed = emptyNotificationFeed();
  let first = true;
  // Keyset pagination keeps large feeds complete without a fixed 1,000-row cap.
  while (first || (result.items.length < limit && result.has_more)) {
    const page: NotificationFeed = await rpc('get_my_notifications', {
      p_timezone: timezone, p_before: before, p_limit: Math.min(100, limit - result.items.length), p_unread_only: unreadOnly,
    });
    if (!page || !Array.isArray(page.items) || !page.preferences) throw new Error('Die Benachrichtigungen konnten nicht geladen werden.');
    result = first ? page : { ...result, items: [...result.items, ...page.items], has_more: page.has_more };
    first = false;
    const last = page.items.at(-1)?.id;
    if (!last || last === before) break;
    before = last;
  }
  return result;
}
export async function markNotificationsRead(throughId: string, id?: string) {
  await rpc('mark_notifications_read', { p_through: throughId, p_id: id ?? null, p_timezone: notificationTimezone() });
}
export async function saveNotificationPreference(category: NotificationCategory, enabled: boolean) {
  await rpc('set_notification_preference', { p_category: category, p_enabled: enabled });
}
