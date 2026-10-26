/**
 * Markup that is safe to write into the page.
 *
 * The console draws itself from template strings written into `innerHTML`,
 * and almost everything it shows comes from the directory: names, paths,
 * descriptions, schema labels, refusal messages, CSV cells, written by many
 * hands. Each value used to be escaped by hand at its interpolation, which
 * holds as long as nobody forgets one. Here the template escapes every
 * interpolation itself: `html` builds a `SafeHtml`, the only thing `render`
 * writes into an element, and the only thing an interpolation passes through
 * unescaped — a function that returns markup returns a `SafeHtml`, and a
 * plain string is text wherever it lands. Nothing but this module touches
 * `innerHTML` (ESLint refuses it elsewhere).
 *
 * @module twake-directory-manager/shared/html
 */

import { escapeHtml } from './dom';

/**
 * Markup escaped already, or trusted as written. Made only by `html` and
 * `trusted`: the constructor is kept to this module, so that a value of this
 * type is one that went through either.
 */
export class SafeHtml {
  /** @internal use `html` or `trusted` */
  constructor(
    /** The markup, as it is written into the page */
    readonly markup: string
  ) {}

  /**
   * Markup is not text: joined, concatenated or put in a plain template, it
   * would read `[object Object]`, or be escaped on its way into the page.
   * Failing here says where, rather than drawing it wrong.
   */
  toString(): never {
    throw new Error(
      'SafeHtml used as a string: interpolate it into html`…` or render it'
    );
  }
}

/** What an interpolation may hold. */
export type Interpolation =
  | SafeHtml
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Interpolation[];

/**
 * What one interpolation writes: markup as it is, text escaped, nothing for
 * what a conditional left out (`null`, `undefined`, `false`), and each item of
 * an array in turn — a `.map` over rows needs no `.join('')`.
 */
function rendered(value: Interpolation): string {
  if (value instanceof SafeHtml) return value.markup;
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(rendered).join('');
  return escapeHtml(String(value));
}

/**
 * Build markup from a template, escaping every interpolation that is not
 * `SafeHtml` already.
 *
 * ```ts
 * html`<li title="${entry.dn}">${name}${rows.map(row => html`<p>${row}</p>`)}</li>`
 * ```
 *
 * @param strings the template's fixed parts
 * @param values what is interpolated
 * @returns the markup, safe to render
 */
export function html(
  strings: TemplateStringsArray,
  ...values: Interpolation[]
): SafeHtml {
  let markup = strings[0];
  for (let i = 0; i < values.length; i++)
    markup += rendered(values[i]) + strings[i + 1];
  return new SafeHtml(markup);
}

/**
 * Markup written by the console itself and trusted as it stands: the icons
 * and logos of `assets.ts`, a constant nothing from outside reaches. Never
 * for a string that holds a value from the directory or the server.
 *
 * @param markup a constant written in the code
 * @returns the same markup, as `SafeHtml`
 */
export function trusted(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

/**
 * Join pieces of markup with a separator, as `Array.join` would strings: the
 * separator is text, escaped.
 */
export function join(pieces: readonly SafeHtml[], separator: string): SafeHtml {
  return new SafeHtml(
    pieces.map(piece => piece.markup).join(escapeHtml(separator))
  );
}

/**
 * Add markup at the end of an element, after what it holds.
 *
 * @param element what to add to
 * @param content what to add
 */
export function append(element: Element, content: SafeHtml): void {
  // eslint-disable-next-line no-restricted-syntax -- the other sink, by design
  element.insertAdjacentHTML('beforeend', content.markup);
}

/**
 * Write markup into an element, in place of what it held. The one assignment
 * to `innerHTML` in the console.
 *
 * @param element what to fill
 * @param content what to write
 */
export function render(element: Element, content: SafeHtml): void {
  // eslint-disable-next-line no-restricted-syntax -- the one sink, by design
  element.innerHTML = content.markup;
}
