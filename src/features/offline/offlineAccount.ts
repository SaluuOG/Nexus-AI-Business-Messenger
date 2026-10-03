// An identifier for local reading only. Never an authentication/session fallback.
const STORAGE_KEY = 'nexus-offline-account-v1';
export function savedOfflineAccount(): string | null {
  try {
    if (localStorage.getItem('nexus-offline-reset')) return null;
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return typeof value?.id === 'string' && Number.isFinite(value.at)
      && value.at <= Date.now() && Date.now() - value.at < 30 * 86400000 ? value.id : null;
  } catch { return null; }
}
export function rememberOfflineAccount(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, at: Date.now() }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* Storage is optional. */ }
}
