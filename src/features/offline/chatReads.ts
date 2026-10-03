import { cachedChatRead, type ChatKind } from './chatCache';
import type { DirectMessagePage } from '../data/chatData';
import type { GroupMessagePage } from '../data/groupChatData';
export const offlineStamp = (at: number) => 'Offline – zuletzt gespeichert: ' + new Date(at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
export function offlineChatList<T>(kind: ChatKind, account: string | undefined, fetch: () => Promise<{ data: T[]; error: string | null }>) {
  return cachedChatRead({ account, kind, id: 'list', fetch, empty: [] as T[], rows: data => data, restore: rows => rows as T[] });
}
export function offlineMessagePage<T extends DirectMessagePage | GroupMessagePage>(kind: ChatKind, id: string, account: string | undefined, fetch: () => Promise<{ data: T; error: string | null }>) {
  return cachedChatRead({ account, kind, id, fetch, empty: { messages: [], has_more: false, next_cursor: null } as unknown as T,
    rows: data => data.messages, restore: rows => ({ messages: rows, has_more: false, next_cursor: null }) as T });
}
