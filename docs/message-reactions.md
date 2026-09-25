# Nachrichtenreaktionen

Einzel- und Gruppenchats bieten neben „Optionen“ ein Herzsymbol mit der Auswahl
❤️ Herz, 👍 Gefällt mir, 😂 Lachen, 😮 Überrascht, 😢 Traurig und 🙏 Danke.
Doppelklick bzw. zweimaliges kurzes Antippen einer Nachrichtenblase setzt ein
Herz. Wiederholtes Doppeltippen lässt ein vorhandenes Herz stehen. Scrollen,
langes Drücken und Bedienelemente wie Anhanglinks vergeben kein versehentliches Herz.

Eine halbe Sekunde gedrückt halten öffnet das Optionen-Menü mit einer kompakten
Emoji-Leiste. Dasselbe Menü ist über ⋯ und am Desktop per Rechtsklick erreichbar.
Nach rechts wischen (mindestens 64 Pixel) bereitet eine Antwort vor. Senkrechtes
Scrollen, abgebrochene Gesten und kurze Wischbewegungen lösen keine Antwort aus.
Herzsymbol und ⋯ bleiben als Alternativen ohne Gesten verfügbar. Die Emoji-Leiste
lässt sich auch mit Pfeiltasten bedienen; Escape schließt sie und gibt den Fokus
zurück. Menüs werden innerhalb des sichtbaren Bildschirmbereichs positioniert.

Pro Person und Nachricht bleibt eine Reaktion aktiv. Eine andere Auswahl ersetzt
sie; erneute Auswahl oder Antippen der eigenen Reaktion entfernt sie. Die Blase
zeigt pro Emoji die Anzahl und markiert die eigene Auswahl. Offline lassen sich
keine Reaktionen vergeben; bereits geladene Anzeigen bleiben während der Sitzung
sichtbar. Der dauerhafte Offline-Speicher speichert weiterhin nur Nachrichtentext.

## Speicherung und Zugriff

- Migrationen: `20260925002134_message_reactions.sql` und
  `20260925003728_reaction_realtime_identity.sql`.
- Getrennte Tabellen mit Fremdschlüsseln für Direkt- und Gruppennachrichten.
- RLS erlaubt Lesen nur bei Zugriff auf die nicht gelöschte Ursprungsnachricht;
  Änderungen betreffen ausschließlich die eigene Reaktion.
- Beide RPCs laufen mit `SECURITY INVOKER`. Eigentümer- und Chat-IDs sind über
  die Data API nicht veränderbar. Nicht angemeldete Nutzer haben keinen Zugriff.
- Schreiben übermittelt den gewünschten Zustand statt eines serverseitigen
  Umschaltens; Wiederholungen erzeugen dadurch keine zusätzlichen Reaktionen.
- Entfernen setzt das Emoji auf `NULL`, damit ein per Chat gefiltertes,
  zugriffsgeschütztes Realtime-UPDATE alle Teilnehmer erreicht.
- Physische Kaskadenlöschungen verwenden ausschließlich eine zufällige
  Reaktions-ID als Replica Identity statt der Nachrichten-/Nutzer-ID.
- Gebündelter Abruf für sichtbare Nachrichten, erneuter Abruf nach Reconnect,
  Rückkehr zur App und periodisch im sichtbaren Tab. Verspätete Ergebnisse eines
  anderen Chats oder Accounts werden verworfen.

## Prüfung

`tests/sql/message-reactions-rls.sql` prüft mit vollständig zurückgerollten
Testkonten tatsächliche Speicherung, Zähler, Wechsel/Entfernen, Wiederholungen,
fremde Zugriffe, falsche Chat-IDs, entzogene Gruppenrechte und gelöschte Nachrichten.

`tests/message-reactions.test.mjs` prüft Datenzugriff und Nachrichtenauswahl.
`tests/browser/message-reactions.mjs` prüft Bedienung, Doppeltippen, Menügrößen,
Realtime-Ereignisse, Offline-Verhalten, Fehler und Kontowechsel mit Testdaten.
Der bestehende Aufgabentest prüft auch das weiterhin verfügbare Optionen-Menü.
