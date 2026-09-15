import { Bell, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { notificationCategories, type NotificationCategory } from '../features/notifications/notifications';
import type { NotificationsModel } from '../features/notifications/useNotifications';

export function NotificationPreferences({ model }: { model: NotificationsModel }) {
  const [saved, setSaved] = useState(false);
  const change = async (category: NotificationCategory, enabled: boolean) => {
    setSaved(false);
    if (await model.savePreference(category, enabled)) setSaved(true);
  };
  return <div className="panel notification-preferences">
    <Bell /><h3>Deine Hinweise</h3>
    <p>Wähle, welche Hinweise in deiner Übersicht und im Zähler erscheinen. Die Auswahl wird für dein Konto gespeichert und gilt auf allen Geräten.</p>
    <div className="notification-options">
      {notificationCategories.map(category => <label key={category.id} className="notification-option">
        <span><b>{category.label}</b><small>{category.description}</small></span>
        <input type="checkbox" role="switch" aria-label={category.label} checked={model.preferences[category.id]} disabled={model.busy || model.loading || Boolean(model.error)} onChange={event => void change(category.id, event.target.checked)} />
      </label>)}
    </div>
    {(model.actionError || model.error) && <p className="form-feedback error" role="alert">{model.actionError || model.error}</p>}
    {model.error && <button className="secondary" onClick={() => void model.refresh()}>Erneut versuchen</button>}
    {model.busy && <p role="status">Einstellung wird gespeichert…</p>}
    {saved && !model.busy && !model.actionError && !model.error && <p className="notification-saved" role="status"><CheckCircle2 size={15} /> Einstellung gespeichert.</p>}
    <p>Ausgeblendete Hinweise behalten ihren Gelesen-Status. Wenn du eine Kategorie wieder einschaltest, erscheinen ihre noch verfügbaren Hinweise erneut. Fristen werden nach der lokalen Zeitzone deines Geräts geprüft.</p>
  </div>;
}
