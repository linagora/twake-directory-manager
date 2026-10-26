/**
 * The frame's sidebar: the brand, the navigation and the language. Markup
 * only, built from what the console decided to offer; the console binds the
 * listeners. The rest of the frame follows here as #220 moves it.
 *
 * @module twake-directory-manager/console/shell
 */

import { CONSOLE_LOGO } from '../assets';
import { availableLanguages, languageName } from '../i18n';
import { html, trusted, type SafeHtml } from '../shared/html';

/** An entry of the navigation: the hash it opens and what it says. */
export interface NavEntry {
  key: string;
  label: string;
}

/** What the sidebar shows. */
export interface SidebarOptions {
  /** The translator's `t`, for the frame's own words */
  t: (key: string) => string;
  /** The collections offered as such, after the overview */
  primary: NavEntry[];
  /** The reference data, tucked in a section of their own */
  reference: NavEntry[];
  /** The interface's language, selected in the list */
  language: string;
}

/**
 * The letter standing for a collection in the navigation and on its card.
 * Collections are named by the deployment, so a drawn icon could only guess
 * what one holds; its own initial never does.
 */
export function initial(label: string): string {
  return (Array.from(label.trim())[0] || '').toLocaleUpperCase();
}

/** A chevron, turned by CSS when its section is open. */
const CHEVRON_ICON = trusted(
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m6 4 4 4-4 4"/></svg>'
);

/** Four squares: the overview, which is every collection at once. */
const OVERVIEW_ICON = trusted(
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
    '<rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.6"/>' +
    '<rect x="9" y="1.5" width="5.5" height="5.5" rx="1.6"/>' +
    '<rect x="1.5" y="9" width="5.5" height="5.5" rx="1.6"/>' +
    '<rect x="9" y="9" width="5.5" height="5.5" rx="1.6"/></svg>'
);

/**
 * The sidebar. The entries are lists, so that a screen reader announces them
 * with their count (#219); the language select says that choosing changes
 * the interface at once (#209).
 *
 * @param options what to show
 * @returns the `<aside>`
 */
export function sidebarMarkup(options: SidebarOptions): SafeHtml {
  const { t, primary, reference, language } = options;
  return html`<aside class="dc-sidebar">
    <div class="dc-brand">
      <span class="dc-brand-logo" aria-hidden="true">${CONSOLE_LOGO}</span>
      <span class="dc-brand-name">${t('app.title')}</span>
    </div>
    <nav class="dc-nav">
      <ul class="dc-nav-list">
        <li>
          <button type="button" class="dc-nav-item" data-nav="">
            <span class="dc-nav-icon">${OVERVIEW_ICON}</span>
            <span class="dc-nav-label">${t('nav.dashboard')}</span>
          </button>
        </li>
        ${primary.map(
          ({ key, label }) =>
            html`<li>
              <button type="button" class="dc-nav-item" data-nav="${key}">
                <span class="dc-nav-icon" aria-hidden="true">${initial(
                  label
                )}</span>
                <span class="dc-nav-label">${label}</span>
              </button>
            </li>`
        )}
      </ul>
      ${
        reference.length
          ? html`<div class="dc-nav-section">
              <button type="button" class="dc-nav-toggle" data-nav-toggle
                aria-expanded="false" aria-controls="dc-nav-reference">
                <span>${t('nav.reference')}</span>
                <span class="dc-nav-chevron">${CHEVRON_ICON}</span>
              </button>
              <div class="dc-nav-reference" id="dc-nav-reference" hidden>
                <ul class="dc-nav-list">
                  ${reference.map(
                    ({ key, label }) =>
                      html`<li>
                        <button type="button" class="dc-nav-item dc-nav-item-reference" data-nav="${key}"><span class="dc-nav-label">${label}</span></button>
                      </li>`
                  )}
                </ul>
              </div>
            </div>`
          : ''
      }
    </nav>
    <div class="dc-sidebar-footer">
      <label class="dc-language">
        <span>${t('app.language')}</span>
        <span id="dc-language-hint" class="dc-visually-hidden">${t(
          'app.languageHint'
        )}</span>
        <select class="dc-input" data-language
          aria-describedby="dc-language-hint">
          ${availableLanguages.map(
            code =>
              html`<option value="${code}" lang="${code}"${
                code === language ? ' selected' : ''
              }>${languageName(code)}</option>`
          )}
        </select>
      </label>
    </div>
  </aside>`;
}
