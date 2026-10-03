import { supabase } from '../../lib/supabase';

export const reactionChoices = [
  { emoji: '❤️', label: 'Herz' },
  { emoji: '👍', label: 'Gefällt mir' },
  { emoji: '😂', label: 'Lachen' },
  { emoji: '😮', label: 'Überrascht' },
  { emoji: '😢', label: 'Traurig' },
  { emoji: '🙏', label: 'Danke' },
] as const;
export type ReactionEmoji = (typeof reactionChoices)[number]['emoji'];
export type ReactionKind = 'direct' | 'group';
export type MessageReaction = { message_id: string; emoji: ReactionEmoji; count: number; mine: boolean };
export const reactionLabel = (emoji: ReactionEmoji) => reactionChoices.find(choice => choice.emoji === emoji)!.label;
export const isReactionEmoji = (value: unknown): value is ReactionEmoji => reactionChoices.some(choice => choice.emoji === value);

export async function loadMessageReactions(kind: ReactionKind, chatId: string, messageIds: string[]) {
  if (!supabase) throw new Error('Reaktionen sind noch nicht verfügbar.');
  const rows: MessageReaction[] = [];
  const ids = [...new Set(messageIds)];
  for (let index = 0; index < ids.length; index += 200) {
    const batch = ids.slice(index, index + 200);
    const { data, error } = await supabase.rpc('get_message_reactions', { p_kind: kind, p_chat_id: chatId, p_message_ids: batch });
    if (error || !Array.isArray(data)) throw new Error('Reaktionen konnten nicht geladen werden.');
    for (const row of data) {
      if (!row || !batch.includes(row.message_id) || !isReactionEmoji(row.emoji) || !Number.isSafeInteger(row.count) || row.count < 1 || typeof row.mine !== 'boolean') throw new Error('Reaktionen konnten nicht geladen werden.');
      rows.push({ message_id: row.message_id, emoji: row.emoji, count: row.count, mine: row.mine });
    }
  }
  return rows;
}

// Explicit desired state makes a retry safe even when a response was lost.
export async function setMessageReaction(kind: ReactionKind, chatId: string, messageId: string, emoji: ReactionEmoji | null) {
  if (!supabase || navigator.onLine === false) throw new Error('Zum Reagieren brauchst du eine Internetverbindung.');
  if (emoji !== null && !isReactionEmoji(emoji)) throw new Error('Diese Reaktion ist nicht verfügbar.');
  const { error } = await supabase.rpc('set_message_reaction', { p_kind: kind, p_chat_id: chatId, p_message_id: messageId, p_emoji: emoji });
  if (error) throw new Error('Die Reaktion konnte nicht gespeichert werden. Bitte versuche es erneut.');
}

export function subscribeMessageReactions(kind: ReactionKind, chatId: string, refresh: () => void) {
  if (!supabase) return () => {};
  const table = kind === 'direct' ? 'direct_message_reactions' : 'group_message_reactions';
  const column = kind === 'direct' ? 'conversation_id' : 'group_id';
  const channel = supabase.channel(`message-reactions:${kind}:${chatId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter: `${column}=eq.${chatId}` }, refresh)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: `${column}=eq.${chatId}` }, refresh)
    .subscribe(status => { if (status === 'SUBSCRIBED') refresh(); });
  return () => { void supabase?.removeChannel(channel); };
}
