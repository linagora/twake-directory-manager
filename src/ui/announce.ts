/**
 * What a screen reader is told without being shown: the result of a search,
 * the count of a selection, where the eye reads it at once (#226, #212). One
 * hidden live region in the frame, written to by `announcer`; the toast
 * region says what everyone sees.
 *
 * @module twake-directory-manager/ui/announce
 */

import { html, type SafeHtml } from '../shared/html';

/** Says a text to the screen reader, and nothing to the eye. */
export type Announce = (text: string) => void;

/** How long the region stays empty before the text is written. */
export const ANNOUNCE_DELAY = 50;

/**
 * The live region, read but not shown, placed once in the frame.
 *
 * @returns the markup
 */
export function announcerMarkup(): SafeHtml {
  return html`<div class="dc-visually-hidden" data-announce role="status"
    aria-live="polite" aria-atomic="true"></div>`;
}

/**
 * An `Announce` writing into the region `element` finds. The region is
 * emptied first and written a moment later, so that the same text twice
 * ("1 selected", then "1 selected" again) is spoken twice; a text that
 * follows another before that moment replaces it.
 *
 * @param element the region, looked up at each call: the frame is redrawn
 * @returns what to call
 */
export function announcer(
  element: () => HTMLElement | null | undefined
): Announce {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return text => {
    const region = element();
    if (!region) return;
    if (timer !== undefined) clearTimeout(timer);
    region.textContent = '';
    timer = setTimeout(() => {
      timer = undefined;
      region.textContent = text;
    }, ANNOUNCE_DELAY);
  };
}
