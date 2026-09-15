import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { emptyNotificationFeed, loadNotifications, markNotificationsRead, saveNotificationPreference, type NotificationCategory, type NotificationFeed } from './notifications';

export function useNotifications(userId: string | undefined, route: string) {
  const [snapshot, setSnapshot] = useState<{ userId?: string; feed: NotificationFeed }>({ userId, feed: emptyNotificationFeed() });
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(25);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [connected, setConnected] = useState(false);
  const version = useRef(0);
  const action = useRef(false);
  const activeUser = useRef(userId);
  activeUser.current = userId;
  const feed = snapshot.userId === userId ? snapshot.feed : emptyNotificationFeed();
  const refresh = useCallback(async () => {
    const request = ++version.current;
    if (!userId) { setSnapshot({ userId, feed: emptyNotificationFeed() }); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await loadNotifications(limit, unreadOnly);
      if (request !== version.current || activeUser.current !== userId) return;
      setSnapshot({ userId, feed: data }); setError(null);
    } catch {
      if (request !== version.current || activeUser.current !== userId) return;
      setSnapshot(current => ({ userId, feed: { ...emptyNotificationFeed(), preferences: current.userId === userId ? current.feed.preferences : emptyNotificationFeed().preferences } }));
      setError('Benachrichtigungen konnten nicht aktualisiert werden. Bitte erneut versuchen.');
    } finally { if (request === version.current) setLoading(false); }
  }, [userId, limit, unreadOnly]);

  useEffect(() => {
    void refresh();
    return () => { ++version.current; };
  }, [refresh, route]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { if (active) void refresh(); }, 180); };
    const visible = () => { if (document.visibilityState === 'visible') schedule(); };
    const channel = supabase?.channel('notifications:' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: 'recipient_id=eq.' + userId }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_preferences', filter: 'user_id=eq.' + userId }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_tasks' }, schedule)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_members' }, schedule)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'workspace_members' }, schedule)
      .subscribe(status => { if (active) { setConnected(status === 'SUBSCRIBED'); if (status === 'SUBSCRIBED') schedule(); } });
    // Reconcile missed events, permission changes, expired invitations and local
    // midnight even when a websocket is temporarily unavailable.
    const interval = window.setInterval(visible, 30_000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    return () => {
      active = false; clearTimeout(timer); window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); window.removeEventListener('online', visible);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [userId, refresh]);

  const perform = async (operation: () => Promise<void>, message: string) => {
    if (action.current || !userId) return false;
    action.current = true; setBusy(true); setActionError(null); ++version.current;
    try {
      await operation();
      if (activeUser.current !== userId) return false;
      await refresh(); return true;
    } catch {
      if (activeUser.current === userId) setActionError(message);
      return false;
    } finally { action.current = false; if (activeUser.current === userId) setBusy(false); }
  };
  return {
    ...feed, loading, error, actionError, busy, connected, unreadOnly, refresh,
    setUnreadOnly: (value: boolean) => { setLimit(25); setUnreadOnly(value); },
    loadMore: () => setLimit(current => current + 25),
    markRead: (id?: string) => perform(() => markNotificationsRead(feed.through_id, id), 'Der Gelesen-Status konnte nicht gespeichert werden. Bitte erneut versuchen.'),
    savePreference: (category: NotificationCategory, enabled: boolean) => perform(() => saveNotificationPreference(category, enabled), 'Die Einstellung konnte nicht gespeichert werden. Bitte erneut versuchen.'),
  };
}
export type NotificationsModel = ReturnType<typeof useNotifications>;
