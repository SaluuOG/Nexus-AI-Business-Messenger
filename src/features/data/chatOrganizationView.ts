// Pure view helpers also used by the offline reader, without an API client.
export type OrganizationKind = 'direct' | 'group';
export type ChatOrganization = { favorite?: boolean; archived?: boolean; muted_until?: string | null; muted_forever?: boolean };
export type ChatMuteMode = 'off' | '1h' | '8h' | 'forever';
export type ChatListView = 'active' | 'favorites' | 'archive';
export type OrganizationField = 'favorite' | 'archived';

export function isChatMuted(state: ChatOrganization, now = Date.now()): boolean {
  return state.muted_forever === true || (typeof state.muted_until === 'string' && Date.parse(state.muted_until) > now);
}

export function organizeChats<T extends ChatOrganization>(rows: T[], view: ChatListView): T[] {
  return rows.filter(row => view === 'archive' ? row.archived === true : !row.archived && (view !== 'favorites' || row.favorite === true))
    .sort((a,b) => Number(b.favorite === true) - Number(a.favorite === true));
}
