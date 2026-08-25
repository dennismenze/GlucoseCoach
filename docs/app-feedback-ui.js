(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const FOOD_LIBRARY_KEY = 'glucosecoach-food-library-v1';
  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);
  const NIGHT_START_HOUR = 21;
  const NIGHT_MEAL_LOOKBACK_MINUTES = 180;
  const NIGHT_MIN_CGM_POINTS = 12;
  const NIGHT_RISE_TRIGGER_MGDL = 15;
  const NIGHT_RISE_MINIMUM_MGDL = 20;
  const NIGHT_DECLINE_MGDL = 8;

  const TIMING_BUCKETS = [
    { key: 'early', min: Number.NEGATIVE_INFINITY, max: -20, label: 'mindestens 20 Min. vor dem Essen' },
    { key: 'before', min: -19, max: -10, label: '10–19 Min. vor dem Essen' },
    { key: 'around', min: -9, max: 5, label: 'kurz vor bis 5 Min. nach dem Essen' },
    { key: 'after', min: 6, max: 20, label: '6–20 Min. nach dem Essen' },
    { key: 'late', min: 21, max: Number.POSITIVE_INFINITY, label: 'mehr als 20 Min. nach dem Essen' },
  ];

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function round(value, digits = 1) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function median(values) {
    const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return null;
    const middle = Math.floor(valid.length / 2);
    return valid.length % 2
      ? valid[middle]
      : (valid[middle - 1] + valid[middle]) / 2;
  }

  function parseMinute(value) {
    const source = String(value ?? '').trim();
    if (!source) return null;
    const german = source.match(
      /^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
    );
    if (german) {
      const date = new Date(
        Number(german[3]),
        Number(german[2]) - 1,
        Number(german[1]),
        Number(german[4]),
        Number(german[5]),
        Number(german[6] || 0),
      );
      return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
    }
    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
  }

  function normalizeFood(value) {
    return String(value ?? '').trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
  }

  function timingBucket(offset) {
    const numeric = finite(offset);
    if (numeric === null) return null;
    return TIMING_BUCKETS.find((bucket) => numeric >= bucket.min && numeric <= bucket.max) || null;
  }

  function buildMealTimingInsights(analyses = []) {
    const groups = new Map();
    for (const analysis of analyses || []) {
      const label = String(analysis?.entry?.food ?? '').trim();
      const key = normalizeFood(label);
      const offset = finite(analysis?.bolusOffset);
      const peakDelta = finite(analysis?.peakDelta);
      const bucket = timingBucket(offset);
      if (!key || !analysis?.complete || !bucket || peakDelta === null) continue;
      if (!groups.has(key)) groups.set(key, { key, label, events: [] });
      groups.get(key).events.push({
        offset,
        peakDelta,
        twoHourDelta: finite(analysis?.twoHourDelta),
        bucket,
      });
    }

    return [...groups.values()]
      .filter((group) => group.events.length >= 2)
      .map((group) => {
        const bands = TIMING_BUCKETS.map((bucket) => {
          const events = group.events.filter((event) => event.bucket.key === bucket.key);
          return {
            key: bucket.key,
            label: bucket.label,
            observations: events.length,
            medianPeakDelta: round(median(events.map((event) => event.peakDelta)), 0),
            medianTwoHourDelta: round(
              median(events.map((event) => event.twoHourDelta).filter(Number.isFinite)),
              0,
            ),
          };
        }).filter((band) => band.observations > 0);
        const candidates = bands.filter((band) => band.observations >= 2);
        const best = [...candidates].sort(
          (a, b) => a.medianPeakDelta - b.medianPeakDelta || b.observations - a.observations,
        )[0] || null;
        return {
          key: group.key,
          label: group.label,
          observations: group.events.length,
          timingGroups: bands.length,
          bands,
          best,
          comparable: group.events.length >= 4 && bands.length >= 2 && Boolean(best),
        };
      })
      .sort((a, b) => b.observations - a.observations || a.label.localeCompare(b.label, 'de'));
  }

  function exactCgmRows(clinical) {
    const map = new Map();
    for (const row of clinical?.cgm || []) {
      const minute = finite(row?.[0]);
      const value = finite(row?.[1]);
      if (minute === null || value === null) continue;
      map.set(minute, [minute, value]);
    }
    return [...map.values()].sort((a, b) => a[0] - b[0]);
  }

  function allCorrectionBoluses(clinical) {
    const rows = [];
    for (const row of clinical?.boluses || []) {
      const minute = finite(row?.[0]);
      const carbs = finite(row?.[1]);
      const units = finite(row?.[2]);
      if (minute === null || units === null || units <= 0 || (carbs !== null && carbs > 0)) continue;
      rows.push({ minute, units, source: 'Pumpe' });
    }
    for (const row of clinical?.manualInsulin || []) {
      const minute = finite(row?.[0]);
      const units = finite(row?.[2]);
      if (minute === null || units === null || units <= 0) continue;
      rows.push({ minute, units, source: 'manuell' });
    }
    const deduplicated = [];
    for (const event of rows.sort((a, b) => a.minute - b.minute)) {
      const duplicate = deduplicated.some(
        (other) => Math.abs(other.minute - event.minute) <= 1 && Math.abs(other.units - event.units) < 0.01,
      );
      if (!duplicate) deduplicated.push(event);
    }
    return deduplicated;
  }

  function localDateKey(minute) {
    const date = new Date(minute * MINUTE_MS);
    const part = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
  }

  function dateAt(key, hour, minute = 0) {
    const [year, month, day] = key.split('-').map(Number);
    return Math.round(new Date(year, month - 1, day, hour, minute).getTime() / MINUTE_MS);
  }

  function sleepStartForDate(diary, key) {
    const start = dateAt(key, 18);
    const end = dateAt(key, 23, 59);
    return (diary || [])
      .filter((entry) => String(entry?.occasion || '').toLocaleLowerCase('de-DE') === 'schlaf')
      .map((entry) => parseMinute(entry.when))
      .filter((minute) => Number.isFinite(minute) && minute >= start && minute <= end)
      .sort((a, b) => a - b)[0] ?? null;
  }

  function hasMealContext(diary, clinical, start, end) {
    const diaryMeal = (diary || []).some((entry) => {
      if (!MEAL_OCCASIONS.has(entry?.occasion)) return false;
      const minute = parseMinute(entry.when);
      return Number.isFinite(minute) && minute >= start && minute <= end;
    });
    if (diaryMeal) return true;

    const pumpMeal = (clinical?.boluses || []).some((row) => {
      const minute = finite(row?.[0]);
      const carbs = finite(row?.[1]);
      return minute !== null && carbs !== null && carbs > 0 && minute >= start && minute <= end;
    });
    if (pumpMeal) return true;

    const cgmCarbs = (clinical?.cgmCarbs || []).some((row) => {
      const minute = finite(row?.[0]);
      const carbs = finite(row?.[1]);
      return minute !== null && carbs !== null && carbs > 0 && minute >= start && minute <= end;
    });
    if (cgmCarbs) return true;

    return (clinical?.foodEvents || []).some((row) => {
      const minute = finite(row?.[0]);
      return minute !== null && minute >= start && minute <= end;
    });
  }

  function findNightRise(rows) {
    if (rows.length < NIGHT_MIN_CGM_POINTS) return null;
    let low = rows[0];
    for (let index = 1; index < rows.length - 2; index += 1) {
      if (rows[index][1] < low[1]) low = rows[index];
      const current = rows[index];
      const confirmation = rows.slice(index, index + 3);
      if (confirmation.length < 3) continue;
      if (confirmation.at(-1)[0] - confirmation[0][0] > 15) continue;
      if (
        current[1] >= low[1] + NIGHT_RISE_TRIGGER_MGDL &&
        confirmation.every((row) => row[1] >= low[1] + NIGHT_RISE_TRIGGER_MGDL - 3)
      ) {
        const peak = rows.slice(index).reduce(
          (best, row) => row[1] > best[1] ? row : best,
          rows[index],
        );
        if (peak[1] - low[1] >= NIGHT_RISE_MINIMUM_MGDL) {
          return {
            baselineMinute: low[0],
            baseline: low[1],
            riseMinute: current[0],
            peakMinute: peak[0],
            peak: peak[1],
            rise: round(peak[1] - low[1], 0),
          };
        }
      }
    }
    return null;
  }

  function findConfirmedDecline(rows, afterMinute) {
    const eligible = rows.filter((row) => row[0] >= afterMinute);
    if (eligible.length < 5) return null;
    const peak = eligible.reduce((best, row) => row[1] > best[1] ? row : best, eligible[0]);
    const startIndex = eligible.findIndex((row) => row[0] === peak[0]);
    for (let index = startIndex; index < eligible.length - 3; index += 1) {
      const candidate = eligible[index];
      const future = eligible.slice(index + 1, index + 5);
      if (future.length < 4) continue;
      if (future.at(-1)[0] - candidate[0] < 15 || future.at(-1)[0] - candidate[0] > 25) continue;
      const confirmedDrop = candidate[1] - future.at(-1)[1];
      const rebound = Math.max(...future.map((row) => row[1])) - candidate[1];
      if (confirmedDrop >= NIGHT_DECLINE_MGDL && rebound <= 3) {
        return {
          peakMinute: peak[0],
          peak: peak[1],
          declineMinute: future.find((row) => candidate[1] - row[1] >= 3)?.[0] || future[0][0],
          confirmedMinute: future.at(-1)[0],
          confirmedDrop: round(confirmedDrop, 0),
        };
      }
    }
    return null;
  }

  function buildNightRiseAnalysis({ diary = [], clinical = {} } = {}) {
    const cgm = exactCgmRows(clinical);
    const corrections = allCorrectionBoluses(clinical);
    const keys = [...new Set(
      cgm
        .filter((row) => new Date(row[0] * MINUTE_MS).getHours() >= NIGHT_START_HOUR)
        .map((row) => localDateKey(row[0])),
    )].sort();

    const result = {
      nightsWithCgm: 0,
      excludedForMeal: 0,
      eligibleNights: 0,
      rises: [],
      correctedRises: 0,
      declinesAfterCorrection: 0,
      medianCorrectionUnitsUntilDecline: null,
    };

    for (const key of keys) {
      const fallbackStart = dateAt(key, NIGHT_START_HOUR);
      const start = sleepStartForDate(diary, key) || fallbackStart;
      const end = dateAt(key, 24);
      const rows = cgm.filter((row) => row[0] >= start && row[0] < end);
      if (rows.length < NIGHT_MIN_CGM_POINTS) continue;
      result.nightsWithCgm += 1;

      if (hasMealContext(diary, clinical, start - NIGHT_MEAL_LOOKBACK_MINUTES, end)) {
        result.excludedForMeal += 1;
        continue;
      }
      result.eligibleNights += 1;
      const rise = findNightRise(rows);
      if (!rise) continue;

      const eventCorrections = corrections.filter(
        (event) => event.minute >= rise.riseMinute && event.minute < end,
      );
      const firstCorrection = eventCorrections[0] || null;
      const decline = firstCorrection ? findConfirmedDecline(rows, firstCorrection.minute) : null;
      const unitsUntilDecline = firstCorrection
        ? round(eventCorrections
          .filter((event) => event.minute <= (decline?.confirmedMinute ?? end))
          .reduce((sum, event) => sum + event.units, 0), 2)
        : 0;
      const night = {
        key,
        start,
        usedSleepEntry: start !== fallbackStart,
        ...rise,
        correctionCount: eventCorrections.length,
        correctionUnits: unitsUntilDecline,
        firstCorrectionMinute: firstCorrection?.minute ?? null,
        decline,
        minutesCorrectionToDecline: decline && firstCorrection
          ? decline.declineMinute - firstCorrection.minute
          : null,
      };
      result.rises.push(night);
      if (eventCorrections.length) result.correctedRises += 1;
      if (decline) result.declinesAfterCorrection += 1;
    }

    result.medianCorrectionUnitsUntilDecline = round(median(
      result.rises
        .filter((event) => event.decline && event.correctionUnits > 0)
        .map((event) => event.correctionUnits),
    ), 2);
    return result;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function formatNumber(value, digits = 1) {
    return Number.isFinite(Number(value))
      ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value))
      : '–';
  }

  function formatDate(minute) {
    return Number.isFinite(minute)
      ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(minute * MINUTE_MS))
      : '–';
  }

  function formatTime(minute) {
    return Number.isFinite(minute)
      ? new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })
        .format(new Date(minute * MINUTE_MS))
      : '–';
  }

  function ensureStyles() {
    if (document.querySelector('#feedback-ui-styles')) return;
    const style = document.createElement('style');
    style.id = 'feedback-ui-styles';
    style.textContent = `
      .feedback-boundary { margin-top:2px; }
      .feedback-boundary > summary { cursor:pointer; color:var(--muted); font-weight:800; }
      .feedback-boundary p { margin:8px 0 0; }
      .diary-help-disclosure,
      .diary-context-disclosure {
        margin:12px 0;
        border:1px solid var(--line);
        border-radius:12px;
        background:var(--surface-strong);
        overflow:hidden;
      }
      .diary-help-disclosure > summary,
      .diary-context-disclosure > summary {
        cursor:pointer;
        padding:10px 12px;
        font-weight:800;
      }
      .diary-help-disclosure > p,
      .diary-help-disclosure > div,
      .diary-context-disclosure > .form-grid { margin:0; padding:0 12px 12px; }
      .diary-type-label { grid-column:span 1; }
      .diary-field-group {
        grid-column:1/-1;
        border:1px solid var(--line);
        border-radius:14px;
        padding:14px;
        background:var(--surface-strong);
      }
      .diary-field-group > h3 { margin:0 0 12px; }
      .diary-field-group[hidden] { display:none; }
      .food-library { margin-top:14px; border-top:1px solid var(--line); padding-top:14px; }
      .food-library h4 { margin:0 0 10px; }
      .food-library-status { min-height:1.2em; margin-top:8px; }
      .timing-insight,
      .night-rise-event {
        border:1px solid var(--line);
        border-radius:12px;
        padding:12px;
        background:var(--surface-strong);
      }
      .timing-insight + .timing-insight,
      .night-rise-event + .night-rise-event { margin-top:10px; }
      .timing-band-list { display:grid; gap:6px; margin-top:10px; }
      .timing-band-list div { display:flex; justify-content:space-between; gap:16px; }
      .feedback-cause-details { margin-top:12px; }
      .feedback-cause-details > summary { cursor:pointer; font-weight:800; }
      .feedback-cause-details p { margin:8px 0 0; color:var(--muted); }
      .entry-context { color:var(--muted); }
      @media (max-width:720px) {
        .timing-band-list div { display:block; }
      }
    `;
    document.head.appendChild(style);
  }

  function hide(selector) {
    const element = document.querySelector(selector);
    if (element) element.hidden = true;
    return element;
  }

  function cleanStaticText() {
    hide('header .eyebrow');
    hide('header .lead');
    hide('#range-note');
    hide('body footer');
    hide('#recommendations > .notice');
    hide('#food-comparison-note');
    hide('#food-comparison-explanation');
    hide('#quality-note');

    for (const card of document.querySelectorAll('#import-data article.card')) {
      if (card.querySelector('h2')?.textContent.trim() === 'Speichermodell') card.hidden = true;
    }
  }

  function definition(card, label) {
    const term = [...card.querySelectorAll('dt')]
      .find((candidate) => candidate.textContent.trim() === label);
    return term?.nextElementSibling || null;
  }

  function makeBoundaryCollapsible(card) {
    const target = definition(card, 'Grenze');
    if (!target || target.querySelector(':scope > details.feedback-boundary')) return;
    const text = target.textContent.trim();
    const details = document.createElement('details');
    details.className = 'feedback-boundary';
    const summary = document.createElement('summary');
    summary.textContent = 'Grenze anzeigen';
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    details.append(summary, paragraph);
    target.replaceChildren(details);
  }

  function cleanRecommendations() {
    hide('#recommendations > .notice');
    for (const card of document.querySelectorAll('#recommendation-list .rec')) {
      const title = card.querySelector('h2')?.textContent.trim() || '';
      const finding = definition(card, 'Befund');
      const action = definition(card, 'Handlung');
      if (title.startsWith('Höherer Hochanteil')) {
        if (finding && !finding.dataset.feedbackCause) {
          finding.textContent = `${finding.textContent.trim()} Mögliche Mitursachen sind eine ` +
            'späte oder verzögerte Mahlzeitenwirkung, Krankheit oder Stress, hormonelle ' +
            'Gegenregulation – etwa durch Wachstumshormon – oder eine in diesem Zeitfenster ' +
            'nicht ausreichende Insulinwirkung. Aus dem Stundenmuster allein lässt sich die ' +
            'Ursache nicht unterscheiden.';
          finding.dataset.feedbackCause = 'high';
        }
        if (action) {
          action.textContent = 'Wiederholt betroffene Tage nach Mahlzeit, Krankheit, Aktivität ' +
            'und Boluskontext getrennt vergleichen.';
        }
      } else if (title.startsWith('Höherer Niedriganteil')) {
        if (finding && !finding.dataset.feedbackCause) {
          finding.textContent = `${finding.textContent.trim()} Mögliche Mitursachen sind noch ` +
            'wirksames Insulin, Aktivität, verzögert aufgenommene oder nicht erfasste ' +
            'Kohlenhydrate, Krankheitserholung oder eine Sensorabweichung. Aus dem ' +
            'Stundenmuster allein lässt sich die Ursache nicht unterscheiden.';
          finding.dataset.feedbackCause = 'low';
        }
        if (action) {
          action.textContent = 'Wiederholt betroffene Tage nach Bolus, Aktivität, Mahlzeit und ' +
            'eventueller Hypobehandlung getrennt vergleichen.';
        }
      }
      makeBoundaryCollapsible(card);
    }
  }

  function replaceText(rootElement, replacements) {
    if (!rootElement) return;
    const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      let value = node.nodeValue;
      for (const [source, target] of replacements) value = value.split(source).join(target);
      node.nodeValue = value;
    }
  }

  function cleanMealAnalysis() {
    const intro = document.querySelector('#meal-method-explanation p.muted') ||
      document.querySelector('#meal-analysis article.card.full > p.muted');
    if (intro) {
      intro.textContent = 'Der Peak endet erst vor einem stabil bestätigten Rückgang: mehrere ' +
        'aufeinanderfolgende CGM-Werte müssen über etwa 20 Minuten insgesamt mindestens ' +
        '8 mg/dl fallen. Das beschreibt nur die Kurvenform und nicht den pharmakologischen ' +
        'Wirkeintritt des Insulins.';
    }
    const methodSummary = document.querySelector('#meal-method-explanation > summary');
    if (methodSummary) methodSummary.textContent = 'Bestimmung des Peak-Endes anzeigen';
    hide('#food-comparison-note');
    hide('#food-comparison-explanation');

    for (const value of document.querySelectorAll('#food-comparison-means strong')) {
      value.textContent = value.textContent
        .replace(/\s*·\s*n=\d+\b/g, '')
        .replace(/nicht bestimmbar\s*·\s*n=0/g, 'nicht bestimmbar');
    }
    replaceText(document.querySelector('#meal-analysis'), [
      ['mit anhaltendem Rückgangs-Proxy', 'mit stabil bestätigtem Rückgang'],
      ['anhaltender Rückgangs-Proxy', 'stabil bestätigter Rückgang'],
      ['CGM-Wendepunkt-Proxy', 'Stabil bestätigter Rückgang'],
      ['Kurvenwendepunkt-Proxy', 'stabil bestätigtem Rückgang'],
    ]);
  }

  function cleanInsulinAnalysis() {
    const phaseCard = document.querySelector('#all-bolus-phases-card');
    if (phaseCard) {
      const title = phaseCard.querySelector('h2');
      if (title) title.textContent = 'Beobachtete Kurvenänderung nach Boli';
      const intro = [...phaseCard.children].find(
        (element) => element.matches?.('p.muted.compact') && element.id !== 'all-bolus-phase-note',
      );
      if (intro) {
        intro.textContent = 'Die Zeiten beschreiben, wann ein vorhandener CGM-Anstieg schwächer ' +
          'wird, ein Wendepunkt folgt und ein stabiler Rückgang beginnt. Sie sind kein direkt ' +
          'gemessener pharmakologischer Wirkeintritt.';
      }
      hide('#all-bolus-phase-note');
      for (const cell of phaseCard.querySelectorAll('#all-bolus-phase-summary > div')) {
        const label = cell.querySelector('span');
        const value = cell.querySelector('strong');
        if (!label || !value) continue;
        if (label.textContent.trim() === 'vollständige Drei-Phasen-Verläufe') {
          cell.hidden = true;
          continue;
        }
        if (label.textContent.includes('Plateau / Wendepunkt')) label.textContent = 'Wendepunkt';
        if (label.textContent.includes('anhaltender Abfall beginnt')) {
          label.textContent = 'stabiler Rückgang beginnt';
        }
        value.textContent = value.textContent
          .replace(/\s*·\s*n=\d+\b/g, '')
          .replace(/nicht bestimmbar\s*·\s*n=0/g, 'nicht bestimmbar');
      }
    }

    const aggregateCard = document.querySelector('#insulin-aggregate')?.closest('article.card');
    const aggregateTitle = aggregateCard?.querySelector('h2');
    if (aggregateTitle) aggregateTitle.textContent = 'Persönliche Wirkungsschätzung aus geeigneten Korrekturboli';

    const notice = document.querySelector('#insulin-action .notice.warn');
    if (notice) {
      notice.innerHTML = '<strong>Retrospektive Kurvenauswertung:</strong> Die App beschreibt, ' +
        'wann sich der CGM-Verlauf nach einem Bolus verändert. Für die persönliche ' +
        'Wirkungsschätzung werden nur Korrekturboli ohne protokollierte Mahlzeit, weiteren ' +
        'Bolus, Aktivität oder Krankheit im Analysefenster zusammengefasst.';
    }

    hide('#insulin-means-card');
    hide('#insulin-means-explanation');
    hide('#insulin-profile-explanation');
    const events = document.querySelector('#insulin-events');
    if (events) events.closest('article.card').hidden = true;
    hide('#insulin-events-explanation');
  }

  function setLabelText(inputId, text) {
    const label = document.querySelector(`#${inputId}`)?.closest('label');
    if (!label) return;
    const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.nodeValue = text;
  }

  function createGroup(id, title) {
    const group = document.createElement('section');
    group.id = id;
    group.className = 'diary-field-group';
    group.innerHTML = `<h3>${escapeHtml(title)}</h3><div class="form-grid"></div>`;
    return group;
  }

  function moveLabel(id, group) {
    const label = document.querySelector(`#${id}`)?.closest('label');
    const target = group?.querySelector(':scope > .form-grid');
    if (label && target && label.parentElement !== target) target.appendChild(label);
  }

  function wrapDiaryHelp(id, summaryText, element) {
    if (!element) return null;
    const existing = document.querySelector(`#${id}`);
    if (existing) return existing;
    const details = document.createElement('details');
    details.id = id;
    details.className = 'diary-help-disclosure';
    const summary = document.createElement('summary');
    summary.textContent = summaryText;
    element.insertAdjacentElement('beforebegin', details);
    details.append(summary, element);
    return details;
  }

  function ensureDiaryStructure() {
    const form = document.querySelector('#diary-form');
    const grid = form?.querySelector(':scope > .form-grid');
    if (!form || !grid) return;

    const occasion = document.querySelector('#occasion');
    if (occasion && ![...occasion.options].some((option) => option.value === 'Schlaf')) {
      occasion.add(new Option('Schlaf', 'Schlaf'));
    }

    let type = document.querySelector('#entry-type');
    if (!type) {
      const label = document.createElement('label');
      label.className = 'diary-type-label';
      label.textContent = 'Bereich';
      type = document.createElement('select');
      type.id = 'entry-type';
      type.innerHTML = '<option value="meal">Mahlzeit</option>' +
        '<option value="activity">Aktivität</option>' +
        '<option value="sleep">Schlaf</option>' +
        '<option value="other">Sonstiges</option>';
      label.appendChild(type);
      const whenLabel = document.querySelector('#when')?.closest('label');
      whenLabel?.insertAdjacentElement('afterend', label);
    }

    let meal = document.querySelector('#diary-meal-fields');
    let activity = document.querySelector('#diary-activity-fields');
    let sleep = document.querySelector('#diary-sleep-fields');
    let other = document.querySelector('#diary-other-fields');
    if (!meal) {
      meal = createGroup('diary-meal-fields', 'Mahlzeit');
      activity = createGroup('diary-activity-fields', 'Aktivität');
      sleep = createGroup('diary-sleep-fields', 'Schlaf');
      other = createGroup('diary-other-fields', 'Sonstiges');
      grid.append(meal, activity, sleep, other);
    }

    setLabelText('occasion', 'Mahlzeitentyp');
    setLabelText('activity', 'Art / Dauer der Aktivität');
    moveLabel('occasion', meal);
    moveLabel('food', meal);
    moveLabel('carbs', meal);
    moveLabel('fat', meal);
    moveLabel('protein', meal);
    moveLabel('fiber', meal);
    moveLabel('activity', activity);
    moveLabel('sleep', sleep);

    let steps = document.querySelector('#steps');
    if (!steps) {
      const label = document.createElement('label');
      label.textContent = 'Schritte';
      steps = document.createElement('input');
      steps.id = 'steps';
      steps.type = 'number';
      steps.min = '0';
      steps.step = '1';
      label.appendChild(steps);
      activity.querySelector(':scope > .form-grid').appendChild(label);
    }

    let otherOccasion = document.querySelector('#other-occasion');
    if (!otherOccasion) {
      const label = document.createElement('label');
      label.textContent = 'Art des Eintrags';
      otherOccasion = document.createElement('select');
      otherOccasion.id = 'other-occasion';
      otherOccasion.innerHTML = '<option>Sonstiges</option><option>Unterzuckerung</option>';
      label.appendChild(otherOccasion);
      other.querySelector(':scope > .form-grid').appendChild(label);
    }

    let context = document.querySelector('#diary-context-fields');
    if (!context) {
      context = document.createElement('details');
      context.id = 'diary-context-fields';
      context.className = 'diary-context-disclosure full-field';
      const summary = document.createElement('summary');
      summary.textContent = 'Zusätzlichen Kontext erfassen';
      const contextGrid = document.createElement('div');
      contextGrid.className = 'form-grid';
      context.append(summary, contextGrid);
      grid.appendChild(context);
    }
    for (const id of ['stress', 'illness', 'notes']) {
      const label = document.querySelector(`#${id}`)?.closest('label');
      const target = context.querySelector(':scope > .form-grid');
      if (label && label.parentElement !== target) target.appendChild(label);
    }

    ensureFoodLibrary(meal);
    installDiaryEvents(form);
  }

  function categoryForOccasion(value) {
    if (MEAL_OCCASIONS.has(value)) return 'meal';
    if (value === 'Sport') return 'activity';
    if (value === 'Schlaf') return 'sleep';
    return 'other';
  }

  function applyDiaryCategory() {
    const type = document.querySelector('#entry-type');
    if (!type) return;
    for (const [name, id] of [
      ['meal', '#diary-meal-fields'],
      ['activity', '#diary-activity-fields'],
      ['sleep', '#diary-sleep-fields'],
      ['other', '#diary-other-fields'],
    ]) {
      const group = document.querySelector(id);
      if (group) group.hidden = type.value !== name;
    }
  }

  function clearValue(id) {
    const element = document.querySelector(`#${id}`);
    if (element) element.value = '';
  }

  function prepareDiarySubmit() {
    const type = document.querySelector('#entry-type')?.value || 'meal';
    const occasion = document.querySelector('#occasion');
    const activity = document.querySelector('#activity');
    const steps = document.querySelector('#steps');
    if (!occasion) return type;

    if (type === 'meal') {
      if (!MEAL_OCCASIONS.has(occasion.value)) occasion.value = 'Frühstück';
      clearValue('activity');
      clearValue('sleep');
    } else if (type === 'activity') {
      occasion.value = 'Sport';
      const description = activity?.value.trim() || '';
      const stepValue = finite(steps?.value);
      if (activity) {
        activity.value = [description, stepValue !== null ? `${formatNumber(stepValue, 0)} Schritte` : '']
          .filter(Boolean).join(' · ');
      }
      for (const id of ['food', 'carbs', 'fat', 'protein', 'fiber', 'sleep']) clearValue(id);
    } else if (type === 'sleep') {
      occasion.value = 'Schlaf';
      for (const id of ['food', 'carbs', 'fat', 'protein', 'fiber', 'activity']) clearValue(id);
    } else {
      occasion.value = document.querySelector('#other-occasion')?.value || 'Sonstiges';
      for (const id of ['food', 'carbs', 'fat', 'protein', 'fiber', 'activity', 'sleep']) clearValue(id);
    }
    return type;
  }

  function installDiaryEvents(form) {
    if (form.dataset.feedbackDiaryInstalled === 'true') return;
    form.dataset.feedbackDiaryInstalled = 'true';
    const type = document.querySelector('#entry-type');
    const occasion = document.querySelector('#occasion');
    const other = document.querySelector('#other-occasion');
    const originalSubmit = form.onsubmit;

    type?.addEventListener('change', () => {
      if (type.value === 'meal' && !MEAL_OCCASIONS.has(occasion.value)) occasion.value = 'Frühstück';
      if (type.value === 'activity') occasion.value = 'Sport';
      if (type.value === 'sleep') occasion.value = 'Schlaf';
      if (type.value === 'other') occasion.value = other?.value || 'Sonstiges';
      applyDiaryCategory();
    });
    occasion?.addEventListener('change', () => {
      type.value = categoryForOccasion(occasion.value);
      if (type.value === 'other' && other) other.value = occasion.value;
      applyDiaryCategory();
    });
    other?.addEventListener('change', () => {
      if (type.value === 'other') occasion.value = other.value;
    });

    form.onsubmit = function feedbackDiarySubmit(event) {
      const submittedType = prepareDiarySubmit();
      const result = originalSubmit?.call(this, event);
      type.value = 'meal';
      occasion.value = 'Frühstück';
      applyDiaryCategory();
      if (submittedType !== 'meal' && typeof gcShow === 'function') gcShow('diary');
      return result;
    };
    applyDiaryCategory();
  }

  function loadFoodLibrary() {
    try {
      const parsed = JSON.parse(localStorage.getItem(FOOD_LIBRARY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter((item) => item && item.name) : [];
    } catch {
      return [];
    }
  }

  function saveFoodLibrary(items) {
    localStorage.setItem(FOOD_LIBRARY_KEY, JSON.stringify(items));
  }

  function foodLibraryElements() {
    return {
      panel: document.querySelector('#food-library'),
      select: document.querySelector('#food-library-select'),
      weight: document.querySelector('#food-weight'),
      save: document.querySelector('#save-food'),
      favorite: document.querySelector('#favorite-food'),
      remove: document.querySelector('#remove-food'),
      status: document.querySelector('#food-library-status'),
    };
  }

  function renderFoodLibrary(selectedId = null) {
    const elements = foodLibraryElements();
    if (!elements.select) return;
    const library = loadFoodLibrary().sort(
      (a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
        a.name.localeCompare(b.name, 'de'),
    );
    const current = selectedId || elements.select.value;
    elements.select.innerHTML = '<option value="">Lebensmittel auswählen</option>' +
      library.map((item) => `<option value="${escapeHtml(item.id)}">` +
        `${item.favorite ? '★ ' : ''}${escapeHtml(item.name)}</option>`).join('');
    if (library.some((item) => item.id === current)) elements.select.value = current;
    const selected = library.find((item) => item.id === elements.select.value) || null;
    if (elements.favorite) elements.favorite.disabled = !selected;
    if (elements.remove) elements.remove.disabled = !selected;
    if (elements.favorite) elements.favorite.textContent = selected?.favorite
      ? 'Aus Favoriten entfernen'
      : 'Als Favorit markieren';
  }

  function selectedFoodRecord() {
    const selected = document.querySelector('#food-library-select')?.value;
    return loadFoodLibrary().find((item) => item.id === selected) || null;
  }

  function applySelectedFood() {
    const record = selectedFoodRecord();
    if (!record) return;
    const weight = document.querySelector('#food-weight');
    document.querySelector('#food').value = record.name;
    weight.value = String(record.referenceWeight);
    scaleSelectedFood();
  }

  function scaleSelectedFood() {
    const record = selectedFoodRecord();
    const weight = finite(document.querySelector('#food-weight')?.value);
    if (!record || weight === null || weight <= 0) return;
    const factor = weight / record.referenceWeight;
    for (const id of ['carbs', 'fat', 'protein', 'fiber']) {
      const value = finite(record[id]);
      document.querySelector(`#${id}`).value = value === null ? '' : String(round(value * factor, 1));
    }
    document.querySelector('#food').value = record.name;
  }

  function ensureFoodLibrary(mealGroup) {
    if (!mealGroup || document.querySelector('#food-library')) {
      renderFoodLibrary();
      return;
    }
    const panel = document.createElement('div');
    panel.id = 'food-library';
    panel.className = 'food-library full-field';
    panel.innerHTML = `
      <h4>Gespeicherte Lebensmittel und Favoriten</h4>
      <div class="form-grid">
        <label class="full-field">Lebensmittel
          <select id="food-library-select"><option value="">Lebensmittel auswählen</option></select>
        </label>
        <label>Gewicht (g)<input id="food-weight" type="number" min="0.1" step="0.1" value="100"></label>
      </div>
      <div class="actions">
        <button id="save-food" class="secondary" type="button">Aktuelle Angaben speichern</button>
        <button id="favorite-food" class="secondary" type="button" disabled>Als Favorit markieren</button>
        <button id="remove-food" class="danger" type="button" disabled>Löschen</button>
      </div>
      <p id="food-library-status" class="muted compact food-library-status" role="status"></p>`;
    mealGroup.querySelector(':scope > .form-grid').appendChild(panel);

    const elements = foodLibraryElements();
    elements.select.addEventListener('change', applySelectedFood);
    elements.weight.addEventListener('input', scaleSelectedFood);
    elements.save.addEventListener('click', () => {
      const name = document.querySelector('#food').value.trim();
      const referenceWeight = finite(elements.weight.value);
      const status = elements.status;
      if (!name || referenceWeight === null || referenceWeight <= 0) {
        status.textContent = 'Name und Bezugsgewicht fehlen.';
        return;
      }
      const id = normalizeFood(name);
      const library = loadFoodLibrary();
      const existing = library.find((item) => item.id === id);
      const record = {
        id,
        name,
        referenceWeight,
        carbs: finite(document.querySelector('#carbs').value),
        fat: finite(document.querySelector('#fat').value),
        protein: finite(document.querySelector('#protein').value),
        fiber: finite(document.querySelector('#fiber').value),
        favorite: Boolean(existing?.favorite),
      };
      const updated = library.filter((item) => item.id !== id);
      updated.push(record);
      saveFoodLibrary(updated);
      renderFoodLibrary(id);
      status.textContent = `${name} ist gespeichert. Beim Ändern des Gewichts werden die Angaben proportional berechnet.`;
    });
    elements.favorite.addEventListener('click', () => {
      const selected = selectedFoodRecord();
      if (!selected) return;
      const library = loadFoodLibrary().map((item) =>
        item.id === selected.id ? { ...item, favorite: !item.favorite } : item,
      );
      saveFoodLibrary(library);
      renderFoodLibrary(selected.id);
    });
    elements.remove.addEventListener('click', () => {
      const selected = selectedFoodRecord();
      if (!selected) return;
      saveFoodLibrary(loadFoodLibrary().filter((item) => item.id !== selected.id));
      renderFoodLibrary();
      elements.status.textContent = `${selected.name} wurde aus der Lebensmitteldatenbank gelöscht.`;
    });
    renderFoodLibrary();
  }

  function collapseDiaryHelp() {
    const card = document.querySelector('#diary article.card.wide');
    if (!card) return;
    const intro = card.querySelector(':scope > p.muted');
    wrapDiaryHelp('diary-local-help', 'Hinweise zum lokalen Tagebuch anzeigen', intro);
    const source = document.querySelector('#glooko-source-control');
    wrapDiaryHelp('diary-glooko-help', 'Zusätzliche Glooko-Mahlzeiten anzeigen', source);
  }

  function enhanceDiaryEntries() {
    if (typeof gcState === 'undefined') return;
    const byId = new Map((gcState.diary || []).map((entry) => [String(entry.id), entry]));
    for (const button of document.querySelectorAll('#entries .remove-entry')) {
      const entry = byId.get(String(button.dataset.id));
      const container = button.closest('.entry');
      if (!entry || !container) continue;
      let context = container.querySelector(':scope > .entry-context');
      if (!context) {
        context = document.createElement('p');
        context.className = 'entry-context';
        button.insertAdjacentElement('beforebegin', context);
      }
      const parts = [];
      if (MEAL_OCCASIONS.has(entry.occasion)) {
        if (entry.carbs !== '') parts.push(`${entry.carbs} g KH`);
        if (entry.fat !== '') parts.push(`${entry.fat} g Fett`);
        if (entry.protein !== '') parts.push(`${entry.protein} g Eiweiß`);
      } else if (entry.occasion === 'Sport' && entry.activity) {
        parts.push(entry.activity);
      } else if (entry.occasion === 'Schlaf' && entry.sleep !== '') {
        parts.push(`${entry.sleep} h Schlaf`);
      }
      if (entry.notes) parts.push(entry.notes);
      context.textContent = parts.join(' · ');
      context.hidden = parts.length === 0;
    }
  }

  function currentMealAnalyses() {
    if (typeof gcState === 'undefined') return [];
    const analyze = typeof analyzeMeals === 'function'
      ? analyzeMeals
      : root?.GlucoseCoachV3?.analyzeMeals;
    if (typeof analyze !== 'function') return [];
    return analyze(gcState.diary || [], gcState.clinical?.cgm || [], gcState.clinical?.boluses || []);
  }

  function ensureTimingCard() {
    let card = document.querySelector('#meal-timing-card');
    if (card) return card;
    const comparison = document.querySelector('#food-comparison')?.closest('article.card');
    if (!comparison) return null;
    card = document.createElement('article');
    card.id = 'meal-timing-card';
    card.className = 'card full';
    card.innerHTML = '<h2>Boluszeitpunkt bei wiederholten Mahlzeiten</h2><div id="meal-timing-insights"></div>';
    comparison.insertAdjacentElement('afterend', card);
    return card;
  }

  function renderMealTimingInsights() {
    const card = ensureTimingCard();
    if (!card) return;
    const insights = buildMealTimingInsights(currentMealAnalyses());
    const target = card.querySelector('#meal-timing-insights');
    if (!insights.length) {
      target.innerHTML = '<p class="muted">Noch keine Mahlzeit ist mindestens zweimal mit ' +
        'vollständigem Peak und zugeordnetem Mahlzeitenbolus auswertbar.</p>';
      return;
    }
    target.innerHTML = insights.map((insight) => {
      const result = insight.comparable
        ? `<p><strong>Kleinster beobachteter Median:</strong> ${escapeHtml(insight.best.label)} ` +
          `mit ${formatNumber(insight.best.medianPeakDelta, 0)} mg/dl Peak-Anstieg aus ` +
          `${insight.best.observations} Beobachtungen.</p>`
        : '<p class="muted">Für eine belastbare Gegenüberstellung fehlen noch mindestens vier ' +
          'Beobachtungen in wenigstens zwei unterschiedlichen Zeitbereichen.</p>';
      const bands = insight.bands.map((band) =>
        `<div><span>${escapeHtml(band.label)} · ${band.observations} Beobachtung(en)</span>` +
        `<strong>${formatNumber(band.medianPeakDelta, 0)} mg/dl Peak-Anstieg</strong></div>`,
      ).join('');
      return `<section class="timing-insight"><h3>${escapeHtml(insight.label)}</h3>${result}` +
        `<div class="timing-band-list">${bands}</div></section>`;
    }).join('') +
      '<details class="feedback-cause-details"><summary>Grenzen der Auswertung anzeigen</summary>' +
      '<p>Verglichen werden nur tatsächlich beobachtete Zeitbereiche. Ausgangswert, Portion, ' +
      'Zusammensetzung, Krankheit, Aktivität und spätere Korrekturboli können den Peak ebenfalls ' +
      'verändern. Daraus entsteht keine automatische Insulinanweisung.</p></details>';
  }

  function ensureNightCard() {
    let card = document.querySelector('#night-rise-card');
    if (card) return card;
    const phase = document.querySelector('#all-bolus-phases-card');
    const first = document.querySelector('#insulin-action .grid > article.card.full');
    const anchor = phase || first;
    if (!anchor) return null;
    card = document.createElement('article');
    card.id = 'night-rise-card';
    card.className = 'card full';
    card.innerHTML = '<h2>Abendlicher Anstieg ohne protokollierte Mahlzeit</h2>' +
      '<div id="night-rise-content"></div>';
    anchor.insertAdjacentElement('afterend', card);
    return card;
  }

  function renderNightRiseAnalysis() {
    if (typeof gcState === 'undefined') return;
    const card = ensureNightCard();
    if (!card) return;
    const result = buildNightRiseAnalysis({ diary: gcState.diary || [], clinical: gcState.clinical || {} });
    const target = card.querySelector('#night-rise-content');
    const summary = [
      ['Nächte mit ausreichenden CGM-Daten', result.nightsWithCgm],
      ['ohne Mahlzeitenkontext auswertbar', result.eligibleNights],
      ['Anstieg erkannt', result.rises.length],
      ['mit Korrekturbolus', result.correctedRises],
      ['bestätigter Rückgang nach Korrektur', result.declinesAfterCorrection],
      ['beobachtete Korrekturmenge bis Rückgang', result.medianCorrectionUnitsUntilDecline === null
        ? '–'
        : `${formatNumber(result.medianCorrectionUnitsUntilDecline, 2)} E im Median`],
    ];
    const events = result.rises.length
      ? result.rises.slice(-8).reverse().map((event) => {
        const correction = event.correctionCount
          ? `${formatNumber(event.correctionUnits, 2)} E in ${event.correctionCount} Korrektur(en)`
          : 'keine Korrektur erfasst';
        const decline = event.decline
          ? `bestätigter Rückgang ${formatNumber(event.minutesCorrectionToDecline, 0)} Min. nach erster Korrektur`
          : 'kein bestätigter Rückgang nach einer Korrektur im Zeitfenster';
        return `<section class="night-rise-event"><strong>${formatDate(event.start)} · ab ` +
          `${formatTime(event.start)} Uhr</strong><p>Anstieg um ${formatNumber(event.rise, 0)} mg/dl ` +
          `bis ${formatTime(event.peakMinute)} Uhr · ${correction} · ${decline}</p></section>`;
      }).join('')
      : '<p class="muted">Noch kein entsprechender Verlauf erkannt. Nächte mit einer ' +
        'protokollierten Mahlzeit in den drei Stunden davor werden nicht einbezogen.</p>';
    target.innerHTML = '<div class="analysis-grid insulin-summary">' +
      summary.map(([label, value]) => `<div><span>${escapeHtml(label)}</span>` +
        `<strong>${escapeHtml(value)}</strong></div>`).join('') +
      `</div><div style="margin-top:12px">${events}</div>` +
      '<details class="feedback-cause-details"><summary>Mögliche Ursachen anzeigen</summary>' +
      '<p>Der Verlauf allein beweist keine Ursache. Mögliche Mitursachen sind hormonelle ' +
      'Gegenregulation nach dem Einschlafen – einschließlich Wachstumshormon –, Krankheit oder ' +
      'Stress, verzögerte Aufnahme einer früheren Mahlzeit, geringe Aktivität, eine nicht passende ' +
      'Basalabdeckung sowie Katheter-, Pumpen- oder Sensorprobleme. Die App weist nur vorhandene ' +
      'Kontexte und beobachtete Korrekturen aus.</p></details>';
  }

  function applyFeedbackUi() {
    ensureStyles();
    ensureDiaryStructure();
    collapseDiaryHelp();
    cleanStaticText();
    cleanRecommendations();
    cleanMealAnalysis();
    cleanInsulinAnalysis();
    enhanceDiaryEntries();
    renderMealTimingInsights();
    renderNightRiseAnalysis();
    renderFoodLibrary();
    applyDiaryCategory();
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    if (root?.__glucoseCoachFeedbackUiInstalled) {
      applyFeedbackUi();
      return;
    }
    if (root) root.__glucoseCoachFeedbackUiInstalled = true;
    const previousRender = gcRender;
    gcRender = function renderWithFeedbackUi() {
      previousRender();
      applyFeedbackUi();
    };
    applyFeedbackUi();
  }

  const api = {
    buildMealTimingInsights,
    buildNightRiseAnalysis,
    findNightRise,
    findConfirmedDecline,
    timingBucket,
    FOOD_LIBRARY_KEY,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachFeedbackUi = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
