// A failed/uncertain response must enter the existing manual retry workflow.
// Never retry writes automatically; reuse the original client request ID.
export async function safeTextSend<T extends { data: unknown; error: { message: string } | null }>(request: () => PromiseLike<T>) {
  const failure = { data: null, error: { message: 'Senden nicht bestätigt. Dein Text bleibt erhalten. Bitte prüfe die Verbindung und nutze „Erneut senden“.' } };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return failure;
  try { return await request(); } catch { return failure; }
}
