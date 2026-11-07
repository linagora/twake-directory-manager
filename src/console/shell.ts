/**
 * The frame: the sidebar, the scope banner, the main area, the panel and the
 * brand's footer. Markup only, built from what the console decided to offer;
 * the console binds the listeners.
 *
 * @module twake-directory-manager/console/shell
 */

import { CONSOLE_LOGO, LINAGORA_LOGO } from '../assets';
import { rdnValue } from '../format';
import { availableLanguages, languageName } from '../i18n';
import type { Rights } from '../rights';
import { html, trusted, type SafeHtml } from '../shared/html';

/** What the console translates the frame with. */
export type FrameText = (
  key: string,
  values?: Record<string, string | number>
) => string;

/** What the scope banner has to say (see `Rights.summary`). */
export type ScopeSummary = Rights['summary'];

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
  /** Whether the high-contrast colours are on (#210) */
  contrast: boolean;
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
 * Switch the high-contrast colours on or off on the frame drawn, and show
 * the choice in its box (#210).
 *
 * @param container what holds the frame
 * @param on whether high contrast is on
 */
export function applyContrast(
  container: ParentNode | null | undefined,
  on: boolean
): void {
  container?.querySelector('.dc-app')?.classList.toggle('dc-contrast-high', on);
  const box = container?.querySelector<HTMLInputElement>('[data-contrast]');
  if (box) box.checked = on;
}

/**
 * The sidebar. The entries are lists, so that a screen reader announces them
 * with their count (#219); the language select says that choosing changes
 * the interface at once (#209).
 *
 * @param options what to show
 * @returns the `<aside>`
 */
export function sidebarMarkup(options: SidebarOptions): SafeHtml {
  const { t, primary, reference, language, contrast } = options;
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
      <span id="dc-language-hint" class="dc-visually-hidden">${t(
        'app.languageHint'
      )}</span>
      <label class="dc-language dc-contrast">
        <input type="checkbox" data-contrast${contrast ? ' checked' : ''} />
        <span>${t('app.highContrast')}</span>
      </label>
    </div>
  </aside>`;
}

/**
 * The sign-out control, when the server offers a way to sign out.
 *
 * @param t the frame's words
 * @param url where the server signs out, when it does
 */
export function logoutMarkup(t: FrameText, url?: string): SafeHtml {
  if (!url) return html``;
  return html`<a class="dc-button dc-logout" href="${url}">${t(
    'app.logout'
  )}</a>`;
}

/**
 * The branches the caller administers, shown permanently.
 *
 * In a local-administration model this is the single most useful thing on
 * the screen, and the interface this replaces showed it nowhere.
 *
 * @param t the frame's words
 * @param summary the scope, as the banner says it
 * @param transit the transit link's text: the branch's name and what waits
 * @returns the scope banner
 */
export function scopeMarkup(
  t: FrameText,
  summary: ScopeSummary,
  transit: string
): SafeHtml {
  if (summary.kind === 'error')
    return html`<span class="dc-scope-error">${t('scope.unavailable', {
      error: summary.error,
    })}</span>`;
  if (summary.kind === 'unrestricted')
    return html`<span class="dc-scope-empty">${t('scope.unrestricted')}</span>`;
  if (summary.kind === 'undescribed')
    return html`<span class="dc-scope-empty">${t('scope.undescribed')}</span>`;
  // Grey, not the green of a scope in order: there is nothing to be had.
  if (summary.kind === 'nothing')
    return html`<span class="dc-scope-empty dc-scope-none">${t(
      'scope.none'
    )}</span>`;
  const branch = summary.transit;
  return html`
    <span class="dc-scope-label">${t('scope.title')}</span>
    <ul class="dc-scope">
      ${summary.branches.map(item => {
        const rights = [
          item.read ? t('scope.read') : '',
          item.write ? t('scope.write') : '',
          item.delete ? t('scope.delete') : '',
        ]
          .filter(Boolean)
          .join(', ');
        return html`<li title="${item.path || item.dn}">
            <strong>${item.name || item.dn}</strong>
            <span class="dc-muted">${rights}</span>
          </li>`;
      })}
    </ul>
          ${
            branch
              ? html`${
                  // "Transit Transit (1)" said its name twice: the label goes
                  // when the branch's name is that word already.
                  rdnValue(branch).toLowerCase() ===
                  t('transit.branch').toLowerCase()
                    ? ''
                    : html`<span class="dc-scope-label">${t('transit.branch')}</span>`
                }
          <a class="dc-scope-transit" data-transit-link href="#/organizations/${encodeURIComponent(
            branch
          )}" title="${
            // Readable, like the branches' paths: the scope gives the
            // transit branch no path, and its name stands in for one.
            rdnValue(branch)
          }">${transit}</a>`
              : ''
          }`;
}

/** What the frame is built from. */
export interface FrameOptions {
  /** The translator's `t`, for the frame's own words */
  t: FrameText;
  /** Whether the high-contrast colours are on (#210) */
  contrast: boolean;
  /** The navigation, the language and the contrast box */
  sidebar: SafeHtml;
  /** The branches administered and the transit branch */
  scope: SafeHtml;
  /** The sign-out control, none when the server offers no way out */
  logout: SafeHtml;
  /** The overlay: side panel, toast region, announcer */
  overlay: SafeHtml;
}

/**
 * The frame the pages are drawn in: a skip link, the sidebar, the scope
 * banner, the main area, and what covers it.
 *
 * @param options what the frame shows
 * @returns the `<div class="dc-app">`
 */
export function frameMarkup(options: FrameOptions): SafeHtml {
  const { t, contrast, sidebar, scope, logout, overlay } = options;
  return html`
    <div class="dc-app${contrast ? ' dc-contrast-high' : ''}">
      <a class="dc-skip-link dc-button dc-button-primary" href="#dc-main"
        data-skip>${t('app.skipToContent')}</a>
      ${sidebar}
      <div class="dc-content">
        <header class="dc-header">${scope}${logout}</header>
        <main class="dc-main" id="dc-main" data-main tabindex="-1"></main>
        <a class="dc-powered" href="https://linagora.com" target="_blank"
          rel="noopener noreferrer">
          <img src="${LINAGORA_LOGO}" alt="LINAGORA" width="100" height="21" />
        </a>
      </div>
      ${overlay}
    </div>`;
}
