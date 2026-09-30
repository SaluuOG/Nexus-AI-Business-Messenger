import { supabase } from '../../lib/supabase';

export type PinKind = 'direct' | 'group';
export type MessagePin = { message_id: string; chat_id: string; preview: string; created_at: string };
const readError = 'Angeheftete Nachrichten konnten nicht geladen werden.';

export async function loadMessagePins(kind: PinKind, chatId: string): Promise<MessagePin[]> {
  if (!supabase) throw new Error(readError);
  const { data, error } = await supabase.rpc('get_message_pins', { p_kind: kind, p_chat_id: chatId });
  if (error || !Array.isArray(data)) throw new Error(readError);
  const seen = new Set<string>();
  return data.map(row => {
    if (!row || typeof row.message_id !== 'string' || !row.message_id || seen.has(row.message_id) || row.chat_id !== chatId || typeof row.preview !== 'string' || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) throw new Error(readError);
    seen.add(row.message_id);
    return { message_id: row.message_id, chat_id: row.chat_id, preview: row.preview, created_at: row.created_at };
  });
}

// Desired state, not a toggle: retrying a lost response cannot create duplicates.
export async function setMessagePin(kind: PinKind, chatId: string, messageId: string, pinned: boolean) {
  if (!supabase || navigator.onLine === false) throw new Error('Zum Anheften brauchst du eine Internetverbindung.');
  const { error } = await supabase.rpc('set_message_pin', { p_kind: kind, p_chat_id: chatId, p_message_id: messageId, p_pinned: pinned });
  if (error) throw new Error('Anheftung konnte nicht gespeichert werden. Prüfe deine Verbindung und deine Berechtigung.');
}

export function subscribeMessagePins(kind: PinKind, chatId: string, refresh: () => void) {
  if (!supabase) return () => {};
  const column = kind === 'direct' ? 'conversation_id' : 'group_id';
  const channel = supabase.channel(`message-pins:${kind}:${chatId}`);
  for (const table of [`${kind}_message_pins`, `${kind}_messages`]) {
    for (const event of ['INSERT', 'UPDATE'] as const) {
      channel.on('postgres_changes', { event, schema: 'public', table, filter: `${column}=eq.${chatId}` }, refresh);
    }
  }
  channel.subscribe(status => { if (status === 'SUBSCRIBED') refresh(); });
  return () => { void supabase?.removeChannel(channel); };
}
