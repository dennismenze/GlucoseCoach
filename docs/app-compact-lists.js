(function () {
  'use strict';

  function ensureStyles() {
    if (document.querySelector('#compact-list-styles')) return;
    const style = document.createElement('style');
    style.id = 'compact-list-styles';
    style.textContent = `
      .compact-list-disclosure { margin-top: 14px; }
      .compact-list-disclosure > summary {
        cursor: pointer;
        font-weight: 800;
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--surface-strong);
      }
      .compact-list-disclosure[open] > summary { margin-bottom: 12px; }
      details.analysis-item,
      details.entry { padding: 0; overflow: hidden; }
      details.analysis-item > summary,
      details.entry > summary {
        cursor: pointer;
        padding: 14px;
        list-style-position: inside;
      }
      details.analysis-item > .analysis-grid,
      details.analysis-item > p,
      details.entry > p,
      details.entry > button {
        margin-left: 14px;
        margin-right: 14px;
      }
      details.analysis-item > p,
      details.entry > button { margin-bottom: 14px; }
    `;
    document.head.appendChild(style);
  }

  function copyAttributes(source, target) {
    for (const attribute of source.attributes) {
      if (attribute.name !== 'class') target.setAttribute(attribute.name, attribute.value);
    }
  }

  function compactItem(item, headSelector) {
    if (item.tagName === 'DETAILS') return item;
    const details = document.createElement('details');
    details.className = item.className;
    copyAttributes(item, details);

    const head = item.querySelector(`:scope > ${headSelector}`);
    if (head) {
      const summary = document.createElement('summary');
      summary.className = head.className;
      while (head.firstChild) summary.appendChild(head.firstChild);
      details.appendChild(summary);
    }

    for (const child of [...item.children]) {
      if (child !== head) details.appendChild(child);
    }
    item.replaceWith(details);
    return details;
  }

  function ensureDisclosure(target, config) {
    let disclosure = document.querySelector(`#${config.id}`);
    if (!disclosure) {
      disclosure = document.createElement('details');
      disclosure.id = config.id;
      disclosure.className = 'compact-list-disclosure';
      const summary = document.createElement('summary');
      summary.id = config.summaryId;
      disclosure.appendChild(summary);
      target.insertAdjacentElement('beforebegin', disclosure);
      disclosure.appendChild(target);
    }

    const items = [...target.querySelectorAll(`:scope > ${config.itemSelector}`)];
    for (const item of items) compactItem(item, config.headSelector);

    const count = target.querySelectorAll(`:scope > details${config.itemSelector}`).length;
    const summary = disclosure.querySelector(`#${config.summaryId}`);
    if (summary) {
      summary.textContent = count
        ? `${count} ${count === 1 ? config.singular : config.plural} anzeigen`
        : config.emptyText;
    }

    if (count === 0) {
      disclosure.open = true;
      disclosure.dataset.empty = 'true';
    } else if (disclosure.dataset.empty === 'true') {
      disclosure.open = false;
      delete disclosure.dataset.empty;
    }
  }

  function compactLists() {
    const meals = document.querySelector('#meal-events');
    if (meals) {
      ensureDisclosure(meals, {
        id: 'meal-events-disclosure',
        summaryId: 'meal-events-summary',
        itemSelector: '.analysis-item',
        headSelector: '.analysis-head',
        singular: 'Mahlzeiteneintrag',
        plural: 'Mahlzeiteneinträge',
        emptyText: 'Noch keine Mahlzeiteneinträge',
      });
    }

    const diary = document.querySelector('#entries');
    if (diary) {
      ensureDisclosure(diary, {
        id: 'diary-entries-disclosure',
        summaryId: 'diary-entries-summary',
        itemSelector: '.entry',
        headSelector: '.entry-head',
        singular: 'Tagebucheintrag',
        plural: 'Tagebucheinträge',
        emptyText: 'Noch keine Tagebucheinträge',
      });
    }
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    ensureStyles();
    const previousRender = gcRender;
    gcRender = function renderWithCompactLists() {
      previousRender();
      compactLists();
    };
    compactLists();
  }

  if (typeof document !== 'undefined') installBrowserPatch();
})();
