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

In Umsetzung; Ergebnisse und veröffentlichter Commit werden nach der Abnahme ergänzt.
