    function esc(value) {
      return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    }

    function loadDiary(storage = globalThis.localStorage) {
      try {
        const value = JSON.parse(storage?.getItem(DIARY_KEY) || '[]');
        return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') : [];
      } catch { return []; }
    }

    function saveDiary(entries, storage = globalThis.localStorage) {
      storage?.setItem(DIARY_KEY, JSON.stringify(entries));
    }

    function loadClinical(storage = globalThis.localStorage) {
      try {
        const value = JSON.parse(storage?.getItem(CLINICAL_KEY) || 'null');
        return normalizeClinical(value);
      } catch { return emptyClinical(); }
    }

    function saveClinical(clinical, storage = globalThis.localStorage) {
      storage?.setItem(CLINICAL_KEY, JSON.stringify(clinical));
    }

    function downloadJson(filename, payload) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function setNow(input) {
      input.value = new Date(Date.now() - new Date().getTimezoneOffset() * MINUTE).toISOString().slice(0, 16);
    }

    function currentCgm() {
      return filterCgmWindow(state.clinical.cgm, state.windowDays);
    }

    function currentMetrics() {
      return state.clinical.cgm.length ? calculateMetrics(currentCgm()) : STATIC_BASELINE.metrics;
    }

    function renderMetrics() {
      const metrics = currentMetrics();
      const local = state.clinical.cgm.length > 0;
      const cards = [
        ['Zeit im Zielbereich', formatPercent(metrics.inRange, 2), '70–180 mg/dl'],
        ['Mittlere Glukose', formatMg(metrics.mean), local ? `${formatNumber(metrics.exactSamples, 0)} exakte Werte` : 'technische Codes ausgeschlossen'],
        ['GMI-Schätzung', Number.isFinite(metrics.gmi) ? `${formatNumber(metrics.gmi, 2)} %` : '–', 'aus exakten CGM-Werten'],
        ['Variationskoeffizient', formatPercent(metrics.cv, 1), 'CV'],
      ];
      document.querySelector('#metrics').innerHTML = cards.map(([label, value, sub]) => `<article class="card metric"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></article>`).join('');
      const segments = [
        ['#range-very-low', metrics.veryLow, '<54', '#8e2c45'],
        ['#range-low', metrics.low, '54–69', '#bd4b68'],
        ['#range-in', metrics.inRange, '70–180', '#2d8b82'],
        ['#range-high', metrics.high, '181–250', '#d67e32'],
        ['#range-very-high', metrics.veryHigh, '>250', '#9a4b16'],
      ];
      for (const [selector, value] of segments) document.querySelector(selector).style.width = `${Math.max(0, Number(value) || 0)}%`;
      document.querySelector('#range-legend').innerHTML = segments.map(([, value, label, color]) => `<span><i style="background:${color}"></i>${esc(label)}: ${esc(formatPercent(value, 2))}</span>`).join('');
      document.querySelector('#range-note').textContent = local
        ? 'HIGH-/LOW-Sentinels zählen für Bereichsanteile, werden aber nicht als numerische Glukosewerte in Mittelwert, GMI oder CV verwendet.'
        : 'Der Ausgangsstand bleibt als verifizierte Referenz sichtbar. Lokale CSV-Daten ersetzen ihn für Neuberechnungen, werden aber nicht rechnerisch mit dem Aggregat vermischt.';
    }

    function renderOverview() {
      const local = state.clinical.cgm.length > 0;
      const cgm = currentCgm();
      const metrics = currentMetrics();
      const pill = document.querySelector('#source-pill');
      pill.textContent = local ? 'Lokaler, wiederholt ergänzbarer CSV-Datenbestand' : STATIC_BASELINE.source;
      pill.classList.toggle('local', local);
      document.querySelector('#window-days').disabled = !local;
      document.querySelector('#header-badge').textContent = local ? `${formatNumber(state.clinical.cgm.length, 0)} lokale CGM-Werte` : '25.382 echte CGM-Werte';
      renderMetrics();
      const analyses = analyzeMeals(state.diary, state.clinical.cgm, state.clinical.boluses);
      const matched = analyses.filter((item) => item.complete).length;
      const start = local ? cgm[0]?.[0] : parseDateTime(STATIC_BASELINE.start);
      const end = local ? cgm[cgm.length - 1]?.[0] : parseDateTime(STATIC_BASELINE.end);
      const facts = [
        ['Zeitraum', start !== undefined && end !== undefined ? `${formatDateMinute(start)}–${formatDateMinute(end)}` : '–'],
        ['CGM-Abdeckung', formatPercent(metrics.activePercent, 2)],
        ['CGM-Punkte', formatNumber(local ? cgm.length : STATIC_BASELINE.metrics.samples, 0)],
        ['Bolusereignisse', formatNumber(local ? state.clinical.boluses.length : STATIC_BASELINE.boluses, 0)],
        ['Tagebucheinträge', formatNumber(state.diary.length, 0)],
        ['vollständige Mahlzeitenkurven', formatNumber(matched, 0)],
      ];
      document.querySelector('#dataset-facts').innerHTML = facts.map(([label, value]) => `<li><span>${esc(label)}</span><strong>${esc(value)}</strong></li>`).join('');
    }

    function renderRecommendations() {
      const cgm = currentCgm();
      const metrics = state.clinical.cgm.length ? calculateMetrics(cgm) : null;
      const analyses = analyzeMeals(state.diary, state.clinical.cgm, state.clinical.boluses);
      const foodGroups = buildFoodComparisons(analyses);
      const cards = buildRecommendations({ diary: state.diary, analyses, foodGroups, cgmRows: cgm, metrics });
      document.querySelector('#recommendation-list').innerHTML = cards.map((card) => `<article class="card rec ${esc(card.type)}"><div class="rec-head"><div><h2>${esc(card.title)}</h2></div><span class="rec-tag">${esc(card.tag)}</span></div><dl><dt>Befund</dt><dd>${esc(card.finding)}</dd><dt>Handlung</dt><dd>${esc(card.action)}</dd><dt>Grenze</dt><dd>${esc(card.boundary)}</dd></dl></article>`).join('');
    }

    function analysisStatus(item) {
      if (item.complete) return ['ok', 'vollständig'];
      if (item.status === 'missing-cgm') return ['wait', 'wartet auf CSV'];
      if (item.status === 'partial-cgm' || item.status === 'partial-analysis') return ['partial', 'teilweise'];
      return ['wait', 'nicht auswertbar'];
    }

    function renderMealAnalysis() {
      const analyses = analyzeMeals(state.diary, state.clinical.cgm, state.clinical.boluses).sort((a, b) => b.minute - a.minute);
      const complete = analyses.filter((item) => item.complete);
      const withBolus = complete.filter((item) => item.bolus).length;
      const withTurn = complete.filter((item) => item.turnMinute !== null).length;
      const summary = [
        ['Mahlzeiteneinträge', analyses.length],
        ['vollständig auswertbar', complete.length],
        ['mit passendem Bolus', withBolus],
        ['mit Kurvenwendepunkt-Proxy', withTurn],
      ];
      document.querySelector('#meal-summary').innerHTML = summary.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(formatNumber(value, 0))}</strong></div>`).join('');

      const target = document.querySelector('#meal-events');
      if (!analyses.length) {
        target.innerHTML = '<div class="empty-state">Noch keine Frühstücks-, Mittags-, Abendessen- oder Snackeinträge.</div>';
      } else {
        target.innerHTML = analyses.map((item) => {
          const [statusClass, statusText] = analysisStatus(item);
          const entry = item.entry;
          const overlap = item.isolation && !item.isolation.isolated ? 'Nicht in Gruppenvergleich: weitere Mahlzeit innerhalb des Isolationsfensters.' : '';
          let explanation = '';
          if (item.status === 'missing-cgm') explanation = 'Für diesen Zeitpunkt liegen lokal noch keine CGM-Werte vor.';
          else if (item.status === 'partial-cgm') explanation = `Nur ${item.cgmPoints ?? 0} exakte Werte im Nachbeobachtungsfenster.`;
          else if (item.status === 'partial-analysis') explanation = 'Kurve vorhanden, aber Mindestabdeckung oder Zwei-Stunden-Näherungswert nicht vollständig.';
          const bolusText = item.bolus ? `${formatNumber(item.bolus[2], 2)} E (${item.bolusOffset >= 0 ? '+' : ''}${formatMinutes(item.bolusOffset)})` : 'kein passender positiver Bolus gefunden';
          const turnText = item.turnMinute !== null ? `${formatMinutes(item.turnFromBolus)} nach Bolus` : 'nicht bestimmbar';
          return `<article class="analysis-item"><div class="analysis-head"><div><strong>${esc(entry.occasion)} · ${esc(entry.food || 'ohne Bezeichnung')}</strong><br><small>${esc(formatDateTimeMinute(item.minute))}</small></div><span class="status ${statusClass}">${esc(statusText)}</span></div>${explanation ? `<p class="muted">${esc(explanation)}</p>` : ''}<div class="analysis-grid"><div><span>Ausgangswert</span><strong>${esc(formatMg(item.baseline))}</strong></div><div><span>erster nachhaltiger Anstieg</span><strong>${esc(formatMinutes(item.minutesToRise))}</strong></div><div><span>Peak</span><strong>${esc(item.peak === undefined ? '–' : `${formatMg(item.peak)} · ${formatMinutes(item.minutesToPeak)}`)}</strong></div><div><span>2-h-Wert</span><strong>${esc(formatMg(item.twoHour))}</strong></div><div><span>Peak-Änderung</span><strong>${esc(Number.isFinite(item.peakDelta) ? `${item.peakDelta >= 0 ? '+' : ''}${formatMg(item.peakDelta)}` : '–')}</strong></div><div><span>2-h-Änderung</span><strong>${esc(Number.isFinite(item.twoHourDelta) ? `${item.twoHourDelta >= 0 ? '+' : ''}${formatMg(item.twoHourDelta)}` : '–')}</strong></div><div><span>Boluszuordnung</span><strong>${esc(bolusText)}</strong></div><div><span>CGM-Wendepunkt-Proxy</span><strong>${esc(turnText)}</strong></div></div>${overlap ? `<p class="muted">${esc(overlap)}</p>` : ''}</article>`;
        }).join('');
      }

      const groups = buildFoodComparisons(analyses);
      const comparisonBody = document.querySelector('#food-comparison');
      comparisonBody.innerHTML = groups.length ? groups.map((group) => `<tr><td>${esc(group.label)}</td><td>${group.entries}</td><td>${group.analyzed}</td><td>${esc(group.analyzed ? `${group.medianPeakDelta >= 0 ? '+' : ''}${formatMg(group.medianPeakDelta)}` : 'wartet auf Daten')}</td><td>${esc(formatMinutes(group.medianMinutesToPeak))}</td><td>${esc(group.analyzed && Number.isFinite(group.medianTwoHourDelta) ? `${group.medianTwoHourDelta >= 0 ? '+' : ''}${formatMg(group.medianTwoHourDelta)}` : '–')}</td></tr>`).join('') : '<tr><td colspan="6">Noch keine Lebensmittelbezeichnung mindestens zweimal erfasst.</td></tr>';
      document.querySelector('#food-comparison-note').textContent = groups.some((group) => group.entries >= 2 && group.analyzed < 2)
        ? 'Wiederholungen sind bereits erkannt. Für einen Kurvenvergleich werden mindestens zwei isolierte, vollständig abgedeckte Ereignisse benötigt.'
        : 'Mediane werden nur aus isolierten, vollständig abgedeckten Ereignissen berechnet.';

      const illness = illnessComparison(analyses);
      const illnessNode = document.querySelector('#illness-comparison');
      if (illness.recordedIllnessEntries === 0) {
        illnessNode.innerHTML = '<p class="muted">Noch kein Eintrag mit „Krankheit: Ja“. Das Feld kann unverändert weiterverwendet werden.</p>';
      } else {
        illnessNode.innerHTML = `<ul class="facts"><li><span>Krankheits-Einträge</span><strong>${illness.recordedIllnessEntries}</strong></li><li><span>auswertbar krank</span><strong>${illness.illness.entries}</strong></li><li><span>Median Peak-Anstieg krank</span><strong>${esc(illness.illness.entries ? formatMg(illness.illness.peakDelta) : '–')}</strong></li><li><span>auswertbar ohne Krankheit</span><strong>${illness.noIllness.entries}</strong></li><li><span>Median Peak-Anstieg sonst</span><strong>${esc(illness.noIllness.entries ? formatMg(illness.noIllness.peakDelta) : '–')}</strong></li></ul><p class="muted">Ein belastbarer Gruppenvergleich wird erst bei mehreren vergleichbaren Ereignissen angezeigt.</p>`;
      }
    }

    function renderDiary() {
      const entries = [...state.diary].sort((a, b) => String(b.when ?? '').localeCompare(String(a.when ?? '')));
      document.querySelector('#empty-diary').hidden = entries.length > 0;
      document.querySelector('#entries').innerHTML = entries.map((entry) => {
        const macros = [entry.carbs && `${entry.carbs} g KH`, entry.fat && `${entry.fat} g Fett`, entry.protein && `${entry.protein} g Eiweiß`, entry.fiber && `${entry.fiber} g Ballaststoffe`].filter(Boolean).join(' · ');
        const context = [entry.activity, entry.sleep && `${entry.sleep} h Schlaf`, entry.stress !== '' && entry.stress !== undefined && `Stress ${entry.stress}/10`, entry.illness === 'ja' && 'Krankheit'].filter(Boolean).join(' · ');
        return `<article class="entry"><div class="entry-head"><strong>${esc(entry.occasion)}</strong><small>${esc(new Date(entry.when).toLocaleString('de-DE'))}</small></div>${entry.food ? `<p>${esc(entry.food)}</p>` : ''}${macros ? `<small>${esc(macros)}</small>` : ''}${context ? `<p><small>${esc(context)}</small></p>` : ''}${entry.notes ? `<p>${esc(entry.notes)}</p>` : ''}<button type="button" class="secondary remove-entry" data-id="${esc(entry.id)}">Löschen und neu berechnen</button></article>`;
      }).join('');
      document.querySelectorAll('.remove-entry').forEach((button) => button.addEventListener('click', () => {
        state.diary = state.diary.filter((entry) => entry.id !== button.dataset.id);
        saveDiary(state.diary);
        renderAll();
      }));
    }

    function renderImport() {
      const cgm = state.clinical.cgm;
      const boluses = state.clinical.boluses;
      const facts = [
        ['CGM-Werte', formatNumber(cgm.length, 0)],
        ['Bolusereignisse', formatNumber(boluses.length, 0)],
        ['Beginn', cgm.length ? formatDateTimeMinute(cgm[0][0]) : '–'],
        ['Ende', cgm.length ? formatDateTimeMinute(cgm[cgm.length - 1][0]) : '–'],
        ['Importvorgänge', formatNumber(state.clinical.imports.length, 0)],
      ];
      document.querySelector('#local-data-facts').innerHTML = facts.map(([label, value]) => `<li><span>${esc(label)}</span><strong>${esc(value)}</strong></li>`).join('');
      const last = state.lastImport ?? state.clinical.imports[state.clinical.imports.length - 1];
      document.querySelector('#import-summary').innerHTML = last ? `<div class="notice info"><strong>Letzter Import:</strong> ${last.files} Datei${last.files === 1 ? '' : 'en'}, ${last.cgmAdded >= 0 ? '+' : ''}${last.cgmAdded} neue CGM-Werte, ${last.bolusesAdded >= 0 ? '+' : ''}${last.bolusesAdded} neue Bolusereignisse, ${last.rejected} verworfene Datenzeilen. Überlappungen wurden dedupliziert.</div>` : '<p class="muted">Noch keine lokale CSV importiert.</p>';
    }

    function renderQuality() {
      const local = state.clinical.cgm.length > 0;
      const metrics = local ? calculateMetrics(state.clinical.cgm) : STATIC_BASELINE.metrics;
      const rows = [
        ['CGM-Abdeckung', formatPercent(metrics.activePercent, 2), local ? 'Aus Zeitspanne und erwarteten 5-Minuten-Punkten des lokalen Bestands berechnet.' : 'Hohe zeitliche Abdeckung im verifizierten 90-Tage-Ausgangsstand.'],
        ['HIGH-Code 2001', `${formatNumber(metrics.highSentinels, 0)} Vorkommen`, 'Als oberhalb des Exportbereichs gewertet; nicht als 2001 mg/dl in Mittelwert, GMI oder CV.'],
        ['LOW-Code 1', `${formatNumber(metrics.lowSentinels, 0)} Vorkommen`, 'Als unterhalb des Exportbereichs gewertet; nicht als 1 mg/dl in Mittelwert, GMI oder CV.'],
        ['Direkte Metadatenzeilen', 'verworfen', 'CSV-Zeilen vor der erkannten Kopfzeile werden weder analysiert noch gespeichert.'],
        ['Rohdateien', 'nicht gespeichert', 'Nur Zeitstempel, CGM-Klassifikation und benötigte Bolusfelder verbleiben lokal im Browser.'],
        ['Tagebuch-Zuordnung', `${analyzeMeals(state.diary, state.clinical.cgm, state.clinical.boluses).filter((item) => item.complete).length} vollständig`, 'Teilanalysen und überlappende Mahlzeiten werden gekennzeichnet und nicht in Gruppenmediane aufgenommen.'],
      ];
      document.querySelector('#quality-body').innerHTML = rows.map(([check, result, treatment]) => `<tr><td>${esc(check)}</td><td>${esc(result)}</td><td>${esc(treatment)}</td></tr>`).join('');
      document.querySelector('#quality-note').textContent = local
        ? 'Die Werte dieser Seite stammen aus dem lokal importierten, de-identifizierten Detailbestand. Der veröffentlichte Ausgangsstand wird nicht hinzuaddiert.'
        : 'Die angezeigten Kennzahlen stammen aus der verifizierten bereinigten Analyse des realen Exports vom 7. Mai bis 4. August 2026.';
    }
