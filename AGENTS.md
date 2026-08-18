# AGENTS.md

Diese Datei enthält verbindliche Arbeitsregeln für Coding-Agenten, die an GlucoseCoach weiterarbeiten.

## Grundsatz

Eine Änderung gilt **nicht** als verifiziert, nur weil der Code plausibel aussieht, lokal syntaktisch korrekt ist oder Unit-Tests gedanklich bzw. außerhalb der CI bestanden haben. Für Änderungen an Browserlogik, Importern, Darstellung, Berechnungen oder E2E-Tests muss das Feedback der **tatsächlichen GitHub-Actions-Läufe** gelesen und abgearbeitet werden.

## Verbindlicher CI-/Debug-Workflow

1. Änderung auf einem separaten Branch vornehmen.
2. Einen Pull Request gegen `main` öffnen oder aktualisieren.
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

- einen temporären Debug-/Feature-Branch erstellen;
- PR gegen `main` öffnen;
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
- die Tabs `Überblick`, `Empfehlungen`, `Mahlzeitenanalyse`, `Tagebuch`, `CSV-Daten` und `Datenqualität` durchlaufen;
- alle dort dargestellten berechneten Zahlen gegen ein vom Rendering unabhängiges Oracle vergleichen;
- 7-, 14-, 30-, 90-Tage- und Gesamtansicht prüfen;
- Browser-Console-Errors und uncaught page errors als Fehler behandeln.

Testfixtures müssen gültige Eingaben darstellen. Insbesondere sind HTML-Constraints wie `step`, `min` und `max` einzuhalten und CSV-Felder mit Trennzeichen korrekt zu quoten. Ein Test soll nicht wegen absichtlich oder versehentlich ungültiger Fixture-Daten fehlschlagen, außer genau diese Validierung wird getestet.

## Umgang mit Testfehlern

Wenn ein neuer Test einen Fehler findet, zuerst klassifizieren:

- **Produktfehler:** Implementierung korrigieren.
- **Testfehler:** Test/Oracle/Fixture korrigieren, ohne die geprüfte Produktanforderung abzuschwächen.
- **Umgebungs-/CI-Fehler:** Workflow oder Setup korrigieren und anschließend die eigentlichen Tests erneut ausführen.

Assertions dürfen nicht bloß gelockert oder entfernt werden, um CI grün zu bekommen. Bei einem Widerspruch zwischen Test und Produktverhalten muss geklärt werden, welches Verhalten fachlich beabsichtigt ist.

## Abschlusskriterium

Eine browserrelevante Aufgabe ist erst abgeschlossen, wenn der aktuelle PR-Head nach den letzten Änderungen einen erfolgreichen `Browser E2E`-Lauf hat und die übrigen Repository-Prüfungen ebenfalls grün sind. Im Abschlussbericht sind nur tatsächlich beobachtete CI-Ergebnisse zu behaupten.
