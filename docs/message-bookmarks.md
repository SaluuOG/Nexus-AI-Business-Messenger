# Persönliche Merkliste

**⋯ → Nachricht merken** merkt eine eigene oder empfangene Nachricht. Für bereits
gemerkte Nachrichten heißt die Aktion **Markierung entfernen**. Sie ist auch bei
Nachrichten mit Bildern, Dateien oder Sprachnachrichten verfügbar. Normale
Gruppenmitglieder können ihre eigenen Markierungen verwalten.

**Hauptmenü → Merkliste** öffnet **Gemerkte Nachrichten**. Die Ansicht enthält
Chatname, Chat-Art, Absender, Textvorschau, gegebenenfalls den ersten Dateinamen
und das Datum der Nachricht. **Zur Nachricht** öffnet den ursprünglichen
Einzel- oder Gruppenchat an der markierten Nachricht. Die Suche berücksichtigt
den vollständigen Text, Chatname, Absender und den angezeigten Dateinamen.
Neueste Markierungen stehen zuerst; **Weitere laden** lädt die nächsten 30.

Die Liste und ihre Markierungen sind kontobezogen und nur für die jeweilige
Person sichtbar. Sie senden keine Nachricht und keine Benachrichtigung und
verändern keine Lesebestätigung. Entwürfe bleiben erhalten. Markierungen werden
auf dem Server gespeichert und stehen nach erneuter Anmeldung auf anderen
Geräten zur Verfügung. Zum Laden und Ändern wird Internet benötigt. Offline
zeigt die Merkliste einen Verbindungshinweis, ohne Schreibaktionen einzureihen.

## Aktualität und Sicherheit

- Gespeichert werden ausschließlich Verweise auf Nachrichten. Keine Kopien von
  Text, Autor, Chatname, Dateiname oder privater Datei-URL.
- Jede Abfrage prüft die aktive Sitzung, das erwartete Konto und den aktuellen
  Zugriff auf die Originalnachricht. Ein Leserecht im Chat gewährt keinen
  Zugriff auf die Markierungen anderer Teilnehmer.
- Beim Aktualisieren erscheinen geänderte Texte; gelöschte Nachrichten und
  Nachrichten aus inzwischen unzugänglichen Chats werden ausgeblendet.
  Die sichtbare Liste aktualisiert sich zusätzlich bei Rückkehr zur App,
  Wiederverbindung und alle 30 Sekunden im Vordergrund. Ein Seitenwechsel oder
  Kontowechsel verwirft verspätete Antworten. Der Sprung zur Originalnachricht
  unterliegt erneut der bestehenden Chat-Zugriffsprüfung.
- Entfernen löscht nur die eigene Markierung. Die Originalnachricht bleibt
  erhalten. Explizites Merken/Entfernen statt eines serverseitigen Toggles macht
  eine Wiederholung nach einer verlorenen Antwort sicher.
- Die private Tabelle hat RLS, eine ausdrückliche Deny-Policy, keine Client-
  Rechte und keine Realtime-Veröffentlichung. Öffentliche RPCs verwenden
  `SECURITY INVOKER`; private Funktionen prüfen Sitzung und Kontoinhaber.
- Fremdschlüssel entfernen Markierungen bei endgültiger Nachrichten- oder
  Kontolöschung. Cursor aus Zeitpunkt und ID verhindern Auslassungen bei
  gleichen Zeitstempeln. Die Suche behandelt `%` und `_` als normale Zeichen.

## Prüfung und Geräteabnahme

- `tests/message-bookmarks.test.mjs`: Antwort- und Cursorvalidierung, Kontobindung,
  Statusabfragen in Paketen von höchstens 200 Nachrichten, Wiederholungen und
  korrekt kodierte Direkt-/Gruppenlinks.
- `tests/sql/message-bookmarks-rls.sql`: Kontentrennung, normale Gruppenmitglieder,
  Quellenrechte, Anhänge, Suche, gleiche Zeitstempel, wiederholte Schreibvorgänge,
  Bearbeitung/Löschung, entzogene Mitgliedschaft, abgelaufene/entzogene Sitzung
  und fehlende direkte Tabellenrechte. Nur synthetische Identitäten; die gesamte
  Transaktion wird zurückgerollt.
- `tests/sql/run-bookmarks-local.mjs`: dieselbe SQL-Abnahme mit den relevanten
  Originalmigrationen in isoliertem PGlite. `NEXUS_PGLITE_MODULE` verweist auf ein
  separat installiertes `@electric-sql/pglite/dist/index.js` (geprüft: 0.5.8).
- `tests/browser/message-bookmarks.mjs`: Einzel-/Gruppenabläufe, Entwurf,
  Neuladen, verlorene Antworten, Suche, Pagination, Originalnachricht,
  Bearbeitung, fehlgeschlagene Zugriffe, Offline und Kontowechsel. Ansichten
  mit 320/390/1440 Pixeln; Chromium und WebKit in GitHub Actions, synthetischer
  Dienst ohne echte Empfänger.
- Die bestehende Menü-/Aufgabenprüfung enthält die neue Aktion. Zum Prüfen des
  Schließens klickt sie auf einen geometrisch bestimmten Punkt außerhalb des
  Menüs, da das gewachsene Menü den Nachrichtentext überdecken kann.

Am 02.10.2026 bestanden alle 204 Unit-Prüfungen, TypeScript, Web-Build mit
iOS-Synchronisierung, der neue Chromium-Ablauf sowie die lokale und die
zurückgerollte SQL-Abnahme im Nexus-Projekt. Die Migration
`20261002213851_message_bookmarks.sql` ist dort eingerichtet. Die
Sicherheitsprüfung meldete keine zusätzlichen Befunde gegenüber dem vorherigen
Stand. Der native iOS-Build und die vollständigen Browserabläufe werden beim
Push zusätzlich durch GitHub Actions geprüft.

Die Prüfung auf dem physischen iPhone steht aus und kann mit **Weiterleiten**,
**Text kopieren** und der Medien-/Datei-/Linkübersicht zusammen erfolgen. Der
Nutzer möchte die Änderungen mit einem gemeinsamen Terminal-/Xcode-Update laden.
