# MVP-Status

Stand: 16. August 2026

## Verfügbarer MVP

- `docs/index.html`: selbstenthaltene statische Webapp ohne Build-Schritt und ohne externe Ressourcen
- echte, aus dem de-identifizierten Export berechnete Gesundheitsdaten; keine Mock- oder Beispieldaten
- Zeitraum 7. Mai bis 4. August 2026
- 25.382 CGM-Messpunkte, 690 Bolusereignisse und 90 Tagesdatensätze
- CGM-Abdeckung 98,40 %, TIR 82,22 %, Mittelwert 138,5 mg/dl, GMI 6,62 %, CV 32,5 %
- reale Muster zu Frühstück, dem Zeitfenster um 21 Uhr und dem Niedrig-Zeitfenster 18–20 Uhr
- lokales Kontexttagebuch mit JSON-Import/-Export

## Datenschutz

Direkte Identifikatoren, E-Mails, Mailheader, Original-ZIP/-CSV und Gerätekennung werden nicht in der Sites-Version verwendet. Das Repository ist privat. Die Tagebuchdaten verbleiben in `localStorage` des Browsers.

## Medizinische Grenze

Die Anwendung analysiert retrospektiv und empfiehlt zusätzliche Dokumentation bzw. Musterprüfung. Sie berechnet keine Insulindosen, Basalraten, Kohlenhydrat- oder Korrekturfaktoren und gibt keine Akutanweisungen.

## Prüfung

`.github/workflows/verify-real-mvp.yml` prüft die Sites-Datei auf die erwarteten Echtwerte und auf direkte Identifikatoren. Vorhandene Repository-Validatoren und Unit-Tests werden zusätzlich ausgeführt.
