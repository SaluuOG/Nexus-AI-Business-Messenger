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
