/**
 * Table of entries, with one search box, paging and bulk actions.
 *
 * The columns are chosen from the schema's semantic roles, not from a
 * hardcoded list, so the table of an entity the deployment adds is readable
 * without a change here.
 *
 * A branch with tens of thousands of entries cannot be listed whole: below
 * `SEARCH_MINIMUM` characters the table says what to type instead of
 * pretending to load. The page size is remembered, because being handed ten
 * rows out of twelve thousand on every visit is not a default anyone chose.
 *
 * @module browser/directory-console/components/EntityList
 */

import { csvCell, writeCsv } from '../csv';
import { escapeHtml } from '../shared/dom';
import type { Translator } from '../i18n';
import { hasRole, tooBroad } from '../api/ConsoleApiClient';
import {
  GENERIC_FAILURE,
  accountState,
  attributeLabel,
  displayValue,
  entryValue,
  ownValueLabel,
  searchableAttributes,
  stateMarkup,
} from '../format';
import type {
  EntityDescriptor,
  Entry,
  EntryList,
  SchemaAttribute,
} from '../types';

// Kept importable from here, where it was first defined.
export { csvCell };

/** Characters required before a search is issued. */
export const SEARCH_MINIMUM = 3;

/**
 * Most entries a list asks the server for, filtered or not.
 *
 * The directory refuses a search matching more than its own size limit —
 * ten thousand entries where this was first seen — and ldap-rest turned that
 * refusal into a failure of the whole list: "List everything" on the accounts
 * of a large directory, or a search as loose as "demo", showed "Internal
 * Server Error" and nothing else. With a server that honours `limit`, asking
 * for fewer turns that into a thousand entries and a notice that there are
 * more — and a thousand rows is already more than anyone pages through rather
 * than searches. ldap-rest 0.12.0 ignores it and still fails past the
 * directory's limit; that failure is then explained (`listFailure`) rather
 * than shown as "Internal Server Error".
 */
export const LIST_LIMIT = 1000;

/**
 * What to say about a list, or a search, that could not be loaded.
 *
 * The server's own message is usually the most useful one, and is kept.
 * Not for a `403`, worded for an API client ("Token does not have
 * permission on this branch"): the reader is told plainly they may not see
 * these entries. Nor for the failures a search too broad for the directory
 * ends in (see `tooBroad`): `422` is ldap-rest saying so, with wording meant
 * for an API client; `500` is how ldap-rest 0.12.0 reports the same refusal — as
 * "Internal Server Error", which tells the operator nothing they can act on
 * — and `502` or `504` is a proxy giving up on the unbounded search before
 * the server did. Those can have other causes, hence the hedged wording; and
 * a `500` that does name its cause keeps it, after that wording, so a real
 * failure stays diagnosable.
 *
 * @param err what the request threw
 * @param translator translator of the interface
 * @returns the message to show
 */
export function listFailure(err: unknown, translator: Translator): string {
  const status = (err as { status?: number } | null)?.status;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 403) return translator.t('list.refused');
  if (!tooBroad(err)) return message;
  if (status === 422) return translator.t('list.tooMany');
  const hedged = translator.t('list.failed');
  const cause = message.trim();
  return status === 500 && !GENERIC_FAILURE.test(cause)
    ? `${hedged} (${cause})`
    : hedged;
}

/**
 * Read what a loader answered: the entries and whether the server left some
 * out, or — from a loader written before the flag existed — the plain map,
 * which says nothing was left out.
 *
 * Told apart by `truncated` being a boolean: in a map keyed by identifier
 * every value is an entry, so even an entry named `truncated` is an object.
 *
 * @param answer what `load` resolved to
 * @returns the entries and the flag
 */
function asEntryList(answer: Record<string, Entry> | EntryList): EntryList {
  const list = answer as Partial<EntryList>;
  if (typeof list.truncated === 'boolean' && list.entries)
    return answer as EntryList;
  return { entries: answer as Record<string, Entry>, truncated: false };
}

/**
 * The search scope meaning "every field worth searching" rather than one.
 *
 * Not an attribute name — `*` cannot be one — so it never collides with the
 * schema's own names in the selector.
 */
export const SEARCH_ANYWHERE = '*';

const PAGE_SIZES = [25, 50, 100, 200];
const PAGE_SIZE_KEY = 'ldap-rest.console.pageSize';

/**
 * The entries an import has just created, shown in the list in place of a
 * search until the reader goes back to it.
 */
export interface ImportedView {
  /**
   * Their identifiers, less those found gone since. Only the pages shown
   * are read, so the count may include an entry of another page deleted
   * meanwhile
   */
  ids: string[];
  /** The page of them the reader is on; the search keeps its own */
  page?: number;
}

/**
 * Where the reader left a list: what they searched, in which field, whether
 * they asked for the whole branch, and the page they were on.
 */
export interface ListView {
  search?: string;
  searchAttribute?: string;
  listEverything?: boolean;
  page?: number;
  /** The entries of the last import, when the list shows them */
  imported?: ImportedView;
  /**
   * The department path the list is cut to, itself and what lies under it:
   * a search of the path matches a substring, and "Sales" found Presales
   */
  under?: string;
}

export interface ListOptions {
  entity: EntityDescriptor;
  translator: Translator;
  /**
   * Fetch the entries; `search` is already known to be long enough. An
   * `EntryList` also says whether the server left entries out; a plain map,
   * as before it existed, means it did not.
   */
  load(
    search: string,
    attribute: string,
    cut?: boolean
  ): Promise<Record<string, Entry> | EntryList>;
  /** What separates the organizations of a department path: ` / ` */
  pathSeparator?: string;
  /** Whether the branch is small enough to show without a search */
  listable: boolean;
  onOpen(id: string): void;
  /** Delete the selection once asked; resolves to whether any entry went */
  onDelete(ids: string[]): Promise<boolean>;
  canDelete: boolean;
  /**
   * What the selection may be given at once besides an export and a
   * deletion: Add to a group…, Change state…. Each resolves to whether it
   * changed anything, the list then read again and the selection cleared.
   */
  bulkActions?: {
    label: string;
    run(selected: [string, Entry][]): Promise<boolean>;
  }[];
  /** Readable name of the entry a pointer lands on, when its schema has one */
  pointerLabel?(dn: string): string | undefined;
  /**
   * Read one entry, for the entries of an import: the create endpoint
   * answers little more than the identifier. Without it, the identifier is
   * all their rows show
   */
  read?(id: string): Promise<Entry>;
  /**
   * Where the reader left this list last time. The list starts from it and
   * keeps it up to date as they search and page, so a list drawn again —
   * Back from a card — opens where it was left rather than empty
   */
  view?: ListView;
}

/** Entries of an import read at once. */
const READ_CONCURRENCY = 4;

/** Controls a repaint must not steal the caret from. */
const FOCUSABLE = ['[data-search]', '[data-search-attribute]'];

interface FocusState {
  selector: string;
  start: number | null;
  end: number | null;
}

/** Read an entry value as a display string. */
function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/** Remembered page size, or the first sensible default. */
function storedPageSize(): number {
  try {
    const stored = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (PAGE_SIZES.includes(stored)) return stored;
    // eslint-disable-next-line no-empty
  } catch {}
  return PAGE_SIZES[0];
}

export class EntityList {
  private readonly options: ListOptions;
  private readonly columns: string[];
  private root: HTMLElement | null = null;
  private entries: [string, Entry][] = [];
  private selected = new Set<string>();
  /** A bulk action open: another is not started over it */
  private bulkRunning = false;
  private search = '';
  private searchAttribute: string;
  private page = 0;
  private pageSize = storedPageSize();
  private loading = false;
  private loaded = false;
  private error: string | null = null;
  /** Whether the server left entries out of the last answer */
  private truncated = false;
  /** Set when the reader asked for the whole branch despite the guard */
  private listEverything = false;
  /** The entries of the last import, shown in place of a search */
  private imported: ImportedView | undefined;
  /** See {@link ListView.under} */
  private under: string | undefined;
  /** The page the search was on, while the import's entries are shown */
  private searchPage = 0;
  /** The entries of the import read since this list was drawn */
  private readonly importedRead = new Map<string, Entry>();
  /**
   * Which load is the current one. A search is debounced, not serialised, so
   * two requests are in flight whenever the operator keeps typing — and the
   * one that answers last is not the one that was asked last. Every load
   * takes a ticket and drops its answer if another was issued meanwhile.
   */
  private generation = 0;
  /**
   * The pending debounce. It used to be a local of `bind()`, and `bind()` runs
   * again on every repaint — so the timer a keystroke had set was forgotten
   * rather than cleared, and fired anyway. Typing eight characters issued
   * eight searches instead of one.
   */
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ListOptions) {
    this.options = options;
    this.columns = EntityList.chooseColumns(options.entity);
    // Searching everywhere is the default: someone looking for a person by
    // surname should not have to know which attribute holds it first.
    this.searchAttribute = options.view?.searchAttribute ?? SEARCH_ANYWHERE;
    this.search = options.view?.search ?? '';
    this.listEverything = options.view?.listEverything ?? false;
    this.page = options.view?.page ?? 0;
    this.under = options.view?.under;
    this.imported = options.view?.imported;
    if (this.imported) {
      this.searchPage = this.page;
      this.page = this.imported.page ?? 0;
    }
  }

  /**
   * Columns worth showing: the identifier first, then the attributes whose
   * role makes them the ones an administrator scans a list for — a name, an
   * address, the organization an entry belongs to.
   *
   * @param entity entity being listed
   * @returns attribute names, in display order
   */
  static chooseColumns(entity: EntityDescriptor): string[] {
    const attributes = entity.schema.attributes;
    const wanted = [
      'employeeId',
      'displayName',
      'primaryEmail',
      'organizationPath',
      'writePolicy',
      'accountStatus',
    ];
    const columns = [entity.mainAttribute];
    for (const role of wanted) {
      for (const [name, attr] of Object.entries(attributes)) {
        if (columns.includes(name)) continue;
        if (hasRole(attr, role)) columns.push(name);
      }
    }
    // A schema that declares no role at all still deserves a usable table.
    if (columns.length === 1) {
      for (const [name, attr] of Object.entries(attributes)) {
        if (columns.length >= 5) break;
        if (name === 'objectClass' || attr.type === 'array') continue;
        if (!columns.includes(name)) columns.push(name);
      }
    }
    return columns;
  }

  /** Attributes a search can be run against: the visible, single-valued ones. */
  /**
   * The term to search for: what was typed, without the spaces around it.
   *
   * `this.search` holds the box's contents exactly, because the box is
   * redrawn from it — trimming on the way in deleted the space the operator
   * had just typed between a first name and a surname, as soon as the
   * debounce repainted. Only the question "is this long enough, and what do
   * I send" wants it trimmed.
   */
  private get query(): string {
    return this.search.trim();
  }

  /**
   * The attribute, or attributes, the search is sent against.
   *
   * @returns one name, or the comma-separated list the endpoint joins with `|`
   */
  private get searchScope(): string {
    if (this.searchAttribute !== SEARCH_ANYWHERE) return this.searchAttribute;
    // A name typed in every field is no department: "Sales" found its staff.
    const path = this.options.entity.organizationPath;
    return this.searchableAttributes()
      .map(([name]) => name)
      .filter(name => name !== path)
      .join(',');
  }

  /** The attributes searched together, under "Every field". */
  private searchableAttributes(): [string, SchemaAttribute][] {
    return searchableAttributes(this.options.entity);
  }

  /**
   * The attributes offered in the scope selector: those, and the department
   * path, which a list shows and a name search should not match — "Sales"
   * in every field found every account of the department.
   */
  private scopeAttributes(): [string, SchemaAttribute][] {
    const offered = this.searchableAttributes();
    const path = this.options.entity.organizationPath;
    const attr = path ? this.options.entity.schema.attributes[path] : undefined;
    return path && attr && !offered.some(([name]) => name === path)
      ? [...offered, [path, attr]]
      : offered;
  }

  /**
   * Render into a container and load what can be loaded.
   *
   * @param container element to fill
   */
  async render(container: HTMLElement): Promise<void> {
    this.root = container;
    this.draw();
    // A search left typed is run again, and the page it was left on kept.
    if (
      (this.imported ||
        this.listable() ||
        this.under !== undefined ||
        this.query.length >= SEARCH_MINIMUM) &&
      !this.loaded
    )
      await this.reload(true);
  }

  /** Whether the branch may be shown without a search. */
  private listable(): boolean {
    return this.options.listable || this.listEverything;
  }

  /**
   * Fetch the entries matching the current search.
   *
   * @param keepPage stay on the current page, as far as the answer reaches,
   *   rather than go back to the first
   */
  private async reload(keepPage = false): Promise<void> {
    const generation = ++this.generation;
    if (this.imported) return this.reloadImported(generation, keepPage);
    if (
      !this.listable() &&
      this.under === undefined &&
      this.query.length < SEARCH_MINIMUM
    ) {
      this.entries = [];
      this.truncated = false;
      this.loaded = false;
      this.draw();
      return;
    }
    this.loading = true;
    this.error = null;
    this.draw();
    try {
      const list = asEntryList(
        await this.options.load(
          this.query,
          this.searchScope,
          this.under !== undefined
        )
      );
      if (generation !== this.generation) return;
      this.entries = Object.entries(list.entries)
        .filter(([, entry]) => this.holds(entry))
        .sort(([a], [b]) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
      this.truncated = list.truncated;
      this.loaded = true;
      const last = Math.max(
        0,
        Math.ceil(this.entries.length / this.pageSize) - 1
      );
      this.page = keepPage ? Math.min(this.page, last) : 0;
      this.selected.clear();
    } catch (err) {
      if (generation !== this.generation) return;
      this.error = listFailure(err, this.options.translator);
      this.entries = [];
      this.truncated = false;
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.draw();
      }
    }
  }

  /**
   * Whether an entry lies in the department the list is cut to, if any,
   * without regard to case, as the directory compares a path.
   */
  private holds(entry: Entry): boolean {
    const path = this.options.entity.organizationPath;
    if (this.under === undefined || !path) return true;
    const value = entryValue(entry, path);
    const stored = String(
      (Array.isArray(value) ? value[0] : value) ?? ''
    ).toLowerCase();
    const under = this.under.toLowerCase();
    const separator = this.options.pathSeparator ?? ' / ';
    return stored === under || stored.startsWith(`${under}${separator}`);
  }

  /**
   * Show the entries of the last import, from their identifiers: what the
   * create endpoint answered holds little more. They are sorted and paged by
   * identifier, and read afresh — once per list drawn, so a change made on a
   * card shows — page by page: an import of thousands of rows is not read
   * whole to show its first 25.
   */
  private async reloadImported(
    generation: number,
    keepPage: boolean
  ): Promise<void> {
    const imported = this.imported as ImportedView;
    imported.ids = [...new Set(imported.ids)].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    this.importedRead.clear();
    this.selected.clear();
    if (!keepPage) this.page = 0;
    await this.showImported(generation);
  }

  /**
   * Read the entries of the page shown that are not read yet, and draw it.
   * One gone since, or out of the reader's reach, is left out, and the page
   * filled from the next; with none left, the list goes back to its search.
   *
   * @param generation the load this is part of; a new one when paging
   */
  private async showImported(generation = ++this.generation): Promise<void> {
    const imported = this.imported as ImportedView;
    const { read } = this.options;
    const { mainAttribute } = this.options.entity;
    this.error = null;
    this.truncated = false;
    for (;;) {
      const last = Math.max(
        0,
        Math.ceil(imported.ids.length / this.pageSize) - 1
      );
      this.page = Math.min(this.page, last);
      const from = this.page * this.pageSize;
      const queue = imported.ids
        .slice(from, from + this.pageSize)
        .filter(id => !this.importedRead.has(id));
      if (!queue.length) break;
      this.loading = true;
      this.draw();
      const gone = new Set<string>();
      let failed = false;
      try {
        await Promise.all(
          Array.from(
            { length: Math.min(READ_CONCURRENCY, queue.length) },
            async () => {
              // A failure ends the reading: the others stop taking entries
              // rather than send requests nobody will read the answer to.
              for (
                let id = queue.shift();
                id !== undefined && !failed;
                id = queue.shift()
              ) {
                try {
                  this.importedRead.set(
                    id,
                    read ? await read(id) : { [mainAttribute]: id }
                  );
                } catch (err) {
                  // Gone, or refused as a card is: left out, not a failure
                  const status = (err as { status?: number } | null)?.status;
                  if (status === 404 || status === 403) {
                    gone.add(id);
                    continue;
                  }
                  failed = true;
                  throw err;
                }
              }
            }
          )
        );
      } catch (err) {
        if (generation !== this.generation) return;
        this.error = listFailure(err, this.options.translator);
        this.loading = false;
        this.draw();
        return;
      }
      if (generation !== this.generation) return;
      if (gone.size) imported.ids = imported.ids.filter(id => !gone.has(id));
      if (imported.ids.length === 0) {
        this.loading = false;
        return this.leaveImported();
      }
    }
    // Every identifier has its row, read or not: the page shown is read,
    // and a selection made on another page was read when it was shown.
    this.entries = imported.ids.map(id => [
      id,
      this.importedRead.get(id) ?? { [mainAttribute]: id },
    ]);
    this.loading = false;
    this.loaded = true;
    this.draw();
  }

  /** Draw the page now shown, reading it first for an import's entries. */
  private turnPage(): void {
    if (this.imported) void this.showImported();
    else this.draw();
  }

  /** Back from the entries of the last import to the list's search. */
  private async leaveImported(): Promise<void> {
    this.imported = undefined;
    if (this.options.view) delete this.options.view.imported;
    this.entries = [];
    this.loaded = false;
    this.page = this.searchPage;
    const reloading = this.reload(true);
    // The button pressed is gone with the view: the keyboard goes on from
    // the search box that took its place.
    this.root?.querySelector<HTMLInputElement>('[data-search]')?.focus();
    await reloading;
  }

  /** Repaint the whole table. */
  private draw(): void {
    const root = this.root;
    if (!root) return;
    const { translator } = this.options;
    // The repaint replaces the search box along with everything else, and the
    // box is where the operator's hands are: every keystroke past the
    // debounce threw the caret out of the field they were typing in. What was
    // focused, and where the caret sat in it, is put back afterwards.
    const focus = this.focusState();

    this.remember();

    const total = this.entries.length;
    const from = this.page * this.pageSize;
    const slice = this.entries.slice(from, from + this.pageSize);

    root.innerHTML = `
      <div class="dc-list">
        <div class="dc-list-toolbar">
          ${
            this.imported
              ? `<div class="dc-list-imported" data-imported>
                  <strong>${escapeHtml(
                    translator.t('list.imported', {
                      count: this.imported.ids.length,
                    })
                  )}</strong>
                  <button type="button" class="dc-button" data-leave-imported>${escapeHtml(
                    translator.t('list.backToSearch')
                  )}</button>
                </div>`
              : this.searchMarkup()
          }
          <div class="dc-bulk" ${this.selected.size ? '' : 'hidden'}>
            <span>${escapeHtml(
              translator.t('list.selected', { count: this.selected.size })
            )}</span>
            <button type="button" class="dc-button" data-export>${escapeHtml(
              translator.t('list.export')
            )}</button>
            ${(this.options.bulkActions ?? [])
              .map(
                (action, index) =>
                  `<button type="button" class="dc-button" data-bulk-action="${index}">${escapeHtml(
                    action.label
                  )}</button>`
              )
              .join('')}
            ${
              this.options.canDelete
                ? `<button type="button" class="dc-button dc-button-danger" data-delete-selected>${escapeHtml(
                    translator.t('list.deleteSelected')
                  )}</button>`
                : ''
            }
          </div>
        </div>
        ${this.bodyMarkup(slice)}
        ${this.footerMarkup(total, from, slice.length)}
      </div>`;

    this.bind();
    this.restoreFocus(focus);
    // Half a page selected has no markup: the box shows it as a property.
    const all = root.querySelector<HTMLInputElement>('[data-select-all]');
    if (all) {
      const picked = slice.filter(([id]) => this.selected.has(id)).length;
      all.indeterminate = picked > 0 && picked < slice.length;
    }
  }

  /** The search box and the field it searches in. */
  private searchMarkup(): string {
    const { translator } = this.options;
    return `
      <div class="dc-search">
        <input type="search" class="dc-input" data-search
          value="${escapeHtml(this.search)}"
          placeholder="${escapeHtml(translator.t('list.search'))}" />
        <label class="dc-search-scope">
          <span>${escapeHtml(translator.t('list.searchIn'))}</span>
          <select class="dc-input" data-search-attribute>
            <option value="${SEARCH_ANYWHERE}"${
              this.searchAttribute === SEARCH_ANYWHERE ? ' selected' : ''
            }>${escapeHtml(translator.t('list.searchAnywhere'))}</option>
            ${this.scopeAttributes()
              .map(
                ([name, attr]) =>
                  `<option value="${escapeHtml(name)}"${
                    name === this.searchAttribute ? ' selected' : ''
                  }>${escapeHtml(
                    attributeLabel(name, attr, this.options.translator.language)
                  )}</option>`
              )
              .join('')}
          </select>
        </label>
      </div>`;
  }

  /** Keep where the reader is, for the list drawn in this one's place. */
  private remember(): void {
    if (!this.options.view) return;
    Object.assign(this.options.view, {
      search: this.search,
      searchAttribute: this.searchAttribute,
      listEverything: this.listEverything,
      page: this.imported ? this.searchPage : this.page,
      under: this.under,
    });
    if (this.imported) this.imported.page = this.page;
  }

  /**
   * What the operator is typing in, if anything, and where the caret sits.
   *
   * @returns the selector of the focused control and its selection
   */
  private focusState(): FocusState | null {
    const root = this.root;
    if (!root || typeof document === 'undefined') return null;
    const active = document.activeElement as HTMLInputElement | null;
    if (!active) return null;
    for (const selector of FOCUSABLE) {
      const candidate = root.querySelector(selector);
      if (candidate && candidate === active)
        return {
          selector,
          start: active.selectionStart ?? null,
          end: active.selectionEnd ?? null,
        };
    }
    return null;
  }

  /**
   * Put the caret back where the repaint took it from.
   *
   * @param state what `focusState` saw before the repaint
   */
  private restoreFocus(state: FocusState | null): void {
    const root = this.root;
    if (!root || !state) return;
    const target = root.querySelector<HTMLInputElement>(state.selector);
    if (!target) return;
    target.focus();
    if (state.start !== null && typeof target.setSelectionRange === 'function')
      try {
        target.setSelectionRange(state.start, state.end ?? state.start);
      } catch {
        // A control whose type has no selection: focus alone is the point.
      }
  }

  private bodyMarkup(slice: [string, Entry][]): string {
    const { translator } = this.options;
    if (this.loading)
      return `<p class="dc-empty">${escapeHtml(translator.t('app.loading'))}</p>`;
    if (this.error)
      return `<p class="dc-empty dc-error-block">${escapeHtml(this.error)}</p>`;
    if (
      !this.imported &&
      !this.listable() &&
      this.under === undefined &&
      this.query.length < SEARCH_MINIMUM
    )
      return `<p class="dc-empty">${escapeHtml(
        translator.t('list.searchGuard', { count: SEARCH_MINIMUM })
      )}<br /><button type="button" class="dc-button" data-list-all>${escapeHtml(
        translator.t('list.listEverything')
      )}</button></p>`;
    if (this.entries.length === 0)
      return `<p class="dc-empty">${escapeHtml(
        // Nobody of the department in what the server kept is no proof
        // that nobody is in it.
        this.under !== undefined && this.truncated
          ? translator.t('list.cutTruncated', { path: this.under })
          : translator.t(this.query ? 'list.noMatch' : 'list.empty')
      )}</p>`;

    const attributes = this.options.entity.schema.attributes;
    // Checked when the whole page is, so that the next click clears the page
    // rather than selecting it once more.
    const whole =
      slice.length > 0 && slice.every(([id]) => this.selected.has(id));
    return `
      ${
        this.truncated
          ? `<p class="dc-list-notice" role="status">${escapeHtml(
              // What was received, not what was asked: a server may cap
              // lower than the console asked. Cut to a department, what is
              // shown is no longer what was received, and a search typed
              // finds no more of it.
              this.under !== undefined
                ? translator.t('list.cutTruncated', { path: this.under })
                : translator.t('list.truncated', {
                    count: this.entries.length,
                  })
            )}</p>`
          : ''
      }
      <div class="dc-table-scroll">
        <table class="dc-table">
          <thead>
            <tr>
              <th class="dc-checkbox-cell">
                <input type="checkbox" data-select-all ${whole ? 'checked' : ''}
                  aria-label="${escapeHtml(translator.t('list.selectAll'))}" />
              </th>
              ${this.columns
                .map(
                  name =>
                    `<th>${escapeHtml(
                      attributeLabel(
                        name,
                        attributes[name],
                        translator.language
                      )
                    )}</th>`
                )
                .join('')}
            </tr>
          </thead>
          <tbody>
            ${slice.map(([id, entry]) => this.rowMarkup(id, entry)).join('')}
          </tbody>
        </table>
      </div>`;
  }

  private rowMarkup(id: string, entry: Entry): string {
    const { translator, entity } = this.options;
    return `
      <tr data-id="${escapeHtml(id)}">
        <td class="dc-checkbox-cell">
          <input type="checkbox" data-select="${escapeHtml(id)}"
            ${this.selected.has(id) ? 'checked' : ''}
            aria-label="${escapeHtml(translator.t('list.selectRow'))}" />
        </td>
        ${this.columns
          .map((name, index) => {
            const attr = entity.schema.attributes[name];
            const value = entryValue(entry, name);
            const raw = text(value);
            const shown = text(
              (Array.isArray(value) ? value : [value])
                .filter((v): v is string => v !== undefined)
                .map(
                  v =>
                    ownValueLabel(
                      entity,
                      name,
                      String(v),
                      translator.language
                    ) ||
                    displayValue(
                      attr,
                      String(v),
                      this.options.pointerLabel,
                      translator.language
                    )
                )
            );
            const isPath = name === entity.organizationPath;
            const state =
              typeof value === 'string'
                ? accountState(entity, name, value)
                : undefined;
            const content = isPath
              ? EntityList.shortenPath(shown)
              : stateMarkup(state, shown);
            // The first column opens the entry: a link Tab reaches and Enter
            // follows, which the browser also opens in a new tab. The rest of
            // the row only stands in for it, for the mouse.
            return `<td${isPath ? ' class="dc-path"' : ''} title="${escapeHtml(raw)}">${
              index === 0
                ? `<a class="dc-row-link" href="${escapeHtml(
                    EntityList.entryHref(entity, id)
                  )}">${content || escapeHtml(id)}</a>`
                : content
            }</td>`;
          })
          .join('')}
      </tr>`;
  }

  /**
   * The address of an entry's card: the one `onOpen` goes to.
   *
   * @param entity the entity listed
   * @param id the entry's identifier
   */
  static entryHref(entity: EntityDescriptor, id: string): string {
    return `#/${entity.key}/${encodeURIComponent(id)}`;
  }

  /**
   * A deep organization path fills a column and tells the reader nothing. Keep
   * the root and the leaf, which is what identifies it, and leave the whole
   * path in the cell's title.
   *
   * @param path full path
   * @returns the shortened, escaped form
   */
  static shortenPath(path: string): string {
    // Split on the separator alone and trim the pieces, rather than on
    // `/\s*\/\s*/`: that pattern scans the run of blanks before every
    // position, so a path made of blanks — and a path is whatever the
    // directory holds — costs the square of its length to cut up.
    const segments = path
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean);
    if (segments.length <= 2) return escapeHtml(path);
    return `${escapeHtml(segments[0])} / … / ${escapeHtml(
      segments[segments.length - 1]
    )}`;
  }

  private footerMarkup(total: number, from: number, shown: number): string {
    if (total === 0) return '';
    const { translator } = this.options;
    const pages = Math.ceil(total / this.pageSize);
    return `
      <div class="dc-list-footer">
        <label class="dc-page-size">
          <span>${escapeHtml(translator.t('list.perPage'))}</span>
          <select class="dc-input" data-page-size>
            ${PAGE_SIZES.map(
              size =>
                `<option value="${size}"${size === this.pageSize ? ' selected' : ''}>${size}</option>`
            ).join('')}
          </select>
        </label>
        <span class="dc-count">${escapeHtml(
          translator.t('list.count', {
            from: from + 1,
            to: from + shown,
            total,
          })
        )}</span>
        <div class="dc-pager">
          <button type="button" class="dc-button" data-page="-1" ${
            this.page === 0 ? 'disabled' : ''
          }>${escapeHtml(translator.t('list.previous'))}</button>
          <button type="button" class="dc-button" data-page="1" ${
            this.page >= pages - 1 ? 'disabled' : ''
          }>${escapeHtml(translator.t('list.next'))}</button>
        </div>
      </div>`;
  }

  private bind(): void {
    const root = this.root;
    if (!root) return;

    const search = root.querySelector<HTMLInputElement>('[data-search]');
    search?.addEventListener('input', () => {
      this.search = search.value;
      // A search typed is a substring again, not the department's cut.
      this.under = undefined;
      this.remember();
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => void this.reload(), 250);
    });

    root
      .querySelector<HTMLSelectElement>('[data-search-attribute]')
      ?.addEventListener('change', event => {
        this.searchAttribute = (event.target as HTMLSelectElement).value;
        this.under = undefined;
        this.remember();
        void this.reload();
      });

    root
      .querySelector<HTMLSelectElement>('[data-page-size]')
      ?.addEventListener('change', event => {
        this.pageSize = Number((event.target as HTMLSelectElement).value);
        this.page = 0;
        try {
          localStorage.setItem(PAGE_SIZE_KEY, String(this.pageSize));
          // eslint-disable-next-line no-empty
        } catch {}
        this.turnPage();
      });

    for (const button of Array.from(
      root.querySelectorAll<HTMLElement>('[data-page]')
    )) {
      button.addEventListener('click', () => {
        this.page += Number(button.dataset.page);
        this.turnPage();
      });
    }

    root
      .querySelector<HTMLInputElement>('[data-select-all]')
      ?.addEventListener('change', event => {
        const checked = (event.target as HTMLInputElement).checked;
        for (const box of Array.from(
          root.querySelectorAll<HTMLInputElement>('[data-select]')
        )) {
          const id = box.dataset.select as string;
          if (checked) this.selected.add(id);
          else this.selected.delete(id);
        }
        this.draw();
      });

    for (const box of Array.from(
      root.querySelectorAll<HTMLInputElement>('[data-select]')
    )) {
      box.addEventListener('change', () => {
        const id = box.dataset.select as string;
        if (box.checked) this.selected.add(id);
        else this.selected.delete(id);
        this.draw();
      });
    }

    for (const row of Array.from(
      root.querySelectorAll<HTMLElement>('tbody tr')
    )) {
      row.addEventListener('click', event => {
        // The link follows itself, into this tab or, with Ctrl, a new one:
        // opening the card here as well would take this tab with it.
        if (
          (event.target as HTMLElement).closest(
            '.dc-checkbox-cell, .dc-row-link'
          )
        )
          return;
        this.options.onOpen(row.dataset.id as string);
      });
    }

    root
      .querySelector('[data-leave-imported]')
      ?.addEventListener('click', () => void this.leaveImported());

    root.querySelector('[data-list-all]')?.addEventListener('click', () => {
      this.listEverything = true;
      void this.reload();
    });

    root.querySelector('[data-export]')?.addEventListener('click', () => {
      this.exportSelection();
    });

    for (const button of Array.from(
      root.querySelectorAll<HTMLElement>('[data-bulk-action]')
    ))
      button.addEventListener('click', () => {
        const action =
          this.options.bulkActions?.[Number(button.dataset.bulkAction)];
        // One at a time: a second, clicked while the first read what it
        // offers, opened over it.
        if (!action || this.bulkRunning) return;
        const selected = this.entries.filter(([id]) => this.selected.has(id));
        this.bulkRunning = true;
        void action
          .run(selected)
          .finally(() => (this.bulkRunning = false))
          .then(changed => {
            // Nor read again once another page replaced the list.
            if (!changed || root.isConnected === false) return;
            this.selected.clear();
            void this.reload(true);
          })
          // An action says its own failures; nothing is left to tell.
          .catch(() => undefined);
      });

    root
      .querySelector('[data-delete-selected]')
      ?.addEventListener('click', () => {
        // Read again only once something went: a Cancel leaves the page,
        // the selection and the focus, back on this button, as they were.
        void this.options
          .onDelete([...this.selected])
          .then(deleted => (deleted ? this.reload() : undefined));
      });
  }

  /**
   * Hand the selection to the browser as a CSV file, written as the import's
   * template is: with a byte-order mark, without which a spreadsheet reads
   * an accented name as mojibake.
   */
  private exportSelection(): void {
    const rows = this.entries
      .filter(([id]) => this.selected.has(id))
      .map(([, entry]) =>
        this.columns.map(name => text(entryValue(entry, name)))
      );
    const blob = new Blob([writeCsv([this.columns, ...rows])], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.options.entity.pluralName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /** Reload after a change made elsewhere. */
  async refresh(): Promise<void> {
    await this.reload();
  }
}
