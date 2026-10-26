/**
 * Where the keyboard goes in the side panel: its controls, and what Tab
 * reaches from each. The panel itself follows here as #220 moves it.
 *
 * @module twake-directory-manager/console/panel
 */

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
