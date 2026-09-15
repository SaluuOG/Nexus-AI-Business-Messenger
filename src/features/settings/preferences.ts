import { routes } from '../../app/routes';
import type { IdentityMode } from '../../types';

export const startViews = [
  { id: 'briefing', label: 'Tagesbriefing', route: routes.briefing },
  { id: 'chats', label: 'Chats', route: routes.chats },
  { id: 'groups', label: 'Gruppen', route: routes.groups },
  { id: 'business', label: 'Business & Aufgaben', route: routes.business },
] as const;
export type StartView = (typeof startViews)[number]['id'];
export type AccountPreferences = { identity: IdentityMode; startView: StartView };
export const defaultPreferences: AccountPreferences = { identity: 'business', startView: 'briefing' };

export function normalizePreferences(value: unknown): AccountPreferences {
  const candidate = value && typeof value === 'object' ? value as Partial<AccountPreferences> : {};
  return {
    identity: candidate.identity === 'private' ? 'private' : 'business',
    startView: startViews.some(view => view.id === candidate.startView) ? candidate.startView! : 'briefing',
  };
}
export const startRoute = (view: StartView) => startViews.find(item => item.id === view)?.route ?? routes.briefing;
const storageKey = (userId: string) => 'nexus.preferences.v1:' + userId;

export function readAccountPreferences(userId?: string): AccountPreferences {
  if (!userId) return { ...defaultPreferences };
  try { return normalizePreferences(JSON.parse(localStorage.getItem(storageKey(userId)) || 'null')); }
  catch { return { ...defaultPreferences }; }
}
export function saveAccountPreferences(userId: string | undefined, preferences: AccountPreferences) {
  if (!userId) return false;
  try { localStorage.setItem(storageKey(userId), JSON.stringify(normalizePreferences(preferences))); return true; }
  catch { return false; }
}
