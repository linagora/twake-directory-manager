/**
 * Turning the rows of a CSV file into entries the server can create.
 *
 * Nothing here writes: rows are read, matched to the schema and checked the
 * way the form checks a field, so the operator sees what a file will do
 * before anything is sent. The entries are then created one by one through
 * the entity's ordinary create endpoint, which applies every rule the server
 * has — the same ones a creation through the form meets.
 *
 * @module importer
 */

import type { CsvTable } from './csv';
import { attributeLabel, rdnValue } from './format';
import type { Translator } from './i18n';
import type { EntityDescriptor, LocalizedText, SchemaAttribute } from './types';

/** An attribute a file may fill. */
export type ImportField = [string, SchemaAttribute];

/** A row checked against the schema. */
export interface PreparedRow {
  /** Line of the file, header included, as a spreadsheet numbers it */
  line: number;
  /** The row as read, to hand back in the report */
  cells: string[];
  /** What would be sent */
  values: Record<string, string | string[]>;
  /** Why it cannot be, when it cannot */
  errors: string[];
}

/** Finds the DN a pointer cell names, or says why it cannot. */
export type PointerResolver = (value: string) => {
  dn?: string;
  ambiguous?: boolean;
};

/**
 * Attributes a file may fill: the ones the form offers on creation. What the
 * server computes, derives or fixes is refused in a request body, and a
 * column for it would only produce errors.
 *
 * @param entity entity the file creates entries of
 * @returns the attributes, in schema order
 */
export function importableFields(entity: EntityDescriptor): ImportField[] {
  return Object.entries(entity.schema.attributes).filter(
    ([, attr]) => !attr.fixed && !attr.generated && !attr.readOnly
  );
}

/** Whether an attribute holds DNs of other entries. */
export function isPointer(attr: SchemaAttribute): boolean {
  return attr.type === 'pointer' || attr.items?.type === 'pointer';
}

/**
 * A name reduced to what two spellings of it share: no case, no accent, no
 * spacing or punctuation. `Title of civility`, `title_of_civility` and
 * `TITLE OF CIVILITY` all read `titleofcivility`.
 */
export function comparableName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Every name an attribute goes by: its labels, in each language, and its own
 * name. A label is what a person wrote the column after, so it counts for
 * more: `Title` is the label of _personalTitle_ before it is the name of
 * _title_.
 */
function namesOf(
  name: string,
  attr: SchemaAttribute
): { form: string; weight: number }[] {
  const label: LocalizedText | undefined = attr.label;
  const labels =
    label === undefined
      ? []
      : typeof label === 'string'
        ? [label]
        : Object.values(label);
  return [
    ...labels.map(text => ({ form: comparableName(text), weight: 2 })),
    { form: comparableName(name), weight: 1 },
  ].filter(item => item.form);
}

/**
 * The attribute a column name designates, when one does so better than every
 * other.
 *
 * @param fields candidates, with their names
 * @param matches whether one of the names fits the column
 * @returns the attribute name, or an empty string when none or several fit
 *   equally well
 */
function best(
  fields: { name: string; forms: { form: string; weight: number }[] }[],
  matches: (form: string) => boolean
): string {
  const scored = fields
    .map(field => ({
      name: field.name,
      score: Math.max(
        0,
        ...field.forms
          .filter(item => matches(item.form))
          .map(item => item.weight)
      ),
    }))
    .filter(field => field.score > 0);
  const top = Math.max(0, ...scored.map(field => field.score));
  const winners = scored.filter(field => field.score === top);
  return winners.length === 1 ? winners[0].name : '';
}

/**
 * Which attribute each column most likely holds.
 *
 * A column named like an attribute or like one of its labels, in any
 * language, is that attribute. A column whose name only starts or ends with
 * one — `Email address` for _Email_, `Phone number` for _Phone_ — is taken
 * when that attribute is the only one it fits and no other column claims it;
 * anything less sure is left for the operator to choose, since a wrong guess
 * would fill an attribute with another's values.
 *
 * @param headers header row of the file
 * @param fields attributes a file may fill
 * @returns one attribute name per column, or an empty string
 */
export function guessMapping(
  headers: string[],
  fields: ImportField[]
): string[] {
  const named = fields.map(([name, attr]) => ({
    name,
    forms: namesOf(name, attr),
  }));
  const mapping = headers.map(header => {
    const wanted = comparableName(header);
    return wanted ? best(named, form => form === wanted) : '';
  });

  const taken = new Set(mapping.filter(Boolean));
  const free = named.filter(field => !taken.has(field.name));
  const partial = headers.map((header, index) => {
    if (mapping[index]) return '';
    const wanted = comparableName(header);
    if (!wanted) return '';
    return best(
      free,
      form =>
        form.length >= 4 && (wanted.startsWith(form) || wanted.endsWith(form))
    );
  });
  // An attribute two columns partly fit belongs to neither.
  for (const [index, name] of partial.entries()) {
    if (name && partial.filter(other => other === name).length === 1)
      mapping[index] = name;
  }
  return mapping;
}

/** A readable name, the way two spellings of an organization path compare. */
function comparableLabel(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A DN, the way two spellings of it compare. */
function comparableDn(dn: string): string {
  return dn.replace(/\s*,\s*/g, ',').toLowerCase();
}

/**
 * A resolver for the cells of one pointer column.
 *
 * A file names what a pointer lands on the way a person would: a title by
 * its value, a position by its name, a department by its path — or by its
 * DN, for a file exported from the directory. Each option is found by its
 * DN, by the name shown in the form, and by the value of its RDN. A name two
 * options share is refused rather than guessed.
 *
 * @param options candidates, as the form lists them
 * @returns the resolver
 */
export function pointerResolver(
  options: { dn: string; label: string }[]
): PointerResolver {
  const byName = new Map<string, string | null>();
  const add = (key: string, dn: string): void => {
    if (!key) return;
    const known = byName.get(key);
    if (known === undefined) byName.set(key, dn);
    else if (known !== dn) byName.set(key, null);
  };
  for (const option of options) {
    add(comparableLabel(option.label), option.dn);
    add(comparableLabel(rdnValue(option.dn)), option.dn);
  }
  const byDn = new Map(
    options.map(option => [comparableDn(option.dn), option.dn])
  );

  return (value: string) => {
    const dn = byDn.get(comparableDn(value));
    if (dn) return { dn };
    const found = byName.get(comparableLabel(value));
    if (found === null) return { ambiguous: true };
    return found ? { dn: found } : {};
  };
}

const TRUE_WORDS = ['true', 'yes', 'y', '1', 'oui', 'o', 'vrai'];
const FALSE_WORDS = ['false', 'no', 'n', '0', 'non', 'faux'];

/**
 * A date as the directory stores it, from the ways a spreadsheet writes one:
 * `2026-09-30`, `30/09/2026`, or already `20260930000000Z`.
 */
function directoryDate(value: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}000000Z`;
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (local)
    return `${local[3]}${local[2].padStart(2, '0')}${local[1].padStart(2, '0')}000000Z`;
  if (/^\d{14}(\.\d+)?Z$/.test(value)) return value;
  return undefined;
}

/**
 * Check every row of a file against the schema, the way the form checks a
 * field, and build what would be sent for each.
 *
 * A cell of a multi-valued attribute holds its values separated by `|`.
 *
 * @param table the file
 * @param mapping attribute of each column, or an empty string to ignore it
 * @param fields attributes a file may fill
 * @param resolvers one per pointer attribute the mapping uses
 * @param translator interface language, for the messages
 * @returns one prepared row per data row of the file
 */
export function prepareRows(
  table: CsvTable,
  mapping: string[],
  fields: ImportField[],
  resolvers: Record<string, PointerResolver>,
  translator: Translator,
  mainAttribute?: string
): PreparedRow[] {
  const attributes = new Map(fields);
  const label = (name: string): string =>
    attributeLabel(name, attributes.get(name), translator.language);

  const rows = table.rows.map((cells, index) => {
    const values: Record<string, string | string[]> = {};
    const errors: string[] = [];
    // A cell already refused is not also reported as missing.
    const refused = new Set<string>();

    for (const [column, name] of mapping.entries()) {
      const attr = name ? attributes.get(name) : undefined;
      if (!attr) continue;
      const raw = (cells[column] ?? '').trim();
      if (!raw) continue;
      const multi = attr.type === 'array';
      let list = multi
        ? raw
            .split(/[|\n]/)
            .map(value => value.trim())
            .filter(Boolean)
        : [raw];

      if (isPointer(attr)) {
        const resolve = resolvers[name];
        const resolved: string[] = [];
        for (const value of list) {
          const answer = resolve ? resolve(value) : {};
          if (answer.dn) resolved.push(answer.dn);
          else {
            refused.add(name);
            errors.push(
              translator.t(
                answer.ambiguous ? 'import.ambiguous' : 'import.notFound',
                { value, field: label(name) }
              )
            );
          }
        }
        list = resolved;
      } else if (attr.type === 'boolean') {
        const word = raw.toLowerCase();
        if (TRUE_WORDS.includes(word)) list = ['TRUE'];
        else if (FALSE_WORDS.includes(word)) list = ['FALSE'];
        else {
          refused.add(name);
          errors.push(
            translator.t('import.notBoolean', {
              value: raw,
              field: label(name),
            })
          );
          continue;
        }
      } else if (attr.type === 'date') {
        const date = directoryDate(raw);
        if (!date) {
          refused.add(name);
          errors.push(
            translator.t('import.notDate', { value: raw, field: label(name) })
          );
          continue;
        }
        list = [date];
      } else {
        const pattern = attr.test || attr.items?.test;
        if (pattern) {
          let regex: RegExp | undefined;
          try {
            regex = new RegExp(pattern);
          } catch {
            // A pattern the browser cannot compile is the server's business.
          }
          const bad = regex
            ? list.find(value => !(regex as RegExp).test(value))
            : undefined;
          if (bad !== undefined) {
            refused.add(name);
            errors.push(
              `${label(name)}: ${attr.hint || attr.items?.hint || bad}`
            );
            continue;
          }
        }
      }

      if (list.length > 0) values[name] = multi ? list : list[0];
    }

    for (const [name, attr] of fields) {
      if (attr.required && values[name] === undefined && !refused.has(name))
        errors.push(translator.t('import.missing', { field: label(name) }));
    }

    return { line: index + 2, cells, values, errors };
  });

  flagDuplicates(rows, fields, mainAttribute, label, translator);
  return rows;
}

/**
 * Refuse a row reusing a value an earlier row of the same file holds, where
 * the schema wants it unique.
 *
 * The server checks uniqueness against the directory, before writing. Two
 * rows of one file sent at once both pass that check, and only one entry is
 * created: the file is checked against itself here, so the operator is told
 * which line repeats which rather than finding out from the server. An
 * attribute's namespace follows its `unique` marker — an address used as a
 * mail on one line and as an alias on another is the same address — and the
 * identifier is unique by nature, since it names the entry.
 *
 * @param rows rows already prepared
 * @param fields attributes a file may fill
 * @param mainAttribute the entity's identifier
 * @param label names an attribute in the messages
 * @param translator interface language
 */
function flagDuplicates(
  rows: PreparedRow[],
  fields: ImportField[],
  mainAttribute: string | undefined,
  label: (name: string) => string,
  translator: Translator
): void {
  const namespaces = new Map<string, string>();
  for (const [name, attr] of fields) {
    if (!attr.unique && name !== mainAttribute) continue;
    const shared =
      typeof attr.unique === 'object' ? attr.unique.attributes || [] : [];
    // Attributes sharing values share one namespace, named after the first.
    const key = [name, ...shared].sort()[0];
    namespaces.set(name, key);
  }
  if (namespaces.size === 0) return;

  const seen = new Map<string, number>();
  for (const row of rows) {
    const mine = new Map<string, number>();
    for (const [name, key] of namespaces) {
      const raw = row.values[name];
      if (raw === undefined) continue;
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        const id = `${key}\u0000${value.toLowerCase()}`;
        const line = seen.get(id);
        if (line !== undefined) {
          row.errors.push(
            translator.t('import.duplicate', {
              field: label(name),
              value,
              line,
            })
          );
        } else mine.set(id, row.line);
      }
    }
    // A refused row claims nothing: it will not be created.
    if (row.errors.length === 0)
      for (const [id, line] of mine) seen.set(id, line);
  }
}

/**
 * The required attributes no column is mapped to. Every row would fail on
 * each of them, so the operator is told once, before any row is checked.
 *
 * @param mapping attribute of each column
 * @param fields attributes a file may fill
 * @returns names of the unmapped required attributes
 */
export function unmappedRequired(
  mapping: string[],
  fields: ImportField[]
): string[] {
  return fields
    .filter(([name, attr]) => attr.required && !mapping.includes(name))
    .map(([name]) => name);
}

/**
 * A file with the right columns and nothing else, to fill in: one column per
 * attribute a file may fill, named by its label in the interface language.
 *
 * @param fields attributes a file may fill
 * @param language interface language
 * @returns the header row
 */
export function templateHeaders(
  fields: ImportField[],
  language: string
): string[] {
  return fields.map(([name, attr]) => attributeLabel(name, attr, language));
}
