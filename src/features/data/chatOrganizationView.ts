// Pure view helpers also used by the offline reader, without an API client.
export type OrganizationKind = 'direct' | 'group';
export type ChatOrganization = { favorite?: boolean; archived?: boolean };
export type ChatListView = 'active' | 'favorites' | 'archive';
export type OrganizationField = 'favorite' | 'archived';

export function organizeChats<T extends ChatOrganization>(rows: T[], view: ChatListView): T[] {
  return rows.filter(row => view === 'archive' ? row.archived === true : !row.archived && (view !== 'favorites' || row.favorite === true))
    .sort((a,b) => Number(b.favorite === true) - Number(a.favorite === true));
}
