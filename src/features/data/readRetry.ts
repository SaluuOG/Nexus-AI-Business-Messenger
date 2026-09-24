type ReadError = string | { message?: string } | null | undefined;

export function isFutureTokenError(error: ReadError): boolean {
  const message = typeof error === 'string' ? error : error?.message;
  return message?.trim().toLowerCase() === 'jwt issued at future';
}

// Only use for reads: retry this specific transient rejection, never mutations
// or generic auth/permission failures. Leave session and JWT validation intact.
export async function retryRead<T extends { error: ReadError }>(
  read: () => PromiseLike<T>,
  current: () => boolean = () => true,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<T> {
  let result = await read();
  for (const delay of [1000, 2000]) {
    if (!isFutureTokenError(result.error) || !current()) break;
    await wait(delay);
    if (!current()) break;
    result = await read();
  }
  return result;
}

export function briefingLoadError(error: string): string {
  return isFutureTokenError(error)
    ? 'Deine Sitzung kann gerade noch nicht bestätigt werden. Bitte lade die Übersicht erneut.'
    : 'Die Übersicht konnte nicht vollständig geladen werden. Bitte versuche es erneut.';
}
