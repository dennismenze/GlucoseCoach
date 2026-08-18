    function renderAll() {
      renderOverview();
      renderRecommendations();
      renderMealAnalysis();
      renderDiary();
      renderImport();
      renderQuality();
    }

    function showPanel(id) {
      document.querySelectorAll('nav button').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.panel === id)));
      document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === id));
    }

    async function importCsvFiles(files) {
      if (!files.length) throw new Error('Keine CSV-Dateien ausgewählt.');
      const parsed = [];
      for (const file of files) {
        const text = await file.text();
        parsed.push(parseClinicalCsv(text));
      }
      const merged = mergeClinical(state.clinical, parsed);
      try {
        saveClinical(merged.clinical);
      } catch (error) {
        if (error?.name === 'QuotaExceededError') throw new Error('Der lokale Browserspeicher ist voll. Zuerst eine Gesamtsicherung exportieren und ältere lokale CSV-Daten löschen.');
        throw error;
      }
      state.clinical = merged.clinical;
      state.lastImport = merged.summary;
      return merged.summary;
    }

    function bindEvents() {
      document.querySelectorAll('nav button').forEach((button) => button.addEventListener('click', () => showPanel(button.dataset.panel)));
      document.querySelector('#window-days').addEventListener('change', (event) => {
        state.windowDays = event.target.value;
        renderOverview();
        renderRecommendations();
      });

      const form = document.querySelector('#diary-form');
      const whenInput = document.querySelector('#when');
      setNow(whenInput);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const get = (id) => document.querySelector(`#${id}`).value;
        const entry = {
          id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          when: get('when'), occasion: get('occasion'), food: get('food').trim(), carbs: get('carbs'), fat: get('fat'),
          protein: get('protein'), fiber: get('fiber'), activity: get('activity').trim(), sleep: get('sleep'), stress: get('stress'),
          illness: get('illness'), notes: get('notes').trim(),
        };
        state.diary.push(entry);
        saveDiary(state.diary);
        form.reset();
        setNow(whenInput);
        renderAll();
        showPanel('meal-analysis');
      });

      document.querySelector('#export-diary').addEventListener('click', () => downloadJson(`glucosecoach-tagebuch-${new Date().toISOString().slice(0,10)}.json`, { schema: DIARY_KEY, exportedAt: new Date().toISOString(), entries: state.diary }));
      document.querySelector('#import-diary').addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          const entries = Array.isArray(parsed) ? parsed : parsed.entries;
          if (!Array.isArray(entries)) throw new Error('Ungültiges Tagebuchformat.');
          state.diary = entries;
          saveDiary(state.diary);
          renderAll();
        } catch (error) { alert(`Import fehlgeschlagen: ${error.message}`); }
        event.target.value = '';
      });
      document.querySelector('#clear-diary').addEventListener('click', () => {
        if (confirm('Alle lokalen Tagebucheinträge unwiderruflich löschen?')) {
          localStorage.removeItem(DIARY_KEY);
          state.diary = [];
          renderAll();
        }
      });

      const csvInput = document.querySelector('#csv-files');
      csvInput.addEventListener('change', () => {
        const files = [...(csvInput.files ?? [])];
        document.querySelector('#selected-files').textContent = files.length ? `${files.length} Datei${files.length === 1 ? '' : 'en'} ausgewählt.` : 'Keine Dateien ausgewählt.';
      });
      document.querySelector('#import-csv').addEventListener('click', async () => {
        const progress = document.querySelector('#import-progress');
        const files = [...(csvInput.files ?? [])];
        try {
          progress.textContent = 'CSV wird ausschließlich lokal gelesen und verarbeitet …';
          const result = await importCsvFiles(files);
          progress.textContent = `Fertig: ${result.cgmAdded} neue CGM-Werte und ${result.bolusesAdded} neue Bolusereignisse; alle Ansichten wurden neu berechnet.`;
          csvInput.value = '';
          document.querySelector('#selected-files').textContent = 'Keine Dateien ausgewählt.';
          renderAll();
          showPanel('meal-analysis');
        } catch (error) {
          progress.textContent = `Import fehlgeschlagen: ${error.message}`;
        }
      });

      document.querySelector('#export-all').addEventListener('click', () => downloadJson(`glucosecoach-gesamtsicherung-${new Date().toISOString().slice(0,10)}.json`, { schema: BACKUP_SCHEMA, exportedAt: new Date().toISOString(), diary: state.diary, clinical: state.clinical }));
      document.querySelector('#import-all').addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          if (parsed.schema !== BACKUP_SCHEMA || !Array.isArray(parsed.diary) || !parsed.clinical) throw new Error('Ungültige Gesamtsicherung.');
          const clinical = normalizeClinical(parsed.clinical);
          saveDiary(parsed.diary);
          saveClinical(clinical);
          state.diary = parsed.diary;
          state.clinical = clinical;
          state.lastImport = null;
          renderAll();
        } catch (error) { alert(`Import fehlgeschlagen: ${error.message}`); }
        event.target.value = '';
      });
      document.querySelector('#clear-clinical').addEventListener('click', () => {
        if (confirm('Nur die lokal importierten CGM-/Bolusdaten löschen? Tagebucheinträge bleiben erhalten.')) {
          localStorage.removeItem(CLINICAL_KEY);
          state.clinical = emptyClinical();
          state.lastImport = null;
          renderAll();
        }
      });
    }

    function bootstrap() {
      state.diary = loadDiary();
      state.clinical = loadClinical();
      bindEvents();
      renderAll();
    }

    const GlucoseCoachAnalytics = {
      parseDateTime, parseLocaleNumber, detectDelimiter, parseDelimited, parseClinicalCsv,
      dedupeCgm, dedupeBoluses, mergeClinical, calculateMetrics, filterCgmWindow,
      analyzeMealEntry, analyzeMeals, buildFoodComparisons, illnessComparison, buildRecommendations,
      normalizeClinical, normalizeFood, findSustainedRise, findCurveTurn, matchBolus,
      DIARY_KEY, CLINICAL_KEY, STATIC_BASELINE,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = GlucoseCoachAnalytics;
    if (typeof document !== 'undefined') bootstrap();
