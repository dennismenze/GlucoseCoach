# AGENTS.md

Diese Datei enthält verbindliche Arbeitsregeln für Coding-Agenten, die an GlucoseCoach weiterarbeiten.

## Grundsatz

Eine Änderung gilt **nicht** als verifiziert, nur weil der Code plausibel aussieht, lokal syntaktisch korrekt ist oder Unit-Tests gedanklich bzw. außerhalb der CI bestanden haben. Für Änderungen an Browserlogik, Importern, Darstellung, Berechnungen oder E2E-Tests muss das Feedback der **tatsächlichen GitHub-Actions-Läufe** gelesen und abgearbeitet werden.

## Ein Arbeitsstrang, ein PR

Für dieselbe fachliche Aufgabe darf nicht bei jedem Fehler ein neuer Branch oder Pull Request erzeugt werden. Existiert bereits ein offener Arbeits-PR, wird **dieser** aktualisiert und als einzige Quelle der Wahrheit verwendet. Überholte PRs werden geschlossen. Temporäre Trigger-, Merge- oder Finalisierungs-Workflows dürfen nicht dauerhaft im Feature-PR verbleiben.

## Verbindlicher CI-/Debug-Workflow

1. Änderung auf einem separaten Branch vornehmen.
2. Einen Pull Request gegen `main` öffnen oder einen bereits vorhandenen PR derselben Aufgabe aktualisieren.
3. Die GitHub-Actions-Läufe des PR-Head-Commits abwarten.
4. Für jeden fehlgeschlagenen Workflow die Jobs und anschließend die vollständigen Job-Logs lesen.
5. Den **ersten konkreten Fehler** beheben. Nicht spekulativ mehrere unabhängige Änderungen auf einmal vornehmen.
6. Neuen Commit auf denselben PR-Branch pushen.
7. Die dadurch ausgelösten Actions erneut lesen.
8. Diesen Zyklus wiederholen, bis mindestens folgende Workflows erfolgreich sind:
   - `Browser E2E`
   - `Verify personal-local MVP`
   - `Validate analysis pipeline`
9. Erst danach darf die Änderung nach `main` übernommen bzw. als fertig bezeichnet werden.

Wenn ein Workflow fehlschlägt, ist die Fehlermeldung die primäre Quelle. Screenshots, Traces oder Playwright-Artefakte sollen zusätzlich verwendet werden, wenn der Job-Log die Ursache nicht eindeutig zeigt.

## GitHub-Connector: wichtiger Sonderfall

Der verwendete GitHub-Connector kann Push-Workflow-Runs auf `main` nicht immer zuverlässig auflisten. Pull-Request-Runs sind dagegen über den Connector vollständig zugänglich, einschließlich Jobs und Job-Logs.

Darum gilt für Agenten mit dieser Einschränkung:

- den bestehenden Feature-/Debug-PR wiederverwenden;
- den PR-Head-SHA mit `fetch_commit_workflow_runs` prüfen;
- mit `fetch_workflow_run_jobs` den fehlgeschlagenen Job bestimmen;
- mit `fetch_workflow_job_logs` die konkrete Fehlermeldung lesen;
- iterativ auf demselben PR-Branch korrigieren;
- erst bei grünen PR-Checks mergen;
- temporäre reine Trigger-Dateien vor dem Merge wieder entfernen.

Ein leerer `get_commit_combined_status` oder ein fehlender Push-Run ist **kein** Beweis dafür, dass CI grün ist.

## Browser-E2E-Anforderungen

Die Playwright-Suite unter `e2e/` ist ein numerischer End-to-End-Vertrag, nicht nur ein Smoke-Test. Änderungen dürfen ihre Abdeckung nicht stillschweigend reduzieren.

Die Suite soll weiterhin:

- reproduzierbar randomisierte Daten mit festen Seeds verwenden;
- Tagebucheinträge über das echte UI-Formular anlegen;
- die unterstützten Omnipod-CSV-Dateitypen über das echte Datei-Input importieren;
- `localStorage` gegen den erwarteten Datensatz prüfen;
- die Tabs `Überblick`, `Empfehlungen`, `Mahlzeitenanalyse`, `Insulinwirkung`, `Tagebuch`, `CSV-Daten` und `Datenqualität` abdecken;
- alle dort dargestellten berechneten Zahlen gegen ein vom Rendering unabhängiges Oracle vergleichen;
- 7-, 14-, 30-, 90-Tage- und Gesamtansicht prüfen;
- Browser-Console-Errors und uncaught page errors als Fehler behandeln.

Für `Insulinwirkung` gilt zusätzlich:

- das Oracle darf nicht die Produktfunktion `analyzeInsulinAction` importieren;
- jede dargestellte berechnete Zahl in Zusammenfassung, Aggregat, Wirkungskurve, Gruppen und Einzelereignissen muss geprüft werden;
- Fixtures müssen sowohl streng isolierte Korrekturen als auch auszuschließende Mahlzeiten-, Sport- oder Überlappungsereignisse abdecken;
- jeder positive Bolus ohne positive Kohlenhydratangabe ist unabhängig von Typbezeichnung und Mahlzeitenkontext als Korrekturbolus zu klassifizieren;
- Mahlzeitenkontext darf einen solchen Korrekturbolus aus der isolierten Wirkungsanalyse ausschließen, aber nicht in einen Mahlzeitenbolus umklassifizieren;
- die Zwei-Stunden-Pumpeneinstellung darf nicht als tatsächliches Ende der Insulinwirkung behandelt werden;
- Mahlzeitenboli dürfen nicht in die aggregierte persönliche Wirkzeit eingehen;
- zensierte Ereignisse und Unsicherheitsangaben dürfen nicht stillschweigend entfernt werden.

Für den Mahlzeiten-Peak müssen fokussierte Fixtures mindestens abdecken:

- einen zugeordneten Mahlzeitenbolus im Bereich von ±60 Minuten um den Tagebucheintrag;
- einen späteren Korrekturbolus während der noch steigenden Kurve;
- einen weiteren Bolus nach dem eigentlichen Peak bzw. Wendepunkt;
- den Nachweis, dass beide späteren Boli den Mahlzeitenbolus und den Peak-Start nicht ersetzen;
- einen Bolus ohne positive Kohlenhydratangabe und mit beliebigem Typfeld, der keine vollständige Mahlzeitenanalyse erzeugen darf;
- einen Bolus außerhalb des Zuordnungsfensters, der nicht rückwirkend als Mahlzeitenbolus verwendet werden darf.

Testfixtures müssen gültige Eingaben darstellen. Insbesondere sind HTML-Constraints wie `step`, `min` und `max` einzuhalten und CSV-Felder mit Trennzeichen korrekt zu quoten. Ein Test soll nicht wegen absichtlich oder versehentlich ungültiger Fixture-Daten fehlschlagen, außer genau diese Validierung wird getestet.

## Verbindlicher Mahlzeiten-Peak-Vertrag

Der Mahlzeiten-Peak ist **nicht** auf 120 Minuten begrenzt. Fett- und proteinreiche Mahlzeiten können einen deutlich späteren Glukoseanstieg zeigen; deshalb gilt für die Implementierung:

- der Mahlzeitenkontext reicht bis zu 300 Minuten nach dem protokollierten Essensbeginn, endet aber früher bei einer neuen protokollierten Mahlzeit;
- als Mahlzeitenbolus kommt nur ein positiver Bolus mit positiver Kohlenhydratangabe im Bereich von 60 Minuten vor bis 60 Minuten nach dem protokollierten Essensbeginn infrage;
- bei mehreren solchen Kandidaten dürfen vorhandene Tagebuch-Kohlenhydrate zur plausiblen Zuordnung verwendet werden;
- jeder positive Bolus ohne positive Kohlenhydratangabe ist immer ein Korrekturbolus, unabhängig davon, ob sein Typfeld `Bolus`, `Korrektur`, `Correction` oder etwas anderes enthält; er darf nie als Mahlzeitenbolus verwendet werden;
- ausgehend vom zugeordneten Mahlzeitenbolus wird ein anhaltender Rückgangs-Proxy mit Hysterese bestimmt;
- der maßgebliche Peak ist der höchste CGM-Wert zwischen diesem Mahlzeitenbolus und dem anschließend stabil bestätigten Rückgang;
- weitere Boli ohne positive Kohlenhydratangabe starten weder die Peak-Suche noch die Wendepunktsuche neu; Boli nach dem Mahlzeitenbolus und vor dem Wendepunkt werden als Korrekturboli ausgewiesen;
- solche späteren Boli bleiben Störvariablen und können den beobachteten CGM-Verlauf beeinflussen; das Ignorieren als Peak-Anker bedeutet nicht, dass ihre Wirkung rechnerisch entfernt wurde;
- der 2-h-Wert bleibt als separater Referenzwert erhalten, ist aber nicht die Peak-Grenze;
- ohne zugeordneten Mahlzeitenbolus oder ohne stabil bestätigten Rückgang darf kein endgültiger bolusbezogener Mahlzeiten-Peak behauptet werden;
- eine weitere protokollierte Mahlzeit beendet die Zuordnung und kann die vorherige Analyse unvollständig machen;
- die UI muss Zeitabstände sowohl relativ zum Essen als auch relativ zum zugeordneten Mahlzeitenbolus eindeutig benennen.

Die Hysterese darf nicht durch einen einzelnen gleichen oder niedrigeren CGM-Wert ausgelöst werden. Der aktuelle Vertrag verlangt vier zusammenhängende Folgewerte über rund 20 Minuten, mindestens 8 mg/dl bestätigten Abfall und verwirft einen Kandidaten bei einem späteren Rebound von mehr als 3 mg/dl im verbleibenden Kontext.

## Medizinisch-methodische Grenzen

GlucoseCoach ist eine retrospektive Musteranalyse. Coding-Agenten dürfen aus CGM-Kurven keinen sicheren pharmakologischen Wirkeintritt behaupten und keine automatische Änderung von Bolus, Basalrate, Insulinfaktor, Korrekturfaktor oder Pumpen-Wirkzeit ableiten.

Insulinwirkungsanalysen müssen deshalb:

- zwischen beobachtetem CGM-Verlauf und modellierter trendbereinigter Wirkung unterscheiden;
- für aggregierte Wirkzeitschätzungen ausschließlich ausreichend isolierte Korrekturereignisse verwenden;
- Nahrung/Kohlenhydrate, weitere Boli, Aktivität, Krankheit, Hypobehandlung, Basaländerungen, Pumpenereignisse, CGM-Lücken und instabile Ausgangstrends als Störvariablen behandeln;
- Mindestfallzahl, mittlere 50%-Intervalle, Qualitätsstufe und nicht innerhalb des Fensters abgeklungene Ereignisse ausweisen;
- eine stabile Glukosephase nicht mit dem Ende der Insulinwirkung gleichsetzen;
- bestehende persönliche Daten ausschließlich lokal verarbeiten.

## Umgang mit Testfehlern

Wenn ein neuer Test einen Fehler findet, zuerst klassifizieren:

- **Produktfehler:** Implementierung korrigieren.
- **Testfehler:** Test/Oracle/Fixture korrigieren, ohne die geprüfte Produktanforderung abzuschwächen.
- **Umgebungs-/CI-Fehler:** Workflow oder Setup korrigieren und anschließend die eigentlichen Tests erneut ausführen.

Assertions dürfen nicht bloß gelockert oder entfernt werden, um CI grün zu bekommen. Bei einem Widerspruch zwischen Test und Produktverhalten muss geklärt werden, welches Verhalten fachlich beabsichtigt ist.

## PRs ohne weitere Aufforderung mergen

Sobald alle für den aktuellen PR vorgeschriebenen GitHub-Actions erfolgreich sind und kein tatsächlicher Merge-Blocker besteht, muss der Agent den PR selbstständig nach `main` mergen. Die Aufforderung zur Umsetzung schließt die Aufforderung zum Merge ein; eine gesonderte Bestätigung des Nutzers darf weder verlangt noch abgewartet werden.

Die Arbeit darf nicht mit „PR ist bereit“, „PR ist noch nicht gemergt“ oder einer bloßen Merge-Empfehlung beendet werden. Nur fehlende Berechtigungen, Merge-Konflikte, Branch-Protection oder nicht erfolgreiche Pflichtprüfungen rechtfertigen ein ausbleibendes Merge. Solche Blocker sind soweit möglich selbstständig zu beheben und andernfalls konkret zu benennen.

## Abschlusskriterium

Eine browserrelevante Aufgabe ist erst abgeschlossen, wenn der aktuelle PR-Head nach den letzten Änderungen einen erfolgreichen `Browser E2E`-Lauf hat und die übrigen Repository-Prüfungen ebenfalls grün sind. Im Abschlussbericht sind nur tatsächlich beobachtete CI-Ergebnisse zu behaupten.
