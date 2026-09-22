# Phase 3.9 — Zusammenarbeit an Aufgaben

Basis: die am 22. September 2026 veröffentlichte mobile Version,
Commit `17b633de61def2ee20638aa1db5c319862323d37`. Phase 3.8 bleibt abgeschlossen.

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

## Einbindung in die aktuelle mobile Version

Der Einstieg erfolgt unter **Projekte → Aufgaben → Details & Zusammenarbeit**.
Der separate Aufgaben-Reiter bleibt entfernt. Auch der Einstieg über Briefing,
Benachrichtigungen und vorhandene Aufgaben-Links öffnet dieselbe Detailansicht.
Mitglieder und Gäste behalten den Aufgaben-Zugang; nur Owner/Admin ändern
Kunden- oder Projektdaten. Die neuen Rechte betreffen ausschließlich die
Zusammenarbeit an Aufgaben.

Die Browserprüfung beginnt bei 390 Pixeln in der Projektübersicht und führt
Kommentieren, Checkliste, Neuladen und Konfliktbehandlung dort aus. Zusätzlich
werden 320 Pixel und Desktop sowie alle bestehenden mobilen Abläufe geprüft.
Ein aufgedeckter Wettlauf beim Browser-Zurück wurde in direkten Chats und Gruppen
behoben: Die Listenabsicht steht vor dem asynchronen Neuladen fest. Das verhindert,
dass eine schnelle Antwort die zuletzt geöffnete Unterhaltung wieder auswählt.
Die mobile Auswahl folgt außerdem der abgeschlossenen Navigation, sodass sehr
schnelles Browser-Zurück keine vorläufige Auswahl zurücklässt.

## Daten und Synchronisierung

Migration: `supabase/migrations/20260922020225_task_collaboration.sql`, ursprünglich mit der
Supabase-CLI erzeugt und auf die tatsächlich angewandte Version abgeglichen. Neue Tabellen: `task_comments`, `task_checklist_items` und
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

## Freigabenachweise vom 22. September 2026

- TypeScript, Produktionsbuild und alle **113 Tests** erfolgreich.
- Vollständige Chromium-/WebKit-Abnahme einschließlich Zusammenarbeit,
  320-/390-Pixel-Navigation, Chats, Gruppen, PWA, Workspace-Lifecycle,
  Nachrichtenverlauf, Aufgabenübernahme, Einstellungen und Benachrichtigungen:
  [CI 35677612899](https://github.com/SaluuOG/Nexus-AI-Business-Messenger/actions/runs/35677612899),
  geprüfter Anwendungsstand `5c10415fc68b4c62aa3a361abf73c6a222fcba7b`.
- Die neue Rollen-/Verlaufsprüfung bestand vor und nach der dauerhaften Migration.
  Auch `tests/sql/mobile-business-rls.sql` bestand mit den neuen Triggern. Sämtliche
  Testdaten wurden zurückgerollt.
- Migration `20260922020225_task_collaboration.sql` ist dauerhaft angewandt.
  Alle drei Tabellen haben RLS und sind in `supabase_realtime` veröffentlicht;
  anonyme Leserechte sind entzogen. Neun Richtlinien schützen die Daten.
  `task_activity` ist für Clients nur lesbar; der private Schreiber ist nicht
  direkt aufrufbar.
- Nachfolgemigration `20260922020428_task_collaboration_fk_indexes.sql` gleicht
  die drei zusammengesetzten Indizes an die Fremdschlüssel-Reihenfolge an.
  Die Cursor-Abfragen bleiben durch die Indizes abgedeckt. Die drei neuen
  Fremdschlüssel-Hinweise des Performance-Advisors sind damit behoben.
- Keine neuen Security-Advisor-Warnungen durch Phase 3.9. Die bereits bestehenden
  Hinweise bleiben unverändert: zwei private RLS-Tabellen ohne direkte Policies,
  70 geschützte öffentlich aufrufbare Security-Definer-Funktionen und deaktivierte
  Leaked-Password-Prüfung. Bestehender Performance-Hinweis zu
  `project_task_sources`; ungenutzte neue Indizes sind vor Nutzung erwartbar.
  Dokumentation: [RLS ohne Policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
  [Security-Definer-RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
  [Passwortprüfung](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
  [Fremdschlüssel-Indizes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

## Veröffentlichung und verbleibende Live-Abnahme

Die Datenbank ist vorbereitet. Der Pages-Workflow prüft den zu veröffentlichenden
Commit erneut vollständig und kontrolliert danach das exakte öffentliche
Release-Asset. Der jeweilige Workflow-Lauf belegt die tatsächliche Veröffentlichung.

**Der formale Abschluss von Phase 3.9 bleibt bis zur Live-Abnahme offen.**
Die automatisierte Browserprüfung verwendet synthetische Dienste; sie ersetzt
nicht die folgende Abnahme mit angemeldeten echten Konten:

1. Mit zwei Testkonten in einem ausschließlich dafür angelegten Test-Workspace
   Kommentare und Checklistenzustände gegenseitig sehen und nach Neuladen prüfen.
2. Live-Synchronisierung, Wechsel zu Member/Guest und Entzug des Schreibzugriffs
   über den tatsächlichen Auth-/API-Weg abnehmen.
3. Ausschließlich diese Testdaten bereinigen und den endgültigen Abschluss
   dokumentieren. Bestehende Arbeits-Workspaces bleiben erhalten.

Im bereitgestellten Browser ist derzeit kein Konto angemeldet; für diesen letzten
Schritt wird eine neue sichere Anmeldung benötigt.

Neue Chat-/E-Mail-Benachrichtigungen, Anhänge an Kommentaren und KI-Funktionen
gehören nicht zu diesem Umfang. Die kostenpflichtige KI bleibt deaktiviert.
