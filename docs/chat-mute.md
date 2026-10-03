# Persönliches Stummschalten von Chats

Das ⋯-Menü in Einzel- und Gruppenchats bietet **Für 1 Stunde stummschalten**,
**Für 8 Stunden stummschalten** und **Dauerhaft stummschalten**. Bei aktiver
Stummschaltung erscheint eine durchgestrichene Glocke in der Listenzeile;
das Menü zeigt den Ablaufzeitpunkt und **Wieder einschalten**.

Die Einstellung gehört nur dem angemeldeten Konto und gilt auf dessen Geräten.
Nachrichten bleiben verfügbar und neue Nachrichten kommen weiterhin an.
Die ungelesenen Zähler in der Chatliste und Lesebestätigungen ändern sich durch
Stummschalten nicht. Favoriten und Archiv sind unabhängig davon; eine neue
Nachricht holt einen archivierten Chat zurück, ohne die Stummschaltung zu beenden.

## Benachrichtigungen

- Die Benachrichtigungsliste und ihre Glocken-Zahl blenden Hinweise aus einem
  stummen Chat aus. Aufgaben, Einladungen und andere Chats bleiben unverändert.
- Die ausgeblendeten Hinweise werden weder gelöscht noch als gelesen markiert.
  Nach Ablauf oder manuellem Einschalten werden sie wieder mit ihrem bisherigen
  Lesestatus angezeigt, soweit die zugrunde liegenden Nachrichten noch zugänglich sind.
- Der bestehende Web-Push-Versand stellt während der Stummschaltung keine neuen
  Chat-Hinweise in die Warteschlange. Bereits wartende Hinweise werden vor dem
  Versand erneut geprüft. Bereits zugestellte Systemmitteilungen werden nicht zurückgerufen.
- Native APNs bleibt vorbereitet und deaktiviert; diese Änderung aktiviert keinen
  kostenpflichtigen Apple-Dienst.

## Umsetzung

- Migration `20260930234425_chat_mute.sql` ergänzt `muted_until` und `muted_forever`
  in den bestehenden persönlichen Chat-Einstellungen. Konto-/Mitgliedschafts-RLS,
  Realtime-Filter und die eindeutigen Konto-/Chat-Indizes bleiben bestehen.
- `set_chat_mute` akzeptiert nur `off`, `1h`, `8h`, `forever`. Die Serverzeit bestimmt
  den Ablauf; der Client übermittelt weder eine Benutzer-ID noch eigene Ablaufzeiten.
  Der private Schreiber prüft aktuelle Teilnahme und verändert nur die Stumm-Felder.
- Öffentliche RPCs sind `SECURITY INVOKER`; private privilegierte Schreiber haben
  einen leeren `search_path`. Direkte Tabellenänderungen durch Clients bleiben verboten.
- Der interne, für Clients nicht ausführbare Helfer `chat_is_muted` wird vom
  bestehenden Empfänger-/Zugriffsprüfer der Benachrichtigungen und von der Push-Queue
  genutzt. Die Einschränkung betrifft nur Direkt- und Gruppennachrichten.
- Realtime aktualisiert die Oberfläche bei Änderungen auf einem anderen Gerät.
  Die Glocke gleicht sich zusätzlich bei Fokus, Wiederverbindung und sichtbar alle
  30 Sekunden ab. Das Stumm-Symbol endet über einen eigenen Ablauf-Timer.
- Offline bleibt der zuletzt geladene Zustand sichtbar; Änderungen benötigen
  Internet. Der begrenzte Cache übernimmt nur validierte Zeitstempel und boolesche
  Werte und wird beim Konto-Wechsel gelöscht. Gruppen-Austritt entfernt die Einstellung.

## Prüfung

- `tests/chat-organization.test.mjs`: explizite Modi, Fehler, Zeitgrenze,
  ungültige Antworten und begrenzte Offline-Daten.
- `tests/sql/chat-mute-rls.sql`: synthetische Konten mit vollständigem ROLLBACK;
  Serverdauer, Teilnahme, fremde Konten, anonyme Rechte, Tabellen-/Helferrechte,
  Feed/Zähler/Lesestatus, Nachrichten während der Stummschaltung, Ablauf,
  Archiv/Favoriten, Mitgliedschaftsentzug und Web-Push-Unterdrückung.
- `tests/browser/chat-mute.mjs`: beide Chatarten, alle Modi, manuelles Einschalten,
  Feed und Glockenzähler, unveränderte ungelesene Chat-Zähler, Neuladen, Offline,
  Ablauf-Timer, Realtime, Speicherfehler, Kontowechsel und Menüs bei 320/390/1440 Pixeln.
  Die Browserprüfung arbeitet mit isolierten Testdaten.

Die Stummschaltung wurde vom Nutzer am 01.10.2026 auf dem physischen iPhone als
funktionierend bestätigt. Der vorherige Favoriten-/Archiv-Block ist ebenfalls bestätigt.
