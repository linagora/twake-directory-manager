/**
 * Creating entries in bulk from a CSV file.
 *
 * Four steps, each shown before the next is taken: choose a file, say which
 * column holds which attribute, see what every row would do, then create the
 * entries — through the entity's ordinary create endpoint, one request per
 * row, so the server applies exactly the rules a creation through the form
 * meets. Nothing is written before the operator has seen the check.
 *
 * @module twake-directory-manager/components/EntityImport
 */

import { parseCsv, writeCsv, type CsvTable } from '../csv';
import { attributeLabel, explainRefusal, rdnValue } from '../format';
import type { Translator } from '../i18n';
import { roleAttribute, tooBroad } from '../api/ConsoleApiClient';
import {
  columnValues,
  guessMapping,
  importableFields,
  isPointer,
  lookupResolver,
  pointerResolver,
  prepareRows,
  templateHeaders,
  unmappedRequired,
  type ImportField,
  type PointerLookup,
  type PointerResolver,
  type PreparedRow,
} from '../importer';
import { EntityList, listFailure } from './EntityList';
import type { EntityDescriptor } from '../types';
import { background, type Reporter } from '../shared/background';
import { html, render, type SafeHtml } from '../shared/html';
import { dataTable } from '../ui/table';

export interface ImportOptions {
  entity: EntityDescriptor;
  translator: Translator;
  /**
   * Told of a failure in work the component starts without waiting for it
   * (see `background`); the console's own reporter, or the log when absent
   */
  report?: Reporter;
  /** Candidates of a pointer attribute, as the form lists them */
  pointerOptions(branch: string): Promise<{ dn: string; label: string }[]>;
  /**
   * How to find a branch's entries value by value, when listing it whole
   * failed as too broad; undefined for a branch that cannot be read so
   */
  pointerLookup?(branch: string): PointerLookup | undefined;
  /**
   * Create one entry; a refusal is thrown with the server's message. It
   * resolves to the identifier of the entry created, which the server may
   * have made; without one, the row's identifier names it
   */
  create(values: Record<string, string | string[]>): Promise<string | void>;
  /** Called once the import has run, with the identifiers of the entries created */
  onDone(created: string[]): void;
  onClose(): void;
}

/** Requests sent at once: enough to be quick, few enough to spare the server. */
const CONCURRENCY = 4;

/** Rows listed on screen; the full list is in the downloadable report. */
const SHOWN_ERRORS = 100;

/** Entries created listed on screen; the list shows them all once closed. */
const SHOWN_CREATED = 100;

type Step = 'file' | 'mapping' | 'checking' | 'review' | 'running' | 'done';

interface Failure {
  row: PreparedRow;
  message: string;
}

/** A row the server took, and the identifier of the entry it made of it. */
interface Success {
  row: PreparedRow;
  id: string;
}

/** Hand a file to the browser to save. */
function download(name: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export class EntityImport {
  private readonly options: ImportOptions;
  private readonly fields: ImportField[];
  private root: HTMLElement | null = null;
  /** What it drew last, gone from the page once its panel is closed. */
  private view: HTMLElement | null = null;
  private step: Step = 'file';
  private fileName = '';
  private table: CsvTable | null = null;
  private mapping: string[] = [];
  private rows: PreparedRow[] = [];
  private failures: Failure[] = [];
  private successes: Success[] = [];
  private created = 0;
  private processed = 0;
  private total = 0;
  private stopping = false;
  private error = '';
  /** The step and error last painted: a new one moves the focus to its lead. */
  private painted: { step: Step | null; error: string } = {
    step: null,
    error: '',
  };
  /** A control the repaint replaces, to give the focus back to: a selector. */
  private refocus: string | null = null;

  constructor(options: ImportOptions) {
    this.options = options;
    this.fields = importableFields(options.entity);
  }

  render(root: HTMLElement): void {
    this.root = root;
    this.view = null;
    this.paint();
  }

  private t(key: string, values?: Record<string, string | number>): string {
    return this.options.translator.t(key, values);
  }

  /**
   * A summary said in one breath, "2 ready to import, 0 with errors": each
   * figure with its label, which agrees with it as the tiles' labels do.
   */
  private summary(parts: [number, string][]): string {
    return parts
      .map(([count, key]) => `${count} ${this.t(key, { count })}`)
      .join(', ');
  }

  private label(name: string): string {
    return attributeLabel(
      name,
      this.options.entity.schema.attributes[name],
      this.options.translator.language
    );
  }

  /** The separator a spreadsheet of the interface's language expects. */
  private get delimiter(): string {
    return this.options.translator.language === 'en' ? ',' : ';';
  }

  private paint(): void {
    const root = this.root;
    // Closed, or its panel given to another form, a running import draws no
    // more: it filled the hidden panel row after row, or wrote over the form.
    if (!root || this.view?.isConnected === false) return;
    render(root, html`<div class="dc-import">${this.stepMarkup()}</div>`);
    this.view = root.querySelector<HTMLElement>('.dc-import');
    // The bar's width is set here, not in a style attribute a strict CSP
    // would refuse; `progress()` moves it as the rows go.
    const bar = root.querySelector<HTMLElement>('.dc-progress-bar');
    if (bar) bar.style.width = `${this.percent()}%`;
    this.bind(root);
    // Each step replaces the panel's content, and the focus fell to the page:
    // a screen reader heard nothing of "1 ready to import, 1 with errors"
    // (#213). A control the repaint replaced gets the focus back (a column
    // mapped otherwise, Stop); otherwise the step's lead takes it when the
    // step changes, an error appears, or the focus was lost with the content.
    const changed =
      this.step !== this.painted.step || this.error !== this.painted.error;
    this.painted = { step: this.step, error: this.error };
    const back = this.refocus && root.querySelector<HTMLElement>(this.refocus);
    this.refocus = null;
    if (back) back.focus();
    else if (changed || !this.holdsFocus(root))
      root.querySelector<HTMLElement>('[data-step-lead]')?.focus();
  }

  /** Whether the focus is on something the import draws. */
  private holdsFocus(root: HTMLElement): boolean {
    if (typeof document === 'undefined') return true;
    const active = document.activeElement;
    return !!active && active !== document.body && root.contains(active);
  }

  private stepMarkup(): SafeHtml {
    switch (this.step) {
      case 'file':
        return this.fileMarkup();
      case 'mapping':
        return this.mappingMarkup();
      case 'checking':
        return html`<p class="dc-empty" tabindex="-1" data-step-lead>${this.t(
          'import.checking'
        )}</p>`;
      case 'review':
        return this.reviewMarkup();
      case 'running':
        return this.progressMarkup();
      case 'done':
        return this.doneMarkup();
    }
  }

  /* ------------------------------------------------------------------ file */

  private fileMarkup(): SafeHtml {
    return html`
      <p>${this.t('import.intro')}</p>
      <ul class="dc-import-notes">
        <li>${this.t('import.noteHeader')}</li>
        <li>${this.t('import.noteMulti')}</li>
        <li>${this.t('import.noteReference')}</li>
      </ul>
      ${
        this.error
          ? html`<p class="dc-error" tabindex="-1" data-step-lead>${
              this.error
            }</p>`
          : ''
      }
      <label class="dc-import-drop">
        <input type="file" accept=".csv,text/csv" data-import-file />
        <span class="dc-import-drop-title">${this.t('import.choose')}</span>
        <span class="dc-muted">${this.t('import.chooseHint')}</span>
      </label>
      <div class="dc-form-actions">
        <button type="button" class="dc-button" data-import-template>${this.t(
          'import.template'
        )}</button>
        <button type="button" class="dc-button" data-import-close>${this.t(
          'app.cancel'
        )}</button>
      </div>`;
  }

  private async readFile(file: File): Promise<void> {
    const table = parseCsv(await file.text());
    if (table.headers.length === 0 || table.rows.length === 0) {
      this.error = this.t('import.emptyFile');
      this.paint();
      return;
    }
    this.error = '';
    this.fileName = file.name;
    this.table = table;
    this.mapping = guessMapping(table.headers, this.fields);
    this.step = 'mapping';
    this.paint();
  }

  /* --------------------------------------------------------------- mapping */

  private mappingMarkup(): SafeHtml {
    const table = this.table as CsvTable;
    const missing = unmappedRequired(this.mapping, this.fields);
    return html`
      ${
        // A check that failed comes back here, with what the server said.
        this.error
          ? html`<p class="dc-error" tabindex="-1" data-step-lead>${
              this.error
            }</p>`
          : ''
      }
      <p tabindex="-1" data-step-lead>${this.t('import.read', {
        count: table.rows.length,
        file: this.fileName,
      })}</p>
      <p class="dc-muted">${this.t('import.mappingHelp')}</p>
      ${dataTable({
        className: 'dc-import-mapping',
        name: this.t('import.table.mapping'),
        columns: [
          { heading: this.t('import.column') },
          { heading: this.t('import.example') },
          { heading: this.t('import.attribute') },
        ],
        rows: table.headers.map(
          (header, index) => html`<tr>
                  <td>${header}</td>
                  <td class="dc-muted" title="${
                    table.rows[0]?.[index] ?? ''
                  }">${table.rows[0]?.[index] ?? ''}</td>
                  <td>
                    <select class="dc-input" data-import-map="${index}"
                      aria-label="${header}">
                      <option value="">${this.t('import.ignore')}</option>
                      ${this.fields.map(
                        ([name, attr]) =>
                          html`<option value="${name}"${
                            this.mapping[index] === name ? ' selected' : ''
                          }>${this.label(name)}${
                            attr.required ? ' *' : ''
                          }</option>`
                      )}
                    </select>
                  </td>
                </tr>`
        ),
      })}
      ${
        missing.length
          ? html`<p class="dc-error">${this.t('import.unmapped', {
              fields: missing.map(name => this.label(name)).join(', '),
            })}</p>`
          : ''
      }
      ${this.duplicateMarkup()}
      <div class="dc-form-actions">
        <button type="button" class="dc-button" data-import-restart>${this.t(
          'import.otherFile'
        )}</button>
        <button type="button" class="dc-button dc-button-primary" data-import-check
          ${missing.length || this.duplicates().length ? 'disabled' : ''}>${this.t(
            'import.check'
          )}</button>
      </div>`;
  }

  /** Attributes two columns are mapped to: which one would win is a guess. */
  private duplicates(): string[] {
    const used = this.mapping.filter(Boolean);
    return [...new Set(used.filter((name, i) => used.indexOf(name) !== i))];
  }

  private duplicateMarkup(): SafeHtml {
    const twice = this.duplicates();
    return twice.length
      ? html`<p class="dc-error">${this.t('import.twice', {
          fields: twice.map(name => this.label(name)).join(', '),
        })}</p>`
      : html``;
  }

  /**
   * Load the candidates of every pointer attribute the file fills, then
   * check each row.
   *
   * The whole branch first: one request, and all a nomenclature or a list of
   * positions takes. A branch past the directory's size limit refuses that
   * search — the accounts of a large directory, for a column of managers —
   * and only the values the file holds are then looked up, each on its own.
   */
  private async check(): Promise<void> {
    this.error = '';
    this.step = 'checking';
    this.paint();
    const resolvers: Record<string, PointerResolver> = {};
    const attributes = this.options.entity.schema.attributes;
    // Columns pointing into one branch share its resolver: a manager and a
    // delegate are both accounts, and the branch is listed, or its values
    // looked up, once for both.
    const branches = new Map<string, string[]>();
    for (const name of new Set(this.mapping.filter(Boolean))) {
      const attr = attributes[name];
      if (!attr || !isPointer(attr)) continue;
      const branch = (attr.branch || attr.items?.branch || [])[0];
      if (!branch) continue;
      branches.set(branch, [...(branches.get(branch) || []), name]);
    }
    try {
      for (const [branch, names] of branches) {
        let resolver: PointerResolver;
        try {
          resolver = pointerResolver(await this.options.pointerOptions(branch));
        } catch (err) {
          const lookup = tooBroad(err)
            ? this.options.pointerLookup?.(branch)
            : undefined;
          if (!lookup) throw err;
          const values = names.flatMap(name =>
            columnValues(
              this.table as CsvTable,
              this.mapping,
              name,
              attributes[name].type === 'array'
            )
          );
          resolver = await lookupResolver(values, lookup, CONCURRENCY);
        }
        for (const name of names) resolvers[name] = resolver;
      }
    } catch (err) {
      // Said the way the list says it: a refusal as too broad, a failure of
      // the server's own, each in the words the list would use.
      this.error = listFailure(err, this.options.translator);
      this.step = 'mapping';
      this.paint();
      return;
    }
    this.rows = prepareRows(
      this.table as CsvTable,
      this.mapping,
      this.fields,
      resolvers,
      this.options.translator,
      this.options.entity.mainAttribute
    );
    this.step = 'review';
    this.paint();
  }

  /* ---------------------------------------------------------------- review */

  private reviewMarkup(): SafeHtml {
    const valid = this.rows.filter(row => row.errors.length === 0);
    const invalid = this.rows.filter(row => row.errors.length > 0);
    return html`
      <div class="dc-import-summary" role="group" tabindex="-1" data-step-lead
        aria-label="${this.summary([
          [valid.length, 'import.ready'],
          [invalid.length, 'import.invalid'],
        ])}">
        <div class="dc-import-stat dc-import-stat-ok">
          <strong>${valid.length}</strong>
          <span>${this.t('import.ready', { count: valid.length })}</span>
        </div>
        <div class="dc-import-stat${invalid.length ? ' dc-import-stat-bad' : ''}">
          <strong>${invalid.length}</strong>
          <span>${this.t('import.invalid', { count: invalid.length })}</span>
        </div>
      </div>
      ${
        invalid.length
          ? html`<p class="dc-muted">${this.t('import.invalidHelp')}</p>
            ${this.problemsMarkup(
              invalid.map(row => ({ row, message: row.errors.join(' — ') }))
            )}`
          : html`<p class="dc-muted">${this.t('import.allValid')}</p>`
      }
      <p class="dc-muted">${this.t('import.serverRules')}</p>
      <div class="dc-form-actions">
        <button type="button" class="dc-button" data-import-back>${this.t(
          'app.back'
        )}</button>
        ${
          invalid.length
            ? html`<button type="button" class="dc-button" data-import-report>${this.t(
                'import.downloadInvalid'
              )}</button>`
            : ''
        }
        <button type="button" class="dc-button dc-button-primary" data-import-run
          ${valid.length ? '' : 'disabled'}>${this.t('import.run', {
            count: valid.length,
          })}</button>
      </div>`;
  }

  private problemsMarkup(problems: Failure[]): SafeHtml {
    return html`
      ${dataTable({
        wrapperClassName: 'dc-import-problems',
        name: this.t('import.table.problems'),
        columns: [
          { heading: this.t('import.line') },
          { heading: this.t('import.problem') },
        ],
        rows: problems.slice(0, SHOWN_ERRORS).map(
          problem => html`<tr>
                  <td>${problem.row.line}</td>
                  <td class="dc-import-message">${problem.message}</td>
                </tr>`
        ),
      })}
      ${
        problems.length > SHOWN_ERRORS
          ? html`<p class="dc-muted">${this.t('import.more', {
              count: problems.length - SHOWN_ERRORS,
            })}</p>`
          : ''
      }`;
  }

  /**
   * The rows that did not make it, as a file the operator corrects and
   * imports again: the original columns, and the reason in a last one.
   */
  private downloadProblems(problems: Failure[]): void {
    const table = this.table as CsvTable;
    const rows = [
      [...table.headers, this.t('import.problem')],
      ...problems.map(problem => [
        ...table.headers.map((_, index) => problem.row.cells[index] ?? ''),
        problem.message,
      ]),
    ];
    const base = this.fileName.replace(/\.csv$/i, '');
    download(
      `${base}-${this.t('import.rejectedSuffix')}.csv`,
      writeCsv(rows, this.delimiter)
    );
  }

  /* --------------------------------------------------------------- running */

  /** How far the import is, in whole percent. */
  private percent(): number {
    return this.total ? Math.round((this.processed / this.total) * 100) : 0;
  }

  private progressMarkup(): SafeHtml {
    return html`
      <p>${this.t('import.progress', {
        done: this.processed,
        total: this.total,
        count: this.total,
      })}</p>
      <div class="dc-progress" role="progressbar" aria-valuemin="0"
        aria-valuemax="${this.total}" aria-valuenow="${this.processed}"
        aria-label="${this.t('import.progressLabel')}" tabindex="-1"
        data-step-lead>
        <div class="dc-progress-bar"></div>
      </div>
      <p class="dc-muted">${this.t('import.progressDetail', {
        created: this.created,
        failed: this.failures.length,
      })}</p>
      <div class="dc-form-actions">
        <button type="button" class="dc-button dc-button-danger" data-import-stop
          ${this.stopping ? 'disabled' : ''}>${this.t(
            this.stopping ? 'import.stopping' : 'import.stop'
          )}</button>
      </div>`;
  }

  private async run(): Promise<void> {
    const queue = this.rows.filter(row => row.errors.length === 0);
    this.total = queue.length;
    this.processed = 0;
    this.created = 0;
    this.failures = [];
    this.successes = [];
    this.stopping = false;
    this.step = 'running';
    this.paint();

    let next = 0;
    const worker = async (): Promise<void> => {
      while (!this.stopping && next < queue.length) {
        const row = queue[next++];
        try {
          const id = await this.options.create(row.values);
          this.successes.push({ row, id: id || this.rowId(row) });
          this.created++;
        } catch (err) {
          // In the words a form says it in, for the table and the file. A
          // refusal of rights is about the organization the row goes to,
          // which is what the server judged, not the entry it would create.
          this.failures.push({
            row,
            message: explainRefusal(
              err,
              this.options.entity.schema,
              this.options.translator,
              this.organizationName(row) ?? this.rowName(row)
            ).message,
          });
        }
        this.processed++;
        this.updateProgress();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)
    );

    this.failures.sort((a, b) => a.row.line - b.row.line);
    this.successes.sort((a, b) => a.row.line - b.row.line);
    this.step = 'done';
    this.paint();
    this.options.onDone(this.successes.map(({ id }) => id).filter(Boolean));
  }

  /** The identifier a row gives its entry, empty when the server makes it. */
  private rowId(row: PreparedRow): string {
    const value = row.values[this.options.entity.mainAttribute];
    return ((Array.isArray(value) ? value[0] : value) ?? '').trim();
  }

  /** The entry a row creates, named by its full name, else its identifier. */
  private rowName(row: PreparedRow): string | undefined {
    const { entity } = this.options;
    const display = roleAttribute(entity.schema, 'displayName');
    for (const name of [display, entity.mainAttribute]) {
      const value = name ? row.values[name] : undefined;
      const first = (Array.isArray(value) ? value[0] : value)?.trim();
      if (first) return first;
    }
    return undefined;
  }

  /**
   * The organization a row attaches its entry to, named as the file names
   * it: the server judges a new entry's creation on it.
   *
   * @returns its name, or undefined for a row attached to none
   */
  private organizationName(row: PreparedRow): string | undefined {
    const link = this.options.entity.organizationLink;
    const value = link ? row.values[link] : undefined;
    const dn = (Array.isArray(value) ? value[0] : value)?.trim();
    if (!link || !dn) return undefined;
    const column = this.mapping.indexOf(link);
    return (column >= 0 ? row.cells[column]?.trim() : '') || rdnValue(dn);
  }

  /** Repaint the progress in place, rather than the whole step per row. */
  private updateProgress(): void {
    const root = this.root;
    // Nor in place: the bar there may be another import's.
    if (!root || this.step !== 'running' || this.view?.isConnected === false)
      return;
    const bar = root.querySelector<HTMLElement>('.dc-progress-bar');
    if (!bar) return this.paint();
    bar.style.width = `${this.percent()}%`;
    root
      .querySelector('.dc-progress')
      ?.setAttribute('aria-valuenow', String(this.processed));
    const texts = root.querySelectorAll<HTMLElement>('.dc-import > p');
    if (texts[0])
      texts[0].textContent = this.t('import.progress', {
        done: this.processed,
        total: this.total,
        count: this.total,
      });
    if (texts[1])
      texts[1].textContent = this.t('import.progressDetail', {
        created: this.created,
        failed: this.failures.length,
      });
  }

  /* ------------------------------------------------------------------ done */

  private doneMarkup(): SafeHtml {
    const skipped = this.total - this.processed;
    return html`
      <div class="dc-import-summary" role="group" tabindex="-1" data-step-lead
        aria-label="${this.summary([
          [this.created, 'import.created'],
          [this.failures.length, 'import.refused'],
        ])}">
        <div class="dc-import-stat dc-import-stat-ok">
          <strong>${this.created}</strong>
          <span>${this.t('import.created', { count: this.created })}</span>
        </div>
        <div class="dc-import-stat${this.failures.length ? ' dc-import-stat-bad' : ''}">
          <strong>${this.failures.length}</strong>
          <span>${this.t('import.refused', { count: this.failures.length })}</span>
        </div>
        ${
          skipped
            ? html`<div class="dc-import-stat">
                <strong>${skipped}</strong>
                <span>${this.t('import.notSent', { count: skipped })}</span>
              </div>`
            : ''
        }
      </div>
      ${this.passwordlessMarkup()}
      ${this.successes.length ? this.createdMarkup() : ''}
      ${this.failures.length ? this.problemsMarkup(this.failures) : ''}
      <div class="dc-form-actions">
        ${
          this.failures.length
            ? html`<button type="button" class="dc-button" data-import-report>${this.t(
                'import.downloadRefused'
              )}</button>`
            : ''
        }
        <button type="button" class="dc-button dc-button-primary" data-import-close>${this.t(
          'app.close'
        )}</button>
      </div>`;
  }

  /**
   * What the accounts created lack when the file gave no password: their
   * owners cannot sign in until each is given one, and "2 created" hid it.
   */
  private passwordlessMarkup(): SafeHtml {
    const password = this.options.entity.password;
    if (!password) return html``;
    // By row, not by column: a Password column left empty creates the
    // accounts without one all the same.
    const count = this.successes.filter(
      ({ row }) => ![row.values[password] ?? []].flat().some(Boolean)
    ).length;
    if (!count) return html``;
    return html`<p class="dc-list-notice" role="status">${this.t(
      'import.noPassword',
      { count }
    )}</p>`;
  }

  /**
   * The entries created, each by its full name and identifier and linked to
   * its card, as the list links its rows. A count alone left the operator
   * searching for each one to check it.
   */
  private createdMarkup(): SafeHtml {
    const { entity } = this.options;
    const rest = this.successes.length - SHOWN_CREATED;
    return html`
      ${dataTable({
        wrapperClassName: 'dc-import-created',
        name: this.t('import.table.created'),
        columns: [
          { heading: this.t('import.line') },
          { heading: this.t('import.createdName') },
        ],
        rows: this.successes.slice(0, SHOWN_CREATED).map(success => {
          const name = this.rowName(success.row) || success.id;
          const id =
            success.id && success.id !== name
              ? html` <span class="dc-muted">(${success.id})</span>`
              : '';
          return html`<tr>
                  <td>${success.row.line}</td>
                  <td class="dc-import-message">${
                    success.id
                      ? html`<a class="dc-row-link" href="${EntityList.entryHref(
                          entity,
                          success.id
                        )}">${name}</a>`
                      : name
                  }${id}</td>
                </tr>`;
        }),
      })}
      ${
        rest > 0
          ? html`<p class="dc-muted">${this.t('import.moreCreated', {
              count: rest,
            })}</p>`
          : ''
      }`;
  }

  /* ------------------------------------------------------------------ bind */

  private bind(root: HTMLElement): void {
    root
      .querySelector('[data-import-close]')
      ?.addEventListener('click', () => this.options.onClose());

    root
      .querySelector('[data-import-template]')
      ?.addEventListener('click', () =>
        download(
          `${this.options.entity.pluralName}-${this.t('import.templateSuffix')}.csv`,
          writeCsv(
            [templateHeaders(this.fields, this.options.translator.language)],
            this.delimiter
          )
        )
      );

    root
      .querySelector<HTMLInputElement>('[data-import-file]')
      ?.addEventListener('change', event => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (file)
          background(
            () => this.readFile(file),
            'readFile',
            this.options.report
          );
      });

    for (const select of Array.from(
      root.querySelectorAll<HTMLSelectElement>('[data-import-map]')
    ))
      select.addEventListener('change', () => {
        this.mapping[Number(select.dataset.importMap)] = select.value;
        this.refocus = `[data-import-map="${select.dataset.importMap}"]`;
        this.paint();
      });

    root
      .querySelector('[data-import-restart]')
      ?.addEventListener('click', () => {
        this.step = 'file';
        this.table = null;
        this.error = '';
        this.paint();
      });

    root
      .querySelector('[data-import-check]')
      ?.addEventListener('click', () =>
        background(() => this.check(), 'check', this.options.report)
      );

    root.querySelector('[data-import-back]')?.addEventListener('click', () => {
      this.step = 'mapping';
      this.paint();
    });

    root
      .querySelector('[data-import-run]')
      ?.addEventListener('click', () =>
        background(() => this.run(), 'run', this.options.report)
      );

    root.querySelector('[data-import-stop]')?.addEventListener('click', () => {
      this.stopping = true;
      this.refocus = '[data-import-stop]';
      this.paint();
    });

    root
      .querySelector('[data-import-report]')
      ?.addEventListener('click', () =>
        this.downloadProblems(
          this.step === 'done'
            ? this.failures
            : this.rows
                .filter(row => row.errors.length > 0)
                .map(row => ({ row, message: row.errors.join(' — ') }))
        )
      );
  }
}
