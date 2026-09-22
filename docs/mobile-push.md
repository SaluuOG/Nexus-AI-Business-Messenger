# Mobile Push-Benachrichtigungen

Stand: Implementierung, gezielte Abnahme und Veröffentlichung in Arbeit.

Nexus erhält nach expliziter Zustimmung Push auf dem jeweiligen Gerät. Aktivierung und Test befinden sich unter Einstellungen → Benachrichtigungen → Auf diesem Gerät. Auf iPhone/iPad wird Nexus als Home-Bildschirm-Web-App ab iOS/iPadOS 16.4 benötigt. Browser und Betriebssystem können die Zustellung durch Fokus, Berechtigungen oder fehlende Verbindung beeinflussen.

## Umfang

- Neue direkte Nachrichten und Gruppennachrichten, fremde Aufgabenzuweisungen, neue Aufgabenkommentare.
- Kommentare benachrichtigen den Aufgabenersteller, den Verantwortlichen und bisherige Kommentierende, jeweils nur aktuelle Workspace-Mitglieder und ohne den Autor selbst. Sie erscheinen auch im bisherigen Hinweiszentrum.
- Geräteschalter für Nachrichten, Zuweisungen, Kommentare und Vorschauen. Kontoweite Kategorieeinstellungen gelten zusätzlich.
- Namen und Inhalte auf dem Sperrbildschirm standardmäßig verborgen. Antippen öffnet die konkrete Unterhaltung bzw. die Aufgabe mit Workspace-/Projektkontext.
- Persönlicher Testknopf, maximal alle 30 Sekunden. Aktivierung bestätigt die Registrierung, nicht den tatsächlichen OS-Empfang.

## Versand und Sicherheit

Private Tabellen enthalten Geräteabonnements und eine deduplizierte Warteschlange ohne Nachrichtenkopien. Registrierung ist an eine bestehende Auth-Sitzung gebunden; Sitzungsentfernung löscht Abonnement und Jobs. Abmelden/Kontowechsel trennt zusätzlich das lokale Abonnement und die Worker-Bindung. Der Service Worker speichert keine Zugangstokens oder Nachrichten, nur Konto-/Gerätebindung, Schalter und kurzlebige Zustell-IDs. Der bestehende Offline-Cache enthält weiterhin ausschließlich den öffentlichen Offline-Hinweis.

Der Worker prüft direkt vor Versand Quelle, heutige Zugriffsrechte, Kategorieeinstellungen und Lesestatus erneut. Gelöschte/entzogene Quellen werden verworfen. Vorschauen werden erst dann aus der Quelle gelesen. Client-Endpunkte sind ausschließlich die HTTPS-Endpunkte der Browser-Push-Anbieter; Redirects sind gesperrt. Verschlüsselung und VAPID kommen aus web-push 3.6.7; private Schlüssel und ein separater 256-Bit-Dispatch-Token liegen ausschließlich im Supabase Vault.

Die Datenbank stößt den Versand nach der Transaktion über pg_net an. Ein minütlicher pg_cron-Job ruft nur bei fälliger Arbeit die Edge Function auf. Es gibt höchstens fünf Versuche, begrenzte parallele Anfragen, kurzlebige Leases mit Token gegen verspätete Antworten und Entfernung abgelaufener Abonnements bei 404/410. Alte Hinweise (>15 Minuten) werden nicht nachträglich gepusht; Vendor-TTL ist fünf Minuten. Ein Versandtimeout kann grundsätzlich eine Wiederholung bedeuten; Notification-Tag und kurzlebige IDs begrenzen doppelte Anzeige.

Die Funktion mobile-push nutzt absichtlich verify_jwt=false: Browseraufrufe prüfen ihr Bearer-Token über Supabase Auth getUser; der interne Dispatcher prüft den privaten Vault-Token mit konstantzeitlichem Vergleich. Service-RPCs sind nur service_role zugänglich, private Tabellen haben keine direkten Client-Grants und ausdrückliche Deny-RLS.

## Betrieb

Nach dem Deploy muss Vault `nexus_push_dispatch_url` auf die Projekt-URL `/functions/v1/mobile-push` zeigen. `private.wake_push_worker(true)` initialisiert die VAPID-Schlüssel über einen signierten internen Aufruf. Dies benötigt weder einen zusätzlichen Push-Dienstvertrag noch eine kostenpflichtige KI. Bestehende Supabase-Kontingente gelten weiter.

Keine automatische Deadline-Push-Planung, Anhänge oder bezahlte KI in diesem Schritt. Fälligkeitshinweise bleiben wie bisher innerhalb der App.

## Gezielt prüfen

- `node --test tests/mobile-push.test.mjs tests/notifications.test.mjs`: Anbietergrenzen, private Vorschauen, Links, Worker-Fehlerklassen und Service-Worker-Bindung.
- `tests/sql/mobile-push-rls.sql` in einer zurückgerollten Transaktion: synthetische Identitäten, Registrierung, Session-Bindung, Privatheit, Empfänger, Leases, Wiederholungen, Entzug, Kategorien, Testrate, Logout-Cascade. Keine echten Konten erhalten Testnachrichten.
- Browser: mobile-push, notifications, settings und mobile-install, jeweils Chromium/WebKit. Push-Anbieter/OS-Freigabe sind im neuen UI-Test simuliert; der Produktions-Service-Worker und Offline-Cache werden separat ausgeführt.
- CI wählt nach tatsächlich geänderten Pfaden aus (`tests/run-changed.mjs`); unbekannte Anwendungsänderungen behalten die volle Suite. `--full` bleibt möglich. Build/Typecheck bleiben immer aktiv.
- Die tatsächliche Zustellung auf einem physischen iPhone/Android muss der Benutzer einmal über „Test senden“ bestätigen; sie kann nicht durch einen Desktop-Browsertest bewiesen werden.
