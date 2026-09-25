export const READ_UNAVAILABLE = 'Die Daten konnten nicht geladen werden. Bitte prüfe deine Verbindung und versuche es erneut.';
export function readableLoadError(error: string): string {
  return /load failed|failed to fetch|networkerror|network request failed|fetch failed|network connection|internet connection/i.test(error) ? READ_UNAVAILABLE : error;
}
// A failed list read is not an empty list. Callers retain their last successful
// in-memory result and render the failure separately from the empty state.
export async function readChatList<T>(read: () => Promise<{ data: T[]; error: string | null }>): Promise<{ data: T[]; error: string | null }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { data: [], error: READ_UNAVAILABLE };
  try {
    const result = await read();
    return { ...result, error: result.error ? readableLoadError(result.error) : null };
  } catch { return { data: [], error: READ_UNAVAILABLE }; }
}
