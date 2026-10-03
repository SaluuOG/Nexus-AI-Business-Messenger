# Medien, Dateien und Links im Chat

Unter dem Kopf eines Einzel- oder Gruppenchats öffnet **Medien, Dateien & Links**
die neue Übersicht. **Bilder** zeigt eine Galerie mit vergrößerbarer Vorschau;
**Dateien** enthält Dokumente und Audio-Anhänge; **Links** sammelt HTTP-/HTTPS-
Adressen aus den Nachrichtentexten. `www.`-Adressen werden als HTTPS geöffnet.

Die Suche filtert Dateinamen bzw. vollständige URLs innerhalb der gewählten
Kategorie, ohne Groß-/Kleinschreibung zu beachten. Jede Karte zeigt das Datum und
**Zur Nachricht**. Dieser Sprung nutzt die vorhandene autorisierte Kontextabfrage
und findet auch Nachrichten außerhalb der zunächst geladenen 100 Nachrichten.
**Weitere laden** lädt die nächste Seite; manuelles Aktualisieren behält den
bereits geladenen Umfang. Es werden keine Nachrichten als gelesen markiert, nur
weil ihre Metadaten über diese neue Abfrage gelesen werden.

## Zugriff und Grenzen

- Die Übersicht benötigt Internet. Der vorhandene Offline-Verlauf bleibt davon
  unabhängig. Es wird kein neues Offline-Archiv für Anhänge oder Links angelegt.
- Nur aktuelle Teilnehmer des jeweiligen Chats können die Übersicht lesen.
  Gruppenmitglieder sehen denselben historischen Zeitraum wie im bisherigen Verlauf.
  Ein Gruppenaustritt/-ausschluss entzieht den Zugriff auf weitere Abfragen.
- Gelöschte Nachrichten erscheinen nicht. Wiederholte Links innerhalb derselben
  Nachricht werden zusammengefasst; derselbe Link in verschiedenen Nachrichten
  behält jeweils seine Originalnachricht.
- Webseiten werden erst beim Antippen geöffnet. Es gibt keinen automatischen
  Abruf von Linkvorschauen oder Favicons. Ungültige oder unsichere URL-Schemata
  werden ausgelassen, ohne andere Ergebnisse zu blockieren.
- Dateien verbleiben im bestehenden privaten Bucket `nexus-chat-attachments`.
  Temporäre Datei-URLs gelten 60 Sekunden und werden beim offenen Dialog alle
  50 Sekunden erneuert. Sie werden nicht in einem zusätzlichen Cache gespeichert.
  Bereits ausgestellte URLs können bis zum Ablauf weiter funktionieren; ein
  Mitgliedschaftsentzug widerruft sie nicht rückwirkend.
- Realtime-INSERT/UPDATE-Ereignisse des ausgewählten Chats sowie Fokus und ein
  30-Sekunden-Abgleich aktualisieren die Metadaten. Bei Lesefehlern werden die
  Ergebnisse entfernt und eine Wiederholung angeboten. Konten-/Chatwechsel
  verwerfen verspätete Antworten. Offline oder beim Wechsel in den Hintergrund
  schließt sich der Dialog.
- Browserfähige Bilder werden direkt angezeigt. Andere Formate lassen sich über
  **Datei öffnen** an das Betriebssystem übergeben; Ladefehler erhalten einen
  verständlichen Hinweis. Ob ein Format dort unterstützt wird, hängt vom Gerät ab.

## Umsetzung

Migration `20261001002035_chat_shared_content.sql` ergänzt ausschließlich Funktionen:
`public.get_chat_shared_content` ist ein `SECURITY INVOKER`-Wrapper um einen privaten
Leser mit leerem `search_path`. Dieser prüft `auth.uid()` und aktuelle Teilnahme,
bevor er Metadaten aus den bewusst nur per RPC zugänglichen Anhangtabellen liest.
Bestehende Tabellen-/Storage-Rechte werden nicht erweitert. Der interne Parser
ist für Clients nicht ausführbar. Es gibt keine neuen Dienste oder Abhängigkeiten.

Die paginierte Abfrage nutzt `(created_at, message_id, item_id)` als stabilen Cursor
mit festgelegter Sortierung, Standardgröße 24 und serverseitiger Obergrenze 50.
Die Suche ist ein literaler Teilstring, keine SQL-Wildcard-Auswertung; maximal 100
Zeichen. Links werden aus zugänglichen Texten berechnet, nicht in einer zweiten
Nachrichtentabelle dupliziert. Der Client validiert Scope, Metadaten und Cursor.

## Prüfung

- `tests/sql/chat-shared-content-rls.sql`: synthetische Konten, vollständiges ROLLBACK;
  Direkt-/Gruppenzugriff, fremde und anonyme Konten, Mitgliedschaftsentzug, gelöschte
  Nachrichten, historische Inhalte, gleiche Zeitstempel, Pagination, wörtliche Suche,
  URL-Klammern/Satzzeichen/Duplikate, interne Funktionsrechte und unveränderte Lesezeilen.
- `tests/chat-shared-content.test.mjs`: Antwort-/Scopevalidierung, fehlerhafte oder
  nicht fortschreitende Cursor, unsichere URLs, kurze private Datei-URLs und
  gefilterte Realtime-Abonnements.
- `tests/browser/chat-shared-content.mjs`: isolierte Daten für Einzel-/Gruppenchats;
  Galerie und Vorschau, Escape/Fokus, Suche, Paging, alte Originalnachrichten,
  verspätete Antworten, Bearbeitung/Löschung, Lese-/Dateifehler, Offline und
  Kontowechsel. Screenshots prüfen 320, 390 und 1440 Pixel; CI nutzt Chromium/WebKit.

Die neue Übersicht muss nach dem App-Update noch auf dem physischen iPhone bestätigt werden.
