(function (root) {
  'use strict';

  function ensureStyles() {
    if (document.querySelector('#app-version-styles')) return;
    const style = document.createElement('style');
    style.id = 'app-version-styles';
    style.textContent = `
      .header-meta {
        display: grid;
        gap: 8px;
        justify-items: end;
        flex: none;
      }
      .version-badge {
        padding: 6px 10px;
        border: 1px solid var(--line);
        background: var(--surface);
        color: var(--muted);
        border-radius: 999px;
        font-size: .74rem;
        font-weight: 800;
        white-space: nowrap;
      }
      @media (max-width: 900px) {
        .header-meta { justify-items: start; margin-top: 16px; }
        .header-meta .badge { margin-top: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  function renderVersion() {
    ensureStyles();
    const header = document.querySelector('header');
    const badge = document.querySelector('#header-badge');
    if (!header || !badge) return;

    let meta = document.querySelector('#header-meta');
    if (!meta) {
      meta = document.createElement('div');
      meta.id = 'header-meta';
      meta.className = 'header-meta';
      badge.insertAdjacentElement('beforebegin', meta);
      meta.appendChild(badge);
    }

    let version = document.querySelector('#app-version');
    if (!version) {
      version = document.createElement('span');
      version.id = 'app-version';
      version.className = 'version-badge';
      meta.appendChild(version);
    }

    const value = String(root.GLUCOSECOACH_VERSION || 'v0.0.0-unbekannt');
    version.textContent = `Version ${value}`;
    version.dataset.version = value;
  }

  if (typeof document !== 'undefined') renderVersion();
})(typeof globalThis !== 'undefined' ? globalThis : this);
