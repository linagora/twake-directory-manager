/**
 * Creating entries in bulk from a CSV file.
 *
 * Four steps, each shown before the next is taken: choose a file, say which
 * column holds which attribute, see what every row would do, then create the
 * entries — through the entity's ordinary create endpoint, one request per
 * row, so the server applies exactly the rules a creation through the form
 * meets. Nothing is written before the operator has seen the check.
 *
 * @module components/EntityImport
 */

import { parseCsv, writeCsv, type CsvTable } from '../csv';
import { attributeLabel } from '../format';
import type { Translator } from '../i18n';
import {
  guessMapping,
  importableFields,
  isPointer,
  pointerResolver,
  prepareRows,
  templateHeaders,
  unmappedRequired,
  type ImportField,
  type PointerResolver,
  type PreparedRow,
} from '../importer';
import { escapeHtml } from '../shared/dom';
import type { EntityDescriptor } from '../types';

export interface ImportOptions {
  entity: EntityDescriptor;
  translator: Translator;
  /** Candidates of a pointer attribute, as the form lists them */
  pointerOptions(branch: string): Promise<{ dn: string; label: string }[]>;
  /** Create one entry; a refusal is thrown with the server's message */
  create(values: Record<string, string | string[]>): Promise<void>;
  /** Called once the import has run, with the number of entries created */
  onDone(created: number): void;
  onClose(): void;
}

/** Requests sent at once: enough to be quick, few enough to spare the server. */
const CONCURRENCY = 4;

/** Rows listed on screen; the full list is in the downloadable report. */
const SHOWN_ERRORS = 100;

type Step = 'file' | 'mapping' | 'checking' | 'review' | 'running' | 'done';

interface Failure {
  row: PreparedRow;
  message: string;
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
  private step: Step = 'file';
  private fileName = '';
  private table: CsvTable | null = null;
  private mapping: string[] = [];
  private rows: PreparedRow[] = [];
  private failures: Failure[] = [];
  private created = 0;
  private processed = 0;
  private total = 0;
  private stopping = false;
  private error = '';

  constructor(options: ImportOptions) {
    this.options = options;
    this.fields = importableFields(options.entity);
  }

  render(root: HTMLElement): void {
    this.root = root;
    this.paint();
  }

  private t(key: string, values?: Record<string, string | number>): string {
    return this.options.translator.t(key, values);
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
    if (!root) return;
    root.innerHTML = `<div class="dc-import">${this.stepMarkup()}</div>`;
    this.bind(root);
  }

  private stepMarkup(): string {
    switch (this.step) {
      case 'file':
        return this.fileMarkup();
      case 'mapping':
        return this.mappingMarkup();
      case 'checking':
        return `<p class="dc-empty">${escapeHtml(this.t('import.checking'))}</p>`;
      case 'review':
        return this.reviewMarkup();
      case 'running':
        return this.progressMarkup();
      case 'done':
        return this.doneMarkup();
    }
  }

  /* ------------------------------------------------------------------ file */

  private fileMarkup(): string {
    return `
      <p>${escapeHtml(this.t('import.intro'))}</p>
      <ul class="dc-import-notes">
        <li>${escapeHtml(this.t('import.noteHeader'))}</li>
        <li>${escapeHtml(this.t('import.noteMulti'))}</li>
        <li>${escapeHtml(this.t('import.noteReference'))}</li>
      </ul>
      ${this.error ? `<p class="dc-error">${escapeHtml(this.error)}</p>` : ''}
      <label class="dc-import-drop">
        <input type="file" accept=".csv,text/csv" data-import-file />
        <span class="dc-import-drop-title">${escapeHtml(this.t('import.choose'))}</span>
        <span class="dc-muted">${escapeHtml(this.t('import.chooseHint'))}</span>
      </label>
      <div class="dc-form-actions">
        <button type="button" class="dc-button" data-import-template>${escapeHtml(
          this.t('import.template')
        )}</button>
        <button type="button" class="dc-button" data-import-close>${escapeHtml(
          this.t('app.cancel')
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

  private mappingMarkup(): string {
    const table = this.table as CsvTable;
    const missing = unmappedRequired(this.mapping, this.fields);
    return `
      <p>${escapeHtml(
        this.t('import.read', { count: table.rows.length, file: this.fileName })
      )}</p>
      <p class="dc-muted">${escapeHtml(this.t('import.mappingHelp'))}</p>
      <div class="dc-table-scroll">
        <table class="dc-table dc-import-mapping">
          <thead><tr>
            <th>${escapeHtml(this.t('import.column'))}</th>
            <th>${escapeHtml(this.t('import.example'))}</th>
            <th>${escapeHtml(this.t('import.attribute'))}</th>
          </tr></thead>
          <tbody>
            ${table.headers
              .map(
                (header, index) => `<tr>
                  <td>${escapeHtml(header)}</td>
                  <td class="dc-muted" title="${escapeHtml(
                    table.rows[0]?.[index] ?? ''
                  )}">${escapeHtml(table.rows[0]?.[index] ?? '')}</td>
                  <td>
                    <select class="dc-input" data-import-map="${index}"
                      aria-label="${escapeHtml(header)}">
                      <option value="">${escapeHtml(this.t('import.ignore'))}</option>
                      ${this.fields
                        .map(
                          ([name, attr]) =>
                            `<option value="${escapeHtml(name)}"${
                              this.mapping[index] === name ? ' selected' : ''
                            }>${escapeHtml(this.label(name))}${
                              attr.required ? ' *' : ''
                            }</option>`
                        )
                        .join('')}
                    </select>
                  </td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      ${
        missing.length
          ? `<p class="dc-error">${escapeHtml(
              this.t('import.unmapped', {
                fields: missing.map(name => this.label(name)).join(', '),
              })
            )}</p>`
          : ''
      }
      ${this.duplicateMarkup()}
      <div class="dc-form-actions">
        <button type="button" class="dc-button" data-import-restart>${escapeHtml(
          this.t('import.otherFile')
        )}</button>
        <button type="button" class="dc-button dc-button-primary" data-import-check
          ${missing.length || this.duplicates().length ? 'disabled' : ''}>${escapeHtml(
            this.t('import.check')
          )}</button>
      </div>`;
  }

  /** Attributes two columns are mapped to: which one would win is a guess. */
  private duplicates(): string[] {
    const used = this.mapping.filter(Boolean);
    return [...new Set(used.filter((name, i) => used.indexOf(name) !== i))];
  }

  private duplicateMarkup(): string {
    const twice = this.duplicates();
    return twice.length
      ? `<p class="dc-error">${escapeHtml(
          this.t('import.twice', {
            fields: twice.map(name => this.label(name)).join(', '),
          })
        )}</p>`
      : '';
  }

  /**
   * Load the candidates of every pointer attribute the file fills, then
   * check each row.
   */
  private async check(): Promise<void> {
    this.step = 'checking';
    this.paint();
    const resolvers: Record<string, PointerResolver> = {};
    const attributes = this.options.entity.schema.attributes;
    try {
      for (const name of new Set(this.mapping.filter(Boolean))) {
        const attr = attributes[name];
        if (!attr || !isPointer(attr)) continue;
        const branch = (attr.branch || attr.items?.branch || [])[0];
        if (!branch) continue;
        resolvers[name] = pointerResolver(
          await this.options.pointerOptions(branch)
        );
      }
    } catch (err) {
      this.error = (err as Error).message;
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

  private reviewMarkup(): string {
    const valid = this.rows.filter(row => row.errors.length === 0);
    const invalid = this.rows.filter(row => row.errors.length > 0);
    return `
      <div class="dc-import-summary">
        <div class="dc-import-stat dc-import-stat-ok">
          <strong>${valid.length}</strong>
          <span>${escapeHtml(this.t('import.ready'))}</span>
        </div>
        <div class="dc-import-stat${invalid.length ? ' dc-import-stat-bad' : ''}">
          <strong>${invalid.length}</strong>
          <span>${escapeHtml(this.t('import.invalid'))}</span>
        </div>
      </div>
      ${
        invalid.length
          ? `<p class="dc-muted">${escapeHtml(this.t('import.invalidHelp'))}</p>
            ${this.problemsMarkup(
              invalid.map(row => ({ row, message: row.errors.join(' — ') }))
            )}`
          : `<p class="dc-muted">${escapeHtml(this.t('import.allValid'))}</p>`
      }
      <p class="dc-muted">${escapeHtml(this.t('import.serverRules'))}</p>
      <div class="dc-form-actions">
        <button type="button" class="dc-button" data-import-back>${escapeHtml(
          this.t('app.back')
        )}</button>
        ${
          invalid.length
            ? `<button type="button" class="dc-button" data-import-report>${escapeHtml(
                this.t('import.downloadInvalid')
              )}</button>`
            : ''
        }
        <button type="button" class="dc-button dc-button-primary" data-import-run
          ${valid.length ? '' : 'disabled'}>${escapeHtml(
            this.t('import.run', { count: valid.length })
          )}</button>
      </div>`;
  }

  private problemsMarkup(problems: Failure[]): string {
    return `
      <div class="dc-table-scroll dc-import-problems">
        <table class="dc-table">
          <thead><tr>
            <th>${escapeHtml(this.t('import.line'))}</th>
            <th>${escapeHtml(this.t('import.problem'))}</th>
          </tr></thead>
          <tbody>
            ${problems
              .slice(0, SHOWN_ERRORS)
              .map(
                problem => `<tr>
                  <td>${problem.row.line}</td>
                  <td class="dc-import-message">${escapeHtml(problem.message)}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      ${
        problems.length > SHOWN_ERRORS
          ? `<p class="dc-muted">${escapeHtml(
              this.t('import.more', { count: problems.length - SHOWN_ERRORS })
            )}</p>`
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

  private progressMarkup(): string {
    const percent = this.total
      ? Math.round((this.processed / this.total) * 100)
      : 0;
    return `
      <p>${escapeHtml(
        this.t('import.progress', { done: this.processed, total: this.total })
      )}</p>
      <div class="dc-progress" role="progressbar" aria-valuemin="0"
        aria-valuemax="${this.total}" aria-valuenow="${this.processed}">
        <div class="dc-progress-bar" style="width:${percent}%"></div>
      </div>
      <p class="dc-muted">${escapeHtml(
        this.t('import.progressDetail', {
          created: this.created,
          failed: this.failures.length,
        })
      )}</p>
      <div class="dc-form-actions">
        <button type="button" class="dc-button dc-button-danger" data-import-stop
          ${this.stopping ? 'disabled' : ''}>${escapeHtml(
            this.t(this.stopping ? 'import.stopping' : 'import.stop')
          )}</button>
      </div>`;
  }

  private async run(): Promise<void> {
    const queue = this.rows.filter(row => row.errors.length === 0);
    this.total = queue.length;
    this.processed = 0;
    this.created = 0;
    this.failures = [];
    this.stopping = false;
    this.step = 'running';
    this.paint();

    let next = 0;
    const worker = async (): Promise<void> => {
      while (!this.stopping && next < queue.length) {
        const row = queue[next++];
        try {
          await this.options.create(row.values);
          this.created++;
        } catch (err) {
          this.failures.push({ row, message: (err as Error).message });
        }
        this.processed++;
        this.updateProgress();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)
    );

    this.failures.sort((a, b) => a.row.line - b.row.line);
    this.step = 'done';
    this.paint();
    this.options.onDone(this.created);
  }

  /** Repaint the progress in place, rather than the whole step per row. */
  private updateProgress(): void {
    const root = this.root;
    if (!root || this.step !== 'running') return;
    const bar = root.querySelector<HTMLElement>('.dc-progress-bar');
    if (!bar) return this.paint();
    const percent = this.total
      ? Math.round((this.processed / this.total) * 100)
      : 0;
    bar.style.width = `${percent}%`;
    root
      .querySelector('.dc-progress')
      ?.setAttribute('aria-valuenow', String(this.processed));
    const texts = root.querySelectorAll<HTMLElement>('.dc-import > p');
    if (texts[0])
      texts[0].textContent = this.t('import.progress', {
        done: this.processed,
        total: this.total,
      });
    if (texts[1])
      texts[1].textContent = this.t('import.progressDetail', {
        created: this.created,
        failed: this.failures.length,
      });
  }

  /* ------------------------------------------------------------------ done */

  private doneMarkup(): string {
    const skipped = this.total - this.processed;
    return `
      <div class="dc-import-summary">
        <div class="dc-import-stat dc-import-stat-ok">
          <strong>${this.created}</strong>
          <span>${escapeHtml(this.t('import.created'))}</span>
        </div>
        <div class="dc-import-stat${this.failures.length ? ' dc-import-stat-bad' : ''}">
          <strong>${this.failures.length}</strong>
          <span>${escapeHtml(this.t('import.refused'))}</span>
        </div>
        ${
          skipped
            ? `<div class="dc-import-stat">
                <strong>${skipped}</strong>
                <span>${escapeHtml(this.t('import.notSent'))}</span>
              </div>`
            : ''
        }
      </div>
      ${this.failures.length ? this.problemsMarkup(this.failures) : ''}
      <div class="dc-form-actions">
        ${
          this.failures.length
            ? `<button type="button" class="dc-button" data-import-report>${escapeHtml(
                this.t('import.downloadRefused')
              )}</button>`
            : ''
        }
        <button type="button" class="dc-button dc-button-primary" data-import-close>${escapeHtml(
          this.t('app.close')
        )}</button>
      </div>`;
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
        if (file) void this.readFile(file);
      });

    for (const select of Array.from(
      root.querySelectorAll<HTMLSelectElement>('[data-import-map]')
    ))
      select.addEventListener('change', () => {
        this.mapping[Number(select.dataset.importMap)] = select.value;
        this.paint();
      });

    root
      .querySelector('[data-import-restart]')
      ?.addEventListener('click', () => {
        this.step = 'file';
        this.table = null;
        this.paint();
      });

    root
      .querySelector('[data-import-check]')
      ?.addEventListener('click', () => void this.check());

    root.querySelector('[data-import-back]')?.addEventListener('click', () => {
      this.step = 'mapping';
      this.paint();
    });

    root
      .querySelector('[data-import-run]')
      ?.addEventListener('click', () => void this.run());

    root.querySelector('[data-import-stop]')?.addEventListener('click', () => {
      this.stopping = true;
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
