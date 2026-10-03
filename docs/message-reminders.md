# Persönliche Wiedervorlagen für Nachrichten

**Nachricht → ⋯ → Später erinnern** öffnet die Terminwahl für Einzel- und
Gruppennachrichten, auch mit Anhängen. Vorschläge: **In zwei Stunden** und
**Morgen um 09:00**. Ein eigener Termin wird in der Ortszeit des Geräts eingegeben;
der Dialog zeigt die Zeitzone. Gespeichert wird ein eindeutiger UTC-Zeitpunkt.
Nicht existierende Ortszeiten beim Wechsel zur Sommerzeit werden abgewiesen.

Pro Konto und Nachricht gibt es höchstens einen offenen Termin. Derselbe Dialog
zeigt einen bestehenden Termin und erlaubt dessen Änderung oder Erledigung.
Die gewählte Zeit muss in der Zukunft und innerhalb der nächsten fünf Jahre
liegen. Ein identischer Wiederholungsversuch bleibt nach seiner Speicherung
auch dann gültig, wenn der Termin inzwischen vergangen ist.

Im **Tagesbriefing → Deine Wiedervorlagen** erscheinen persönliche Einträge auch
ohne ausgewählten Workspace. **Fällig** zeigt erreichte Termine, **Alle offenen**
auch spätere. Der vollständige Fällig-Zähler kommt vom Server. **Zur Nachricht**
öffnet die Originalnachricht; **Verschieben** öffnet die Terminwahl;
**Erledigen** entfernt den Eintrag aus den offenen Wiedervorlagen, ohne die
Nachricht oder deren Lesebestätigung zu verändern. Weitere Einträge werden in
Seiten von 20 geladen, sortiert nach Termin und ID.

Die Ansicht lädt bei Rückkehr, Wiederverbindung und alle 30 Sekunden im
Vordergrund neu. Änderungen anderer Geräte werden dabei übernommen. Offline
werden keine Wiedervorlagen-Texte gespeichert oder angezeigt und keine
Schreibvorgänge eingereiht. Diese Erweiterung zeigt Erinnerungen innerhalb der
geöffneten App; sie verschickt keine Hintergrund-Pushs oder E-Mails.

## Daten und Zugriff

- Private Tabelle mit RLS und ausdrücklicher Deny-Policy, ohne Tabellenrechte
  für Clients und ohne Realtime-Veröffentlichung.
- Gespeichert werden nur Kontoinhaber, Nachrichtenverweis, Termin und Version.
  Nachrichtentexte und Datei-URLs werden nicht kopiert.
- Öffentliche RPCs nutzen `SECURITY INVOKER`. Private Funktionen prüfen eine
  tatsächlich aktive Auth-Sitzung und das ausdrücklich erwartete Konto.
- Lesen und Terminsetzen prüfen zusätzlich die aktuelle Chat-Teilnahme und die
  nicht gelöschte Originalnachricht. Normale Gruppenmitglieder dürfen ihre
  eigenen Wiedervorlagen verwalten. Andere Teilnehmer sehen diese nicht.
- Änderungen und Löschungen der Quelle sowie entzogene Gruppenrechte werden
  bei jedem Abruf berücksichtigt. Endgültige Nachrichten-/Kontolöschung
  entfernt die abhängigen Einträge.
- Versionsvergleich und eine unveränderte Vorgangs-ID bei Wiederholungen
  verhindern doppelte Einträge und das Überschreiben neuerer Änderungen.
  Erledigte Einträge behalten ausschließlich ihren Verweis und die letzte
  Version, damit verspätete Anfragen sie nicht wiederherstellen.
- Terminänderungen sperren Sitzung, Nachrichtenquelle und Mitgliedschaft für
  die Dauer des Schreibvorgangs. Eine eigene Wiedervorlage kann auch bei
  verlorenem Quellenzugriff erledigt werden; die API liefert dabei keinen
  Nachrichtentext zurück.
- Kontowechsel verwirft alte Ansichten und verspätete Antworten. Fehlgeschlagene
  Lesevorgänge entfernen Vorschauen und bieten einen erneuten Abruf an.

## Prüfung

- `tests/message-reminders.test.mjs`: Ortszeit/UTC, Jahreswechsel, Zeitumstellung,
  Antwort-/Cursorvalidierung, erwartetes Konto, Versionsbindung, unbestätigte
  Antworten und identische Wiederholungen.
- `tests/sql/message-reminders-rls.sql`: direkte und Gruppen-Nachrichten,
  Kontentrennung, verbotene Quellen, Sitzungsentzug, gleiche Zeitstempel,
  vollständige Zähler, Seitenwechsel, Änderung/Löschung, verlorener Zugriff,
  Versionskonflikte sowie veraltete Wiederholungen nach Erledigung/Neuplanung.
  Ausschließlich synthetische Daten in einer zurückgerollten Transaktion.
- `tests/sql/run-reminders-local.mjs`: dieselben SQL-Prüfungen mit den relevanten
  Originalmigrationen in isoliertem PGlite.
- `tests/browser/message-reminders.mjs`: beide Chat-Arten, vergangene Termine,
  verlorene Antworten, Änderung auf anderem Gerät, Entwurfserhalt, Neuladen,
  fällige/geplante Ansicht, Originalnachricht, Verschieben, Erledigen, Anhänge,
  Seitengrenzen, Zugriffsfehler, Offline/Wiederverbindung und Kontowechsel.
  Screenshots und Größenprüfung mit 320/390/1440 Pixeln.

Die automatisierte Geräteprüfung läuft zusätzlich in GitHub Actions (Chromium,
WebKit und nativer iOS-Build). Der Test auf dem physischen iPhone steht noch aus:
Nachricht vormerken, im Briefing unter **Alle offenen** öffnen, Termin auf wenige
Minuten später ändern, bei Fälligkeit unter **Fällig** prüfen und erledigen.

Am 03.10.2026 (Europe/Berlin) bestanden 208 Unit-Tests, TypeScript, der Web-Build
mit iOS-Synchronisierung, die gezielten Chromium-Abläufe und die SQL-Abnahme
lokal sowie als zurückgerollte Transaktion im Nexus-Projekt. Die Migration
`20261002230823_message_reminders.sql` ist angewandt. Der Sicherheitsvergleich
meldete keine zusätzlichen Befunde. Die vollständige Browser- und native
iOS-Prüfung wird durch den Push gestartet.
