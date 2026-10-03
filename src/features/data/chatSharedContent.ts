import { supabase } from '../../lib/supabase';
import type { OrganizationKind } from './chatOrganizationView';

export type SharedCategory = 'images' | 'files' | 'links';
export type SharedCursor = { created_at: string; message_id: string; item_id: string };
export type SharedItem = SharedCursor & {
  kind: OrganizationKind; chat_id: string; title: string; url: string | null;
  storage_path: string | null; mime_type: string | null; file_size: number | null;
};
export type SharedPage = { items: SharedItem[]; has_more: boolean; next_cursor: SharedCursor | null };

export function safeSharedUrl(value: unknown): string | null {
  if (typeof value !== 'string' || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['https:','http:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const validCursor = (value: unknown): value is SharedCursor => {
  if (!value || typeof value !== 'object') return false;
  const c=value as Partial<SharedCursor>;
  return typeof c.created_at==='string' && Number.isFinite(Date.parse(c.created_at)) && typeof c.message_id==='string' && !!c.message_id && typeof c.item_id==='string' && !!c.item_id && c.item_id.length<=100;
};
export async function loadChatSharedContent(kind: OrganizationKind, chatId: string, category: SharedCategory, query='', cursor: SharedCursor | null=null): Promise<SharedPage> {
  if (!supabase || (typeof navigator!=='undefined' && navigator.onLine===false)) throw new Error('Keine Internetverbindung.');
  if (!chatId || !['direct','group'].includes(kind) || !['images','files','links'].includes(category) || Array.from(query.trim()).length>100 || (cursor && !validCursor(cursor))) throw new Error('Ungültiger Filter.');
  const {data,error}=await supabase.rpc('get_chat_shared_content',{
    p_kind:kind,p_chat_id:chatId,p_category:category,p_query:query.trim(),p_limit:24,
    p_before_created_at:cursor?.created_at??null,p_before_message_id:cursor?.message_id??null,p_before_item_id:cursor?.item_id??null,
  });
  if (error) throw new Error('Die Übersicht konnte nicht geladen werden. Prüfe deine Verbindung und deinen Zugriff auf den Chat.');
  const invalid=()=>new Error('Die Übersicht konnte nicht sicher geladen werden.');
  if (!data || !Array.isArray(data.items) || data.items.length>24 || typeof data.has_more!=='boolean') throw invalid();
  const seen=new Set<string>();
  const rows: SharedItem[]=data.items.map((row: unknown)=>{
    if (!validCursor(row)) throw invalid();
    const r=row as SharedItem,key=r.message_id+':'+r.item_id;
    if (r.kind!==kind || r.chat_id!==chatId || typeof r.title!=='string' || !r.title || seen.has(key)) throw invalid();
    seen.add(key);
    if (category==='links') {
      if (!r.item_id.startsWith('l:') || typeof r.url!=='string' || r.storage_path!==null || r.mime_type!==null || r.file_size!==null) throw invalid();
    } else if (!r.item_id.startsWith('a:') || r.url!==null || typeof r.storage_path!=='string' || !r.storage_path.startsWith(kind==='direct'?`${chatId}/`:`groups/${chatId}/`) || typeof r.mime_type!=='string'
      || (category==='images')!==r.mime_type.startsWith('image/') || typeof r.file_size!=='number' || !Number.isSafeInteger(r.file_size) || r.file_size<=0 || r.file_size>25*1024*1024) throw invalid();
    return {...r,url:r.url?safeSharedUrl(r.url):null};
  });
  const next=data.next_cursor;
  if ((rows.length>0 && !validCursor(next)) || (rows.length===0 && (next!==null || data.has_more))) throw invalid();
  const last=rows.at(-1);
  if (last && (last.message_id!==next.message_id || last.item_id!==next.item_id || Date.parse(last.created_at)!==Date.parse(next.created_at))) throw invalid();
  if (cursor && next && cursor.message_id===next.message_id && cursor.item_id===next.item_id && Date.parse(cursor.created_at)===Date.parse(next.created_at)) throw invalid();
  // A mistyped URL in a message must not break the whole overview. Keep the
  // server cursor so a skipped URL cannot prevent loading the next page.
  return {items:rows.filter(row=>category!=='links'||row.url!==null),has_more:data.has_more,next_cursor:next};
}

export async function signSharedItem(item: SharedItem): Promise<string> {
  if (!supabase || !item.storage_path) throw new Error('Datei nicht verfügbar.');
  const {data,error}=await supabase.storage.from('nexus-chat-attachments').createSignedUrl(item.storage_path,60);
  const url=safeSharedUrl(data?.signedUrl);
  if (error || !url) throw new Error('Datei konnte nicht geöffnet werden. Bitte erneut versuchen.');
  return url;
}

export function subscribeSharedContent(kind: OrganizationKind, chatId: string, refresh: () => void) {
  if (!supabase) return ()=>{};
  const channel=supabase.channel(`shared-content:${kind}:${chatId}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:kind+'_messages',filter:`${kind==='direct'?'conversation_id':'group_id'}=eq.${chatId}`},refresh)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:kind+'_messages',filter:`${kind==='direct'?'conversation_id':'group_id'}=eq.${chatId}`},refresh)
    .subscribe();
  return ()=>{void supabase?.removeChannel(channel);};
}
