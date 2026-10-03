import { supabase } from '../../lib/supabase';
import { routes } from '../../app/routes';

export type BookmarkKind = 'direct' | 'group';
export type BookmarkCursor = { saved_at: string; id: string };
export type MessageBookmark = BookmarkCursor & {
  kind: BookmarkKind; message_id: string; chat_id: string; chat_name: string;
  sender_name: string; preview: string; attachment_name: string | null; created_at: string;
};
export type BookmarkPage = { items: MessageBookmark[]; has_more: boolean; next_cursor: BookmarkCursor | null };
const readError = 'Gemerkte Nachrichten konnten nicht geladen werden. Bitte versuche es erneut.';
const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const date = (value: unknown): value is string => string(value) && Number.isFinite(Date.parse(value));

export function bookmarkTarget(row: Pick<MessageBookmark, 'kind' | 'chat_id' | 'message_id'>) {
  const key = row.kind === 'direct' ? 'conversation' : 'group';
  return (row.kind === 'direct' ? routes.chats : routes.groups) + '?' + new URLSearchParams({ [key]: row.chat_id, message: row.message_id });
}

export async function loadMessageBookmarks(userId: string, query: string, cursor: BookmarkCursor | null = null): Promise<BookmarkPage> {
  if (!supabase || !userId) throw new Error(readError);
  const { data, error } = await supabase.rpc('get_message_bookmarks', { p_user_id: userId, p_query: query.trim(), p_before_saved_at: cursor?.saved_at ?? null, p_before_id: cursor?.id ?? null, p_limit: 30 });
  if (error || !data || !Array.isArray(data.items) || typeof data.has_more !== 'boolean') throw new Error(readError);
  const seen = new Set<string>();
  const items: MessageBookmark[] = data.items.map((row: MessageBookmark) => {
    if (!row || !string(row.id) || !['direct','group'].includes(row.kind) || !string(row.message_id) || !string(row.chat_id) || !string(row.chat_name) || !string(row.sender_name) || typeof row.preview !== 'string' || !(row.attachment_name === null || typeof row.attachment_name === 'string') || !date(row.saved_at) || !date(row.created_at) || seen.has(row.id)) throw new Error(readError);
    seen.add(row.id);
    return { id: row.id, kind: row.kind, message_id: row.message_id, chat_id: row.chat_id, chat_name: row.chat_name, sender_name: row.sender_name, preview: row.preview, attachment_name: row.attachment_name, created_at: row.created_at, saved_at: row.saved_at };
  });
  const next = data.next_cursor;
  const last = items.at(-1);
  if (data.has_more ? (!next || !last || !date(next.saved_at) || next.id !== last.id || next.saved_at !== last.saved_at || (cursor?.id === next.id && cursor?.saved_at === next.saved_at)) : next !== null) throw new Error(readError);
  return { items, has_more: data.has_more, next_cursor: data.has_more ? { saved_at: next.saved_at, id: next.id } : null };
}

export async function loadBookmarkStatus(userId: string, kind: BookmarkKind, chatId: string, messageIds: string[]): Promise<Set<string>> {
  if (!supabase || !userId) throw new Error(readError);
  const unique = [...new Set(messageIds)];
  const batches = Array.from({ length: Math.ceil(unique.length / 200) }, (_, i) => unique.slice(i * 200, (i + 1) * 200));
  const rows = await Promise.all(batches.map(async ids => {
    const { data, error } = await supabase!.rpc('get_message_bookmark_status', { p_user_id: userId, p_kind: kind, p_chat_id: chatId, p_message_ids: ids });
    if (error || !Array.isArray(data) || data.some(id => !string(id) || !ids.includes(id)) || new Set(data).size !== data.length) throw new Error(readError);
    return data as string[];
  }));
  return new Set(rows.flat());
}

// Desired state keeps a manual retry safe after a lost response.
export async function setMessageBookmark(userId: string, kind: BookmarkKind, messageId: string, saved: boolean) {
  if (!supabase || !userId || navigator.onLine === false) throw new Error('Zum Merken oder Entfernen brauchst du eine Internetverbindung.');
  const { data, error } = await supabase.rpc('set_message_bookmark', { p_user_id: userId, p_kind: kind, p_message_id: messageId, p_saved: saved });
  if (error || data !== saved) throw new Error('Markierung nicht bestätigt. Prüfe deine Verbindung und deinen Chat-Zugriff und versuche es erneut.');
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nexus:bookmarks', { detail: userId }));
}

export function watchBookmarks(userId: string, refresh: () => void) {
  const resume = () => { if (document.visibilityState === 'visible' && navigator.onLine !== false) refresh(); };
  const changed = (event: Event) => { if ((event as CustomEvent).detail === userId) resume(); };
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('nexus:bookmarks', changed);
  const interval = setInterval(resume, 30_000);
  return () => { clearInterval(interval); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); window.removeEventListener('nexus:bookmarks', changed); };
}
