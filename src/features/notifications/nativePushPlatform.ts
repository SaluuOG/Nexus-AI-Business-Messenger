import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import type { NativePushPlatform } from './nativePush';

// No registration or permission request happens by importing this adapter.
function ios() {
  if (Capacitor.getPlatform() !== 'ios') throw new Error('Diese Push-Anbindung ist für die iPhone-App vorgesehen.');
}
export const nativePushPlatform: NativePushPlatform = {
  async permission() { ios(); const { receive } = await PushNotifications.checkPermissions(); return receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt'; },
  async requestPermission() { ios(); return (await PushNotifications.requestPermissions()).receive === 'granted' ? 'granted' : 'denied'; },
  async register(signal) {
    ios();
    if (signal.aborted) throw new Error('Die Geräteanmeldung wurde abgebrochen.');
    const listeners: { remove: () => Promise<void> }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel = () => {};
    let active = true;
    try {
      return await new Promise<string>((resolve, reject) => {
        cancel = () => reject(new Error('Die Geräteanmeldung wurde abgebrochen.'));
        signal.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(() => reject(new Error('Die Geräteanmeldung hat zu lange gedauert. Bitte versuche es erneut.')), 15000);
        void (async () => {
          const tokenListener = await PushNotifications.addListener('registration', token => resolve(token.value));
          listeners.push(tokenListener);
          if (!active || signal.aborted) { await tokenListener.remove(); return; }
          const errorListener = await PushNotifications.addListener('registrationError', () => reject(new Error('Die Geräteanmeldung bei Apple ist fehlgeschlagen.')));
          listeners.push(errorListener);
          if (!active || signal.aborted) { await errorListener.remove(); return; }
          await PushNotifications.register();
        })().catch(() => reject(new Error('Die Geräteanmeldung bei Apple ist fehlgeschlagen.')));
      });
    } finally {
      active = false;
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
      await Promise.all(listeners.map(listener => listener.remove()));
    }
  },
  async unregister() { ios(); await PushNotifications.unregister(); },
  async clearDelivered() { ios(); await PushNotifications.removeAllDeliveredNotifications(); },
};

// Attach only after the native backend is enabled. Keep callbacks free of logs:
// notification.data may contain routing IDs, never feed it to analytics.
export async function listenForNativePushAction(onAction: (data: unknown) => void) {
  ios();
  return PushNotifications.addListener('pushNotificationActionPerformed', action => {
    if (action.actionId === 'tap') onAction(action.notification.data);
  });
}
