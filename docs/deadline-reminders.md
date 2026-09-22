# Automatische Fristerinnerungen

Erweitert den vorhandenen mobilen Push-Versand. Unter **Einstellungen → Benachrichtigungen → Auf diesem Gerät → Aufgaben-Erinnerungen** lassen sich Erinnerungen aktivieren, Vortag/Fälligkeitstag auswählen und Uhrzeit sowie Zeitzone speichern. Standardvorschlag: beide Tage um 09:00 in der Browser-Zeitzone. Bestehende Geräte erhalten erst nach ausdrücklichem Speichern eingeschaltete Erinnerungen.

Die Einstellung gilt pro Gerät. Die kontoweite Kategorie **Fällige Aufgaben** gilt zusätzlich. Die gewählte Zeitzone bleibt auf Reisen erhalten. Nur zugewiesene, offene Aufgaben mit Datum und aktueller Workspace-Mitgliedschaft mit Schreibrecht werden erinnert. Antippen öffnet die betreffende Aufgabe im richtigen Workspace und Projekt. Vorschauen bleiben standardmäßig ausgeschaltet. Änderungen und Erledigung werden unmittelbar vor dem Versand erneut geprüft.

## Terminplanung

Der bestehende Minutenjob führt zuerst `private.enqueue_deadline_push()` und anschließend den vorhandenen Push-Weckruf aus. Ohne fällige Arbeit entsteht kein zusätzlicher Edge-Aufruf. Die Planung ist ausschließlich intern ausführbar. Aufgaben werden über den bestehenden Index nach verantwortlicher Person und Datum eingegrenzt.

Die private Warteschlange enthält nur Aufgaben-ID, Stichtag, Erinnerungsart und Versandtermin. Fremdschlüssel entfernen diese Einträge beim Löschen von Aufgabe, Workspace, Sitzung oder Gerät. Derselbe Termin wird pro Gerät/Aufgabe/Stichtag/Erinnerungsart nur einmal geplant; ein bereits gesendeter Termin wird auch nach einer Uhrzeitänderung nicht wiederholt. Noch nicht versandte Erinnerungen können mit geänderter Uhrzeit neu geplant werden. Ein eigener Reminder-Eintrag im Hinweiszentrum ist nicht nötig: Die bestehenden Fälligkeitshinweise bleiben unabhängig erhalten.

Der Versand prüft aktuelle Zuweisung, offenen Status, Datum, Mitgliedschaft/Rolle, Sitzung, Geräte- und Kontofreigabe sowie Uhrzeit/Zeitzone. Verspätete Erinnerungen werden maximal 15 Minuten innerhalb desselben lokalen Kalendertags aufgeholt. Vorherige Tage und alte Fristen werden nicht nachträglich gepusht. Ein bereits vom Push-Anbieter angenommener Hinweis lässt sich bei einer nachfolgenden Aufgabenänderung nicht zurückrufen.

Kalendertage werden vor der Zeitzonenumrechnung bestimmt. Sommer-/Winterzeit folgt der [PostgreSQL-Regel für nicht existierende und doppelte Uhrzeiten](https://www.postgresql.org/docs/current/datetime-invalid-input.html): Eine übersprungene Uhrzeit wird um die Zeitlücke verschoben; bei einer doppelten Stunde gilt die spätere Standardzeit. Auch dann bleibt die Erinnerung einmalig. Der Cron-Auftrag wird über die [offiziellen Planungsfunktionen](https://supabase.com/docs/guides/cron) aktualisiert.

## Gezielte Abnahme

- Unit: neue Vorschau-/Zielpfade, beide Erinnerungsarten und Gerätefreigabe im Produktions-Service-Worker; bestehende direkt betroffene Push- und Benachrichtigungslogik.
- SQL: `tests/sql/deadline-reminders-rls.sql`, ausschließlich synthetische Identitäten und gezielt ausgewähltes Testgerät in einer zurückgerollten Transaktion. Prüft Validierung, Kontogrenzen, Sitzung, Rollen-/Mitgliedschaftsentzug, Zeitfenster, doppelte Aufrufe, Termin-/Uhrzeit-/Zeitzonenänderung, Erledigung, Abschalten, Löschkaskaden, Jahreswechsel, Schaltjahr und Zeitumstellung.
- Browser: Erweiterung der vorhandenen Push-Prüfung um Speichern/Neuladen, Uhrzeit/Zeitzone/Tagesauswahl, Validierung und fehlgeschlagene Speicherung bei 320/390 Pixeln. Benachrichtigungen und PWA werden als direkt betroffene Abläufe mitgeprüft. Anbieter/OS-Zustellung ist im Browser-Test simuliert; die bereits bestätigte physische Push-Zustellung wird nicht erneut als eigener Gerätetest ausgegeben.
- TypeScript und Produktionsbuild bleiben reguläre Veröffentlichungsgates. Alte Phasen werden nicht vollständig wiederholt.

## Veröffentlichung

Am 22.09.2026 zur Veröffentlichung freigegeben. Nachweise:

- Migration `20260922091033_deadline_push_reminders.sql` dauerhaft angewandt; die gezielte SQL-Abnahme bestand vor und nach der Anwendung. Migration zunächst mit der Supabase-CLI erstellt, danach auf den tatsächlich angewandten Versionsstempel abgeglichen.
- Edge Function `mobile-push`, Version 3, aktiv; die bestehende Authentifizierung und VAPID-Schlüssel bleiben erhalten.
- [Gezielte CI-Abnahme](https://github.com/SaluuOG/Nexus-AI-Business-Messenger/actions/runs/35708791497): TypeScript, Build, elf Unit-Tests sowie Push-/Benachrichtigungsabläufe in Chromium und WebKit bestanden. Die PWA-Prüfung bestand bereits im [vorherigen Lauf](https://github.com/SaluuOG/Nexus-AI-Business-Messenger/actions/runs/35708584805); dessen uneindeutige Zeitzonen-Beschriftung wurde korrigiert und erfolgreich nachgeprüft.
- Live-Prüfung des neuen Versandwegs: Ein ausschließlich synthetisches Konto mit isoliertem Workspace, Projekt und Aufgabe erhielt einen fälligen Warteschlangeneintrag. Der echte Minutenjob verarbeitete ihn um 09:13 UTC. Edge antwortete HTTP 200 mit `expired: 1`, ohne Fehler oder Wiederholung; der ausdrücklich nicht existierende FCM-Endpunkt wurde erwartungsgemäß als abgelaufen erkannt. Abonnement und Job wurden automatisch entfernt. Testkonto, Sitzung, Workspace, Projekt und Aufgabe wurden anschließend unter Identitätsprüfung vollständig gelöscht. Kein echtes Gerät wurde adressiert; dies ist kein erneuter physischer Handy-Test.
- Supabase Advisors: keine neuen Sicherheitsfunde und kein fehlender neuer Fremdschlüssel-Index. Der neue FK-Index wird direkt nach Einrichtung noch als unbenutzt gemeldet. Bestehende Hinweise bleiben unverändert; siehe die [Sicherheitsnachweise der Phase 3.9](phase-3-9.md).

Veröffentlichter Commit und Live-Prüfung der App folgen nach Abschluss des Deployments.
