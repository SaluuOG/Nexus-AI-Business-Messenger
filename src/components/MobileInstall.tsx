import { useState, useSyncExternalStore } from 'react';
import { Smartphone } from 'lucide-react';
import { installSnapshot, requestInstall, subscribeInstall } from '../features/mobile/install';

export function MobileInstall() {
  const { installed, prompt } = useSyncExternalStore(subscribeInstall, installSnapshot);
  const [error, setError] = useState(false);
  return <section className="mobile-install" aria-label="Nexus auf dem Handy">
    <h3><Smartphone size={18} aria-hidden="true" /> Nexus auf deinem Handy</h3>
    {installed ? <p>Nexus ist als App eingerichtet.</p> : <>
      <p>Direkt vom Home-Bildschirm starten – mit deinem bestehenden Konto.</p>
      {prompt && <button className="primary" type="button" onClick={() => {
        setError(false);
        void requestInstall().catch(() => setError(true));
      }}>Nexus installieren</button>}
      {error && <p role="status">Nutze bitte die Installationsschritte im Browsermenü.</p>}
      <details>
        <summary>So installierst du Nexus</summary>
        <p><strong>iPhone / iPad:</strong> In Safari öffnen → Teilen → Zum Home-Bildschirm. „Als Web-App öffnen“ aktivieren, falls angeboten, und hinzufügen.</p>
        <p><strong>Android:</strong> In Chrome öffnen → Menü ⋮ → App installieren oder Zum Startbildschirm hinzufügen.</p>
        <p>Für Chats und Aufgaben brauchst du eine Internetverbindung.</p>
      </details>
    </>}
  </section>;
}
