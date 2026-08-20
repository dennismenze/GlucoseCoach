(function (root) {
  'use strict';

  const PROFILE_KEY = 'glucosecoach-profile-v1';
  const KNOWN_IMPORT_FILE = /^(?:cgm_data_|bolus_data_|insulin_data_|basal_data_|bg_data_|alarms_data_|cgm_carbs_data_|exercise_data_|food_data_|manual_insulin_data_|medication_data_|notes_data_)/i;
  const KIND_LABELS = Object.freeze({
    cgmCarbs: 'CGM-Kohlenhydrate',
    exercise: 'Sport',
    food: 'Lebensmittel',
    manualInsulin: 'manuelles Insulin',
    medication: 'Medikamente',
    note: 'Notizen',
  });
  let pendingFiles = [];
  let importRunning = false;

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

  function normalizedClinical(value = gcState.clinical || {}) {
    if (
      typeof GlucoseCoachV3 !== 'undefined' &&
      typeof GlucoseCoachV3.normalizeClinical === 'function'
    ) {
      return GlucoseCoachV3.normalizeClinical(value);
    }
    return value;
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

  function downloadBytes(filename, content, type) {
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

  function progressTarget() {
    return document.querySelector('#import-progress');
  }

  function setProgress(message) {
    const target = progressTarget();
    if (target) target.textContent = message;
  }

  function selectedTarget() {
    return document.querySelector('#selected-files');
  }

  function selectionText(files) {
    const list = Array.from(files || []);
    if (!list.length) return 'Keine Dateien ausgewählt.';
    const zipCount = list.filter((file) => /\.zip$/i.test(file.name || '')).length;
    const csvCount = list.filter((file) => /\.csv$/i.test(file.name || '')).length;
    const other = list.length - zipCount - csvCount;
    if (zipCount === 0 && other === 0) return `${list.length} Datei(en) ausgewählt.`;
    const parts = [];
    if (zipCount) parts.push(`${zipCount} ZIP`);
    if (csvCount) parts.push(`${csvCount} CSV`);
    if (other) parts.push(`${other} andere`);
    return `${list.length} Datei(en) ausgewählt (${parts.join(', ')}).`;
  }

  function setPendingFiles(files) {
    pendingFiles = Array.from(files || []);
    const target = selectedTarget();
    if (target) target.textContent = selectionText(pendingFiles);
  }

  function clearPendingFiles() {
    pendingFiles = [];
    const input = document.querySelector('#csv-files');
    if (input) input.value = '';
    const target = selectedTarget();
    if (target) target.textContent = 'Keine Dateien ausgewählt.';
  }

  function formatCount(value, singular, plural) {
    const count = Number(value || 0);
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function formatImportSummary(summary, ignoredCount = 0) {
    const parts = [
      [summary.cgmAdded, 'CGM-Werte'],
      [summary.bolusesAdded, 'Bolusereignisse'],
      [summary.dailyInsulinAdded, 'Tages-Insulinzeilen'],
      [summary.basalEventsAdded, 'Basalereignisse'],
      [summary.manualGlucoseAdded, 'manuelle Glukosewerte'],
      [summary.alarmsAdded, 'Alarme/Ereignisse'],
      [summary.cgmCarbsAdded, 'CGM-KH-Ereignisse'],
      [summary.exerciseAdded, 'Sportereignisse'],
      [summary.foodAdded, 'Lebensmitteleinträge'],
      [summary.manualInsulinAdded, 'manuelle Insulineinträge'],
      [summary.medicationsAdded, 'Medikamente'],
      [summary.notesAdded, 'Notizen'],
    ]
      .filter(([count]) => Number(count) > 0)
      .map(([count, label]) => `${count} neue ${label}`);
    const kinds = [...new Set(summary.kinds || [])]
      .map((kind) => KIND_LABELS[kind] || kind)
      .join(', ');
    if (!parts.length) parts.push('keine neuen Datenzeilen');
    let result = `${parts.join(', ')}${kinds ? ` · erkannt: ${kinds}` : ''}`;
    if (Number(summary.rejected) > 0) result += ` · ${summary.rejected} verworfen`;
    if (ignoredCount > 0) result += ` · ${ignoredCount} nicht unterstützte CSV ignoriert`;
    return result;
  }

  function applyRestoredPayload(payload, clinical) {
    gcState.diary = safeArray(payload.diary);
    gcState.clinical = normalizedClinical(clinical || payload.clinical || {});
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify(payload.profile && typeof payload.profile === 'object' ? payload.profile : {}),
    );

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
  }

  async function readExpandedEntries(files, zipApi) {
    const entries = await zipApi.expandInputFiles(files);
    const result = [];
    for (const entry of entries) {
      result.push({ ...entry, source: await entry.text() });
    }
    return result;
  }

  function parseClinicalEntries(entries, zipApi) {
    const parsed = [];
    const ignored = [];
    for (const entry of entries) {
      const source = zipApi.unprotectGeneratedCsv(entry.source);
      try {
        parsed.push(GlucoseCoachV3.parseClinicalCsv(source, entry.name));
      } catch (error) {
        if (KNOWN_IMPORT_FILE.test(entry.name || '')) throw error;
        ignored.push({ entry, error });
      }
    }
    return { parsed, ignored };
  }

  function clinicalFromCompanion(payload, parsedItems) {
    if (!parsedItems.length) return normalizedClinical(payload.clinical || {});
    const merged = GlucoseCoachV3.mergeClinical({}, parsedItems).clinical;
    const companionClinical = payload.clinical && typeof payload.clinical === 'object'
      ? payload.clinical
      : {};
    return normalizedClinical({
      ...merged,
      imports: safeArray(companionClinical.imports),
      updatedAt: companionClinical.updatedAt || null,
    });
  }

  async function importSelectedFiles(files) {
    if (importRunning) return;
    const exportApi = root.GlucoseCoachExport;
    const zipApi = root.GlucoseCoachZipExchange;
    if (!exportApi || !zipApi || typeof GlucoseCoachV3 === 'undefined') {
      setProgress('Import fehlgeschlagen: ZIP-/CSV-Module sind nicht vollständig geladen.');
      return;
    }

    const selected = Array.from(files || []);
    if (!selected.length) {
      setProgress('Import fehlgeschlagen: Keine CSV- oder ZIP-Dateien ausgewählt.');
      return;
    }

    importRunning = true;
    const button = document.querySelector('#import-csv');
    if (button) button.disabled = true;
    setProgress('CSV-/ZIP-Dateien werden lokal gelesen …');

    try {
      const entries = await readExpandedEntries(selected, zipApi);
      const complete = entries.filter((entry) => zipApi.isCompleteCsvSource(entry.source));
      if (complete.length > 1) {
        throw new Error('Mehrere GlucoseCoach-Begleit- oder Voll-CSV-Dateien gefunden.');
      }
      const clinicalEntries = entries.filter((entry) => !zipApi.isCompleteCsvSource(entry.source));
      const { parsed, ignored } = parseClinicalEntries(clinicalEntries, zipApi);

      if (complete.length === 1) {
        const payload = exportApi.parseCompleteCsv(complete[0].source);
        const isCompanion = complete[0].name.toLocaleLowerCase('de-DE')
          === zipApi.COMPANION_FILENAME.toLocaleLowerCase('de-DE');
        const clinical = isCompanion
          ? clinicalFromCompanion(payload, parsed)
          : parsed.length
            ? GlucoseCoachV3.mergeClinical(payload.clinical || {}, parsed).clinical
            : payload.clinical;
        applyRestoredPayload(payload, clinical);
        setProgress(
          `CSV-ZIP vollständig importiert: ${formatCount(payload.diary.length, 'Tagebucheintrag', 'Tagebucheinträge')}, ${formatCount(normalizedClinical(clinical).cgm.length, 'CGM-Wert', 'CGM-Werte')} und ${entries.length} CSV-Dateien${ignored.length ? `; ${ignored.length} nicht unterstützte CSV ignoriert` : ''}.`,
        );
      } else {
        if (!parsed.length) {
          throw new Error(
            ignored.length
              ? 'Keine unterstützte CSV im ausgewählten ZIP gefunden.'
              : 'Keine importierbaren CSV-Dateien gefunden.',
          );
        }
        const merged = GlucoseCoachV3.mergeClinical(gcState.clinical, parsed);
        gcState.clinical = merged.clinical;
        gcState.lastImport = merged.summary;
        gcSave();
        gcRender();
        if (typeof gcShow === 'function') gcShow('overview');
        setProgress(`Fertig: ${formatImportSummary(merged.summary, ignored.length)}.`);
      }
      clearPendingFiles();
    } catch (error) {
      setProgress(`Import fehlgeschlagen: ${error.message}`);
    } finally {
      importRunning = false;
      if (button) button.disabled = false;
    }
  }

  function replaceLabelText(label, value) {
    if (!label) return;
    const textNode = Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = value;
    else label.insertBefore(document.createTextNode(value), label.firstChild);
  }

  function ensureDropStyle() {
    if (document.querySelector('#glucosecoach-zip-drop-style')) return;
    const style = document.createElement('style');
    style.id = 'glucosecoach-zip-drop-style';
    style.textContent = `
      .import-drop { transition: outline-color .15s ease, background-color .15s ease; }
      .import-drop.zip-drag-active { outline: 3px dashed currentColor; outline-offset: -6px; }
    `;
    document.head.appendChild(style);
  }

  function ensureImportControls() {
    const zipApi = root.GlucoseCoachZipExchange;
    const drop = document.querySelector('.import-drop');
    const input = document.querySelector('#csv-files');
    const button = document.querySelector('#import-csv');
    if (!zipApi || !drop || !input || !button) return;

    document.querySelector('#import-complete-csv-label')?.remove();
    const description = drop.querySelector('p');
    if (description) {
      description.innerHTML = '<strong>Kompletter Omnipod-Export als CSV oder ZIP:</strong> ZIP hier ablegen oder CSV/ZIP auswählen. ZIP-Archive werden lokal entpackt; enthaltene CSV-Dateien dürfen auch in Unterordnern liegen.';
    }
    const secondary = drop.querySelectorAll('p')[1];
    if (secondary) {
      secondary.textContent = 'Unterstützt werden die zwölf Omnipod-/CGM-Dateitypen. Beim Ablegen startet der Import direkt. Es werden keine Dateien hochgeladen.';
    }
    input.accept = '.csv,.zip,text/csv,application/zip,application/x-zip-compressed';
    replaceLabelText(input.closest('label'), 'CSV oder ZIP auswählen');
    button.textContent = 'Ausgewählte CSV/ZIP lokal importieren';

    if (input.dataset.zipBound !== 'true') {
      input.dataset.zipBound = 'true';
      input.onchange = (event) => {
        setPendingFiles(event.target.files || []);
        setProgress('');
      };
    }
    button.onclick = () => importSelectedFiles(pendingFiles.length ? pendingFiles : input.files);

    if (drop.dataset.zipBound !== 'true') {
      drop.dataset.zipBound = 'true';
      const activate = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        drop.classList.add('zip-drag-active');
      };
      const deactivate = (event) => {
        event.preventDefault();
        event.stopPropagation();
        drop.classList.remove('zip-drag-active');
      };
      drop.addEventListener('dragenter', activate);
      drop.addEventListener('dragover', activate);
      drop.addEventListener('dragleave', deactivate);
      drop.addEventListener('drop', (event) => {
        deactivate(event);
        const files = Array.from(event.dataTransfer?.files || []);
        setPendingFiles(files);
        void importSelectedFiles(files);
      });
    }
    ensureDropStyle();
  }

  function ensureExportControls() {
    const exportApi = root.GlucoseCoachExport;
    const zipApi = root.GlucoseCoachZipExchange;
    const button = document.querySelector('#export-all');
    if (!exportApi || !zipApi || !button) return;

    document.querySelector('#import-complete-csv-label')?.remove();
    button.textContent = 'CSV-ZIP herunterladen';
    button.onclick = async () => {
      button.disabled = true;
      setProgress('CSV-ZIP wird lokal erstellt …');
      try {
        const bytes = await zipApi.buildExchangeZip(currentPayload(), exportApi);
        downloadBytes(
          `glucosecoach-csv-export-${dateFilenamePart()}.zip`,
          bytes,
          'application/zip',
        );
        setProgress('CSV-ZIP erstellt: zwölf importkompatible Datendateien und eine GlucoseCoach-Begleit-CSV ohne doppelte klinische Daten.');
      } catch (error) {
        setProgress(`Export fehlgeschlagen: ${error.message}`);
      } finally {
        button.disabled = false;
      }
    };

    const diaryNote = document.querySelector('#diary article.card.wide > p.muted');
    if (diaryNote) {
      diaryNote.textContent = 'Einträge werden lokal unter derselben Website-Adresse gespeichert. Für einen Gerätewechsel enthält der CSV-ZIP-Export zusätzlich eine GlucoseCoach-Begleit-CSV für Tagebuch und Einstellungen.';
    }
  }

  function ensureControls() {
    ensureImportControls();
    ensureExportControls();
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    const previousRender = gcRender;
    gcRender = function renderWithZipCsvExchange() {
      previousRender();
      ensureControls();
    };
    ensureControls();
  }

  if (typeof document !== 'undefined') installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
