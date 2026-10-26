/**
 * A search box, the one way the console draws one (#226): a `search` input
 * named for a screen reader (its placeholder goes as one types), and, when
 * the search has a scope, the select that chooses it, named too.
 *
 * @module twake-directory-manager/ui/search
 */

import { html, type SafeHtml } from '../shared/html';

/** One choice of where to search. */
export interface SearchScopeOption {
  value: string;
  label: string;
  selected?: boolean;
}

/** What the box shows. */
export interface SearchBoxOptions {
  /** The data attribute the caller finds the input by (`search`, `filter`) */
  data: string;
  /** What the box is called: "Search Users", "Filter organizations" */
  name: string;
  /** Shown while the box is empty */
  placeholder: string;
  /** What it holds */
  value: string;
  /** Where to search, when the search has a scope */
  scope?: {
    /** The data attribute of the select */
    data: string;
    /** What stands before the select: "in" */
    text: string;
    /** What the select is called: "Search in" */
    name: string;
    options: SearchScopeOption[];
  };
}

/**
 * Draw a search box, alone or with the select of its scope.
 *
 * @param options what to show
 * @returns the markup
 */
export function searchBox(options: SearchBoxOptions): SafeHtml {
  const { data, name, placeholder, value, scope } = options;
  const input = html`<input type="search" class="dc-input" data-${data}
    value="${value}" placeholder="${placeholder}"
    aria-label="${name}" title="${name}" />`;
  if (!scope) return input;
  return html`<div class="dc-search">
    ${input}
    <label class="dc-search-scope">
      <span>${scope.text}</span>
      <select class="dc-input" data-${scope.data} aria-label="${scope.name}">
        ${scope.options.map(
          option =>
            html`<option value="${option.value}"${
              option.selected ? ' selected' : ''
            }>${option.label}</option>`
        )}
      </select>
    </label>
  </div>`;
}
