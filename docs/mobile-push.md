# Mobile Push-Benachrichtigungen

Stand: Am 22.09.2026 veröffentlicht und abgenommen. Backend, gezielte Tests und Live-Prüfung der veröffentlichten App bestanden. Der Benutzer hat am 22.09.2026 den erfolgreichen Empfang auf seinem Handy bestätigt; damit ist auch die ausstehende Geräteabnahme abgeschlossen.

Nexus erhält nach expliziter Zustimmung Push auf dem jeweiligen Gerät. Aktivierung und Test befinden sich unter Einstellungen → Benachrichtigungen → Auf diesem Gerät. Auf iPhone/iPad wird Nexus als Home-Bildschirm-Web-App ab iOS/iPadOS 16.4 benötigt. Browser und Betriebssystem können die Zustellung durch Fokus, Berechtigungen oder fehlende Verbindung beeinflussen.

## Umfang

- Neue direkte Nachrichten und Gruppennachrichten, fremde Aufgabenzuweisungen, neue Aufgabenkommentare.
- Kommentare benachrichtigen den Aufgabenersteller, den Verantwortlichen und bisherige Kommentierende, jeweils nur aktuelle Workspace-Mitglieder und ohne den Autor selbst. Sie erscheinen auch im bisherigen Hinweiszentrum.
- Geräteschalter für Nachrichten, Zuweisungen, Kommentare und Vorschauen. Kontoweite Kategorieeinstellungen gelten zusätzlich.
- Namen und Inhalte auf dem Sperrbildschirm standardmäßig verborgen. Antippen öffnet die konkrete Unterhaltung bzw. die Aufgabe mit Workspace-/Projektkontext.
- Persönlicher Testknopf, maximal alle 30 Sekunden. Aktivierung bestätigt die Registrierung, nicht den tatsächlichen OS-Empfang.

## Versand und Sicherheit

Private Tabellen enthalten Geräteabonnements und eine deduplizierte Warteschlange ohne Nachrichtenkopien. Registrierung ist an eine bestehende Auth-Sitzung gebunden; Sitzungsentfernung löscht Abonnement und Jobs. Abmelden/Kontowechsel trennt zusätzlich das lokale Abonnement und die Worker-Bindung. Der Service Worker speichert keine Zugangstokens oder Nachrichten, nur Konto-/Gerätebindung, Schalter und kurzlebige Zustell-IDs. Der bestehende Offline-Cache enthält weiterhin ausschließlich den öffentlichen Offline-Hinweis.

Der Worker prüft direkt vor Versand Quelle, heutige Zugriffsrechte, Kategorieeinstellungen und Lesestatus erneut. Gelöschte/entzogene Quellen werden verworfen. Vorschauen werden erst dann aus der Quelle gelesen. Client-Endpunkte sind ausschließlich die HTTPS-Endpunkte der Browser-Push-Anbieter; Redirects sind gesperrt. Verschlüsselung und VAPID kommen aus web-push 3.6.7; private Schlüssel liegen ausschließlich im Supabase Vault. Jeder interne Aufruf trägt eine einmal verwendbare, zwei Minuten gültige 256-Bit-Nonce; nur ihr Hash liegt in einer privaten Tabelle. Wiederverwendbare Zugangsschlüssel erscheinen niemals in der pg_net-HTTP-Warteschlange.

Die Datenbank stößt den Versand nach der Transaktion über pg_net an. Ein minütlicher pg_cron-Job ruft nur bei fälliger Arbeit die Edge Function auf. Es gibt höchstens fünf Versuche, begrenzte parallele Anfragen, kurzlebige Leases mit Token gegen verspätete Antworten und Entfernung abgelaufener Abonnements bei 404/410. Alte Hinweise (>15 Minuten) werden nicht nachträglich gepusht; Vendor-TTL ist fünf Minuten. Ein Versandtimeout kann grundsätzlich eine Wiederholung bedeuten; Notification-Tag und kurzlebige IDs begrenzen doppelte Anzeige.

Die Funktion mobile-push nutzt absichtlich verify_jwt=false: Browseraufrufe prüfen ihr Bearer-Token über Supabase Auth getUser; der interne Dispatcher verbraucht atomar eine gültige einmalige Nonce. Service-RPCs sind nur service_role zugänglich, private Tabellen haben keine direkten Client-Grants und ausdrückliche Deny-RLS.

## Betrieb

Nach dem Deploy muss Vault `nexus_push_dispatch_url` auf die Projekt-URL `/functions/v1/mobile-push` zeigen. `private.wake_push_worker(true)` initialisiert die VAPID-Schlüssel über einen intern autorisierten Aufruf. Dies benötigt weder einen zusätzlichen Push-Dienstvertrag noch eine kostenpflichtige KI. Bestehende Supabase-Kontingente gelten weiter.

Keine automatische Deadline-Push-Planung, Anhänge oder bezahlte KI in diesem Schritt. Fälligkeitshinweise bleiben wie bisher innerhalb der App.

## Gezielt prüfen

- `node --test tests/mobile-push.test.mjs tests/notifications.test.mjs`: Anbietergrenzen, private Vorschauen, Links, Worker-Fehlerklassen und Service-Worker-Bindung.
- `tests/sql/mobile-push-rls.sql` in einer zurückgerollten Transaktion: synthetische Identitäten, Registrierung, Session-Bindung, Privatheit, Empfänger, Leases, Wiederholungen, Entzug, Kategorien, Testrate, Logout-Cascade. Keine echten Konten erhalten Testnachrichten.
- Browser: mobile-push, notifications, settings und mobile-install, jeweils Chromium/WebKit. Push-Anbieter/OS-Freigabe sind im neuen UI-Test simuliert; der Produktions-Service-Worker und Offline-Cache werden separat ausgeführt.
- CI wählt nach tatsächlich geänderten Pfaden aus (`tests/run-changed.mjs`); unbekannte Anwendungsänderungen behalten die volle Suite. `--full` bleibt möglich. Build/Typecheck bleiben immer aktiv.
- Für weitere Geräte die tatsächliche Zustellung einmal über „Test senden“ bestätigen; ein Desktop-Browsertest beweist keinen Empfang auf einem physischen Handy. Die Geräteabnahme des Benutzers ist mit seiner Rückmeldung vom 22.09.2026 abgeschlossen.


## Abnahmenachweise vom 22.09.2026 (UTC)

- Migration `20260922030203_mobile_push_notifications.sql` angewendet; exakt dieser Stand auch nach Anwendung mit synthetischen Identitäten und Rollback geprüft.
- Edge Function `mobile-push`, Version 2, aktiv. Der interne Aufruf antwortet HTTP 200; fehlende Authentifizierung und gefälschte Einmal-Nonce antworten beide HTTP 401. Stabile VAPID-Schlüssel wurden erzeugt, ohne private Schlüssel auszugeben.
- Zusätzliche gezielte Live-Prüfung des neuen Versandwegs: synthetische Sitzung und gültige ECDH-Schlüssel, ausdrücklich nicht existierender FCM-Endpunkt. Der Worker verschlüsselte und verschickte den Test-Request, erkannte 404/410 als abgelaufen und entfernte Abonnement/Warteschlangeneintrag (`expired: 1`, keine Wiederholung, HTTP 200). Testkonto und Sitzung anschließend unter Identitätsprüfung gelöscht. Kein echtes Gerät adressiert; dies bestätigt keine physische Handy-Zustellung.
- Supabase Advisors: keine neuen Sicherheitsfunde oder fehlenden FK-Indizes. Die bisherigen Hinweise bleiben unverändert; unbenutzte neue FK-Indizes sind direkt nach Einrichtung erwartbar.
- [Gezielte Browser- und Unit-Abnahme](https://github.com/SaluuOG/Nexus-AI-Business-Messenger/actions/runs/35681775270): Push und Benachrichtigungen in Chromium/WebKit bestanden. Ein vorheriger Test musste auf die asynchrone Speicherbestätigung warten, statt unmittelbar nach dem Klick den Checkbox-Zustand zu erzwingen; diese Korrektur ist integriert.
- [Veröffentlichung und direkt betroffene Regressionen](https://github.com/SaluuOG/Nexus-AI-Business-Messenger/actions/runs/35681952822): 17 ausgewählte Unit-Tests sowie Push, Benachrichtigungen, Einstellungen und PWA/Offline jeweils in Chromium/WebKit bestanden. Keine vollständige Wiederholung der Phase-3.9-Abnahme.

- Veröffentlichter Anwendungscommit: `c49efb58c1cf5b4545cae4aaccd6a50f034e74f8`; Script `/Nexus-AI-Business-Messenger/assets/index-QvJb0uRi.js`. Die Live-Prüfung des Deployments bestand um 03:11 UTC in Chromium und WebKit.
- Zusätzlich im bereits angemeldeten Live-Browser: exakt dieses Script und Einstellungen → Benachrichtigungen geprüft. „Push aktivieren“, die ausgeschaltete Gerätefreigabe und die neue Kategorie „Aufgabenkommentare“ sind sichtbar. Es wurde kein reales Gerät ohne Benutzerfreigabe angemeldet.
- Benutzerbestätigung vom 22.09.2026: „okey funktioniert“ als Antwort auf die Anleitung zum Aktivieren und Testen von Push auf dem Handy. Dies dokumentiert den vom Benutzer bestätigten Empfang und schließt die ausstehende Geräteabnahme ab. Gerätetyp und Betriebssystem wurden nicht angegeben.
