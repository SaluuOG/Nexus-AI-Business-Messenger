import { supabase } from '../../lib/supabase';
import { Capacitor } from '@capacitor/core';

export type ReminderOptions = { deadlines: boolean; reminder_before: boolean; reminder_due: boolean; reminder_time: string; reminder_timezone: string };
export type PushOptions = { messages: boolean; assignments: boolean; comments: boolean; previews: boolean } & ReminderOptions;
export type PushStatus = PushOptions & { enabled: boolean };
export const defaultPushStatus: PushStatus = { enabled: false, messages: true, assignments: true, comments: true, previews: false,
  deadlines: false, reminder_before: true, reminder_due: true, reminder_time: '09:00', reminder_timezone: '' };
const storageKey = 'nexus-push-device-v1';
type LocalDevice = { id: string; userId: string | null; status: PushStatus };
let account: string | null | undefined;
let accountReady: Promise<void> = Promise.resolve();
let generation = 0;

export function pushSupport(): 'supported' | 'install' | 'unavailable' | 'native-pending' {
  if (Capacitor.isNativePlatform()) return 'native-pending';
  const standalone = matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !standalone) return 'install';
  return isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window ? 'supported' : 'unavailable';
}

function localDevice(): LocalDevice {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    try {
      const value = JSON.parse(saved) as LocalDevice;
      if (/^[0-9a-f-]{36}$/.test(value.id) && value.status) return value;
    } catch { /* A corrupt device marker can be replaced without resetting the account. */ }
  }
  const value = { id: crypto.randomUUID(), userId: null, status: { ...defaultPushStatus } };
  localStorage.setItem(storageKey, JSON.stringify(value));
  return value;
}

async function registration() {
  if (pushSupport() !== 'supported') throw new Error('Push wird in diesem Browser noch nicht unterstützt.');
  // Explicit registration also supports the first visit before window.load.
  const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' });
  if (!reg.active) {
    await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Nexus wird noch aktualisiert. Bitte kurz warten und erneut versuchen.')), 8000))]);
  }
  return reg;
}

async function binding(reg: ServiceWorkerRegistration, device: LocalDevice | null) {
  const worker = reg.active;
  if (!worker) throw new Error('Nexus wird noch aktualisiert. Bitte erneut versuchen.');
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Geräteeinstellung konnte nicht gespeichert werden. Bitte Nexus neu laden.')); }, 5000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      if (event.data?.ok) resolve(); else reject(new Error('Geräteeinstellung konnte nicht gespeichert werden.'));
    };
    worker.postMessage({ type: 'NEXUS_PUSH_BINDING', binding: device?.status.enabled ? { userId: device.userId, deviceId: device.id, ...device.status } : null }, [channel.port2]);
  });
}

async function rpc(action: string, device: LocalDevice, extra: Record<string, unknown> = {}) {
  if (!supabase) throw new Error('Bitte melde dich an.');
  const { data, error } = await supabase.rpc('manage_push_device', { p_action: action, p_device_id: device.id, ...extra });
  if (error) throw new Error(error.message);
  if (!data || typeof data.enabled !== 'boolean') throw new Error('Push-Einstellungen konnten nicht geladen werden.');
  return { ...defaultPushStatus, ...data } as PushStatus;
}

function guard(userId: string, started: number) {
  if (account !== userId || generation !== started) throw new Error('Das Konto wurde gewechselt. Bitte erneut versuchen.');
}

// Called after auth loading, and synchronously before explicit sign-out. The
// worker stores only account/device binding and preferences, never auth tokens.
export function syncPushAccount(userId: string | null): Promise<void> {
  if (account === userId) return accountReady;
  account = userId;
  const started = ++generation;
  const previous = accountReady;
  accountReady = (async () => {
    await previous;
    if (pushSupport() !== 'supported' || started !== generation) return;
    let reg: ServiceWorkerRegistration | undefined;
    try {
      reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      if (!reg?.active || started !== generation) return;
      const device = localDevice();
      if (device.userId !== userId || !userId) {
        await binding(reg, null);
        if (started !== generation) return;
        const sub = await reg.pushManager.getSubscription();
        await sub?.unsubscribe();
        if (started !== generation) return;
        localStorage.setItem(storageKey, JSON.stringify({ ...device, userId, status: { ...defaultPushStatus } }));
      } else await binding(reg, device);
    } catch {
      // Fail closed even if local storage or unsubscription is blocked.
      if (reg?.active && started === generation) await binding(reg, null).catch(() => {});
    }
  })();
  return accountReady;
}

export async function loadPushStatus(userId: string): Promise<PushStatus> {
  const started = generation;
  await accountReady;
  guard(userId, started);
  const device = localDevice();
  if (device.userId !== userId || !device.status.enabled || Notification.permission !== 'granted') return { ...defaultPushStatus };
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  guard(userId, started);
  const status = sub ? await rpc('status', device) : { ...defaultPushStatus };
  guard(userId, started);
  const next = { ...device, status };
  await binding(reg, next);
  guard(userId, started);
  localStorage.setItem(storageKey, JSON.stringify(next));
  return status;
}

export async function enablePush(userId: string) {
  const started = generation;
  // Permission must be requested directly from the tap (especially iOS).
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Benachrichtigungen sind blockiert. Erlaube sie in den Browser- oder Geräteeinstellungen und versuche es erneut.' : 'Du hast die Freigabe noch nicht bestätigt. Du kannst Push später aktivieren.');
  await accountReady;
  guard(userId, started);
  const reg = await registration();
  guard(userId, started);
  const device = localDevice();
  if (!supabase) throw new Error('Bitte melde dich an.');
  const { data, error } = await supabase.functions.invoke('mobile-push', { body: {} });
  if (error || !data?.publicKey) throw new Error('Push ist gerade nicht erreichbar. Bitte erneut versuchen.');
  guard(userId, started);
  let sub = await reg.pushManager.getSubscription();
  const key = Uint8Array.from(atob(data.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  if (sub) {
    const existing = sub.options.applicationServerKey;
    if (device.userId !== userId || (existing && String(new Uint8Array(existing)) !== String(key))) { await sub.unsubscribe(); sub = null; }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try {
    guard(userId, started);
    const status = await rpc('register', device, { p_subscription: sub.toJSON() });
    if (!status.enabled) throw new Error('Push konnte nicht aktiviert werden. Bitte erneut versuchen.');
    guard(userId, started);
    const next = { ...device, userId, status };
    await binding(reg, next);
    guard(userId, started);
    localStorage.setItem(storageKey, JSON.stringify(next));
    return status;
  } catch (error) {
    await sub.unsubscribe().catch(() => false);
    if (account === userId && generation === started) await binding(reg, null).catch(() => {});
    throw error;
  }
}

export async function changePushOptions(userId: string, options: Partial<PushOptions>) {
  const started = generation;
  const device = localDevice();
  guard(userId, started);
  const status = await rpc('options', device, { p_options: options });
  guard(userId, started);
  const next = { ...device, userId, status };
  const reg = await registration();
  guard(userId, started);
  await binding(reg, next);
  guard(userId, started);
  localStorage.setItem(storageKey, JSON.stringify(next));
  return status;
}

export async function disablePush(userId: string) {
  const device = localDevice();
  const started = generation;
  const reg = await registration();
  guard(userId, started);
  await binding(reg, null); // Hide queued deliveries before the server request.
  const status = await rpc('remove', device);
  guard(userId, started);
  await (await reg.pushManager.getSubscription())?.unsubscribe();
  localStorage.setItem(storageKey, JSON.stringify({ ...device, userId, status }));
  return status;
}

export async function testPush(userId: string) {
  guard(userId, generation);
  await rpc('test', localDevice());
}
