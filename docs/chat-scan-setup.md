# KI-Auswertung eines gesamten Chats

Die Auswertung wird im jeweiligen Einzel- oder Gruppenchat über „Chat auswerten“ geöffnet. Eine Statusabfrage überträgt keine Chattexte an einen KI-Anbieter. Erst „Gesamten Chat auswerten“ startet den ausdrücklich beschriebenen Verarbeitungsschritt.

## Aktivierungsstand

Die Anbindung ist vorbereitet und bleibt ohne Server-Konfiguration ausgeschaltet. Eine Prüfung mit einem echten KI-Modell steht bis zur Einrichtung eines Anbieterzugangs aus. Automatisierte Tests verwenden synthetische Nachrichten und simulierte Anbieterantworten.

Der vorbereitete Adapter verwendet OpenAI. Für die Einrichtung sind ein eigenes Nexus-Projekt, das Modell `gpt-5.6-terra` und ein monatliches hartes Ausgabenlimit von 10 US-Dollar vorgesehen. Der Anbieterzugang und dieses Limit sind noch nicht eingerichtet; bisher wurde kein echter Modellaufruf durchgeführt. Ein ChatGPT-Abonnement ersetzt die Konfiguration dieses serverseitigen API-Zugangs nicht. Keine Zugangsschlüssel in Chatnachrichten, GitHub, `VITE_*`-Variablen oder Browser-Speicher eintragen.

## Einrichtung auf dem Server

1. Die Migrationen `supabase/migrations/20260915044932_chat_scan.sql` und `supabase/migrations/20260915132017_chat_scan_workflow.sql` anwenden und die Edge Function `supabase/functions/chat-scan` bereitstellen.
2. Im OpenAI-Projekt unter Limits → Spend das Monatslimit setzen und ausdrücklich „Enforce a hard limit“ aktivieren. Benachrichtigungen allein stoppen den Verbrauch nicht; die Übernahme von Limits kann kurz verzögert sein. Siehe [offizielle Anleitung](https://developers.openai.com/api/docs/guides/spend-limits).
3. In den Supabase Edge Function Secrets `OPENAI_API_KEY` und `NEXUS_AI_MODEL=gpt-5.6-terra` konfigurieren. Das ausgewählte Modell muss strukturierte JSON-Ausgaben im implementierten API-Aufruf unterstützen. Erst nach Einrichtung des Kostenrahmens `NEXUS_AI_ENABLED=true` setzen. Ohne vollständige Konfiguration meldet die Oberfläche „KI noch nicht eingerichtet“.
4. Mit einem eigenen, ausdrücklich für den Test bestimmten Chat die komplette Kette prüfen: Status, Start, Ergebnis, Quellen, Abbruch und Fehler. Keine privaten fremden Chats für technische Tests verwenden.

Supabase-Projekt: `mwptfpzhnnkondverggi`. API-Schlüssel bleiben ausschließlich als Server-Secrets hinterlegt. Die Funktion verwendet den JWT des angemeldeten Kontos und die bestehenden Zugriffsrechte für den Chatabruf.

## Persönlicher Chatstatus

Der Status gilt für das angemeldete Konto und wird auf dessen Geräten abgeglichen. Andere Gruppenmitglieder behalten ihren eigenen Bearbeitungsstand. Die Chatliste lässt sich nach Alle, Offen, Ausgewertet und Fertig filtern.

| Status | Verhalten |
| --- | --- |
| Offen | Noch keine erfolgreiche Auswertung; der gesamte zugängliche Textverlauf einschließlich alter Nachrichten wird berücksichtigt. |
| Neue Nachrichten | Seit der letzten Auswertung wurde der Verlauf ergänzt oder geändert. Im Filter „Offen“ enthalten; eine neue Auswertung berücksichtigt wieder den gesamten Verlauf. |
| Ausgewertet | Das letzte erfolgreiche Ergebnis passt zum aktuellen Verlauf. „Auswertung ansehen“ öffnet es ohne weiteren KI-Aufruf. |
| Fertig | Vom Nutzer manuell abgeschlossen; bleibt auch bei neuen Nachrichten von Auswertungen ausgeschlossen. „Wieder öffnen“ hebt dies auf. |

„Ausgewertet“ bedeutet nicht, dass die erkannten Aufgaben erledigt sind. Beim Wiederöffnen bleibt ein unveränderter, bereits ausgewerteter Verlauf ausgewertet; geänderte Verläufe werden wieder offen berücksichtigt. Fehlgeschlagene oder während der Bearbeitung ungültig gewordene Auswertungen setzen keinen erfolgreichen Status.

## Umfang und Grenzen

- Die Auswertung liest den gesamten zugänglichen Textverlauf über einen eigenen seitenweisen Abruf, unabhängig von den letzten 200 im Chatfenster geladenen Nachrichten.
- Ergebnisse: Zusammenfassung, wichtige Informationen, Entscheidungen, Aufgabenvorschläge und offene Fragen, mit überprüfbaren Quellenauszügen.
- Bilder, Dokumentinhalte und Sprachnachrichten werden in diesem Teil noch nicht gelesen bzw. transkribiert. Die Oberfläche zeigt diese Ausnahmen an.
- Sehr große Verläufe oberhalb der serverseitigen Grenzen werden mit einer verständlichen Fehlermeldung abgewiesen. Es wird kein gekürzter Verlauf als vollständig ausgewertet dargestellt.
- Es werden keine Aufgaben automatisch angelegt, keine Nachrichten automatisch verschickt und keine vom Chattext angeforderten Werkzeuge ausgeführt.
- Pro Konto und Chat wird nur die letzte erfolgreiche Auswertung privat gespeichert. Jeder Abruf prüft den aktuellen Chat-Zugriff und den vollständigen Verlauf erneut. Änderungen an Nachrichten, Anhängen oder verwendeten Absendernamen entfernen veraltete Ergebnisse; bei entferntem Gruppenzugriff wird der persönliche Datensatz gelöscht. Dies ist kein Archiv früherer Auswertungen.
- Konten-/Chatwechsel, Fensterwechsel und Offline-Zustand blenden bereits geladene Ergebnisse aus und brechen offene Abrufe ab. Ein erneuter Aufruf lädt nur ein noch gültiges Ergebnis.

## Prüfungen

`npm run typecheck`, `npm test` und `npm run build` prüfen den Anwendungscode und die simulierte KI-Verarbeitung. `tests/sql/chat-scan-rls.sql` und `tests/sql/chat-scan-workflow-rls.sql` prüfen vollständigen Abruf, persönliche Status, Zugriffsrechte, ungültige Quellen und konkurrierende Statuswechsel in zurückgerollten Transaktionen. `tests/browser/chat-scan.mjs` prüft die Bedienung mit isolierten Daten in Chromium und WebKit innerhalb von GitHub Actions.

Anbieterfehler, unvollständige Ausgaben und nicht mehr zugängliche Quellen führen zu einem Fehlerzustand; sie werden nicht als erfolgreiche Auswertung angezeigt. Eine bestandene Simulation ersetzt den noch ausstehenden Test mit dem eingerichteten KI-Modell nicht.
