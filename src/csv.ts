/**
 * Reading and writing CSV files, as spreadsheets produce and read them.
 *
 * @module csv
 */

/** A file read into its header row and its data rows. */
export interface CsvTable {
  headers: string[];
  rows: string[][];
  /** Separator the file was written with */
  delimiter: string;
}

const DELIMITERS = [';', ',', '\t'];

/**
 * The separator a file was written with.
 *
 * A spreadsheet saves CSV with the separator of its locale: a comma in
 * English, a semicolon in French — and the files an administrator already
 * has use the semicolon. The header row decides: it holds one name per
 * column, so the separator is the character that splits it into the most
 * cells, counted outside quotes.
 *
 * @param line first line of the file
 * @returns the separator
 */
export function detectDelimiter(line: string): string {
  let best = ',';
  let most = 0;
  for (const delimiter of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) count++;
    }
    if (count > most) {
      most = count;
      best = delimiter;
    }
  }
  return best;
}

/**
 * Read a CSV file (RFC 4180): quoted cells may hold the separator, a quote
 * written twice and a line break. A byte-order mark is dropped, CRLF and LF
 * both end a row, and a row with no content at all is skipped.
 *
 * @param text file content
 * @returns headers, rows and the separator found
 */
export function parseCsv(text: string): CsvTable {
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = detectDelimiter(firstLine);

  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      record.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || record.length > 0) {
    record.push(cell);
    records.push(record);
  }

  const meaningful = records.filter(row => row.some(value => value.trim()));
  const [headers = [], ...rows] = meaningful;
  return { headers: headers.map(header => header.trim()), rows, delimiter };
}

/**
 * One value as a CSV cell.
 *
 * Two separate jobs. RFC 4180 quoting is what keeps a separator or a newline
 * inside its own field; the leading apostrophe is what keeps a spreadsheet
 * from *evaluating* the cell. A directory holds whatever was written into it,
 * and Excel and LibreOffice both read a value opening on `= + - @` — or on a
 * tab or a carriage return — as a formula rather than as text. Quoting does
 * not help there: the quotes are stripped on import and the formula runs.
 *
 * @param value value to write
 * @param delimiter separator of the file the cell goes into
 * @returns the cell, escaped and neutralised
 */
export function csvCell(value: string, delimiter = ','): string {
  const cell = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return cell.includes(delimiter) || /[",\n\r]/.test(cell)
    ? `"${cell.replace(/"/g, '""')}"`
    : cell;
}

/**
 * Write rows as a CSV file, with the separator given.
 *
 * @param rows header row first
 * @param delimiter separator
 * @returns the file content, with a byte-order mark so a spreadsheet reads
 *   it as UTF-8
 */
export function writeCsv(rows: string[][], delimiter = ','): string {
  return (
    '\uFEFF' +
    rows
      .map(row => row.map(value => csvCell(value, delimiter)).join(delimiter))
      .join('\r\n') +
    '\r\n'
  );
}
