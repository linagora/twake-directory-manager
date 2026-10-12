/**
 * How a value and its name are shown.
 *
 * Two things are wrong by default when a schema is rendered as-is: an
 * attribute with no `label` shows as `twakeDepartmentPath`, and a DN reference
 * shows as the whole DN, which fills a column and tells the reader nothing
 * they did not already know. Both are fixed here, in one place, so the table,
 * the detail card and the form agree.
 *
 * @module browser/directory-console/format
 */

import { toTitleCase } from './shared/dom';

import type {
  EntityDescriptor,
  EntitySchema,
  Entry,
  LocalizedText,
  SchemaAttribute,
} from './types';

/**
 * Pick the text for a language.
 *
 * A deployment names its own entities and attributes, so those names — and
 * their translations — come from its schemas rather than from a catalogue
 * shipped with the product. A plain string is the text itself; a map is
 * searched for the exact tag, then for its language, then for English, and
 * finally for whatever it does hold, so a partially translated schema shows
 * *something* rather than nothing.
 *
 * @param text the schema's text, in one or several languages
 * @param language language tag the interface is running in
 * @returns the text to show, or undefined when there is none
 */
export function resolveText(
  text: LocalizedText | undefined,
  language: string
): string | undefined {
  if (text === undefined || text === null) return undefined;
  if (typeof text === 'string') return text || undefined;
  const short = language.split('-')[0].toLowerCase();
  const candidates = [language, short, 'en'];
  for (const key of candidates) {
    const found = text[key];
    if (found) return found;
  }
  return Object.values(text).find(Boolean);
}

/**
 * Name to show for an attribute: the schema's own label when it has one, in
 * the interface's language, and otherwise its name made readable —
 * `twakeDepartmentPath` reads better as "Twake department path" than as itself.
 *
 * @param name attribute name
 * @param attr its schema definition
 * @param language language tag the interface is running in
 * @returns the label to show
 */
export function attributeLabel(
  name: string,
  attr: SchemaAttribute | undefined,
  language = 'en'
): string {
  return resolveText(attr?.label, language) || toTitleCase(name);
}

/**
 * Whether a text is written as a DN — `attribute=value` pairs separated by
 * commas, two at least — rather than as a name. An identifier holding an
 * `=` is not one, being a single pair.
 */
export function isDnShaped(text: string): boolean {
  return /^\s*[a-z][\w.-]*\s*=(?:\\.|[^,\\])*(?:,\s*[a-z][\w.-]*\s*=(?:\\.|[^,\\])*)+$/i.test(
    text
  );
}

/** Value of the first RDN of a DN, with its escapes removed. */
export function rdnValue(dn: string): string {
  const match = /^[^=]+=((?:\\.|[^,])*)/.exec(dn);
  return match ? match[1].replace(/\\(.)/g, '$1') : dn;
}

/**
 * Case-insensitive index of an entry's own keys, so a schema attribute is
 * found however the directory spelled it.
 *
 * LDAP attribute names are case-insensitive (RFC 4512) and a directory
 * answers with whatever case it holds them in, which does not always match
 * the schema's — `scripts/audit-directory.ts` hit the same mismatch and
 * lowercases its keys for the same reason. Built the first time an entry
 * needs it and cached on the entry itself with a `WeakMap`, so a table
 * showing many entries, each read for many columns, pays the scan once per
 * entry rather than once per cell.
 */
const caseIndexes = new WeakMap<Entry, Map<string, string>>();

function caseIndex(entry: Entry): Map<string, string> {
  let index = caseIndexes.get(entry);
  if (!index) {
    index = new Map();
    for (const key of Object.keys(entry)) index.set(key.toLowerCase(), key);
    caseIndexes.set(entry, index);
  }
  return index;
}

/**
 * Read an entry's attribute by the schema's own name, falling back to
 * whatever case the directory actually answered with.
 *
 * Every place the console reads an entry by a schema attribute name goes
 * through here rather than indexing the entry directly, so a directory that
 * answers `mailQuotaSize` where the schema says `mailquotasize` (or the
 * reverse) still shows the value instead of an empty cell.
 *
 * @param entry entry as the API returned it, or undefined when there is none
 * @param name attribute name, as the schema spells it
 * @returns the value, under either spelling, or undefined when the entry
 *   carries it under neither
 */
export function entryValue(
  entry: Entry | undefined,
  name: string
): string | string[] | undefined {
  if (!entry) return undefined;
  if (name in entry) return entry[name];
  const actual = caseIndex(entry).get(name.toLowerCase());
  return actual === undefined ? undefined : entry[actual];
}

/**
 * Decimal units, the ones `parseByteSize` reads and the ones mail servers
 * report: 1 GB is 10^9 bytes, not 2^30.
 */
const SIZE_UNITS: [string, number][] = [
  ['TB', 1e12],
  ['GB', 1e9],
  ['MB', 1e6],
  ['KB', 1e3],
];

/**
 * A byte count as the size a reader recognises.
 *
 * The directory stores what `normalize: "byteSize"` computed — a bare number
 * of bytes — so a mail quota reads as ten digits where the operator set
 * `4GB`. It is turned back only when the shorter form means exactly the same
 * number: a value that needs more than three decimals is not made clearer by
 * a unit, and the form hands what is shown straight back to the server, which
 * reads it with `parseByteSize`.
 *
 * @param value value as stored
 * @returns the size in the largest unit that says it exactly
 */
export function formatByteSize(value: string): string {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return value;
  const bytes = Number(text);
  if (!Number.isSafeInteger(bytes)) return value;
  for (const [unit, size] of SIZE_UNITS) {
    if (bytes < size) continue;
    const quantity = (bytes / size).toFixed(3).replace(/\.?0+$/, '');
    if (Math.round(Number(quantity) * size) !== bytes) return value;
    return `${quantity} ${unit}`;
  }
  return `${bytes} B`;
}

/**
 * Read a size the way the server's `parseByteSize` does — `4GB`, `500 MB`,
 * `2048` or `2048B`, in any case — so that the form refuses before sending
 * what the server would refuse after.
 *
 * @param value value as typed
 * @returns the size in bytes, or undefined when it is no size
 */
export function parseByteSize(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i.exec(value.trim());
  if (!match) return undefined;
  const unit = (match[2] || 'B').toUpperCase();
  const size = SIZE_UNITS.find(([name]) => name === unit)?.[1] ?? 1;
  return Math.round(parseFloat(match[1]) * size);
}

/**
 * A directory date as a reader writes it.
 *
 * The directory stores a date as a GeneralizedTime, `20310115000000Z`, which
 * reads as a number. It is shown in the interface's language, and as the day
 * stored — the one the form's date field shows — whatever the reader's time
 * zone.
 *
 * @param value value as stored
 * @param language interface language
 * @returns the date, or the value as it stands when it is no date
 */
export function formatDate(value: string, language: string): string {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value.trim());
  if (!match) return value;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` carries a 13th month or a 32nd day over rather than refuse it.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return value;
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Whether a directory date falls before today, as the server judges an
 * expiry: by the day in UTC, the time zone the directory writes its dates in,
 * so that a date set for today passes.
 *
 * @param value value as stored, `20310115000000Z` or `2031-01-15`
 * @param now the present
 * @returns true when the day has passed; false for what is no date
 */
export function beforeToday(value: string, now: Date = new Date()): boolean {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value.trim());
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  return (
    Date.UTC(year, month - 1, day) <
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

/**
 * A server refusal in the words of the form.
 *
 * The server names an attribute the way the directory spells it —
 * `Attribute "twakeDeletionDate" must not be earlier than today` — where the
 * operator only ever saw its label. A name the schema knows, quoted or
 * following the word "field", is replaced by its label; the rest of the
 * message is the server's own.
 *
 * @param message what the server answered
 * @param schema schema of the entry it refused
 * @param language interface language
 * @returns the message, naming fields by their labels
 */
export function nameAttributes(
  message: string,
  schema: EntitySchema,
  language: string
): string {
  const labelOf = (name: string): string | undefined => {
    const key = Object.keys(schema.attributes).find(
      candidate => candidate.toLowerCase() === name.toLowerCase()
    );
    return key === undefined
      ? undefined
      : attributeLabel(key, schema.attributes[key], language);
  };
  return message.replace(
    /"([a-z][\w-]*)"|\b(field) ([a-z][\w-]*)/gi,
    (match, quoted?: string, word?: string, bare?: string) => {
      const label = labelOf(quoted ?? bare ?? '');
      if (label === undefined) return match;
      return quoted === undefined ? `${word} "${label}"` : `"${label}"`;
    }
  );
}

/**
 * Text to show for one value.
 *
 * A DN reference is shown by its own name — `active`, `Systems Analyst` — and
 * the full DN belongs in the tooltip, where it is available without being in
 * the way.
 *
 * @param attr schema definition of the attribute
 * @param value value as stored
 * @param pointerLabel readable name of the entry a pointer lands on
 * @param language interface language, to write a date in
 * @returns the text to show
 */
export function displayValue(
  attr: SchemaAttribute | undefined,
  value: string,
  pointerLabel?: (dn: string) => string | undefined,
  language = 'en'
): string {
  const pointer = attr?.type === 'pointer' || attr?.items?.type === 'pointer';
  if (pointer) return pointerLabel?.(value) || rdnValue(value);
  if (attr?.normalize === 'byteSize') return formatByteSize(value);
  if (attr?.type === 'date') return formatDate(value, language);
  return value;
}

/** A DN in the one spelling two DNs are compared in. */
export function comparableDn(dn: string): string {
  return dn.replace(/\s*,\s*/g, ',').toLowerCase();
}

/** Whether a DN is a branch itself or lies anywhere under it. */
export function withinDn(dn: string, branch: string): boolean {
  const entry = comparableDn(dn);
  const root = comparableDn(branch);
  return entry === root || entry.endsWith(`,${root}`);
}

/**
 * What to call the entry a pointer lands on, when its schema names it.
 *
 * A nomenclature declares a readable name per value in `entity.valueLabels`,
 * keyed by the value of its main attribute — `teamMailbox` reads _Shared
 * mailbox_. The entity is the one whose base is the entry's parent, which is
 * where a flat entity keeps its entries.
 *
 * @param entities every entity the console knows
 * @param dn DN the pointer holds
 * @param language interface language
 * @returns the readable name, or undefined when no schema gives one
 */
export function pointerLabel(
  entities: EntityDescriptor[],
  dn: string,
  language: string
): string | undefined {
  const match = /^[^=]+=((?:\\.|[^,])*),(.+)$/.exec(dn);
  if (!match) return undefined;
  const parent = comparableDn(match[2]);
  const owner = entities.find(
    entity => entity.base && comparableDn(entity.base) === parent
  );
  const labels = owner?.schema.entity?.valueLabels;
  if (!labels) return undefined;
  return valueLabel(labels, rdnValue(dn), language);
}

/**
 * The readable name of one value in a `valueLabels` map. A directory answers
 * with its own spelling of a value, so the key is found whatever its case.
 *
 * @param labels the entity's map
 * @param value main attribute value
 * @param language interface language
 * @returns the name, or undefined when the map does not hold the value
 */
export function valueLabel(
  labels: Record<string, LocalizedText>,
  value: string,
  language: string
): string | undefined {
  const key =
    value in labels
      ? value
      : Object.keys(labels).find(
          name => name.toLowerCase() === value.toLowerCase()
        );
  return key === undefined ? undefined : resolveText(labels[key], language);
}

/**
 * The attributes a search of an entity looks in.
 *
 * A schema that marks any attribute `searchable` has said which ones its
 * directory indexed, and that list is taken as it stands. One that marks
 * none is guessed at — everything returnable, single-valued and not a DN —
 * which suits a small branch and scans a large one.
 *
 * @param entity entity searched
 * @returns the attributes, in schema order
 */
export function searchableAttributes(
  entity: EntityDescriptor
): [string, SchemaAttribute][] {
  const all = Object.entries(entity.schema.attributes);
  const declared = all.filter(([, attr]) => attr.searchable);
  if (declared.length) return declared;
  return all.filter(
    ([name, attr]) =>
      name !== 'objectClass' &&
      !attr.neverReturn &&
      attr.type !== 'array' &&
      attr.type !== 'pointer'
  );
}
