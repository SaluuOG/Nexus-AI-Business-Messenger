# Nexus für iOS

Die native iOS-Hülle liegt unter `ios/` und verwendet Capacitor 8. Die Web-App
wird lokal in das App-Paket kopiert; private Server-Schlüssel bleiben weiterhin
ausschließlich in Supabase Edge Functions.

## Lokal aktualisieren

```bash
npm ci
npm run build:ios
npm run open:ios
```

`build:ios` erzeugt den Build mit relativen Asset-Pfaden und synchronisiert ihn
in das Xcode-Projekt. Der normale `npm run build` behält dagegen den Pfad für
GitHub Pages.

## Automatischer nativer Build

Der Workflow **Validate Nexus iOS** kompiliert die Release-Konfiguration auf
einem Standard-GitHub-Runner mit macOS 26 und Xcode 26 oder neuer. Er wird bei
relevanten Pull Requests, Änderungen auf `main` oder manuell gestartet.
Er benötigt ausschließlich die bereits vorhandenen öffentlichen Repository-
Variablen `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY`.

Die Prüfungen kontrollieren die tatsächlich verpackten relativen Web-Assets,
die öffentliche Backend-Konfiguration und die SDK-Privacy-Manifeste. Sie
blockieren Live-Reload-URLs, offene Navigation, aktiviertes WebView-Debugging
und bekannte private Schlüssel-Formate einschließlich Service-Role-JWTs.
Der Schlüssel-Scanner ist eine zusätzliche Schutzschicht, keine vollständige
Sicherheits- oder Datenschutz-Zertifizierung.

Der Xcode-Build bleibt ausdrücklich **unsigniert**. Er erstellt keine auf einem
iPhone installierbare IPA und lädt nichts zu Apple hoch. Build-Protokoll und
Xcode-Ergebnis werden sieben Tage als CI-Diagnose aufbewahrt. Ein erfolgreicher
Build ersetzt weder den Test auf einem echten iPhone noch Apples App Review.

Gezielte lokale Prüfung nach einem nativen Build:

```bash
node --test tests/ios-package.test.mjs
node .github/scripts/verify-ios-package.mjs ios/App/App
```

Dafür müssen die beiden oben genannten öffentlichen Build-Variablen im
Terminal gesetzt sein; niemals private AI- oder Service-Role-Schlüssel verwenden.

## Vor dem App-Store-Upload

- Xcode 26 oder neuer auf einem Mac verwenden und `ios/App/App.xcodeproj` öffnen.
- Im Target `App` das eigene Apple-Developer-Team auswählen.
- Die Bundle-ID `com.saluuog.nexus` im Apple Developer Portal registrieren oder
  in `capacitor.config.ts` und Xcode gemeinsam auf eine eigene eindeutige ID ändern.
- App-Version und Buildnummer in Xcode setzen, anschließend auf einem echten
  iPhone Anmeldung, Passwort-Wiederherstellung, Chats, Dateien, Mikrofon und
  Kontolöschung prüfen.
- App-Datenschutzangaben und eine öffentliche Datenschutz-URL in App Store
  Connect hinterlegen. Der rechtliche Text benötigt die vollständigen Angaben
  des verantwortlichen Unternehmens bzw. Betreibers.

Native E-Mail-Bestätigungs- und Passwortlinks verwenden
`com.saluuog.nexus://auth/callback?auth=callback` bzw. `auth=recovery`. Vor
einem Test muss in Supabase Auth → URL Configuration die Redirect-URL
`com.saluuog.nexus://auth/callback?auth=callback` und
`com.saluuog.nexus://auth/callback?auth=recovery` freigegeben werden; die öffentliche Site URL
bleibt auf der Web-App. Bestehende, zuvor verschickte Links bleiben Web-Links.
Im nativen Build verarbeitet `@capacitor/app` den Link auch beim Kaltstart und
übernimmt die Supabase-Sitzung ohne Token in Web-History oder Logs. Erfolg,
abgelaufene Links und einen Kontowechsel auf dem Test-iPhone prüfen. Die
Web-/PWA-Version behält ihren bisherigen Redirect.

Noch nicht enthalten: native APNs-Push-Benachrichtigungen. Im nativen Build
zeigt die Push-Einstellung deshalb keinen irreführenden PWA-Installationsweg
mehr an. Die SDK-Manifeste ersetzen nicht die app-eigenen Datenschutzangaben
in App Store Connect oder eine öffentliche Datenschutzerklärung.

Technische Referenzen:
- [Capacitor: iOS und Xcode-Voraussetzungen](https://capacitorjs.com/docs/ios)
- [Capacitor: Privacy-Manifeste](https://capacitorjs.com/docs/ios/privacy-manifest)
- [GitHub: macOS-26-Runner](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md)

Die iOS-Hülle verwendet `capacitor://localhost`. Die Kontolöschungsfunktion und
KI-Funktion akzeptieren diese Origin ausdrücklich; das ist keine Freigabe für
beliebige Webseiten.

## Geräteabnahme der nativen Auth-Links (Phase 4)

Der erste CI-Durchlauf des [PR #6](https://github.com/SaluuOG/Nexus-AI-Business-Messenger/pull/6)
hat am 24.09.2026 Web-/Browserprüfungen und den unsignierten nativen Build
bestanden. Nachfolgende Änderungen müssen auf dem aktuellen PR-Commit erneut
grün sein. Die Abnahme auf einem echten iPhone ist weiterhin offen.

### Vorbereitung am Mac

1. Den Branch `codex/native-auth-links` aus dem Repository auschecken. Bei
   einer neuen Arbeitskopie:
   ```bash
   git clone --branch codex/native-auth-links https://github.com/SaluuOG/Nexus-AI-Business-Messenger.git
   cd Nexus-AI-Business-Messenger
   ```
2. Node 24 und Xcode 26 oder neuer verwenden. `.env.example` nach `.env.local`
   kopieren und die Projekt-URL sowie den öffentlichen Supabase-Publishable-Key
   eintragen. Die Projekt-URL lautet `https://mwptfpzhnnkondverggi.supabase.co`.
3. Die zwei oben genannten nativen Redirect-URLs in Supabase freigeben; die
   bestehenden Web-Redirects und die Site URL beibehalten.
4. `npm ci`, `npm run build:ios` und `npm run open:ios` ausführen.
5. In Xcode unter Target `App` → Signing & Capabilities das Apple-Team wählen.
   Das entsperrte iPhone verbinden, als Run Destination auswählen und die App
   mit Run installieren. Etwaige Gerätefreigaben direkt auf dem iPhone bestätigen.

### Testprotokoll

Frische Links aus der installierten nativen App anfordern. Als Nachweis je
Test iOS-Version, App-Buildnummer, Ergebnis und gegebenenfalls den sichtbaren
Fehler festhalten; keine vollständigen Auth-Links oder Tokens dokumentieren.

| Test | Erwartung | Stand |
|---|---|---|
| Registrierung mit frischer E-Mail-Bestätigung | Link öffnet Nexus und zeigt das richtige angemeldete Konto | Offen |
| Passwort-Reset bei geöffneter App | Link öffnet die Passwortmaske für das zum Link gehörende Konto | Offen |
| Passwort-Reset nach vollständigem Beenden | Nexus startet und zeigt dieselbe Passwortmaske | Offen |
| Erfolgreicher Reset und neue Anmeldung | Neues Passwort funktioniert; altes Passwort funktioniert nicht mehr | Offen |
| Ungültiger/abgelaufener Link | Fehleranzeige; keine gültige Recovery-Sitzung aus einem zuvor angemeldeten Konto | Offen |
| Kurzzeitig offline, danach denselben Link erneut öffnen | Link kann nach dem Netzfehler erneut verarbeitet werden | Offen |
| Bestätigung nach vorherigem Recovery-Ablauf | Keine übernommene alte Passwortmaske | Offen |
| Link für Konto B während Konto A angemeldet ist | Nach Erfolg ist Konto B sichtbar; A-Inhalte sind nicht mehr sichtbar | Offen |
| Doppelte Zustellung desselben Links | Keine zweite parallele Sitzungsübernahme | Offen |
| Web/PWA-Passwort-Reset | Bisheriger Web-Ablauf funktioniert weiterhin | Offen |

Automatisierte Handler-Tests decken doppelte Zustellung, fehlende Sitzungen,
Netzfehler/Retry, Reihenfolge mehrerer Links und das Entfernen alter Listener
ab. Sie ersetzen die Betriebssystem-, Mail-App- und Signing-Tests oben nicht.
