# Persönliche Favoriten und Chatarchiv

Einzel- und Gruppenchats haben die Ansichten **Aktiv**, **Favoriten** und **Archiv**.
Das ⋯-Menü jeder Listenzeile bietet „Als Favorit markieren“ / „Favorit entfernen“
und „Archivieren“ / „Aus Archiv holen“. Favoriten stehen zuerst; innerhalb der
beiden Bereiche bleibt die bisherige Reihenfolge der Chatliste bestehen.
Suchtext und persönlicher Bearbeitungsstatus gelten zusätzlich zur gewählten Ansicht.

Die Einstellungen gehören dem angemeldeten Konto, gelten auf dessen Geräten und
werden anderen Teilnehmern nicht gezeigt. Auch normale Gruppenmitglieder dürfen
ihre eigene Liste organisieren. Archivieren löscht keine Nachrichten, setzt keine
Lesebestätigung und schaltet Benachrichtigungen nicht stumm. Explizite Nachrichten-
und Aufgabenlinks können weiterhin einen archivierten Chat öffnen.

Neue Nachrichten holen den Chat automatisch zurück zu Aktiv. Das gilt auch bei
geschlossener App und bei eigenen neuen Nachrichten. Bearbeitungen, Löschungen,
Reaktionen, Lesebestätigungen und wiederholte Übertragungen derselben Nachricht
holen ihn nicht zurück. Der Favoritenstatus bleibt beim Archivieren erhalten.

## Umsetzung

- Migration `20260930230057_chat_organization.sql`: je eine Tabelle für Direkt-
  und Gruppeneinstellungen, eindeutiger Datensatz pro Konto/Chat, RLS und nur
  kontoeigene Lesezugriffe. Clients erhalten keine direkten Tabellen-Schreibrechte.
- Öffentliche RPCs sind `SECURITY INVOKER`. Der private Schreiber prüft `auth.uid()`
  sowie aktuelle Teilnahme und erlaubt genau eines der beiden booleschen Felder.
- Ein interner INSERT-Trigger entfernt den Archivstatus bei echten neuen Nachrichten.
  Schreiber und Trigger sperren die gemeinsame Chatzeile vor den Einstellungen
  mit `NO KEY UPDATE`: keine Abhängigkeit von Geräteuhren, gleiche Sperrreihenfolge,
  kompatibel zu den Fremdschlüssel-Sperren beim Nachrichtenversand.
- Ein Gruppen-Austritt/-Ausschluss entfernt die persönlichen Gruppeneinstellungen
  über den Mitgliedschafts-Fremdschlüssel. Erneutes Beitreten beginnt ohne alte Werte.
- Kontogefilterte Realtime-INSERT/UPDATE-Abonnements sowie der vorhandene Abgleich
  bei Fokus, Wiederverbindung und alle 30 Sekunden aktualisieren die Liste.
- Der bestehende begrenzte Offline-Cache übernimmt nur die beiden booleschen
  Einstellungen. Auch der Leser mit abgelaufener Offline-Sitzung bietet die Ansichten.
  Änderungen benötigen Internet; Kontowechsel/Abmeldung löschen alte Offline-Daten.
- Vor einer vollständigen Listenaktualisierung müssen auch die Einstellungen
  erfolgreich geladen sein. Fehler dürfen archivierte Chats nicht als aktiv darstellen.
- Speicheranfragen setzen einen ausdrücklichen Zielwert; Doppelauslösung ist pro
  Chat gesperrt. Fehler melden keinen Erfolg, verspätete Antworten eines vorherigen
  Kontos ändern nicht die aktuelle Oberfläche.

## Prüfung

- `tests/sql/chat-organization-rls.sql` wurde gegen das verbundene Projekt ausgeführt,
  ausschließlich mit synthetischen Konten und vollständigem ROLLBACK: Kontentrennung,
  normales Gruppenmitglied, falsche IDs, direkte Tabellenzugriffe, unabhängige Felder,
  neue Nachrichten mit absichtlich alter Zeit, Favoritenerhalt, Änderungen/Löschen,
  idempotenter Sende-Retry, Mitgliedschaftsentzug und anonyme Rechte.
- `tests/chat-organization.test.mjs`: validierte Antworten, fehlgeschlagene Metadaten,
  Netzwerkfehler, explizite Schreibwerte, stabile Sortierung, Offline-Datenminimierung
  und kontogefilterte Realtime-Abonnements.
- `tests/browser/chat-organization.mjs`: beide Chatarten, Favoriten/Archiv/Wiederherstellen,
  Nachrichten öffnen, neue Nachrichten, Änderungen von einem anderen Gerät,
  gescheiterte Speicherung, Offline-Neustart, Kontowechsel und 320/390/1440-Pixel-Menüs.
  Diese automatisierten Browserprüfungen verwenden isolierte Testdaten.

Die neue Bedienung auf dem physischen iPhone muss nach dem App-Update noch
bestätigt werden. Der vorherige Block „Nachrichten anheften“ wurde vom Nutzer
am 01.10.2026 bereits als funktionierend bestätigt.
