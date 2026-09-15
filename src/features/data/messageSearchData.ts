import { supabase } from '../../lib/supabase';

export type MessageSearchKind = 'direct' | 'group';

export type MessageCursor = {
  created_at: string;
  message_id: string;
};

export type MessageSearchResult = {
  kind: MessageSearchKind;
  chat_id: string;
  chat_name: string;
  message_id: string;
  sender_id: string;
  sender_name: string | null;
  sender_username: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
};

export type MessageSearchPage = {
  results: MessageSearchResult[];
  has_more: boolean;
  next_cursor: MessageCursor | null;
};

export type MessageSearchFilters = {
  query: string;
  kind?: MessageSearchKind | null;
  chatId?: string | null;
  senderId?: string | null;
  /** Restricts only the author name or username. */
  senderQuery?: string | null;
  /** Literal substring across author and conversation/group name. */
  scopeQuery?: string | null;
  /** Local calendar date in YYYY-MM-DD format, inclusive. */
  fromDate?: string | null;
  /** Local calendar date in YYYY-MM-DD format, inclusive. */
  toDate?: string | null;
  cursor?: MessageCursor | null;
  limit?: number;
};

const emptySearchPage = (): MessageSearchPage => ({
  results: [],
  has_more: false,
  next_cursor: null,
});

function validCursor(value: unknown): MessageCursor | null {
  if (!value || typeof value !== 'object') return null;
  const cursor = value as Partial<MessageCursor>;
  return typeof cursor.created_at === 'string' && Number.isFinite(Date.parse(cursor.created_at))
    && typeof cursor.message_id === 'string' && cursor.message_id.length > 0
    ? { created_at: cursor.created_at, message_id: cursor.message_id }
    : null;
}

function normalizeSearchPage(value: unknown): MessageSearchPage | null {
  if (!value || typeof value !== 'object') return null;
  const page = value as Partial<MessageSearchPage>;
  if (!Array.isArray(page.results) || typeof page.has_more !== 'boolean') return null;
  const results: MessageSearchResult[] = [];
  for (const candidate of page.results) {
    if (!candidate || typeof candidate !== 'object') return null;
    const result = candidate as Partial<MessageSearchResult>;
    if ((result.kind !== 'direct' && result.kind !== 'group')
      || typeof result.chat_id !== 'string' || !result.chat_id || typeof result.chat_name !== 'string'
      || typeof result.message_id !== 'string' || !result.message_id || typeof result.sender_id !== 'string' || !result.sender_id
      || typeof result.body !== 'string' || typeof result.created_at !== 'string'
      || !Number.isFinite(Date.parse(result.created_at))
      || (result.sender_name !== null && typeof result.sender_name !== 'string')
      || (result.sender_username !== null && typeof result.sender_username !== 'string')
      || (result.edited_at !== null && (typeof result.edited_at !== 'string'
        || !Number.isFinite(Date.parse(result.edited_at))))) return null;
    results.push(result as MessageSearchResult);
  }
  const nextCursor = page.next_cursor === null ? null : validCursor(page.next_cursor);
  if ((page.next_cursor !== null && !nextCursor) || (results.length > 0 && !nextCursor)
    || (results.length === 0 && nextCursor !== null)
    || (page.has_more && !nextCursor)) return null;
  return {
    results,
    has_more: page.has_more,
    next_cursor: nextCursor,
  };
}

function localDateBoundary(value: string | null | undefined, nextDay: boolean) {
  if (!value) return { value: null as string | null, error: null as string | null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { value: null, error: 'Bitte verwende ein gültiges Datum.' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const local = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) {
    return { value: null, error: 'Bitte verwende ein gültiges Datum.' };
  }
  if (nextDay) local.setDate(local.getDate() + 1);
  return { value: local.toISOString(), error: null as string | null };
}

export async function searchAccessibleMessages(filters: MessageSearchFilters) {
  if (!supabase) {
    return { data: emptySearchPage(), error: 'Supabase ist nicht konfiguriert.' };
  }

  const query = filters.query.trim();
  const queryLength = Array.from(query).length;
  if (queryLength < 2 || queryLength > 100) {
    return { data: emptySearchPage(), error: 'Der Suchbegriff muss zwischen 2 und 100 Zeichen lang sein.' };
  }
  if (Array.from(filters.senderQuery?.trim() ?? '').length > 100) {
    return { data: emptySearchPage(), error: 'Der Absenderfilter ist zu lang.' };
  }
  if (Array.from(filters.scopeQuery?.trim() ?? '').length > 100) {
    return { data: emptySearchPage(), error: 'Der Gesprächs- oder Personenfilter ist zu lang.' };
  }
  if (filters.kind !== undefined && filters.kind !== null
    && filters.kind !== 'direct' && filters.kind !== 'group') {
    return { data: emptySearchPage(), error: 'Die Chat-Art ist ungültig.' };
  }
  if (filters.chatId && !filters.kind) {
    return { data: emptySearchPage(), error: 'Bitte wähle für einen bestimmten Chat auch die Chat-Art.' };
  }

  const fromBoundary = localDateBoundary(filters.fromDate, false);
  const toBoundary = localDateBoundary(filters.toDate, true);
  if (fromBoundary.error || toBoundary.error) {
    return { data: emptySearchPage(), error: fromBoundary.error ?? toBoundary.error };
  }
  if (fromBoundary.value && toBoundary.value && fromBoundary.value >= toBoundary.value) {
    return { data: emptySearchPage(), error: 'Der Datumsbereich ist ungültig.' };
  }

  const requestedLimit = filters.limit ?? 50;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.trunc(requestedLimit), 50))
    : 50;
  const cursor = filters.cursor === null || filters.cursor === undefined ? null : validCursor(filters.cursor);
  if (filters.cursor && !cursor) {
    return { data: emptySearchPage(), error: 'Der Such-Cursor ist ungültig.' };
  }
  const { data, error } = await supabase.rpc('search_accessible_messages', {
    p_query: query,
    p_kind: filters.kind ?? null,
    p_chat_id: filters.chatId ?? null,
    p_sender_id: filters.senderId ?? null,
    p_sender_query: filters.senderQuery?.trim() || null,
    p_scope_query: filters.scopeQuery?.trim() || null,
    p_from_date: fromBoundary.value,
    p_to_date: toBoundary.value,
    p_before_created_at: cursor?.created_at ?? null,
    p_before_message_id: cursor?.message_id ?? null,
    p_limit: limit,
  });

  if (error) return { data: emptySearchPage(), error: error.message };
  const page = normalizeSearchPage(data);
  return page
    ? { data: page, error: null as string | null }
    : { data: emptySearchPage(), error: 'Die Suchergebnisse konnten nicht sicher geladen werden.' };
}
