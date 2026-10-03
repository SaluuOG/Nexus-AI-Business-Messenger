# Dateninventar und vorgeschlagene App-Privacy-Angaben

Stand: 3. Oktober 2026. **Vorläufige Zuordnung aus Code und Projektmetadaten, kein bereits ausgefülltes Apple-Formular.** „Keine Daten erfasst“ wäre für Nexus unzutreffend. Die Tabelle muss mit dem endgültigen Build, dem tatsächlichen Betrieb und den Dienstleisterverträgen abgeglichen werden.

| Apple-Datenart | Nachgewiesener Nexus-Zweck / Code | Vorschlag für den derzeitigen Umfang |
| --- | --- | --- |
| Name, Email Address | Auth, Profil und Kontakt-/Kundendaten; `AuthProvider.tsx`, `businessData.ts` | Erfasst, kontobezogen, App-Funktionalität |
| Phone Number | Optionales Kundentelefon in `customers` | Erfasst, kontobezogen, App-Funktionalität; kein Telefonbuchimport |
| User ID | Konto-ID, Benutzername, Mitgliedschaft, persönliche Einstellungen | Erfasst, kontobezogen, App-Funktionalität |
| Contacts | Nexus-Kontaktbeziehungen und Gruppenmitgliedschaften als sozialer Graph | Erfasst, kontobezogen, App-Funktionalität; iOS-Kontaktberechtigung ist dafür kein Maßstab |
| Emails or Text Messages | Einzel-/Gruppennachrichten, Antwortbezüge | Erfasst, kontobezogen, App-Funktionalität |
| Photos or Videos | Hochgeladene Bilder/Avatare; Video-Unterstützung nicht als Feature beworben | Erfasst, kontobezogen, App-Funktionalität |
| Audio Data | Gesendete Sprachnachrichten | Erfasst, kontobezogen, App-Funktionalität |
| Other User Content | Dateien, Projekte, Aufgaben, Kommentare, Profiltexte, Notizen | Erfasst, kontobezogen, App-Funktionalität |
| Product Interaction / Other Usage Data | Gespeicherte Lese-/Präsenzinformationen, Bearbeitungsaktivitäten und persönliche Markierungen | Erfasst, kontobezogen, App-Funktionalität; genaue Abgrenzung im Formular prüfen |
| Other Financial Info | Frei eingetragene Projektwerte können sich auf natürliche Personen beziehen | Vorsorglich als erfasst/kontobezogen/App-Funktionalität einplanen; tatsächliche Nutzung prüfen |
| Customer Support | Zukünftige Support-E-Mails, Fehlerberichte und Löschanfragen | Mit Aufnahme des Supports erfasst/kontobezogen/App-Funktionalität; Dienstleister noch offen |
| Device ID | Gerätebindung im Web-Push; native SDK-Vorbereitung | Für iOS endgültigen Build und Backend prüfen; nicht allein aus vorhandenem SDK eine Registrierung ableiten |
| Other Diagnostic Data | Auth-/API-/Hoster-Protokolle einschließlich möglicher IP- und Fehlerdaten | Betreiber-/Supabase-Logkonfiguration, Zweck, Personenbezug und Fristen vor Abgabe klären |
| Search History | Suchanfragen werden an den Server gesendet, keine eigene dauerhafte Suchhistorie im Code gefunden | Aufzeichnung durch API-/Infrastruktur-Logs prüfen; keine pauschale Nicht-Erfassung behaupten |

Alle „kontobezogen“-Vorschläge berücksichtigen, dass Inhalts- und Nutzungsdaten einer Konto-/Workspace-ID zugeordnet sind. Pseudonyme IDs sind nicht automatisch anonym. Drittpersonen in Kunden- und Chatinhalten gehören ebenfalls zum Dateninventar.

Im geprüften App-Code wurde kein Werbe-/Tracking-SDK gefunden. **Vorläufig „kein Tracking“**, solange weder Betreiber noch Partner die Daten appübergreifend zu Werbung oder Datenhandel verknüpfen. Das ersetzt nicht die Prüfung der eingebundenen Dienste. Keine GPS-, HealthKit-, Zahlungs- oder Adressbuch-API gefunden; daraus folgt nicht, dass frei eingegebene Inhalte solche Angaben nie enthalten können. Keine ATT-Abfrage lediglich vorsorglich einbauen.

## Verarbeitung und Empfänger

- Supabase: Auth, PostgreSQL, Realtime, Storage und Edge Functions. Projektregion am Prüfdatum bestätigt: `eu-central-1`. Vertragspartner, AV-Vertrag, Unterauftragnehmer, Supportzugriffe und Drittlandgarantien noch dokumentieren.
- GitHub Pages: Web-Version und künftig gegebenenfalls öffentliche Rechtstext-/Supportseiten. Der native Build lädt seine App-Dateien lokal; eine geöffnete externe Webseite erzeugt dennoch eigene Hostingzugriffe.
- E-Mail: Bestätigungs-/Wiederherstellungsnachrichten über die eingerichtete Auth-Zustellung. Tatsächlichen SMTP-Anbieter, Versandregion und Protokollfristen ermitteln; nicht aus dem Absender erraten.
- Apple: Store-Verteilung; eigene Apple-Verarbeitung von Store-/Geräteinformationen getrennt erläutern. Native APNs-Registrierung/Zustellung ist derzeit nicht als fertig bestätigt.
- Web-Push: optional in Web/PWA; Geräteabonnements und Zustellung gemäß `docs/mobile-push.md`. Nicht ungeprüft auf die native iOS-Fassung übertragen.
- KI: Code unterstützt eine ausdrücklich aktivierbare OpenAI-Anbindung. Projektstand: deaktiviert. Bei Aktivierung werden zugängliche Chattexte und zugehörige Metadaten ausgewertet, keine Bild-/Audio-/Dateibytes. Vor Aktivierung Empfänger, Rechtsgrundlagen, Transparenz/gegebenenfalls Einwilligung, Verträge, Speicherfristen und Apple-Angaben neu prüfen. `store:false` ist keine Garantie vollständiger Löschung beim Anbieter.

## Lokaler Speicher

| Speicher | Tatsächlicher Stand | Noch zu entscheiden / prüfen |
| --- | --- | --- |
| Auth-Sitzung | Supabase-Persistenz, automatische Erneuerung | Gesamte Speicher-/Backupkonfiguration des Release-Builds prüfen |
| Offline-Chats, IndexedDB | Konto-getrennte Texte/Metadaten; bis 100 Nachrichten pro gespeicherter Seite, 40 Verläufe, ca. 8 MB; Alter von 30 Tagen begrenzt die Nutzung | Bereinigung erfolgt bei App-/Cache-Aktivität, nicht garantiert bei geschlossenem Gerät; aktueller Löschtest erforderlich |
| Chatentwürfe, localStorage | Max. 5.000 Zeichen pro Konto/Gespräch; leerer Text oder erfolgreiches Senden entfernt den Entwurf | Kein TTL und keine ausdrückliche Entwurfsbereinigung bei Abmeldung/Kontolöschung gefunden; vor Release beheben und erklären |
| Persönliche Wiedervorlagen | Serverseitige Referenz, Termin, Status/Version; keine zusätzliche Textkopie | Erledigte Referenz kann für sichere Wiederholungen bestehen bleiben; Fristkonzept festlegen |

Der lokale Chattext und Entwurf sind nicht zusätzlich durch Nexus verschlüsselt. Serverseitiger Zugriff ist über Berechtigungen eingeschränkt; es gibt keine implementierte Ende-zu-Ende-Verschlüsselung. Offline kann das Gerät einen inzwischen online entzogenen Zugriff bis zur nächsten Verbindung nicht erkennen. Kopien und Weiterleitungen bei Empfängern sind bei Löschanfragen separat zu berücksichtigen.

## Kontolöschung: nicht mit „alles verschwindet überall sofort“ beschreiben

`delete-account` prüft die Sitzung, fordert Eigentumsübertragung/-löschung, entfernt dem Konto zugeordnete Storage-Objekte, meldet global ab und löscht den Auth-Nutzer. Datenbank-Fremdschlüssel entfernen viele verknüpfte Datensätze. Direkte Gespräche haben Kaskadenlöschung; eigene Gruppennachrichten sind ebenfalls an das Konto gebunden.

Gemeinsame Kunden-/Projekt-/Aufgabendaten, Kommentare und Aktivitätseinträge können dagegen fortbestehen; die Konto-Referenz wird teilweise auf NULL gesetzt. Freitext kann weiterhin Personen nennen. Das ist **keine garantierte vollständige Anonymisierung**. Weiterleitungen sind eigenständige Nachrichten. Fremde Geräte können vorübergehend alte Offline-Stände haben. Provider-Backups, Logs, verwaiste Dateien und zulässige Aufbewahrung müssen anhand eines eigenen Löschkonzepts behandelt werden. Bestehende Zugriffstokens/Downloads nicht als augenblicklich widerrufen darstellen, ohne dies technisch nachgewiesen zu haben.

## Datenschutzmanifest und Verschlüsselungsexport

Im App-Target liegt kein eigenes `PrivacyInfo.xcprivacy`. Die bestehende CI prüft die SDK-Manifeste von Capacitor/Cordova. Das ist noch kein vollständiger Privacy-Report. Im signierten Archiv alle Abhängigkeiten und tatsächlich verwendeten Required Reason APIs prüfen; erforderliche Deklarationen mit zutreffendem Zweck hinzufügen. Keine pauschalen Null-Angaben oder erfundenen API-Gründe eintragen. App-Privacy-Label und Manifest sind unterschiedliche Angaben.

`ITSAppUsesNonExemptEncryption` wurde nicht ungeprüft gesetzt. HTTPS/Standard-Sicherheitsbibliotheken und insbesondere Web-Push-Kryptografie müssen für das tatsächlich gebündelte Produkt im Exportfragebogen beurteilt werden; keine unbelegte Ausnahme zusagen.

Quelle für die Kategorien: [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/). Die Nexus-Zuordnung ist eine eigene Ableitung aus der Codeprüfung, keine Aussage Apples zu dieser App.
