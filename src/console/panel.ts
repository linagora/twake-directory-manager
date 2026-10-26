/**
 * Where the keyboard goes in the side panel: its controls, and what Tab
 * reaches from each. The panel itself follows here as #220 moves it.
 *
 * @module twake-directory-manager/console/panel
 */

import { html, type SafeHtml } from '../shared/html';
import { announcerMarkup } from '../ui/announce';

/** What Tab can reach in the side panel. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * What Tab reaches in an element: its enabled controls not hidden.
 *
 * @param root the element
 * @returns the controls, in the page's order
 */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    element => !element.closest('[hidden]')
  );
}

/**
 * Where a panel's focus starts: its first control, but not a field's help
 * button, which stands before the field and is not where a form starts.
 *
 * @param body the panel's body
 * @returns the control, or null for a panel with none
 */
export function firstFocus(body: HTMLElement): HTMLElement | null {
  return focusables(body).find(item => !item.matches?.('.dc-help')) ?? null;
}

/**
 * Where a Tab pressed in an open panel takes the focus, or null to leave it
 * to the browser. The focus stays in the dialog: past its last control it
 * comes back to the first, and the other way with Shift. From a place the
 * dialog focused for the screen reader — the lead of an import step, no
 * control itself — it goes on to the next control in the page's order, or
 * back to the one before, rather than to the ends.
 *
 * @param dialog the panel's dialog
 * @param active what has the focus
 * @param back whether Shift is held
 * @returns what to focus, or null when the browser's own Tab is right
 */
export function tabTarget(
  dialog: HTMLElement,
  active: HTMLElement | null,
  back: boolean
): HTMLElement | null {
  const items = focusables(dialog);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first) return dialog;
  if (active && items.includes(active))
    return active === (back ? first : last) ? (back ? last : first) : null;
  if (active && dialog.contains?.(active)) {
    const after = (item: HTMLElement): boolean =>
      !!(
        active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    const following = items.filter(after);
    const preceding = items.filter(item => !after(item));
    return back
      ? (preceding[preceding.length - 1] ?? last)
      : (following[0] ?? first);
  }
  return back ? last : first;
}

/**
 * What the frame lays over the page: the side panel, a dialog the keyboard
 * stays in while it is open; the toast region, a live region that says each
 * message as it shows; and the hidden region of `announce`. Drawn once with
 * the frame; the console fills the panel and binds its close.
 *
 * @param close what the close button is called
 * @returns the markup
 */
export function overlayMarkup(close: string): SafeHtml {
  return html`<div class="dc-panel" data-panel hidden>
      <div class="dc-panel-inner" data-panel-dialog role="dialog"
        aria-modal="true" aria-labelledby="dc-panel-title" tabindex="-1">
        <header class="dc-panel-header">
          <h2 id="dc-panel-title" data-panel-title></h2>
          <button type="button" class="dc-icon-button" data-panel-close
            aria-label="${close}">×</button>
        </header>
        <div class="dc-panel-body" data-panel-body></div>
      </div>
    </div>
    <div data-toast-region role="status" aria-live="polite" aria-atomic="true">
      <div class="dc-toast" data-toast hidden></div>
    </div>
    ${announcerMarkup()}`;
}
