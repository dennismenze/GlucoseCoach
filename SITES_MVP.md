# ChatGPT-Sites-MVP

Die selbstenthaltene, statische Version liegt unter [`docs/index.html`](docs/index.html). Sie verwendet ausschließlich die aus dem realen, de-identifizierten Export berechneten Kennzahlen und Muster:

- Zeitraum: 7. Mai bis 4. August 2026
- 25.382 CGM-Messpunkte
- 690 Bolusereignisse
- 90 Tagesdatensätze
- 98,40 % CGM-Abdeckung
- 82,22 % im Bereich 70–180 mg/dl
- 138,5 mg/dl Mittelwert
- 6,62 % GMI-Schätzung
- 32,5 % Variationskoeffizient

Die Empfehlungen betreffen dokumentations- und analysebezogene nächste Schritte. Die App berechnet keine Bolus-, Basal-, Korrektur- oder Kohlenhydratfaktoren und gibt keine akuten Therapieanweisungen.

Das Tagebuch arbeitet ausschließlich mit `localStorage` und überträgt keine Einträge. Die Datei benötigt keinen Build-Schritt und keine externen Ressourcen.
