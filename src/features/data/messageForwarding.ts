import { supabase } from '../../lib/supabase';
import type { MessageTaskOrigin } from './messageTasks';

export type ForwardTarget = { kind: 'direct' | 'group'; chat_id: string; name: string };
export type ForwardTargets = { items: ForwardTarget[]; has_more: boolean };
export const forwardTargetKey = (target: ForwardTarget) => target.kind + ':' + target.chat_id;

export async function loadForwardTargets(query: string): Promise<ForwardTargets> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.');
  const { data, error } = await supabase.rpc('get_message_forward_targets', { p_query: query.trim() });
  if (error || !data || !Array.isArray(data.items) || typeof data.has_more !== 'boolean') throw new Error('Zielchats konnten nicht geladen werden.');
  const seen = new Set<string>();
  const items: ForwardTarget[] = data.items.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new Error('Ungültiger Zielchat.');
    const value = row as Partial<ForwardTarget>;
    if (!['direct', 'group'].includes(value.kind ?? '') || typeof value.chat_id !== 'string' || !value.chat_id || typeof value.name !== 'string' || !value.name.trim()) throw new Error('Ungültiger Zielchat.');
    const target = { kind: value.kind!, chat_id: value.chat_id, name: value.name };
    const key = forwardTargetKey(target);
    if (seen.has(key)) throw new Error('Doppelter Zielchat.');
    seen.add(key);
    return target;
  });
  return { items, has_more: data.has_more };
}

export async function forwardTextMessage(userId: string, source: MessageTaskOrigin, target: ForwardTarget, requestId: string) {
  const uncertain = 'Versand nicht bestätigt. Prüfe deine Verbindung und versuche es erneut. Derselbe Versuch wird nicht doppelt gesendet.';
  if (!supabase || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { id: null, error: uncertain };
  if (!userId || !source.body.trim() || Array.from(source.body).length > 5000 || source.attachmentName) return { id: null, error: 'Derzeit können nur reine Textnachrichten weitergeleitet werden.' };
  try {
    const { data, error } = await supabase.rpc('forward_text_message', {
      p_user_id: userId, p_source_kind: source.kind, p_source_id: source.messageId,
      p_target_kind: target.kind, p_target_id: target.chat_id, p_expected_body: source.body, p_request_id: requestId,
    });
    if (error) return { id: null, error: ['42501', '22023'].includes(error.code) ? error.message : uncertain };
    return typeof data === 'string' && data ? { id: data, error: null } : { id: null, error: uncertain };
  } catch { return { id: null, error: uncertain }; }
}
