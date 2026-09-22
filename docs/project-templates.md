# Projektvorlagen

Owner und Admin können unter **Projekte → Als Vorlage speichern** einen wiederverwendbaren Ablauf speichern. Das Startdatum des Ausgangsprojekts bestimmt die relativen Aufgabenfristen und Projektdeadline. Beim Anlegen eines neuen Projekts: Vorlage auswählen, neues Startdatum setzen und **Vorlage übernehmen**. Titel, Beschreibung, Prioritäten, Aufgaben, Zuständigkeiten, Termine und Checklisten lassen sich anschließend prüfen und bearbeiten.

Die Vorlage enthält Projektbeschreibung/Priorität sowie Aufgabentitel, Beschreibungen, Prioritäten, relative Fristen und Checklistenbeschriftungen. Neue Aufgaben sind offen, Checklisten ungeprüft und Zuständigkeiten zunächst frei. Kunden, Auftragswerte, Kommentare, Anhänge und Chat-Verknüpfungen werden nicht kopiert. Ein bestehender Entwurf wird nur nach ausdrücklicher Bestätigung ersetzt. Eine Änderung des Startdatums wirkt erst bei erneuter Übernahme.

Vorlagen sind unveränderliche Momentaufnahmen innerhalb eines Workspace. Änderungen oder Löschung des Ausgangsprojekts ändern die Vorlage nicht. Entfernen ist im Vorlagenwähler mit einer Bestätigung innerhalb der App möglich. Bereits angelegte Projekte bleiben erhalten. Grenze: 100 aktive Vorlagen je Workspace; je Vorlage 50 Aufgaben, 100 Checklistenpunkte je Aufgabe und 500 insgesamt.

## Daten und Berechtigungen

- `project_templates`: RLS, ausdrückliches SELECT für angemeldete Owner/Admin; keine direkten Client-Schreibrechte.
- Private Funktionen überprüfen eine aktive Auth-Sitzung und sperren die aktuelle Owner/Admin-Mitgliedschaft. Öffentliche RPC-Wrapper laufen als SECURITY INVOKER; die begrenzten privaten SECURITY-DEFINER-Funktionen verwenden einen leeren Suchpfad und explizite Execute-Grants.
- Aufnahme des Projekts und seiner Aufgaben/Checklisten in einer SQL-Anweisung mit konsistentem Snapshot; keine clientseitig erfundenen Ausgangsdaten.
- Stabile Anfrage-ID, erste erfolgreiche Aufnahme gewinnt. Entfernte Vorlagen behalten eine minimale Sperrmarkierung; eine alte Anfrage kann sie nicht wiederherstellen. Workspace-Löschung entfernt auch diese Einträge.
- `create_project_with_tasks` bleibt rückwärtskompatibel. Optionale Checklisten entstehen in derselben Transaktion wie Projekt und Aufgaben. Ungültige Checklisten oder Zuständigkeiten hinterlassen kein Teilprojekt. Wiederholungen erzeugen keine doppelten Aufgaben/Punkte.
- Formulare bleiben im Speicher; Account/Workspace-Wechsel oder Entzug der Verwaltungsrolle verwerfen den offenen Vorlagendialog und verspätete Antworten.

## Gezielte Prüfung

- `tests/project-templates.test.mjs`: Kalenderarithmetik (Sommerzeit, Schaltjahr, Jahreswechsel), unabhängige Entwürfe, Checklistenlimits, Workspace-Anfragen, sichere Fehlermeldungen.
- `tests/sql/project-templates-rls.sql`: echter Postgres, isolierte synthetische Datensätze, abschließendes ROLLBACK. Rollen, Mandantentrennung, widerrufene Sitzung, Wiederholungen, atomare Checklistenanlage, manuelle Anlage, Entfernen und Kaskaden.
- `tests/browser/project-templates.mjs`: Chromium/WebKit mit synthetischem Dienst, Speichern/Übernehmen, angepasste Fristen/Zuständigkeiten/Checklisten, verlorene Antworten, manuelle Anlage, Bestätigung zum Entfernen, 320/390 Pixel und verspätete Antworten bei Rollen-/Kontowechsel.
- Zusätzlich direkt betroffene Business- und Aufgaben-Datentests; TypeScript und Produktionsbuild.

Backend-Migration `20260922171611_project_templates.sql` am 22.09.2026 eingespielt. SQL-Abnahme vor und nach der Migration erfolgreich. Keine neuen Security-Advisory-Funde; nur die drei zunächst unbenutzten neuen Indizes werden als Performance-Information gemeldet. Die Business-Verwaltungsrechte folgen jetzt der per Realtime/Fokus aktualisierten Teammitgliedschaft.

Branch-Abnahme: Lauf `35761249927`, Commit `8340ce601109e21a338b9599b41b853bdc1447d9`, erfolgreich. 15 gezielte Unit-Tests sowie Chromium und WebKit bestanden.

Veröffentlichungscommit: `f28b3e449f8aac51f759e84d1b16dd6e5390ba44`. Veröffentlichung erfolgreich: Lauf `35761503987` (Build `106860396576`, Deployment `106860893835`). Ausgelieferter Einstieg: `/Nexus-AI-Business-Messenger/assets/index-DBxroj8p.js`.

Live-Abnahme am 22.09.2026 mit einer bestehenden echten Sitzung in einem isolierten Workspace mit genau einem Mitglied:

- Vorlage über die veröffentlichte Oberfläche gespeichert; serverseitig eine Momentaufnahme mit einer Aufgabe und zwei Checklistenpunkten bestätigt.
- Gespeicherter Ausgangsstart 22.09.2026; Aufgabenabstand 11 Tage, Projektabstand 23 Tage. Mit neuem Start 01.11.2026 zeigte die Oberfläche 12.11.2026 und 24.11.2026. Die Aufgabe wurde vor dem Anlegen auf 13.11.2026 verschoben, zugewiesen und um einen dritten Checklistenpunkt ergänzt.
- Tatsächlich gespeicherter Projektstatus `planning`, Fortschritt 0, Deadline 24.11.2026; genau eine offene Aufgabe mit der gewählten Person und Frist 13.11.2026; drei ungeprüfte Checklistenpunkte. Das Ausgangsprojekt und seine erledigte Checkliste blieben unverändert.
- Neues Projekt und Aufgabe wurden in der Live-Oberfläche angezeigt. Nach Öffnen der Zusammenarbeit brach die Verbindung zum Prüfbrowser ab; die abschließende Sichtprüfung dieses Bereichs und der Screenshot waren deshalb nicht mehr möglich. Checklistenpersistenz wurde direkt im Backend bestätigt, ihre Darstellung zusätzlich in beiden automatisierten Browserprüfungen.
- Beim ersten Aufruf während der Veröffentlichung war ein neuer dynamischer App-Baustein noch nicht abrufbar; nach vollständiger Bereitstellung und Neuladen funktionierte die neue Oberfläche. Die betreffende Datei antwortete anschließend mit HTTP 200.
- Alle Abnahmedaten danach entfernt. Workspace, Projekte, Aufgaben, Checklisten und Vorlagen für den isolierten Testbereich: jeweils 0 verbliebene Datensätze.
