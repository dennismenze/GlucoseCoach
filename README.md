# GlucoseCoach

Privater Web-MVP zur retrospektiven Musteranalyse eines realen Omnipod-/CGM-Exports. Die App verwendet keine Beispieldaten: Der aktuelle Stand basiert auf 25.382 CGM-Messpunkten sowie den zugehörigen Kohlenhydrat-, Bolus-, Basal-, Blutzucker- und Alarmereignissen vom 7. Mai bis 4. August 2026.

Der MVP ist bewusst **keine Dosierungs- oder Therapie-App**. Er erkennt wiederkehrende Zeit- und Mahlzeitenmuster, schlägt konkrete zusätzliche Dokumentation vor und grenzt unzulässige Schlussfolgerungen explizit aus.

## Aktueller Datenbefund

Die bereinigte Gesamtauswertung ergibt:

| Kennzahl | Wert |
|---|---:|
| CGM-Abdeckung | 98,40 % |
| Mittelwert | 138,5 mg/dl |
| GMI-Schätzung | 6,62 % |
| CV | 32,5 % |
| Zeit 70–180 mg/dl | 82,22 % |
| Zeit <70 mg/dl | 1,23 % |
| Zeit >180 mg/dl | 16,55 % |

Die derzeit stärksten beobachtbaren Muster sind:

1. Isoliert auswertbare Frühstücksereignisse zeigen im Median einen Peak von 202 mg/dl nach etwa 95 Minuten.
2. Um 21 Uhr ist der Anteil über 180 mg/dl deutlich höher als im Gesamtprofil.
3. Zwischen 18 und 20 Uhr treten relativ häufiger Werte unter 70 mg/dl auf.
4. Konkrete Lebensmittel, Bewegung, Schlaf, Krankheit und Stress fehlen im Export; das lokale Tagebuch schließt genau diese Lücke.

Diese Aussagen sind Beobachtungen, keine kausalen Nachweise und keine Grundlage für selbstständige Änderungen an Pumpen- oder Insulineinstellungen.

## Funktionen

- Zeitraumumschaltung für 7, 14, 30 und 90 Tage
- TIR/TBR/TAR, Mittelwert, GMI und Variabilität
- 24-Stunden-Profil mit Median und 10.–90. Perzentil
- täglicher Verlauf und Tagesabschnittvergleich
- Mahlzeitenvergleich nach Tageszeit und Kohlenhydratmenge
- echte, regelbasierte Empfehlungen mit Befund, Handlungsschritt und Grenze
- lokales Tagebuch für Lebensmittel, Makronährstoffe, Sport, Schritte, Schlaf, Krankheit und Stress
- JSON-Import/-Export des lokalen Tagebuchs
- Datenqualitäts- und Sentinel-Dokumentation
- reproduzierbare Python-Pipeline zur Erzeugung eines de-identifizierten Detaildatensatzes und einer prüfbaren Release-Datei

## Lokal starten

Es ist kein Build-Schritt und kein JavaScript-Paketmanager erforderlich.

```bash
python -m http.server 8000
```

Danach `http://localhost:8000` öffnen. Direktes Öffnen von `index.html` per `file://` funktioniert wegen Browser-Sicherheitsregeln für `fetch()` nicht zuverlässig.

## Datensatz reproduzieren

Die Rohdaten werden absichtlich nicht versioniert. Mit einem lokal entpackten Omnipod-Export:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python scripts/build_dataset.py \
  --input "/pfad/zum/entpackten-export" \
  --output data

python scripts/package_release.py \
  --source "/pfad/zum/entpackten-export" \
  --data data
```

`data/provenance.json` enthält SHA-256-Prüfsummen aller 13 Original-CSV-Dateien. Damit ist nachvollziehbar, aus welchem unveränderten Export der Repository-Datensatz erzeugt wurde, ohne die Originaldateien oder direkte Identifikatoren einzuchecken.

## Datenschutz

Das Repository ist privat. Nicht eingecheckt werden:

- E-Mails und Mailheader
- Original-ZIP
- Original-CSV-Dateien
- voller Name
- E-Mail-Adressen
- Geräte-Seriennummer

Eingecheckt werden dagegen echte, de-identifizierte Gesundheitswerte einschließlich Datum/Uhrzeit, Glukose, Insulin und dokumentierter Kohlenhydrate. Diese Daten bleiben sensibel. Eine öffentliche Bereitstellung der Webapp ohne Authentifizierung würde sie offenlegen und ist nicht vorgesehen.

Das lokale Tagebuch verwendet ausschließlich `localStorage`; es sendet nichts an einen Server.

## Technische HIGH-/LOW-Codes

Der Export enthält 29 Werte `2001` und einen Wert `1`. Die benachbarten Messungen zeigen, dass es sich um technische Außerbereichsmarkierungen handelt. Die Pipeline behandelt sie deshalb so:

- `2001`: zählt als oberhalb des Exportbereichs für TAR, aber nicht als 2001 mg/dl in Mittelwert, GMI oder CV
- `1`: zählt als unterhalb des Exportbereichs für TBR, aber nicht als 1 mg/dl in Mittelwert, GMI oder CV

So bleiben Bereichszeiten erhalten, ohne numerische Kennzahlen durch technische Codes zu verfälschen.

## Medizinische Grenze

Die Anwendung erzeugt ausdrücklich nicht:

- Basalraten oder temporäre Basaländerungen
- Bolusmengen
- Kohlenhydratfaktoren
- Korrekturfaktoren oder „mg/dl pro Einheit“
- Vorbolus-Zeitpunkte
- Diagnosen wie Insulinresistenz
- akute Hypo-/Hyperglykämieanweisungen

Der Grund ist nicht nur regulatorisch, sondern methodisch: Automatische Insulinabgabe, aktives Insulin, CGM-Verzögerung, überlappende Mahlzeiten, Bewegung und fehlende Kontextdaten verhindern aus diesem Export allein eine belastbare Dosierungsableitung.

## Referenzwerte

Die Oberfläche verwendet die standardisierten CGM-Bereiche 70–180 mg/dl, <70/<54 mg/dl und >180/>250 mg/dl. Als allgemeine Referenzen zeigt sie TIR ≥70 %, TBR <4 %, TBR <54 mg/dl <1 %, TAR <25 % und CV ≤36 %. Diese Werte werden nicht als individuell verordnete Therapieziele dargestellt.

Primärquellen:

- American Diabetes Association, *Standards of Care in Diabetes—2026*, Section 6: https://diabetesjournals.org/care/article/49/Supplement_1/S132/163927/6-Glycemic-Goals-Hypoglycemia-and-Hyperglycemic
- ISPAD Clinical Practice Consensus Guidelines 2024, *Glycemic Targets*: https://pmc.ncbi.nlm.nih.gov/articles/PMC11854972/

## Struktur

```text
index.html                         statische App
assets/styles.css                  responsives Layout
src/app.js                         Rendering, Charts, Tagebuch
scripts/build_dataset.py           Omnipod-CSV → de-identifizierte JSON-Daten
scripts/package_release.py         Vollpaket und Provenienz
scripts/validate_project.py        statische Validierung
data/summary.json                  aggregierte und tägliche Echtwerte
data/full-export...json.gz         alle de-identifizierten Detailwerte als Gesamtpaket
data/provenance.json               Prüfsummen und Verarbeitung
tests/                             Vertrags- und Datenschutztests
```

Die App verwendet nur relative URLs, keine externen CDN-Ressourcen und keinen Servercode. Damit lässt sie sich später in eine geeignete statische Hosting- oder Sites-Umgebung überführen. Vor jeder Bereitstellung der realen Daten ist Zugriffsschutz erforderlich.
