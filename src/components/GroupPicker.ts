/**
 * What _Add to a group…_ opens on an account's card: a search over the
 * groups, the groups chosen as tokens, and Add.
 *
 * Adding a newcomer to their team's groups follows every account creation,
 * and it took a trip to each group's form, one group at a time. The groups
 * are chosen here, from the account, and joined in one go.
 *
 * @module browser/directory-console/components/GroupPicker
 */

import { escapeHtml } from '../shared/dom';
import { SEARCH_MINIMUM, listFailure } from './EntityList';
import type { Translator } from '../i18n';
import { background, type Reporter } from '../shared/background';

/** Wait after a keystroke before searching, as the form's pickers do. */
const SEARCH_DELAY = 250;

/** A group offered, or chosen. */
export interface GroupChoice {
  dn: string;
  /** Its name, on the token once chosen */
  name: string;
  /** What the suggestion reads: its name, its type and its address */
  label: string;
}

export interface GroupPickerOptions {
  translator: Translator;
  /**
   * Told of a failure in work the component starts without waiting for it
   * (see `background`); the console's own reporter, or the log when absent
   */
  report?: Reporter;
  /**
   * The groups matching what was typed that may be offered: those the
   * caller writes, the account is not in yet
   */
  search(query: string): Promise<GroupChoice[]>;
  /**
   * Add the account to the groups chosen.
   *
   * @returns the groups it could not join, with why, which the panel keeps
   */
  onAdd(
    groups: GroupChoice[]
  ): Promise<{ left: GroupChoice[]; error?: string }>;
  onCancel(): void;
  /**
   * What the field and its hint say, for a picker of something else than
   * groups: the members of a group
   */
  words?: { field: string; hint: string };
  /**
   * What to say when nothing is offered, where a rule left out what was
   * found: a shared mailbox takes the accounts of its domain only
   */
  emptyNote?(query: string): string | undefined;
}

export class GroupPicker {
  private readonly options: GroupPickerOptions;
  private chosen: GroupChoice[] = [];

  constructor(options: GroupPickerOptions) {
    this.options = options;
  }

  /**
   * Render into the panel's body.
   *
   * @param container element to fill
   */
  render(container: HTMLElement): void {
    const { translator } = this.options;
    const t = (key: string, values?: Record<string, string | number>): string =>
      translator.t(key, values);
    container.innerHTML = `
      <form class="dc-form" data-group-picker>
        <div class="dc-field">
          <label for="dc-group-search">${escapeHtml(
            this.options.words?.field ?? t('groups.field')
          )}</label>
          <div class="dc-tokens dc-picker">
            <ul class="dc-token-list" data-chosen></ul>
            <div class="dc-picker-box">
              <input id="dc-group-search" type="search" class="dc-input"
                autocomplete="off" role="combobox" aria-autocomplete="list"
                aria-expanded="false" aria-controls="dc-group-results"
                aria-describedby="dc-group-hint" />
              <ul class="dc-picker-results" id="dc-group-results"
                role="listbox" hidden></ul>
            </div>
          </div>
          <p class="dc-hint" id="dc-group-hint">${escapeHtml(
            this.options.words?.hint ??
              t('groups.search', { count: SEARCH_MINIMUM })
          )}</p>
        </div>
        <p class="dc-error-block" role="alert" data-error hidden></p>
        <div class="dc-form-actions">
          <button type="button" class="dc-button" data-cancel>${escapeHtml(
            t('app.cancel')
          )}</button>
          <button type="submit" class="dc-button dc-button-primary" data-add disabled>${escapeHtml(
            t('groups.confirm')
          )}</button>
        </div>
      </form>`;
    this.bind(container);
  }

  private bind(container: HTMLElement): void {
    const { translator } = this.options;
    const form = container.querySelector<HTMLFormElement>('form');
    const input = container.querySelector<HTMLInputElement>('#dc-group-search');
    const results = container.querySelector<HTMLElement>('#dc-group-results');
    const tokens = container.querySelector<HTMLElement>('[data-chosen]');
    const error = container.querySelector<HTMLElement>('[data-error]');
    const add = container.querySelector<HTMLButtonElement>('[data-add]');
    if (!form || !input || !results || !tokens || !error || !add) return;
    let candidates: GroupChoice[] = [];
    let active = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A search answered after a later keystroke is dropped.
    let generation = 0;
    let busy = false;
    // What the suggestions answer, for a note on why there are none.
    let asked = '';

    const redraw = (): void => {
      tokens.innerHTML = this.chosen
        .map(
          (group, index) => `
        <li class="dc-token">
          <span title="${escapeHtml(group.dn)}">${escapeHtml(group.name)}</span>
          <button type="button" data-remove="${index}"
            aria-label="${escapeHtml(
              translator.t('form.removeValue', { value: group.name })
            )}">×</button>
        </li>`
        )
        .join('');
      add.disabled = busy || this.chosen.length === 0;
    };
    const close = (): void => {
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    };
    // A note is no option: nothing in the list is active while it shows.
    const message = (text: string): void => {
      candidates = [];
      active = -1;
      results.innerHTML = `<li class="dc-picker-note" role="presentation">${escapeHtml(text)}</li>`;
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.removeAttribute('aria-activedescendant');
    };
    const paint = (): void => {
      if (candidates.length === 0)
        return message(
          this.options.emptyNote?.(asked) ?? translator.t('list.noMatch')
        );
      results.innerHTML = candidates
        .map(
          (candidate, index) => `
        <li id="dc-group-option-${index}" role="option"
          class="dc-picker-option${index === active ? ' dc-active' : ''}"
          aria-selected="${index === active ? 'true' : 'false'}"
          data-candidate="${index}" title="${escapeHtml(candidate.dn)}">${escapeHtml(
            candidate.label
          )}</li>`
        )
        .join('');
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (active < 0) return;
      input.setAttribute('aria-activedescendant', `dc-group-option-${active}`);
      // The arrows walk past what the list shows: the option they reach is
      // brought into it.
      results
        .querySelector<HTMLElement>(`#dc-group-option-${active}`)
        ?.scrollIntoView?.({ block: 'nearest' });
    };
    const held = (dn: string): boolean =>
      this.chosen.some(group => group.dn.toLowerCase() === dn.toLowerCase());
    // A search waiting for its delay, or for its answer, is dropped: it would
    // open the list again once a group is picked or the box left, and the
    // next Enter would pick a group rather than add the chosen ones.
    const drop = (): void => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      generation++;
    };
    const choose = (candidate: GroupChoice): void => {
      drop();
      if (!held(candidate.dn)) this.chosen.push(candidate);
      input.value = '';
      close();
      redraw();
    };

    const run = (query: string, ticket: number): void => {
      asked = query;
      message(translator.t('form.searching'));
      this.options
        .search(query)
        .then(found => {
          if (ticket !== generation) return;
          // What is already chosen is not offered again.
          candidates = found.filter(candidate => !held(candidate.dn));
          active = candidates.length ? 0 : -1;
          paint();
        })
        .catch((err: unknown) => {
          if (ticket === generation) message(listFailure(err, translator));
        });
    };

    input.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      const query = input.value.trim();
      const ticket = ++generation;
      if (query.length < SEARCH_MINIMUM) {
        if (query.length === 0) close();
        else
          message(translator.t('list.searchGuard', { count: SEARCH_MINIMUM }));
        return;
      }
      // The suggestions of the text typed before go at once: until the new
      // search answers, Enter or a click would pick a group the box no
      // longer names.
      message(translator.t('form.searching'));
      timer = setTimeout(() => run(query, ticket), SEARCH_DELAY);
    });

    input.addEventListener('keydown', event => {
      const key = event.key;
      if (key === 'Escape') {
        // The suggestions close, not the panel.
        if (!results.hidden) event.preventDefault();
        drop();
        close();
        return;
      }
      // The arrow opens again the list Escape closed, as it opens a select.
      const query = input.value.trim();
      if (
        key === 'ArrowDown' &&
        results.hidden &&
        query.length >= SEARCH_MINIMUM
      ) {
        event.preventDefault();
        drop();
        run(query, generation);
        return;
      }
      if (results.hidden || candidates.length === 0) {
        // Enter in an empty search adds what is chosen, as the button does;
        // in a search still answering, it waits for a suggestion.
        if (key === 'Enter' && input.value.trim()) event.preventDefault();
        return;
      }
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        const step = key === 'ArrowDown' ? 1 : -1;
        active = (active + step + candidates.length) % candidates.length;
        paint();
      } else if (key === 'Enter') {
        event.preventDefault();
        if (active >= 0) choose(candidates[active]);
      }
    });

    // `mousedown`, not `click`: the input's blur closes the list first.
    results.addEventListener('mousedown', event => {
      const item = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-candidate]'
      );
      if (!item) return;
      event.preventDefault();
      choose(candidates[Number(item.dataset.candidate)]);
    });
    input.addEventListener('blur', () => {
      drop();
      close();
    });

    tokens.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-remove]'
      );
      if (!button) return;
      this.chosen.splice(Number(button.dataset.remove), 1);
      redraw();
      // The token and its button are gone: the focus goes back to the box.
      input.focus();
    });

    container
      .querySelector('[data-cancel]')
      ?.addEventListener('click', () => this.options.onCancel());

    form.addEventListener('submit', event => {
      event.preventDefault();
      if (busy || this.chosen.length === 0) return;
      busy = true;
      error.hidden = true;
      redraw();
      const groups = [...this.chosen];
      background(
        () =>
          this.options
            .onAdd(groups)
            .catch((err: unknown) => ({
              left: groups,
              error: err instanceof Error ? err.message : String(err),
            }))
            .then(({ left, error: why }) => {
              busy = false;
              this.chosen = left;
              redraw();
              if (why) {
                error.textContent = why;
                error.hidden = false;
              }
            }),
        'options.onAdd',
        this.options.report
      );
    });
  }
}
