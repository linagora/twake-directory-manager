/**
 * A data table, the one way the console draws one (#226): every column has a
 * heading that says it heads a column, and the table has a name, so that a
 * screen reader moving by table hears "People (1)" rather than "table, four
 * columns" twice. ESLint refuses `<table` written anywhere else.
 *
 * @module twake-directory-manager/ui/table
 */

import { html, type Interpolation, type SafeHtml } from '../shared/html';

/** A column: its heading, and how its cells are classed. */
export interface Column {
  /** What the heading says: text, or markup such as the select-all box */
  heading: Interpolation;
  /**
   * Read but not shown: the column of actions, whose buttons name themselves,
   * needs no visible heading
   */
  hidden?: boolean;
  /** A class on the heading cell, where the column's width is set */
  className?: string;
}

/** What a table shows. */
export interface TableOptions {
  /** Classes on the table, after `dc-table` */
  className?: string;
  /** Classes on the scrolling wrapper, after `dc-table-scroll` */
  wrapperClassName?: string;
  /**
   * The table's name: a text, read but not shown (a caption), or the id of
   * the heading above it, which then names it
   */
  name?: string | { labelledBy: string };
  columns: Column[];
  /** The rows, each a `<tr>` */
  rows: readonly SafeHtml[];
}

/**
 * Draw a table in its scrolling wrapper.
 *
 * @param options what to show
 * @returns the wrapper and the table
 */
export function dataTable(options: TableOptions): SafeHtml {
  const { name, columns, rows } = options;
  const wrapper = options.wrapperClassName
    ? ` ${options.wrapperClassName}`
    : '';
  const classes = options.className ? ` ${options.className}` : '';
  const labelled =
    name && typeof name === 'object'
      ? html` aria-labelledby="${name.labelledBy}"`
      : '';
  const caption =
    typeof name === 'string'
      ? html`<caption class="dc-visually-hidden">${name}</caption>`
      : '';
  const heads = columns.map(
    column =>
      html`<th scope="col"${
        column.className ? html` class="${column.className}"` : ''
      }>${
        column.hidden
          ? html`<span class="dc-visually-hidden">${column.heading}</span>`
          : column.heading
      }</th>`
  );
  return html`<div class="dc-table-scroll${wrapper}"><table class="dc-table${classes}"${labelled}>${caption}<thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
