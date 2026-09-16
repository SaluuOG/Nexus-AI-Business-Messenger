# Phase 3.9 — Zusammenarbeit an Aufgaben

Basis: veröffentlichte und am 16. September 2026 vollständig abgenommene Phase 3.8,
Commit `94cab678d07604ec82c6ca11dca107e191acba4f`.

## Umfang

Über **Details & Zusammenarbeit** an einer Aufgabenkarte öffnet sich die bestehende
Aufgaben-URL. Dort können Teammitglieder kommentieren, Checklistenpunkte anlegen,
bearbeiten, erledigen und entfernen. Der Verlauf erfasst neue Aufgaben, Änderungen
an den Aufgabenfeldern und Aktionen an Kommentaren und Checklisten automatisch.

| Rolle | Lesen | Kommentare | Checkliste | Verlauf ändern |
|---|---|---|---|---|
| Owner / Admin | Ja | Erstellen, eigene bearbeiten, alle entfernen | Vollständig | Nein |
| Member | Ja | Erstellen, eigene bearbeiten/entfernen | Vollständig | Nein |
| Guest | Ja | Nein | Nein | Nein |
| Kein Mitglied / anonym | Nein | Nein | Nein | Nein |

Kommentare sind für alle Mitglieder des betreffenden Workspaces sichtbar. Der
Verlauf enthält ausschließlich Aktionsarten, Feldnamen, Zeitpunkt und Akteur;
er archiviert keine Kommentar- oder Chattexte. Ehemalige Mitglieder werden über
einen neutralen Namen dargestellt. Beim Löschen eines Kontos bleibt dessen
geteilter Inhalt erhalten, während die Kontoreferenz auf `NULL` gesetzt wird.

## Daten und Synchronisierung

Migration: `supabase/migrations/20260916111035_task_collaboration.sql`, mit der
Supabase-CLI erzeugt. Neue Tabellen: `task_comments`, `task_checklist_items` und
`task_activity`. Zusammengesetzte Fremdschlüssel verhindern eine Zuordnung zu
Aufgaben eines anderen Workspaces. RLS prüft die aktuelle Mitgliedschaft; die
öffentlichen Spaltenrechte verhindern gefälschte Autoren, Zeitpunkte und Revisionen.

Revisionen schützen bearbeitete und entfernte Einträge vor einem veralteten
Browserstand. Clientseitige Vorgangs-IDs ermöglichen Wiederholungen nach einer
verlorenen Antwort. Beim Wiederholen muss der vorhandene Eintrag zu Autor, Task,
Workspace und identischem Eingabetext passen; bestehender Inhalt wird nicht
überschrieben. Diese Wiederholungs-ID bleibt nur während des aktuellen Formulars
erhalten. Entwürfe werden nicht dauerhaft gespeichert.

Kommentar- und Verlauf-Seiten verwenden `(created_at, id)` als Cursor. Ein Refresh
liest das gesamte bereits geöffnete Fenster erneut. Checklisten werden vollständig
in mehreren Seiten geladen. Realtime berücksichtigt auch DELETE-Ereignisse mit
nur einem Primärschlüssel. Fokuswechsel und ein Abgleich alle 30 Sekunden bei
sichtbarem Tab fangen unterbrochene Realtime-Verbindungen auf. Wechsel von Konto,
Workspace, Aufgabe oder Rolle verwerfen den Zustand des vorherigen Kontexts.

## Verifikation

- `npm run typecheck`
- `npm test`, einschließlich `tests/task-collaboration.test.mjs`
- `npm run build`
- `tests/sql/task-collaboration-rls.sql`: ausschließlich synthetische Identitäten
  und Datensätze; abschließendes `ROLLBACK`. Prüft Rollen, eigenes/fremdes
  Bearbeiten, Moderation, Gast-Downgrade, Mitgliedschaftsentzug, anonyme Zugriffe,
  Workspace-Grenzen, Längen, Audit-Fälschungen, Revisionen, Wiederholungen,
  Verlaufsschutz, Kontoanonymisierung und Löschkaskade. Mit der neuen Migration
  zusammen erfolgreich in einer vollständig zurückgerollten Transaktion geprüft.
- `tests/browser/task-collaboration.mjs`: Chromium und WebKit; Kommentare,
  verlorene Antwort/Wiederholung, Checklisten, Revisionenkonflikt, Verlauf,
  320-/390-Pixel-Ansichten, mehrseitige Kommentare mit gleichen Zeitstempeln,
  Realtime für ältere Einträge, Rollenwechsel, Moderation, Lesefehler,
  Workspace-/Kontowechsel und Zugriffsverlust. In die bestehenden CI- und
  Veröffentlichungsgates aufgenommen. Ergebnisse im zugehörigen GitHub-Lauf prüfen.

## Veröffentlichung und Live-Abnahme

Der Arbeitszweig ist noch keine veröffentlichte Version. Die Migration wurde für
die Entwicklung nur innerhalb der zurückgerollten Prüfung ausgeführt und ist
noch nicht dauerhaft in der Produktivdatenbank installiert.

1. CI auf dem konkreten Freigabe-Commit erfolgreich abschließen.
2. Migration einmalig in das vorhandene Nexus-Supabase-Projekt übernehmen;
   anschließend Sicherheits-/Performance-Advisors prüfen und Berechtigungen sowie
   Realtime-Publikation der drei Tabellen bestätigen.
3. Frontend veröffentlichen und exaktes Release-Asset prüfen.
4. Mit zwei echten Konten in einem eigens angelegten Test-Workspace Kommentar,
   Checklistenzustand, Realtime, Rollenwechsel und erneutes Laden abnehmen.
5. Testdaten bereinigen und den endgültigen Abschluss von 3.9 dokumentieren.

Neue Chat-/E-Mail-Benachrichtigungen, Anhänge an Kommentaren und KI-Funktionen
gehören nicht zu diesem Umfang. Die kostenpflichtige KI bleibt deaktiviert.
