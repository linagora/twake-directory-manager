/**
 * The domains an address may be at, offered under its box once an "@" is
 * typed into it: a list that completes the address with the domain chosen
 * in it.
 *
 * The first line is chosen, as a picker's is: Enter takes it. Nothing else
 * would have: "jane@" and Enter left "jane@", and the form refused it. An
 * address typed whole, its domain among those offered, opens no list, and
 * Enter goes on adding it or submitting the form. Up and Down move through
 * the list, Escape closes it, and leaving the box closes it too.
 *
 * @module twake-directory-manager/components/addressCompletion
 */

import { completingDomains } from '../format';
import { background, type Reporter } from '../shared/background';
import { html, render } from '../shared/html';

export interface CompletionOptions {
  /** The field, which names the ids of the options it draws */
  name: string;
  /** Its text box */
  input: HTMLInputElement;
  /** The field, holding the list */
  wrapper: HTMLElement;
  /** The domains the address may be at, read when first asked for */
  domains: () => Promise<string[]>;
  /**
   * Told of a failure in work the component starts without waiting for it
   * (see `background`); the console's own reporter, or the log when absent
   */
  report?: Reporter;
  /** Told of an address the list completed */
  written?: (value: string) => void;
}

/**
 * Offer the domains an address may be at, once an "@" is typed into it.
 *
 * @param options the box, the field holding its list, and what to read and
 *   tell
 * @returns what the box's own keys are first handed to, and how to close
 *   the list; undefined when the field has no list
 */
export function bindCompletion(
  options: CompletionOptions
): { key(event: KeyboardEvent): boolean; close(): void } | undefined {
  const { name, input, wrapper, written } = options;
  const results = wrapper.querySelector<HTMLElement>('[data-completions]');
  if (!results) return undefined;
  let suggestions: string[] = [];
  let active = -1;
  // Domains answered after a later keystroke are dropped.
  let generation = 0;

  const close = (): void => {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    suggestions = [];
    active = -1;
  };
  const paint = (): void => {
    render(
      results,
      html`${suggestions.map(
        (suggestion, index) => html`
        <li id="dc-complete-${name}-${index}" role="option"
          class="dc-picker-option${index === active ? ' dc-active' : ''}"
          aria-selected="${index === active ? 'true' : 'false'}"
          data-suggestion="${index}">${suggestion}</li>`
      )}`
    );
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    results.scrollIntoView?.({ block: 'nearest' });
    if (active >= 0)
      input.setAttribute(
        'aria-activedescendant',
        `dc-complete-${name}-${active}`
      );
    else input.removeAttribute('aria-activedescendant');
  };
  const choose = (index: number): void => {
    input.value = suggestions[index];
    close();
    written?.(input.value);
  };

  input.addEventListener('input', () => {
    const value = input.value.trim();
    const at = value.lastIndexOf('@');
    const ticket = ++generation;
    if (at < 0) return close();
    const local = value.slice(0, at);
    background(
      () =>
        options.domains().then(domains => {
          if (ticket !== generation) return;
          // What is typed completes without case nor accent: `jane@EXA`
          // offers `jane@example.com`, as `jane@Éxa` does.
          suggestions = completingDomains(domains, value.slice(at + 1)).map(
            domain => `${local}@${domain}`
          );
          active = 0;
          if (suggestions.length === 0) close();
          else paint();
        }),
      'domainsOf',
      options.report
    );
  });

  // `mousedown`, not `click`: the box's blur closes the list first.
  results.addEventListener('mousedown', event => {
    const item = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-suggestion]'
    );
    if (!item) return;
    event.preventDefault();
    choose(Number(item.dataset.suggestion));
  });
  input.addEventListener('blur', () => {
    generation++;
    close();
  });

  return {
    close: (): void => {
      generation++;
      close();
    },
    key: (event: KeyboardEvent): boolean => {
      if (results.hidden || suggestions.length === 0) return false;
      const { key } = event;
      if (key === 'Escape') {
        event.preventDefault();
        close();
        return true;
      }
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        const count = suggestions.length;
        active =
          active < 0
            ? key === 'ArrowDown'
              ? 0
              : count - 1
            : (active + (key === 'ArrowDown' ? 1 : -1) + count) % count;
        paint();
        return true;
      }
      if (key === 'Enter' && active >= 0) {
        event.preventDefault();
        choose(active);
        return true;
      }
      return false;
    },
  };
}
