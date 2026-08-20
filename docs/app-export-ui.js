(function (root) {
  'use strict';

  const PROFILE_KEY = 'glucosecoach-profile-v1';

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function readProfile() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function normalizedClinical() {
    if (
      typeof GlucoseCoachV3 !== 'undefined' &&
      typeof GlucoseCoachV3.normalizeClinical === 'function'
    ) {
      return GlucoseCoachV3.normalizeClinical(gcState.clinical || {});
    }
    return gcState.clinical || {};
  }

  function currentPayload() {
    return {
      version: root.GLUCOSECOACH_VERSION || '',
      profile: readProfile(),
      ui: { windowDays: gcState.windowDays },
      diary: safeArray(gcState.diary),
      clinical: normalizedClinical(),
    };
  }

  function downloadText(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function dateFilenamePart() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }


  function restoreCompleteCsv(file, api) {
    return file.text().then((source) => {
      const payload = api.parseCompleteCsv(source);
      gcState.diary = payload.diary;
      gcState.clinical = (
        typeof GlucoseCoachV3 !== 'undefined' &&
        typeof GlucoseCoachV3.normalizeClinical === 'function'
      ) ? GlucoseCoachV3.normalizeClinical(payload.clinical) : payload.clinical;

      if (payload.profile && typeof payload.profile === 'object') {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(payload.profile));
      }

      const requested = String(payload.ui?.windowDays ?? '90');
      gcState.windowDays = ['7', '14', '30', '90', 'all'].includes(requested)
        ? requested
        : '90';
      const select = document.querySelector('#window-days');
      if (select) select.value = gcState.windowDays;

      gcState.lastImport = null;
      gcSave();
      gcRender();
      if (typeof gcShow === 'function') gcShow('overview');
      return payload;
    });
  }

  function ensureCsvImport(csvButton, api) {
    let label = document.querySelector('#import-complete-csv-label');
    let input = document.querySelector('#import-complete-csv');
    if (!label) {
      label = document.createElement('label');
      label.id = 'import-complete-csv-label';
      label.className = 'file-button';
      label.textContent = 'Vollständige CSV importieren';
      input = document.createElement('input');
      input.id = 'import-complete-csv';
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.hidden = true;
      label.appendChild(input);
      csvButton.insertAdjacentElement('afterend', label);
    }
    if (!input || input.dataset.bound === 'true') return;
    input.dataset.bound = 'true';
    input.addEventListener('change', async (event) => {
      const progress = document.querySelector('#import-progress');
      try {
        const file = event.target.files?.[0];
        if (!file) return;
        const payload = await restoreCompleteCsv(file, api);
        if (progress) {
          progress.textContent =
            `Vollständige CSV importiert: ${payload.diary.length} Tagebucheinträge und ${payload.clinical.cgm.length} CGM-Werte.`;
        }
      } catch (error) {
        if (progress) progress.textContent = `Import fehlgeschlagen: ${error.message}`;
        else alert(error.message);
      }
      event.target.value = '';
    });
  }

  function ensureExportControls() {
    const api = root.GlucoseCoachExport;
    const csvButton = document.querySelector('#export-all');
    if (!api || !csvButton) return;

    csvButton.textContent = 'Vollständige CSV herunterladen';
    csvButton.onclick = () => {
      downloadText(
        `glucosecoach-vollstaendig-${dateFilenamePart()}.csv`,
        api.buildCompleteCsv(currentPayload()),
        'text/csv;charset=utf-8',
      );
    };

    ensureCsvImport(csvButton, api);
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    const previousRender = gcRender;
    gcRender = function renderWithCompleteCsv() {
      previousRender();
      ensureExportControls();
    };
    ensureExportControls();
  }

  if (typeof document !== 'undefined') installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
