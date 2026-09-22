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

Veröffentlichung und Live-Abnahme werden nach erfolgreicher Bereitstellung ergänzt.
