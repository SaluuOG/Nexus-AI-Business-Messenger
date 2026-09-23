import { supabase } from '../../lib/supabase';

export const ACCOUNT_DELETION_CONFIRMATION = 'KONTO LÖSCHEN';

export async function deleteCurrentAccount(confirmation: string) {
  if (!supabase) return { error: 'Supabase ist noch nicht konfiguriert.' };

  const { data, error } = await supabase.functions.invoke('delete-account', {
    body: { confirmation },
  });
  if (error) {
    const context = error.context as Response | undefined;
    if (context) {
      try {
        const payload = await context.json() as { error?: string };
        if (payload.error) return { error: payload.error };
      } catch {
        // Use the stable public fallback below.
      }
    }
    return { error: 'Das Konto konnte gerade nicht gelöscht werden. Bitte versuche es erneut.' };
  }
  if (!data?.deleted) return { error: 'Das Konto konnte nicht bestätigt gelöscht werden.' };

  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // The server has already deleted the account. Local state is cleared by
    // the auth listener or during the next startup if this call is unavailable.
  }
  return { error: null };
}

