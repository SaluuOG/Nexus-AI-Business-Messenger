import { supabase } from '../../lib/supabase';
import type { BookmarkKind, MessageBookmark } from './messageBookmarks';

export type ReminderState = { id: string; version: string; due_at: string | null };
export type MessageReminder = Omit<MessageBookmark, 'saved_at'> & ReminderState & { due_at: string };
export type ReminderCursor = { due_at: string; id: string };
export type ReminderPage = { items: MessageReminder[]; has_more: boolean; next_cursor: ReminderCursor | null; due_count: number; server_now: string };
export type ReminderIntent = { version: string | null; requestId: string; dueAt: string | null };
const readError = 'Wiedervorlagen konnten nicht geladen werden. Bitte versuche es erneut.';
const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const date = (value: unknown): value is string => string(value) && Number.isFinite(Date.parse(value));
async function request(name: string, args: Record<string, unknown>) {
  if (!supabase) throw new Error(readError);
  try { return await supabase.rpc(name, args); }
  catch { throw new Error(name === 'change_message_reminder' ? 'Änderung nicht bestätigt. Prüfe deine Verbindung und versuche es erneut.' : readError); }
}
export class ReminderError extends Error { constructor(message: string, public code = '') { super(message); } }
function state(value: ReminderState): ReminderState {
  if (!value || !string(value.id) || !string(value.version) || !(value.due_at === null || date(value.due_at))) throw new Error(readError);
  return { id: value.id, version: value.version, due_at: value.due_at };
}
export function localReminderInput(value: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
export function reminderPreset(which: 'twoHours' | 'tomorrow', now = new Date()) {
  const value = new Date(now);
  if (which === 'twoHours') value.setTime(Math.ceil((now.getTime() + 7_200_000) / 60_000) * 60_000);
  else { value.setDate(value.getDate() + 1); value.setHours(9, 0, 0, 0); }
  return localReminderInput(value);
}
export function parseReminderInput(value: string, now = Date.now()) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) throw new Error('Bitte wähle Datum und Uhrzeit.');
  const [,y,m,d,h,min] = parts.map(Number), result = new Date(y, m - 1, d, h, min);
  if (result.getFullYear() !== y || result.getMonth() !== m - 1 || result.getDate() !== d || result.getHours() !== h || result.getMinutes() !== min) throw new Error('Diese Ortszeit existiert nicht. Bitte wähle einen anderen Termin.');
  if (result.getTime() <= now) throw new Error('Bitte wähle einen zukünftigen Termin.');
  return result.toISOString();
}
export function reminderDate(value: string) { return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }); }
export async function loadMessageReminder(userId: string, kind: BookmarkKind, messageId: string): Promise<ReminderState | null> {
  if (!supabase || !userId) throw new Error(readError);
  const { data, error } = await request('get_message_reminder', { p_user_id: userId, p_kind: kind, p_message_id: messageId });
  if (error) throw new Error('Wiedervorlage nicht erreichbar. Prüfe deine Verbindung und deinen Chat-Zugriff.');
  return data === null ? null : state(data);
}
export async function changeMessageReminder(userId: string, kind: BookmarkKind, messageId: string, intent: ReminderIntent) {
  if (!supabase || !userId || navigator.onLine === false) throw new Error('Für Wiedervorlagen brauchst du eine Internetverbindung.');
  const { data, error } = await request('change_message_reminder', { p_user_id: userId, p_kind: kind, p_message_id: messageId, p_expected_version: intent.version, p_request_id: intent.requestId, p_due_at: intent.dueAt });
  if (error) {
    const message = error.code === '40001' ? 'Die Wiedervorlage wurde inzwischen geändert. Lade den aktuellen Stand neu.' : error.code === '22023' ? 'Termin nicht bestätigt. Wähle einen zukünftigen Termin innerhalb der nächsten fünf Jahre.' : 'Änderung nicht bestätigt. Prüfe deine Verbindung und deinen Chat-Zugriff.';
    throw new ReminderError(message, error.code);
  }
  const result = state(data);
  if (result.version !== intent.requestId || (intent.dueAt === null ? result.due_at !== null : result.due_at === null || Date.parse(result.due_at) !== Date.parse(intent.dueAt))) throw new Error('Änderung nicht bestätigt. Bitte erneut versuchen.');
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nexus:reminders', { detail: userId }));
  return result;
}
export async function loadMessageReminders(userId: string, mode: 'due' | 'all', cursor: ReminderCursor | null = null): Promise<ReminderPage> {
  if (!supabase || !userId) throw new Error(readError);
  const { data, error } = await request('get_message_reminders', { p_user_id: userId, p_mode: mode, p_after_due_at: cursor?.due_at ?? null, p_after_id: cursor?.id ?? null, p_limit: 20 });
  if (error || !data || !Array.isArray(data.items) || !date(data.server_now) || !Number.isSafeInteger(data.due_count) || data.due_count < 0 || typeof data.has_more !== 'boolean') throw new Error(readError);
  const seen = new Set<string>();
  const items = data.items.map((row: MessageReminder) => {
    const saved = state(row);
    if (!saved.due_at || !['direct','group'].includes(row.kind) || !string(row.message_id) || !string(row.chat_id) || !string(row.chat_name) || !string(row.sender_name) || typeof row.preview !== 'string' || !(row.attachment_name === null || typeof row.attachment_name === 'string') || !date(row.created_at) || seen.has(row.id)) throw new Error(readError);
    seen.add(row.id);
    return { ...saved, due_at: saved.due_at, kind: row.kind, message_id: row.message_id, chat_id: row.chat_id, chat_name: row.chat_name, sender_name: row.sender_name, preview: row.preview, attachment_name: row.attachment_name, created_at: row.created_at };
  });
  const next = data.next_cursor, last = items.at(-1);
  if (data.has_more ? (!next || !last || next.id !== last.id || next.due_at !== last.due_at || (cursor?.id === next.id && cursor?.due_at === next.due_at)) : next !== null) throw new Error(readError);
  return { items, has_more: data.has_more, next_cursor: data.has_more ? { id: next.id, due_at: next.due_at } : null, due_count: data.due_count, server_now: data.server_now };
}
export function watchReminders(userId: string, refresh: () => void) {
  const resume = () => { if (document.visibilityState === 'visible' && navigator.onLine !== false) refresh(); };
  const changed = (event: Event) => { if ((event as CustomEvent).detail === userId) resume(); };
  window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume); window.addEventListener('nexus:reminders', changed);
  const interval = setInterval(resume, 30_000);
  return () => { clearInterval(interval); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); window.removeEventListener('nexus:reminders', changed); };
}
