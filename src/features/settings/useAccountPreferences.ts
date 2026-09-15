import { useEffect, useState } from 'react';
import { defaultPreferences, readAccountPreferences, saveAccountPreferences, type AccountPreferences } from './preferences';

export function useAccountPreferences(userId?: string) {
  const [snapshot, setSnapshot] = useState(() => ({ userId, preferences: readAccountPreferences(userId), error: null as string | null }));
  useEffect(() => {
    setSnapshot({ userId, preferences: readAccountPreferences(userId), error: null });
  }, [userId]);
  const ready = snapshot.userId === userId;
  const preferences = ready ? snapshot.preferences : defaultPreferences;
  const updatePreferences = (patch: Partial<AccountPreferences>) => {
    const next = { ...preferences, ...patch };
    const saved = saveAccountPreferences(userId, next);
    setSnapshot({ userId, preferences: next, error: saved ? null : 'Dein Browser konnte die Auswahl nicht speichern. Sie gilt bis zum nächsten Neuladen.' });
  };
  return { preferences, updatePreferences, ready, error: ready ? snapshot.error : null };
}
