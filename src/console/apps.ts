/**
 * The Workplace's other applications, in the header (#392): a button that
 * opens a grid of links, as Twake Calendar and Contacts offer. The list is
 * the deployment's (`DM_CONSOLE_APP_LIST`, in Calendar's `appList` format);
 * without one, or inside the Home, whose bar offers the applications
 * already, there is no button.
 *
 * @module twake-directory-manager/console/apps
 */

import { html, trusted, type SafeHtml } from '../shared/html';
import type { AppLink } from '../types';

/**
 * Whether an address is one a link may go to: http(s), absolute or relative
 * to the console's origin. A `javascript:` link would run in the console.
 *
 * @param value the address the deployment wrote
 * @param origin the console's origin, to resolve a relative one
 * @param images whether a `data:image/` URI is accepted, for an icon
 */
function safeUrl(value: unknown, origin: string, images = false): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (images && /^data:image\//i.test(value.trim())) return true;
  try {
    const url = new URL(value.trim(), origin);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The applications the deployment lists, those it wrote wrong left out: no
 * name, or a link or an icon that is no web address.
 *
 * @param raw `features.console.appList`, as the server answered it
 * @param origin the console's origin
 * @returns the applications, in the deployment's order
 */
export function readAppList(raw: unknown, origin: string): AppLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown): AppLink[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { name, link, icon } = item as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) return [];
    if (!safeUrl(link, origin)) return [];
    return [
      {
        name: name.trim(),
        link: (link as string).trim(),
        ...(safeUrl(icon, origin, true)
          ? { icon: (icon as string).trim() }
          : {}),
      },
    ];
  });
}

/** A grid of nine dots, the usual sign of an application switcher. */
const GRID_ICON = trusted(
  '<svg class="dc-apps-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
    [4, 12, 20]
      .flatMap(y =>
        [4, 12, 20].map(x => `<circle cx="${x}" cy="${y}" r="2.2"/>`)
      )
      .join('') +
    '</svg>'
);

/**
 * The button and the grid it opens, closed; nothing without applications.
 *
 * @param label the button's name, "Applications"
 * @param apps the applications listed
 */
export function appsMarkup(label: string, apps: AppLink[]): SafeHtml {
  if (apps.length === 0) return html``;
  return html`<div class="dc-apps" data-apps>
    <button type="button" class="dc-button dc-apps-toggle" data-apps-toggle
      aria-expanded="false" aria-controls="dc-apps-menu">${GRID_ICON}<span>${label}</span></button>
    <ul id="dc-apps-menu" class="dc-apps-menu" aria-label="${label}" hidden>
      ${apps.map(
        app =>
          html`<li><a class="dc-apps-link" href="${app.link}">${
            app.icon
              ? html`<img src="${app.icon}" alt="" width="32" height="32" />`
              : html`<span class="dc-apps-initial" aria-hidden="true">${app.name
                  .charAt(0)
                  .toUpperCase()}</span>`
          }<span>${app.name}</span></a></li>`
      )}
    </ul>
  </div>`;
}

/**
 * Open and close the grid: on the button, closed by Escape, which gives the
 * focus back to the button, and when the focus leaves it.
 *
 * @param container what holds the frame
 */
export function bindApps(container: HTMLElement): void {
  const box = container.querySelector<HTMLElement>('[data-apps]');
  const toggle = box?.querySelector<HTMLButtonElement>('[data-apps-toggle]');
  const menu = box?.querySelector<HTMLElement>('.dc-apps-menu');
  if (!box || !toggle || !menu) return;
  const show = (open: boolean): void => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  toggle.addEventListener('click', () => {
    const open = menu.hidden;
    show(open);
    if (open) menu.querySelector<HTMLElement>('a')?.focus();
  });
  box.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || menu.hidden) return;
    // The grid closes, not the panel or the page under it.
    event.stopPropagation();
    show(false);
    toggle.focus();
  });
  box.addEventListener('focusout', event => {
    const next = event.relatedTarget as Node | null;
    if (!next || !box.contains(next)) show(false);
  });
}

/**
 * Whether the console is drawn inside another page, the Home's frame: its
 * bar offers the applications, and a second switcher would repeat it.
 */
export function framed(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    // A parent of another origin refuses to be read: framed all the same.
    return true;
  }
}
