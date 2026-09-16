type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const display = window.matchMedia('(display-mode: standalone)');
let snapshot = {
  installed: display.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
  prompt: null as InstallPrompt | null,
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export const installSnapshot = () => snapshot;
export const subscribeInstall = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

// Capture before lazy-loaded auth/settings screens mount.
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  snapshot = { ...snapshot, prompt: event as InstallPrompt };
  emit();
});
window.addEventListener('appinstalled', () => {
  snapshot = { installed: true, prompt: null };
  emit();
});
display.addEventListener('change', () => {
  snapshot = { ...snapshot, installed: display.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone) };
  emit();
});

export async function requestInstall() {
  const prompt = snapshot.prompt;
  if (!prompt) return;
  snapshot = { ...snapshot, prompt: null };
  emit();
  await prompt.prompt();
  await prompt.userChoice;
}

export function registerMobileApp() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL, updateViaCache: 'none',
    }).catch(() => { /* Online use remains available if the browser blocks storage. */ });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
