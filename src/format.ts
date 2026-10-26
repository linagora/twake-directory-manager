/**
 * How a value and its name are shown.
 *
 * Two things are wrong by default when a schema is rendered as-is: an
 * attribute with no `label` shows as `twakeDepartmentPath`, and a DN reference
 * shows as the whole DN, which fills a column and tells the reader nothing
 * they did not already know. Both are fixed here, in one place, so the table,
 * the detail card and the form agree.
 *
 * @module twake-directory-manager/format
 */

import { toTitleCase } from './shared/dom';

import type { Translator } from './i18n';
import type {
  EntityDescriptor,
  EntitySchema,
  Entry,
  LocalizedText,
  Refusal,
  SchemaAttribute,
} from './types';
import { html, type SafeHtml } from './shared/html';

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
 * Plain-language description of what an attribute accepts, in the
 * interface's language: the attribute's own, or that of its items.
 *
 * @param attr its schema definition
 * @param language language tag the interface is running in
 * @returns the hint to show, or undefined when there is none
 */
export function attributeHint(
  attr: SchemaAttribute | undefined,
  language = 'en'
): string | undefined {
  return (
    resolveText(attr?.hint, language) ??
    resolveText(attr?.items?.hint, language)
  );
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

/**
 * A value written into a DN, escaped as RFC 4514 asks: `a+b@example.com`
 * becomes `a\+b@example.com`, whose `+` would otherwise join a second
 * attribute to the RDN. The inverse of `rdnValue`.
 */
export function escapeDnValue(value: string): string {
  return value
    .replace(/[\\,+"<>;=]/g, '\\$&')
    .replace(/^([ #])/, '\\$1')
    .replace(/ $/, '\\ ');
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
 * A byte count as a size to read, not to write back.
 *
 * `formatByteSize` leaves a size no decimal unit says exactly as digits —
 * 1073741824, a gibibyte, is 1.073741824 GB — because the form hands it
 * back to the server. The card hands nothing back: there it reads rounded to
 * three significant figures, 1.07 GB, and the caller keeps the exact count
 * at hand for whoever needs it. Nor does the server read it, so it is
 * written the reader's way: 1,07 Go in French.
 *
 * @param value value as stored
 * @param language interface language
 * @returns the size, and whether it says the stored count exactly
 */
export function readableByteSize(
  value: string,
  language = 'en'
): {
  text: string;
  exact: boolean;
} {
  const exact = formatByteSize(value);
  const bytes = Number(value.trim());
  if (
    exact !== value ||
    !/^\d+$/.test(value.trim()) ||
    !Number.isSafeInteger(bytes)
  )
    return { text: localSize(exact, language), exact: true };
  for (const [index, [unit, size]] of SIZE_UNITS.entries()) {
    if (bytes < size) continue;
    const quantity = Number((bytes / size).toPrecision(3));
    // Rounded up to a thousand, it reads in the unit above: 999999999 is
    // 1 GB, not 1000 MB.
    const above = SIZE_UNITS[index - 1];
    if (quantity >= 1000 && above)
      return {
        text: sizeText(
          Number((bytes / above[1]).toPrecision(3)),
          above[0],
          language
        ),
        exact: false,
      };
    return { text: sizeText(quantity, unit, language), exact: false };
  }
  return { text: exact, exact: true };
}

/**
 * Size units as a language writes them, where it does not write them the
 * English way: French counts octets.
 */
const SIZE_SYMBOLS: Record<string, Record<string, string>> = {
  fr: { TB: 'To', GB: 'Go', MB: 'Mo', KB: 'Ko', B: 'o' },
};

/** A size as the interface language writes it: 4,5 Go in French. */
function sizeText(quantity: number, unit: string, language: string): string {
  const short = language.split('-')[0].toLowerCase();
  const symbol = SIZE_SYMBOLS[short]?.[unit] ?? unit;
  return `${new Intl.NumberFormat(language).format(quantity)} ${symbol}`;
}

/**
 * A size `formatByteSize` wrote, `4.5 GB`, as the interface language writes
 * it; digits it left as they are stay so.
 */
function localSize(text: string, language: string): string {
  const sized = /^(\d+(?:\.\d+)?) (TB|GB|MB|KB|B)$/.exec(text);
  return sized ? sizeText(Number(sized[1]), sized[2], language) : text;
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
  const labelOf = (name: string): string | undefined =>
    schemaLabel(name, schema, language);
  return message.replace(
    /"([a-z][\w-]*)"|\b(field) ([a-z][\w-]*)/gi,
    (match, quoted?: string, word?: string, bare?: string) => {
      const label = labelOf(quoted ?? bare ?? '');
      if (label === undefined) return match;
      return quoted === undefined ? `${word} "${label}"` : `"${label}"`;
    }
  );
}

/** What a server says on a `500` when it says nothing about the cause. */
export const GENERIC_FAILURE =
  /^(?:\d{3}\s*)?(?:Internal Server Error|An error occurred)?\.?$/i;

/**
 * The label of an attribute the server names, spelt as the directory spells
 * it: the schema's own key may differ in case.
 *
 * @param name attribute as the server names it
 * @param schema schema of the entry
 * @param language interface language
 * @returns its label, or undefined for a name the schema does not know
 */
function schemaLabel(
  name: string,
  schema: EntitySchema,
  language: string
): string | undefined {
  const key = Object.keys(schema.attributes).find(
    candidate => candidate.toLowerCase() === name.toLowerCase()
  );
  return key === undefined
    ? undefined
    : attributeLabel(key, schema.attributes[key], language);
}

/**
 * What a failed read means for the reader.
 *
 * Only a `404` means what "no longer exists" says. A `401`, a `403` or a proxy
 * error is a different thing entirely, and telling the operator the entry is
 * gone sends them looking for the wrong problem — so every view that reads one
 * entry reads its failures here.
 *
 * A `403` is said plainly too: the server words it for an API client
 * ("Token does not have permission on this branch"), and a refusal is no
 * failure of the console to report as one.
 *
 * @param err failure raised by the API client
 * @param translator interface language
 * @returns the message to show, whether the entry is simply gone, and
 *   whether the reader was refused it
 */
export function readFailure(
  err: unknown,
  translator: Translator
): { gone: boolean; refused: boolean; message: string } {
  const status = (err as { status?: number }).status;
  const gone = status === 404;
  const refused = status === 403;
  return {
    gone,
    refused,
    message: gone
      ? translator.t('detail.notFound')
      : refused
        ? translator.t('detail.refused')
        : (err as Error).message,
  };
}

/**
 * A server refusal in the interface's language, and the attribute at fault.
 *
 * ldap-rest describes its common refusals besides wording them (see
 * {@link Refusal}): a value already used, an address outside the mail domains
 * of its organization, a change outside the caller's branches. Those are said
 * here in the console's words, the field named by its label; the attribute is
 * handed back for a form to show the message under it. Any other refusal — a
 * `4xx` but `401` — is the server's own sentence, fields named by their
 * labels, said to be the server's: its words are not the console's. What is
 * no refusal — a server failing, a session ended, an answer nobody could
 * read — is said to have gone wrong, with the server's words when they say
 * more than its status. A failure no server answered — the network, say — is
 * left as it is.
 *
 * @param err what the request threw
 * @param schema schema of the entry refused
 * @param translator interface language
 * @param name what a refusal of the caller's rights is about: the entry
 *   changed, or the organization a new or moved entry goes to, the one the
 *   server judged; without it, that refusal is said as the server worded it
 * @param field the attribute naming that organization, for a form to show
 *   the refusal of rights under it
 * @returns the message, and the attribute it is about when it is about one
 */
export function explainRefusal(
  err: unknown,
  schema: EntitySchema,
  translator: Translator,
  name?: string,
  field?: string
): { message: string; attribute?: string } {
  const { message, status, refusal } = (err ?? {}) as {
    message?: string;
    status?: number;
    refusal?: Refusal;
  };
  const { language } = translator;
  const { code, attribute, value, domains } = refusal ?? { code: '' };
  const label =
    attribute === undefined
      ? undefined
      : (schemaLabel(attribute, schema, language) ??
        attributeLabel(attribute, undefined, language));
  if (code === 'unique' && label !== undefined && value !== undefined)
    return {
      message: translator.t('refusal.unique', { field: label, value }),
      attribute,
    };
  if (code === 'mailDomain' && label !== undefined && value && domains)
    return {
      message: translator.t('refusal.domain', {
        field: label,
        domain: value.slice(value.lastIndexOf('@') + 1),
        domains: domains.join(', '),
      }),
      attribute,
    };
  if (code === 'forbidden' && name)
    return {
      message: translator.t('refusal.forbidden', { name }),
      ...(field ? { attribute: field } : {}),
    };
  const named = nameAttributes(String(message ?? ''), schema, language);
  if (typeof status !== 'number') return { message: named };
  if (status >= 400 && status < 500 && status !== 401)
    return { message: translator.t('refusal.server', { message: named }) };
  const cause = named.trim();
  return {
    message: GENERIC_FAILURE.test(cause)
      ? translator.t('app.error')
      : `${translator.t('app.error')} (${cause})`,
  };
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
 * @param language interface language, to write a date or a size in
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
  if (attr?.normalize === 'byteSize')
    return localSize(formatByteSize(value), language);
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
 * The DN an entry hangs from: everything after the first comma its own RDN
 * does not escape, so `cn=Smith\, John,ou=users` hangs from `ou=users`.
 *
 * @param dn DN of the entry
 * @returns the parent's DN, or undefined for a DN of one RDN
 */
export function parentDn(dn: string): string | undefined {
  const match = /^(?:\\.|[^,\\])*,\s*(.+)$/.exec(dn);
  return match ? match[1] : undefined;
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

/** The states said as a badge: the exceptions, Active being the norm. */
const BADGED_STATES = ['disabled', 'noAccess', 'toDelete'];

/**
 * The state an account's status names, by the key its schema gives it:
 * `enabled`, `disabled`, `noAccess`, `toDelete`.
 *
 * @param entity the account's entity
 * @param name attribute the value is held in
 * @param value the value, the DN of a state
 * @returns the key, or undefined for another attribute or an unknown state
 */
export function accountState(
  entity: EntityDescriptor | undefined,
  name: string | undefined,
  value: string
): string | undefined {
  if (!entity?.accountStatus || name !== entity.accountStatus) return undefined;
  const states = entity.schema.attributes[name]?.states ?? {};
  return Object.keys(states).find(
    state => comparableDn(states[state]) === comparableDn(value)
  );
}

/**
 * An account's state as the lists and the card show it: the exceptions as a
 * badge, which a scan down a column catches, the text kept so that colour
 * is never the only cue. Active, and a deployment's own states, stay text.
 *
 * @param state the state's key
 * @param shown its name
 * @returns the markup
 */
export function stateMarkup(
  state: string | undefined,
  shown: string
): SafeHtml {
  return state && BADGED_STATES.includes(state)
    ? html`<span class="dc-state dc-state-${state}">${shown}</span>`
    : html`${shown}`;
}

/**
 * What a nomenclature calls one of its own entries: the name its schema gives
 * the value of its main attribute — `memberRestrictedList` reads _Members
 * only_ on its own card and in its list, as it does in the selects pointing
 * at it.
 *
 * @param entity the entity the entry belongs to
 * @param name attribute the value is held in
 * @param value the value
 * @param language interface language
 * @returns the name, or undefined for another attribute or an unnamed value
 */
export function ownValueLabel(
  entity: EntityDescriptor,
  name: string,
  value: string,
  language: string
): string | undefined {
  const labels = entity.schema.entity?.valueLabels;
  if (!labels || name !== entity.mainAttribute) return undefined;
  return valueLabel(labels, value, language);
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
