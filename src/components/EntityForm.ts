/**
 * Schema-driven form.
 *
 * Every field, its type, whether it is required, what a valid value looks like
 * and even its label come from the entity schema. Nothing here knows a
 * concrete attribute, so an attribute the deployment adds appears in the form
 * on its own.
 *
 * Two things the interface it replaces got wrong are fixed here: the pattern a
 * value has to satisfy is shown *under the field*, in words, before the user
 * gets it wrong; and a long form opens as a side panel rather than a modal
 * whose Save button ends up off screen.
 *
 * @module browser/directory-console/components/EntityForm
 */

import { escapeHtml } from '../shared/dom';
import {
  attributeHint,
  attributeLabel,
  beforeToday,
  comparableDn,
  entryValue,
  escapeDnValue,
  formatByteSize,
  isDnShaped,
  parseByteSize,
  rdnValue,
  resolveText,
} from '../format';
import { hasRole, tooBroad } from '../api/ConsoleApiClient';
import { SEARCH_MINIMUM, listFailure } from './EntityList';
import type { Translator } from '../i18n';
import type {
  EntityDescriptor,
  Entry,
  ExternalMembers,
  SchemaAttribute,
} from '../types';
import { background, type Reporter } from '../shared/background';

/** An entry a pointer field may land on. */
interface PointerCandidate {
  dn: string;
  label: string;
  /** Name of the value once chosen, when the offer reads otherwise */
  token?: string;
  /** Address of a member found by searching, when it has one */
  mail?: string;
}

/** An address as typed into a member field, loosely: the server judges. */
const ADDRESS = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** Wait after a keystroke before searching, so a word is one request. */
const SEARCH_DELAY = 250;

/** A field's current value, always as a list to keep one code path. */
type Values = Record<string, string[]>;

export interface FormOptions {
  entity: EntityDescriptor;
  translator: Translator;
  /**
   * Told of a failure in work the component starts without waiting for it
   * (see `background`); the console's own reporter, or the log when absent
   */
  report?: Reporter;
  /** Existing entry when editing; absent when creating */
  entry?: Entry;
  /**
   * What a new entry starts with, when it is created from somewhere that
   * says part of it: the department of the organization card it was asked
   * for on, with that department's path to name it. Ignored when editing
   */
  preset?: Entry;
  /** Load the candidates of a pointer field */
  pointerOptions(branch: string): Promise<{ dn: string; label: string }[]>;
  /**
   * A search of a branch too large to list, or undefined when it is not: a
   * pointer into such a branch is chosen by typing, not from a select. Asked
   * again with `failed` once listing a branch failed as too broad, for a
   * search that stands in for its select if the branch can be searched
   */
  pointerSearch?(
    branch: string,
    failed?: boolean
  ): ((query: string) => Promise<PointerCandidate[]>) | undefined;
  /**
   * A search of the entries a group's members or owners may name, or
   * undefined when there is none: the field then takes DNs typed whole
   */
  memberSearch?(
    role: 'members' | 'owners'
  ): ((query: string) => Promise<PointerCandidate[]>) | undefined;
  /**
   * Where a group's members may be created outside the directory, from an
   * address no entry holds; undefined when the server takes none
   */
  externalMembers?: ExternalMembers;
  /**
   * Whether the server keeps a team mailbox's members to its mail domain:
   * the member search of one then offers accounts of that domain only, and
   * no external member
   */
  teamMailboxesKeepDomain?: boolean;
  /**
   * How a full name is written from its parts: `{givenName}` and `{surname}`
   * stand for the fields of those roles. `{givenName} {surname}` when unset
   */
  fullNameFormat?: string;
  /**
   * Whether a pointer into a branch small enough to list is chosen by typing
   * all the same: its entries, listed once, are filtered as the operator
   * types. A mail domain is known by its name, and a select of every domain
   * has the operator read them from the top
   */
  typeAhead?(branch: string): boolean;
  /**
   * DNs of the mail domains the organization being edited may be linked to,
   * when the caller may link it to those only: the ones linked by the
   * organizations above it. Undefined, or a failure, when any may be linked
   */
  linkableDomains?(): Promise<string[] | undefined>;
  /**
   * The mail domains an entry attached to an organization may hold
   * addresses at, offered once an "@" is typed into an address. A failure
   * offers none: the field stays the text box it was
   */
  mailDomains?(organization?: string): Promise<string[]>;
  /** Called with the attributes to write and those to clear */
  onSubmit(
    values: Record<string, string | string[]>,
    cleared: string[]
  ): Promise<void>;
  onCancel(): void;
}

/**
 * What a pointer select does when its branch could not be listed.
 *
 * A branch the caller may not read answers `403`, and "nothing to offer" is
 * then the truth: the select says nothing more. Any other failure is said
 * next to the field, in the words the list uses, rather than left to look
 * like an empty branch. One a search too broad for the directory ends in
 * also trades the select for a search, when the branch can be searched — a
 * branch past the directory's size limit cannot be listed, but its entries
 * can still be found by typing.
 *
 * @param err what listing the branch threw
 * @param translator interface language
 * @param search the branch's search, asked only when it would be used
 * @returns what to say, if anything, and the search to offer instead
 */
export function pointerFallback(
  err: unknown,
  translator: Translator,
  search: () => ((query: string) => Promise<PointerCandidate[]>) | undefined
): {
  message?: string;
  search?: (query: string) => Promise<PointerCandidate[]>;
} {
  if ((err as { status?: number } | null)?.status === 403) return {};
  const message = listFailure(err, translator);
  return tooBroad(err) ? { message, search: search() } : { message };
}

/** Wait before filling a live region just shown, for it to be announced. */
const ANNOUNCE_DELAY = 100;

/** A full name, where the deployment does not say how it writes one. */
const FULL_NAME_FORMAT = '{givenName} {surname}';

/** Above this many fields a modal stops being usable and becomes a panel. */
const PANEL_THRESHOLD = 8;

/**
 * Roles of the fields a long creation form shows though the schema does not
 * require them: an account's mailbox and its password, which it is created
 * with as a rule. Its aliases are not: an account rarely starts with any.
 */
const SHOWN_ROLES = [
  'primaryEmail',
  'emailQuota',
  'emailQuotaSize',
  'password',
  'passwordReset',
];

/**
 * Quote an attribute name for use inside an attribute selector.
 *
 * `CSS.escape` would do, but it does not exist outside a browser, and a
 * component that cannot be rendered in a test is a component nobody tests.
 * LDAP attribute names are letters, digits and hyphens, so quoting the two
 * characters that could close the selector early is enough.
 *
 * @param name attribute name
 * @returns the name, safe to embed between double quotes
 */
function selectorValue(name: string): string {
  return name.replace(/["\\]/g, '\\$&');
}

/** Read an entry value as a list of strings. */
function toList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map(v => String(v));
  return [String(value)];
}

export class EntityForm {
  private readonly options: FormOptions;
  private readonly fields: [string, SchemaAttribute][];
  private values: Values = {};
  /** The values the form opened with, to tell a change from none */
  private initial = '';
  /**
   * Something was typed in a field since the form opened, stored or not. A
   * pick counts through the values; what a picker's search holds does not.
   */
  private typed = false;
  private root: HTMLElement | null = null;
  /** A submission waits for the server: a second one is not sent */
  private submitting = false;
  /** The form drawn, which the panel's body outlives */
  private drawn: Element | null = null;
  private errors: Record<string, string> = {};
  /** Pointer fields chosen by searching, with their search */
  private readonly searches = new Map<
    string,
    (query: string) => Promise<PointerCandidate[]>
  >();
  /** Names of the entries picked by searching or offered, keyed by DN */
  private readonly picked = new Map<string, string>();
  /** Searched fields that also take a DN typed whole: members, owners */
  private readonly freeform = new Set<string>();
  /** Member fields that offer to create a member from a typed address */
  private readonly external = new Set<string>();
  /** Searched member fields, which a team mailbox keeps to its domain */
  private readonly memberFields = new Set<string>();
  /** Pointer fields whose entries, listed once, are filtered as typed */
  private readonly filtered = new Set<string>();
  /** Address fields completed with a domain after an "@" */
  private readonly addresses = new Set<string>();
  /** The domains an address may be completed with, by organization DN */
  private readonly addressDomains = new Map<string, Promise<string[]>>();

  constructor(options: FormOptions) {
    this.options = options;
    this.fields = this.editableFields();
    const start = options.entry ?? options.preset;
    for (const [name, attr] of this.fields) {
      this.values[name] = toList(entryValue(start, name));
      const pointer = attr.type === 'pointer' || attr.items?.type === 'pointer';
      const branch = (attr.branch || attr.items?.branch || [])[0];
      const search = pointer && branch ? this.searchOf(branch) : undefined;
      if (search) this.searches.set(name, search);
      // A group's members and owners are DNs the schema types as strings:
      // found by email address, and still typed whole by who has the DN.
      const role = (['members', 'owners'] as const).find(candidate =>
        hasRole(attr, candidate)
      );
      if (!search && role && attr.type === 'array') {
        const members = this.memberSearchOf(role);
        if (members) {
          this.searches.set(name, members);
          this.freeform.add(name);
          if (role === 'members') this.memberFields.add(name);
          if (role === 'members' && options.externalMembers)
            this.external.add(name);
        }
      }
      // The department an account is attached to is named by its path, which
      // the entry already carries: reading it costs no request, where the DN
      // alone would show the bare name of the last organization.
      const pathName = options.entity.organizationPath;
      if (search && name === options.entity.organizationLink && pathName) {
        const path = toList(entryValue(start, pathName))[0];
        if (path && this.values[name].length === 1)
          this.picked.set(this.values[name][0], path);
      }
      // An account's address, its aliases, a list's or a shared mailbox's
      // address: what the schema marks as one, whatever the attribute.
      if (
        options.mailDomains &&
        !pointer &&
        (hasRole(attr, 'primaryEmail') || hasRole(attr, 'emailAliases'))
      )
        this.addresses.add(name);
    }
    this.initial = JSON.stringify(this.values);
  }

  /**
   * Whether closing the form would lose something: a value changed, or
   * typing not yet stored, which the field keeps until it is left. A search
   * typed in a picker is no value of the form, nor is a list of suggestions
   * opened and closed.
   */
  isDirty(): boolean {
    return this.typed || JSON.stringify(this.values) !== this.initial;
  }

  /**
   * The caller's search of a branch, if it has one. A caller's function that
   * throws rather than answer undefined is read as having none: thrown from
   * the constructor or from `render()`, it would leave the form half-built —
   * what `fillPointers` guards the listing against too.
   *
   * @param branch DN the pointer must land in
   * @param failed whether listing the branch failed
   * @returns the search, or undefined
   */
  private searchOf(
    branch: string,
    failed?: boolean
  ): ((query: string) => Promise<PointerCandidate[]>) | undefined {
    try {
      return failed
        ? this.options.pointerSearch?.(branch, true)
        : this.options.pointerSearch?.(branch);
    } catch {
      return undefined;
    }
  }

  /**
   * What an address typed into a member field makes, when no entry found
   * holds it and the server creates members outside the directory: the DN
   * it creates the entry under, offered after what the search found. An
   * address at a domain of the directory belongs to an account, which the
   * server refuses to create a second time: said instead, when the search
   * found nothing to choose.
   *
   * @param name field typed into
   * @param query what was typed
   * @param found what the search answered
   * @returns the offer, the reason there is none, or undefined
   */
  private externalOffer(
    name: string,
    query: string,
    found: PointerCandidate[]
  ): PointerCandidate | string | undefined {
    const external = this.options.externalMembers;
    if (!external || !this.external.has(name) || !ADDRESS.test(query))
      return undefined;
    const address = query.toLowerCase();
    // `Jane Doe <jane@example.com>`, or the bare address of a list.
    const held = found.some(candidate => {
      const label = candidate.label.toLowerCase();
      return label === address || label.endsWith(`<${address}>`);
    });
    if (held) return undefined;
    const { translator } = this.options;
    const domain = address.slice(address.lastIndexOf('@') + 1);
    if (external.managedDomains.includes(domain))
      return translator.t('form.managedDomain', { domain });
    return {
      dn: `${external.rdnAttribute}=${escapeDnValue(query)},${external.branch}`,
      label: translator.t('form.addExternal', { address: query }),
      token: query,
    };
  }

  /**
   * The mail domain the group being edited keeps its members to, lower-cased:
   * when the server keeps team mailboxes to theirs and the group is one. Read
   * from the form, so that an address or a type just changed counts.
   *
   * @returns the domain, or undefined when members may be at any
   */
  private teamMailboxDomain(): string | undefined {
    if (!this.options.teamMailboxesKeepDomain) return undefined;
    const { attributes } = this.options.entity.schema;
    const named = (role: string): string | undefined =>
      Object.keys(attributes).find(name => hasRole(attributes[name], role));
    const value = (name: string): string[] =>
      this.values[name] ?? toList(entryValue(this.options.entry, name));
    const type = named('mailboxType');
    const mail = named('primaryEmail');
    if (!type || !mail) return undefined;
    // The value is the DN of a nomenclature entry: `cn=teamMailbox,…`.
    if (!value(type).some(dn => /^\s*cn=teamMailbox\s*,/i.test(dn)))
      return undefined;
    const address = value(mail)[0] ?? '';
    const at = address.lastIndexOf('@');
    return at > 0
      ? address
          .slice(at + 1)
          .trim()
          .toLowerCase()
      : undefined;
  }

  /** The caller's search of members or owners, guarded like `searchOf`. */
  private memberSearchOf(
    role: 'members' | 'owners'
  ): ((query: string) => Promise<PointerCandidate[]>) | undefined {
    try {
      return this.options.memberSearch?.(role);
    } catch {
      return undefined;
    }
  }

  /** Whether the caller filters a branch as typed, guarded like `searchOf`. */
  private typeAheadOf(branch: string): boolean {
    try {
      return Boolean(this.options.typeAhead?.(branch));
    } catch {
      return false;
    }
  }

  /**
   * The domains an address typed into a field may be completed with, as
   * ldap-rest's `ldap/enterpriseRules` judges it from the field's schema: a
   * `mailDomainScope` of `organization` keeps it to the domains allowed to
   * the organization the form attaches the entry to — read from the form,
   * so that a department just changed counts — and `allowSubdomains` lets
   * in the domains of the directory below one of those, as a list's
   * `lists.example.com` under `example.com`. Any other field is judged on
   * nothing, and is offered every domain.
   *
   * None when they cannot be read: the field then stays the text box it
   * was, without a word — an address is typed whole as well.
   *
   * @param name the field
   * @returns the domain names, lower-cased
   */
  private async domainsOf(name: string): Promise<string[]> {
    const attr = this.fields.find(([field]) => field === name)?.[1];
    const link = this.options.entity.organizationLink;
    const organization =
      (attr?.mailDomainScope === 'organization' &&
        link &&
        (this.values[link] ??
          toList(entryValue(this.options.entry, link)))[0]) ||
      '';
    const allowed = await this.domainNames(organization);
    if (!organization || !attr?.allowSubdomains) return allowed;
    return (await this.domainNames('')).filter(domain =>
      allowed.some(parent => domain === parent || domain.endsWith(`.${parent}`))
    );
  }

  /**
   * The caller's `mailDomains` for an organization, or for none when given
   * the empty string, asked once per form.
   */
  private domainNames(organization: string): Promise<string[]> {
    let names = this.addressDomains.get(organization);
    if (!names) {
      const ask = this.options.mailDomains;
      names = Promise.resolve()
        .then(() => (ask ? ask(organization || undefined) : []))
        .catch(() => []);
      this.addressDomains.set(organization, names);
    }
    return names;
  }

  /**
   * The domains a domain link may take, compared as DNs: those the caller's
   * `linkableDomains` names, plus those the entry already links, which the
   * server lets it keep. Undefined when any may be linked, or when the field
   * links no domain.
   *
   * @param name the field
   * @returns the DNs, or undefined
   */
  private async linkableOf(name: string): Promise<Set<string> | undefined> {
    const attr = this.fields.find(([field]) => field === name)?.[1];
    const linkable = this.options.linkableDomains;
    if (!linkable || !hasRole(attr, 'domainLink')) return undefined;
    let allowed: string[] | undefined;
    try {
      allowed = await linkable();
    } catch {
      return undefined;
    }
    if (!allowed) return undefined;
    return new Set(
      [...allowed, ...toList(entryValue(this.options.entry, name))].map(
        comparableDn
      )
    );
  }

  /**
   * Attributes a person may actually fill in: what the server computes or
   * derives is shown on the detail view, not offered for editing.
   *
   * @returns the attributes to render, in schema order
   */
  private editableFields(): [string, SchemaAttribute][] {
    const { entity, entry } = this.options;
    return Object.entries(entity.schema.attributes).filter(([name, attr]) => {
      if (attr.fixed) return false;
      if (attr.generated || attr.readOnly) return false;
      // The identifier is the RDN: chosen once, then changed through the
      // rename endpoint rather than by editing the field.
      if (name === entity.mainAttribute && entry) return false;
      return true;
    });
  }

  /** True when the form is long enough to deserve a panel rather than a modal. */
  get wantsPanel(): boolean {
    return this.fields.length > PANEL_THRESHOLD;
  }

  /** Label of an attribute: its schema label, or its name made readable. */
  private label(name: string, attr: SchemaAttribute): string {
    return attributeLabel(name, attr, this.options.translator.language);
  }

  /**
   * Render the form into a container.
   *
   * @param container element to fill
   */
  async render(container: HTMLElement): Promise<void> {
    this.root = container;
    const { translator } = this.options;
    const { shown, folded } = this.layout();
    const folds = [...folded.values()].flat().length;

    container.innerHTML = `
      <form class="dc-form" novalidate>
        <p class="dc-form-required">${escapeHtml(translator.t('form.required'))}</p>
        ${this.groupsMarkup(shown)}
        ${
          folds
            ? `<details class="dc-form-optional" data-optional>
          <summary>${escapeHtml(translator.t('form.optional', { count: folds }))}</summary>
          ${this.groupsMarkup(folded)}
        </details>`
            : ''
        }
        <div class="dc-form-actions">
          <button type="button" class="dc-button" data-cancel>${escapeHtml(
            translator.t('app.cancel')
          )}</button>
          <button type="submit" class="dc-button dc-button-primary">${escapeHtml(
            translator.t(this.options.entry ? 'app.save' : 'app.create')
          )}</button>
        </div>
      </form>`;

    this.drawn = container.querySelector('form');
    container.querySelector('form')?.addEventListener('input', event => {
      const target = event.target as Element | null;
      if (!target?.closest?.('[data-picker]')) this.typed = true;
    });
    this.bind();
    await this.fillPointers();
  }

  /**
   * Fields by group, in the order the form shows them: those shown, and
   * those folded under a summary. A long form creating an entry folds what
   * the schema does not require, so that what must be filled in fits on
   * screen — but for the mail and the password (`SHOWN_ROLES`), and the
   * schema groups they belong to, which are not split: the mailbox settings
   * stay together. Editing shows everything, as an entry may hold any of it.
   */
  private layout(): {
    shown: Map<string, [string, SchemaAttribute][]>;
    folded: Map<string, [string, SchemaAttribute][]>;
  } {
    const group = (attr: SchemaAttribute): string =>
      resolveText(attr.group, this.options.translator.language) || '';
    const prominent = (attr: SchemaAttribute): boolean =>
      Boolean(attr.required) || SHOWN_ROLES.some(role => hasRole(attr, role));
    const kept = new Set(
      this.fields
        .filter(([, attr]) => prominent(attr) && group(attr))
        .map(([, attr]) => group(attr))
    );
    const shown = (attr: SchemaAttribute): boolean =>
      prominent(attr) || kept.has(group(attr));
    const fold =
      !this.options.entry &&
      this.wantsPanel &&
      this.fields.some(([, attr]) => attr.required) &&
      this.fields.some(([, attr]) => !shown(attr));
    return fold
      ? {
          shown: this.grouped(this.fields.filter(([, attr]) => shown(attr))),
          folded: this.grouped(this.fields.filter(([, attr]) => !shown(attr))),
        }
      : { shown: this.grouped(this.fields), folded: new Map() };
  }

  /** Fields by the group their schema puts them in, in schema order. */
  private grouped(
    fields: [string, SchemaAttribute][]
  ): Map<string, [string, SchemaAttribute][]> {
    const groups = new Map<string, [string, SchemaAttribute][]>();
    for (const field of fields) {
      const group =
        resolveText(field[1].group, this.options.translator.language) || '';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(field);
    }
    return groups;
  }

  /** Markup of groups of fields, one fieldset each. */
  private groupsMarkup(
    groups: Map<string, [string, SchemaAttribute][]>
  ): string {
    return [...groups.entries()]
      .map(
        ([group, fields]) => `
          <fieldset class="dc-form-group">
            ${group ? `<legend>${escapeHtml(group)}</legend>` : ''}
            ${fields.map(([name, attr]) => this.fieldMarkup(name, attr)).join('')}
          </fieldset>`
      )
      .join('');
  }

  /** Markup of one field, chosen from its schema type. */
  private fieldMarkup(name: string, attr: SchemaAttribute): string {
    return `
      <div class="dc-field" data-field="${escapeHtml(name)}">
        ${this.fieldContent(name, attr)}
      </div>`;
  }

  /** What a field holds: redrawn alone when a select turns into a search. */
  private fieldContent(name: string, attr: SchemaAttribute): string {
    const id = `dc-field-${name}`;
    const { translator } = this.options;
    // The schema's hints speak of storage: "xGB, xMB, xKB", a notation and
    // no example, and "the DN of an entry" under a search by name, which a
    // reader is never asked to type. A size gets the console's own words,
    // a search none: its placeholder says what to type.
    // An empty password created an account nobody could sign in to, and
    // nothing said so: one is generated, and shown, once it exists.
    const hint =
      hasRole(attr, 'password') && !this.options.entry
        ? translator.t('form.passwordGenerated')
        : attr.normalize === 'byteSize'
          ? translator.t('form.sizeHint')
          : this.searches.has(name)
            ? undefined
            : attributeHint(attr, translator.language);
    const required = attr.required ? ' <span class="dc-required">*</span>' : '';
    const control = this.searches.has(name)
      ? this.pickerMarkup(name)
      : attr.type === 'array'
        ? this.tokenMarkup(name, attr)
        : attr.type === 'pointer'
          ? this.pointerMarkup(name, attr)
          : attr.type === 'boolean'
            ? this.booleanMarkup(name)
            : this.inputMarkup(name, attr);

    const pointer = attr.type === 'pointer' || attr.items?.type === 'pointer';
    const label = `<label for="${escapeHtml(id)}">${escapeHtml(this.label(name, attr))}${required}</label>`;
    const help = resolveText(attr.help, this.options.translator.language);
    // Outside the label, which would hand a click on it to the control, and
    // shown on hover only: focusable, it took the focus a panel gives its
    // first field and opened with the form. The control is described by it
    // instead (see bind), which is how a screen reader hears it.
    const heading = help
      ? `<div class="dc-label">
          ${label}
          <span class="dc-help" aria-hidden="true">?</span>
          <span class="dc-tooltip" role="tooltip" id="dc-help-${escapeHtml(name)}">${escapeHtml(help)}</span>
        </div>`
      : label;
    return `
        ${heading}
        ${control}
        ${hint ? `<p class="dc-hint" data-hint>${escapeHtml(hint)}</p>` : ''}
        ${
          this.identifierSource()?.field === name
            ? `<p class="dc-hint" id="dc-identifier-${escapeHtml(name)}" data-identifier hidden></p>`
            : ''
        }
        <p class="dc-error" id="dc-error-${escapeHtml(name)}" data-error hidden></p>
        ${
          // Why the branch offers nothing, when that is not the truth. Apart
          // from the validation message, which a save rewrites, and styled as
          // a hint without being one: a refusal hides `[data-hint]`.
          pointer
            ? `<p class="dc-hint" id="dc-note-${escapeHtml(name)}" data-pointer-note role="status" hidden></p>`
            : ''
        }`;
  }

  private inputMarkup(name: string, attr: SchemaAttribute): string {
    const value = this.values[name][0] ?? '';
    const type =
      attr.type === 'date' ? 'date' : attr.neverReturn ? 'password' : 'text';
    // A normalised size is stored as a bare byte count and edited as one, so
    // the operator counted zeros to change a quota. The field is text, and
    // the server reads `4 GB` with the same `parseByteSize` that produced the
    // number — the value shown is a value it accepts back.
    const shown =
      attr.type === 'date'
        ? EntityForm.toDateInput(value)
        : attr.normalize === 'byteSize'
          ? formatByteSize(value)
          : value;
    const input = `<input id="dc-field-${escapeHtml(name)}" name="${escapeHtml(name)}"
      type="${type}" class="dc-input" value="${escapeHtml(shown)}"
      ${attr.neverReturn ? 'autocomplete="new-password"' : this.comboboxAttributes(name)} />`;
    return this.completionMarkup(name, input);
  }

  /**
   * What makes an address box a combobox, once its domains are offered: the
   * browser's own suggestions, the addresses typed in other forms, would
   * cover the domains'.
   */
  private comboboxAttributes(name: string): string {
    if (!this.addresses.has(name)) return '';
    return `role="combobox" aria-autocomplete="list" aria-expanded="false"
      aria-controls="dc-complete-${escapeHtml(name)}" autocomplete="off"`;
  }

  /**
   * An address box with the list its domains are offered in, under it as a
   * picker's suggestions are; the box alone for any other field.
   */
  private completionMarkup(name: string, control: string): string {
    if (!this.addresses.has(name)) return control;
    return `
      <div class="dc-picker-box">
        ${control}
        <ul class="dc-picker-results" id="dc-complete-${escapeHtml(name)}"
          role="listbox" data-completions hidden></ul>
      </div>`;
  }

  private booleanMarkup(name: string): string {
    const { translator } = this.options;
    const value = (this.values[name][0] ?? '').toUpperCase();
    return `<select id="dc-field-${escapeHtml(name)}" name="${escapeHtml(name)}" class="dc-input">
      <option value="">${escapeHtml(translator.t('form.none'))}</option>
      <option value="TRUE"${value === 'TRUE' ? ' selected' : ''}>${escapeHtml(
        translator.t('form.true')
      )}</option>
      <option value="FALSE"${value === 'FALSE' ? ' selected' : ''}>${escapeHtml(
        translator.t('form.false')
      )}</option>
    </select>`;
  }

  private pointerMarkup(name: string, attr: SchemaAttribute): string {
    const { translator } = this.options;
    const current = this.values[name][0] ?? '';
    const branch = (attr.branch || [])[0] || '';
    // Inert until `fillPointers` has answered: with the empty choice as the
    // only selectable option, the click that opens the list picks that choice
    // and silently clears the value the entry holds.
    return `<select id="dc-field-${escapeHtml(name)}" name="${escapeHtml(name)}"
      class="dc-input" data-pointer="${escapeHtml(branch)}"
      ${attr.required ? 'data-required="true" ' : ''}disabled aria-busy="true">
      <option value="" disabled>${escapeHtml(translator.t('form.choose'))}</option>
      ${current ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>` : ''}
    </select>`;
  }

  /**
   * A pointer into a branch too large to list: the entries chosen, as tokens,
   * and a box that suggests entries as the operator types. A single-valued
   * attribute holds one token, which a new choice replaces.
   */
  private pickerMarkup(name: string): string {
    const { translator } = this.options;
    const listId = `dc-picker-${name}`;
    return `
      <div class="dc-tokens dc-picker" data-picker="${escapeHtml(name)}">
        <ul class="dc-token-list">${this.pickerItems(name)}</ul>
        <div class="dc-picker-box">
          <input id="dc-field-${escapeHtml(name)}" type="search" class="dc-input"
            data-picker-input autocomplete="off" role="combobox"
            aria-autocomplete="list" aria-expanded="false"
            aria-controls="${escapeHtml(listId)}"
            placeholder="${escapeHtml(
              this.filtered.has(name)
                ? translator.t('form.filterPointer')
                : this.freeform.has(name)
                  ? translator.t('form.searchMember', { count: SEARCH_MINIMUM })
                  : translator.t('form.searchPointer', {
                      count: SEARCH_MINIMUM,
                    })
            )}" />
          <ul class="dc-picker-results" id="${escapeHtml(listId)}"
            role="listbox" hidden></ul>
        </div>
      </div>`;
  }

  private pickerItems(name: string): string {
    const { translator } = this.options;
    return this.values[name]
      .map((dn, index) => {
        const shown = this.picked.get(dn) || rdnValue(dn);
        return `
      <li class="dc-token">
        <span title="${escapeHtml(dn)}">${escapeHtml(shown)}</span>
        <button type="button" data-remove="${index}"
          aria-label="${escapeHtml(
            translator.t('form.removeValue', { value: shown })
          )}">×</button>
      </li>`;
      })
      .join('');
  }

  /**
   * A multi-valued attribute as a list of removable tokens plus one input.
   * The instruction is explicit — a text box that silently swallows Enter is
   * the surest way to lose a value.
   */
  private tokenMarkup(name: string, attr: SchemaAttribute): string {
    const { translator } = this.options;
    const isPointer = attr.items?.type === 'pointer';
    const branch = (attr.items?.branch || [])[0] || '';
    // The id the field's label points at: without it, a screen reader names
    // the box by its placeholder, and the select by nothing at all.
    const id = `dc-field-${name}`;
    return `
      <div class="dc-tokens" data-tokens="${escapeHtml(name)}">
        <ul class="dc-token-list">${this.tokenItems(name)}</ul>
        ${
          isPointer
            ? `<select id="${escapeHtml(id)}" class="dc-input" data-token-input data-pointer="${escapeHtml(branch)}"
                 ${attr.required ? 'data-required="true" ' : ''}disabled aria-busy="true">
                 <option value="" disabled>${escapeHtml(translator.t('form.choose'))}</option>
               </select>`
            : this.completionMarkup(
                name,
                `<input id="${escapeHtml(id)}" class="dc-input" data-token-input type="text"
                 placeholder="${escapeHtml(translator.t('form.addValue'))}"
                 ${this.comboboxAttributes(name)} />`
              )
        }
      </div>`;
  }

  private tokenItems(name: string): string {
    const { translator } = this.options;
    const attr = this.fields.find(([field]) => field === name)?.[1];
    // A DN is named the way its select offers it, the DN kept for the title.
    const pointer = attr?.items?.type === 'pointer';
    return this.values[name]
      .map((value, index) => {
        const shown = pointer
          ? this.picked.get(value) || rdnValue(value)
          : value;
        // Named after what it removes: a row of "Remove this value" buttons
        // cannot be told apart by a screen reader, nor by voice.
        return `
      <li class="dc-token">
        <span title="${escapeHtml(value)}">${escapeHtml(shown)}</span>
        <button type="button" data-remove="${index}"
          aria-label="${escapeHtml(
            translator.t('form.removeValue', { value: shown })
          )}">×</button>
      </li>`;
      })
      .join('');
  }

  /** Wire the controls up to the value map. */
  private bind(): void {
    const root = this.root;
    if (!root) return;

    root.querySelector('[data-cancel]')?.addEventListener('click', () => {
      this.options.onCancel();
    });

    root.querySelector('form')?.addEventListener('submit', event => {
      event.preventDefault();
      background(() => this.submit(), 'submit', this.options.report);
    });

    this.bindFullName(root);
    const identifier = this.identifierSource();

    for (const [name, attr] of this.fields) {
      const wrapper = root.querySelector<HTMLElement>(
        `[data-field="${selectorValue(name)}"]`
      );
      if (!wrapper) continue;
      if (attr.help)
        wrapper
          .querySelector(`[id="dc-field-${selectorValue(name)}"]`)
          ?.setAttribute('aria-describedby', `dc-help-${name}`);

      if (this.searches.has(name)) {
        this.bindPicker(name, wrapper);
        continue;
      }
      if (attr.type === 'array') {
        this.bindTokens(name, wrapper);
        continue;
      }
      const control = wrapper.querySelector<
        HTMLInputElement | HTMLSelectElement
      >('.dc-input');
      const store = (raw: string): void => {
        this.values[name] =
          raw === ''
            ? []
            : [attr.type === 'date' ? EntityForm.toDirectoryDate(raw) : raw];
      };
      control?.addEventListener('change', () => store(control.value));
      const preview =
        control && identifier?.field === name
          ? this.bindIdentifier(name, attr, control, wrapper)
          : undefined;
      if (control && this.addresses.has(name)) {
        // A completion writes the box without the `change` a person's
        // typing ends in: the value is stored as it is written.
        const completion = this.bindCompletion(
          name,
          control as HTMLInputElement,
          wrapper,
          value => {
            store(value);
            preview?.(value);
          }
        );
        control.addEventListener('keydown', event => {
          completion?.key(event as KeyboardEvent);
        });
      }
    }
  }

  /**
   * Write the full name from the given name and the surname, as typed, for
   * as long as nobody wrote it otherwise: while it is empty, or holds what
   * the parts last made of it — on an entry as on a new one, so that a
   * surname changed carries the full name along. The fields are found by
   * their schema roles; the order is the deployment's (`fullNameFormat`).
   * On a new entry, the common name follows the full name in turn.
   */
  private bindFullName(root: HTMLElement): void {
    const plain = (role: string): string | undefined =>
      this.fields.find(
        ([name, attr]) =>
          hasRole(attr, role) &&
          attr.type === 'string' &&
          !this.searches.has(name)
      )?.[0];
    const display = plain('displayName');
    if (!display) return;
    const control = (name: string): HTMLInputElement | null =>
      root.querySelector<HTMLInputElement>(
        `[data-field="${selectorValue(name)}"] .dc-input`
      );
    const target = control(display);
    if (!target) return;
    const common = this.bindCommonName(display, target, control);
    const parts = [plain('givenName'), plain('surname')];
    if (parts.some(name => !name)) return;
    const [given, surname] = parts.map(name => control(name!));
    if (!given || !surname) return;
    const compose = (givenName: string, surnameValue: string): string =>
      givenName && surnameValue
        ? EntityForm.fullName(
            this.options.fullNameFormat || FULL_NAME_FORMAT,
            givenName,
            surnameValue
          )
        : '';
    let written = compose(
      (this.values[parts[0]!][0] || '').trim(),
      (this.values[parts[1]!][0] || '').trim()
    );
    const follow = (): void => {
      if (target.value !== '' && target.value !== written) return;
      written = compose(given.value.trim(), surname.value.trim());
      target.value = written;
      this.values[display] = written ? [written] : [];
      common?.(written);
    };
    given.addEventListener('input', follow);
    surname.addEventListener('input', follow);
  }

  /**
   * Write the common name from the full name, on a new entry, for as long
   * as nobody wrote it otherwise. The member pickers match names through
   * it: an account created here, with none, was not found by its full name.
   * No role marks the field; it is the one named `cn`. An entry's own is
   * left alone.
   *
   * @param display the full name field
   * @param source its box
   * @param control the box of a field
   * @returns what a full name written by its parts is handed to
   */
  private bindCommonName(
    display: string,
    source: HTMLInputElement,
    control: (name: string) => HTMLInputElement | null
  ): ((fullName: string) => void) | undefined {
    if (this.options.entry) return undefined;
    const name = this.fields.find(
      ([field, attr]) =>
        field !== display &&
        field.toLowerCase() === 'cn' &&
        attr.type === 'string' &&
        !this.searches.has(field)
    )?.[0];
    const target = name ? control(name) : null;
    if (!name || !target) return undefined;
    let written = '';
    const follow = (fullName: string): void => {
      if (target.value !== '' && target.value !== written) return;
      written = fullName.trim();
      target.value = written;
      this.values[name] = written ? [written] : [];
    };
    source.addEventListener('input', () => follow(source.value));
    return follow;
  }

  /**
   * Where a new entry's identifier comes from, when the server generates it
   * (`generatedFrom`): the field it is taken from, and the rule. The form
   * has no identifier field then, and the operator met it on the card only.
   */
  private identifierSource():
    | {
        field: string;
        rule: NonNullable<SchemaAttribute['generatedFrom']>;
      }
    | undefined {
    const { entity, entry } = this.options;
    if (entry) return undefined;
    const main = entity.schema.attributes[entity.mainAttribute];
    const rule = main?.generated ? main.generatedFrom : undefined;
    if (!rule || !this.fields.some(([name]) => name === rule.attribute))
      return undefined;
    return { field: rule.attribute, rule };
  }

  /**
   * The identifier the server generates from a value, as ldap-rest does:
   * the `extract` group (or the whole match), in lower case, without what
   * `strip` names. A collision is the server's to settle.
   *
   * @param rule the identifier's `generatedFrom`
   * @param value the value it is generated from
   * @returns the identifier, or undefined when none comes out
   */
  static generatedIdentifier(
    rule: NonNullable<SchemaAttribute['generatedFrom']>,
    value: string
  ): string | undefined {
    let id = value;
    try {
      if (rule.extract) {
        const match = new RegExp(rule.extract).exec(id);
        if (match) id = match[1] !== undefined ? match[1] : match[0];
      }
      if (rule.lowercase) id = id.toLowerCase();
      if (rule.strip) id = id.replace(new RegExp(rule.strip, 'g'), '');
    } catch {
      return undefined; // A pattern the browser cannot compile
    }
    return id || undefined;
  }

  /**
   * Show, under the field a new entry's identifier is generated from, the
   * identifier it will get, once the field holds a value it accepts.
   *
   * @param name the field
   * @param attr its schema definition
   * @param control its box
   * @param wrapper the field, holding the line
   * @returns what a value written into the box is handed to
   */
  private bindIdentifier(
    name: string,
    attr: SchemaAttribute,
    control: HTMLInputElement | HTMLSelectElement,
    wrapper: HTMLElement
  ): ((value: string) => void) | undefined {
    const line = wrapper.querySelector<HTMLElement>('[data-identifier]');
    const source = this.identifierSource();
    if (!line || !source) return undefined;
    const { entity, translator } = this.options;
    const main = entity.schema.attributes[entity.mainAttribute];
    let accepts: RegExp | undefined;
    try {
      accepts = attr.test ? new RegExp(attr.test) : undefined;
    } catch {
      accepts = undefined;
    }
    const described = control.getAttribute?.('aria-describedby');
    control.setAttribute(
      'aria-describedby',
      [described, `dc-identifier-${name}`].filter(Boolean).join(' ')
    );
    const show = (value: string): void => {
      const typed = value.trim();
      const id =
        typed && (!accepts || accepts.test(typed))
          ? EntityForm.generatedIdentifier(source.rule, typed)
          : undefined;
      line.hidden = !id;
      line.textContent = id
        ? [
            translator.t('form.identifierPreview', {
              label: this.label(entity.mainAttribute, main),
              id,
            }),
            source.rule.onCollision === 'suffix'
              ? translator.t('form.identifierTaken')
              : '',
          ]
            .filter(Boolean)
            .join(' ')
        : '';
    };
    control.addEventListener('input', () => show(control.value));
    return show;
  }

  /**
   * A full name written from its parts: `{givenName}` and `{surname}` in the
   * format replaced by them, spaces collapsed.
   */
  static fullName(format: string, givenName: string, surname: string): string {
    return format
      .replace(/\{(givenName|surname)\}/g, (_match, part: string) =>
        part === 'givenName' ? givenName : surname
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  private bindPicker(name: string, wrapper: HTMLElement): void {
    const search = this.searches.get(name);
    const input = wrapper.querySelector<HTMLInputElement>(
      '[data-picker-input]'
    );
    const results = wrapper.querySelector<HTMLElement>('.dc-picker-results');
    const tokens = wrapper.querySelector<HTMLElement>('.dc-token-list');
    if (!search || !input || !results || !tokens) return;
    const { translator } = this.options;
    // From the schema. It was read from a `data-multiple` the picker carried,
    // on the field this is handed, which never had it: every picker read as
    // single-valued, and choosing a second delegate replaced the first.
    const multiple =
      this.fields.find(([field]) => field === name)?.[1].type === 'array';
    // Entries listed once and filtered here answer at once, from the first
    // letter: no request to spare, and nothing to say while waiting.
    const filtered = this.filtered.has(name);
    const minimum = filtered ? 1 : SEARCH_MINIMUM;
    let candidates: PointerCandidate[] = [];
    let active = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A search answered after a later keystroke is dropped, like the list's.
    let generation = 0;

    const redraw = (): void => {
      tokens.innerHTML = this.pickerItems(name);
    };
    const close = (): void => {
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    };
    const message = (text: string): void => {
      candidates = [];
      results.innerHTML = `<li class="dc-picker-note">${escapeHtml(text)}</li>`;
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    const paint = (): void => {
      if (candidates.length === 0) return message(translator.t('list.noMatch'));
      results.innerHTML = candidates
        .map(
          (candidate, index) => `
        <li id="dc-picker-${escapeHtml(name)}-${index}" role="option"
          class="dc-picker-option${index === active ? ' dc-active' : ''}"
          aria-selected="${index === active ? 'true' : 'false'}"
          data-candidate="${index}" title="${escapeHtml(candidate.dn)}">${escapeHtml(
            candidate.label
          )}</li>`
        )
        .join('');
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      // The last fields of a long form sit above the sticky actions: bring
      // the suggestions into the scrolled panel rather than under the buttons.
      results.scrollIntoView?.({ block: 'nearest' });
      if (active >= 0)
        input.setAttribute(
          'aria-activedescendant',
          `dc-picker-${name}-${active}`
        );
    };
    // A DN typed whole, where the field takes one: added as it is, the
    // directory being the judge of whether it names an entry.
    const typedDn = (): string | undefined => {
      const value = input.value.trim();
      return this.freeform.has(name) && isDnShaped(value) ? value : undefined;
    };
    const addTyped = (dn: string): void => {
      const held = this.values[name].some(
        value => value.toLowerCase() === dn.toLowerCase()
      );
      if (!held) this.values[name].push(dn);
      input.value = '';
      close();
      redraw();
    };
    const choose = (candidate: PointerCandidate): void => {
      this.picked.set(candidate.dn, candidate.token ?? candidate.label);
      if (multiple) {
        // DNs compare without regard to case, as a DN typed whole does.
        const held = this.values[name].some(
          value => value.toLowerCase() === candidate.dn.toLowerCase()
        );
        if (!held) this.values[name].push(candidate.dn);
      } else this.values[name] = [candidate.dn];
      input.value = '';
      close();
      redraw();
    };

    const run = (query: string, ticket: number): void => {
      if (!filtered) message(translator.t('form.searching'));
      Promise.all([search(query), this.linkableOf(name)])
        .then(([found, linkable]) => {
          if (ticket !== generation) return;
          // What is already chosen is not offered again.
          const chosen = (dn: string): boolean =>
            this.values[name].some(
              value => value.toLowerCase() === dn.toLowerCase()
            );
          // A team mailbox takes the accounts of its domain only, and no
          // external member: what the server would refuse is not offered.
          const domain = this.memberFields.has(name)
            ? this.teamMailboxDomain()
            : undefined;
          const atDomain = (candidate: PointerCandidate): boolean =>
            !domain ||
            candidate.mail
              ?.slice(candidate.mail.lastIndexOf('@') + 1)
              .toLowerCase() === domain;
          // Nor a domain no organization above links, to a caller below the
          // top: the server refuses them that link.
          const linked = (candidate: PointerCandidate): boolean =>
            !linkable || linkable.has(comparableDn(candidate.dn));
          candidates = found.filter(
            candidate =>
              !chosen(candidate.dn) && atDomain(candidate) && linked(candidate)
          );
          if (
            linkable &&
            candidates.length === 0 &&
            found.some(candidate => !chosen(candidate.dn))
          )
            return message(translator.t('form.notLinkedAbove'));
          if (
            domain &&
            candidates.length === 0 &&
            (found.some(candidate => !chosen(candidate.dn)) ||
              ADDRESS.test(query))
          )
            return message(translator.t('form.otherDomain', { domain }));
          const outside = domain
            ? undefined
            : this.externalOffer(name, query, found);
          if (typeof outside === 'string' && candidates.length === 0)
            return message(outside);
          if (typeof outside === 'object' && !chosen(outside.dn))
            candidates.push(outside);
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
      if (typedDn()) return message(translator.t('form.addDn'));
      if (query.length < minimum) {
        if (query.length === 0) close();
        else
          message(translator.t('list.searchGuard', { count: SEARCH_MINIMUM }));
        return;
      }
      if (filtered) run(query, ticket);
      else timer = setTimeout(() => run(query, ticket), SEARCH_DELAY);
    });

    input.addEventListener('keydown', event => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Escape') {
        if (!results.hidden) event.preventDefault();
        close();
        return;
      }
      const dn = typedDn();
      if (key === 'Enter' && dn) {
        event.preventDefault();
        addTyped(dn);
        return;
      }
      // The arrow opens a list read whole, as it opens a select: who does
      // not know the names reads them rather than guess one.
      if (filtered && key === 'ArrowDown' && results.hidden) {
        event.preventDefault();
        run(input.value.trim(), ++generation);
        return;
      }
      if (results.hidden || candidates.length === 0) {
        // Enter in an empty search must not submit the whole form.
        if (key === 'Enter') event.preventDefault();
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
      // A DN typed and left in the box is one the operator meant to add, as
      // a value left in a token box is.
      const dn = typedDn();
      if (dn) addTyped(dn);
      else close();
    });

    tokens.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-remove]'
      );
      if (!button) return;
      this.values[name].splice(Number(button.dataset.remove), 1);
      redraw();
    });
  }

  private bindTokens(name: string, wrapper: HTMLElement): void {
    const redraw = (): void => {
      const list = wrapper.querySelector('.dc-token-list');
      if (list) list.innerHTML = this.tokenItems(name);
    };

    wrapper.addEventListener('click', event => {
      // The listener sits on the field itself, which outlives its content:
      // once a select that could not be filled became a search, the search
      // removes its own tokens, and one click must not remove two values.
      if (this.searches.has(name)) return;
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-remove]'
      );
      if (!button) return;
      this.values[name].splice(Number(button.dataset.remove), 1);
      redraw();
    });

    const input = wrapper.querySelector<HTMLInputElement | HTMLSelectElement>(
      '[data-token-input]'
    );
    if (!input) return;

    const add = (value: string): void => {
      const trimmed = value.trim();
      if (!trimmed || this.values[name].includes(trimmed)) return;
      this.values[name].push(trimmed);
      input.value = '';
      redraw();
    };

    // By its tag rather than `instanceof HTMLSelectElement`, which does not
    // exist outside a browser: see `selectorValue`.
    if (input.tagName === 'SELECT') {
      input.addEventListener('change', () => add(input.value));
    } else {
      const completion = this.addresses.has(name)
        ? this.bindCompletion(name, input as HTMLInputElement, wrapper)
        : undefined;
      input.addEventListener('keydown', event => {
        // A domain offered and chosen with the arrows takes the key first;
        // with none chosen, Enter adds what is typed, as it always did.
        if (completion?.key(event as KeyboardEvent)) return;
        if ((event as KeyboardEvent).key !== 'Enter') return;
        event.preventDefault();
        add(input.value);
        completion?.close();
      });
      // A value typed and left in the box is a value the user meant to add.
      input.addEventListener('blur', () => add(input.value));
    }
  }

  /** Load the candidates of every pointer control. */
  private async fillPointers(): Promise<void> {
    const root = this.root;
    if (!root) return;
    const selects = root.querySelectorAll<HTMLSelectElement>('[data-pointer]');
    await Promise.all(
      Array.from(selects).map(async select => {
        const branch = select.dataset.pointer;
        if (!branch) return;
        // A branch the caller may not read answers 403, and the form is
        // awaited by a caller that does not await it back: the rejection
        // would surface as an unhandled one and leave the whole form
        // half-built. The select keeps the value the entry already holds and
        // offers nothing else, which is what an unreadable branch means.
        // Any other failure keeps it so too, and says why (`pointerFallback`).
        let options: { dn: string; label: string }[];
        try {
          options = await this.options.pointerOptions(branch);
        } catch (err) {
          options = [];
          const fallback = pointerFallback(err, this.options.translator, () =>
            this.searchOf(branch, true)
          );
          if (fallback.message && this.fallBack(select, fallback)) return;
        }
        // In the order a person looks for them, not the order the server
        // found them in: the organization walk is breadth-first, which put a
        // department after every node of the level above it.
        options.sort((a, b) =>
          a.label.localeCompare(b.label, this.options.translator.language, {
            sensitivity: 'base',
            numeric: true,
          })
        );
        if (
          options.length > 0 &&
          this.typeAheadOf(branch) &&
          this.filterInstead(select, options)
        )
          return;
        const current = select.value;
        // The empty choice is offered only when taking it means something: on
        // a branch that answered nothing it would drop the value the entry
        // holds and put nothing in its place, and on a required field the form
        // refuses to save it.
        const empty = options.length > 0 && select.dataset.required !== 'true';
        select.innerHTML =
          `<option value=""${empty ? '' : ' disabled'}>` +
          `${escapeHtml(this.options.translator.t('form.choose'))}</option>` +
          options
            .map(
              option =>
                `<option value="${escapeHtml(option.dn)}"${
                  option.dn === current ? ' selected' : ''
                }>${escapeHtml(option.label)}</option>`
            )
            .join('');
        if (current && !options.some(option => option.dn === current)) {
          // Keep a value the directory holds but the branch listing missed,
          // rather than silently dropping it on the next save.
          select.insertAdjacentHTML(
            'beforeend',
            `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`
          );
        }
        select.value = current;
        select.disabled = false;
        select.removeAttribute('aria-busy');
        if ('tokenInput' in select.dataset) this.nameTokens(select, options);
      })
    );
  }

  /**
   * Name the values a token select holds the way it offers them: the tokens
   * are drawn before the options are known, by the RDN of each DN.
   *
   * @param select the select of a multi-valued pointer
   * @param options what it offers
   */
  private nameTokens(
    select: HTMLSelectElement,
    options: { dn: string; label: string }[]
  ): void {
    for (const option of options) this.picked.set(option.dn, option.label);
    const field = select.closest<HTMLElement>('[data-tokens]');
    const name = field?.dataset.tokens;
    const list = field?.querySelector('.dc-token-list');
    if (name && list) list.innerHTML = this.tokenItems(name);
  }

  /**
   * Trade a pointer select for a picker that filters what it would have
   * offered, as the operator types. The candidates are the ones just listed,
   * so the picker asks nothing more of the server; a branch that could not
   * be listed, or listed empty, keeps its select, and whatever it said about
   * it (`pointerFallback`).
   *
   * @param select the select of the pointer
   * @param options what it would have offered, sorted
   * @returns true when the select was replaced, and is not to be filled
   */
  private filterInstead(
    select: HTMLSelectElement,
    options: { dn: string; label: string }[]
  ): boolean {
    const field = select.closest?.<HTMLElement>('[data-field]');
    const name = field?.dataset.field;
    const attr = this.fields.find(([candidate]) => candidate === name)?.[1];
    if (!field || !name || !attr) return false;
    // The values held are named the way the list names them, not by RDN.
    for (const option of options) this.picked.set(option.dn, option.label);
    this.filtered.add(name);
    this.searches.set(name, query => {
      const text = query.trim().toLowerCase();
      return Promise.resolve(
        options.filter(option => option.label.toLowerCase().includes(text))
      );
    });
    field.innerHTML = this.fieldContent(name, attr);
    this.bindPicker(name, field);
    return true;
  }

  /**
   * Offer the domains an address may be at, once an "@" is typed into it:
   * a list under the box, as a picker's, that completes the address with
   * the domain chosen in it.
   *
   * The first line is chosen, as a picker's is: Enter takes it. Nothing
   * else would have: "jane@" and Enter left "jane@", and the form refused
   * it. An address typed whole, its domain among those offered, opens no
   * list, and Enter goes on adding it or submitting the form. Up and Down
   * move through the list, Escape closes it, and leaving the box closes it
   * too.
   *
   * @param name the field
   * @param input its text box
   * @param wrapper the field, holding the list
   * @param written told of an address the list completed
   * @returns what the box's own keys are first handed to, and how to close
   *   the list; undefined when the field has no list
   */
  private bindCompletion(
    name: string,
    input: HTMLInputElement,
    wrapper: HTMLElement,
    written?: (value: string) => void
  ): { key(event: KeyboardEvent): boolean; close(): void } | undefined {
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
      results.innerHTML = suggestions
        .map(
          (suggestion, index) => `
        <li id="dc-complete-${escapeHtml(name)}-${index}" role="option"
          class="dc-picker-option${index === active ? ' dc-active' : ''}"
          aria-selected="${index === active ? 'true' : 'false'}"
          data-suggestion="${index}">${escapeHtml(suggestion)}</li>`
        )
        .join('');
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
      const typed = value.slice(at + 1).toLowerCase();
      background(
        () =>
          this.domainsOf(name).then(domains => {
            if (ticket !== generation) return;
            // A domain typed whole needs no offer, nor the longer ones it is
            // part of; otherwise, those the typed text begins come first, then
            // those it is part of.
            const matching = domains.includes(typed)
              ? []
              : domains.filter(domain => domain.includes(typed));
            const starts = matching.filter(domain => domain.startsWith(typed));
            suggestions = [
              ...starts,
              ...matching.filter(domain => !starts.includes(domain)),
            ].map(domain => `${local}@${domain}`);
            active = 0;
            if (suggestions.length === 0) close();
            else paint();
          }),
        'domainsOf',
        this.options.report
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

  /**
   * Say why a pointer select could not be filled, and turn it into a search
   * when there is one.
   *
   * @param select the select that could not be filled
   * @param fallback what `pointerFallback` decided
   * @returns true when the select was replaced, and is not to be filled
   */
  private fallBack(
    select: HTMLSelectElement,
    fallback: {
      message?: string;
      search?: (query: string) => Promise<PointerCandidate[]>;
    }
  ): boolean {
    const field = select.closest<HTMLElement>('[data-field]');
    const name = field?.dataset.field;
    const attr = this.fields.find(([candidate]) => candidate === name)?.[1];
    if (!field || !name || !attr) return false;
    const replaced = Boolean(fallback.search);
    if (fallback.search) {
      this.searches.set(name, fallback.search);
      field.innerHTML = this.fieldContent(name, attr);
      this.bindPicker(name, field);
    }
    const note = field.querySelector<HTMLElement>('[data-pointer-note]');
    if (note && fallback.message) {
      const message = fallback.message;
      // Shown empty first, and filled a moment later: a live region is
      // announced when its text changes, not when it appears already filled
      // — and after a switch to a search it has only just been inserted.
      // The control points at it as well, for whoever tabs to it later.
      note.hidden = false;
      setTimeout(() => {
        note.textContent = message;
      }, ANNOUNCE_DELAY);
      field
        .querySelector('[data-pointer], [data-picker-input]')
        ?.setAttribute('aria-describedby', note.id);
    }
    return replaced;
  }

  /**
   * Whether the form is still in the page, rather than closed or replaced
   * while the server answered. One never drawn counts as shown.
   */
  isShown(): boolean {
    return this.drawn?.isConnected !== false;
  }

  /** Validate, then hand the values to the caller. */
  private async submit(): Promise<void> {
    // A second Enter sent a second creation, the server numbering the
    // identifier of the new one: two accounts for one person.
    if (this.submitting || !this.validate()) return;
    const values: Record<string, string | string[]> = {};
    const cleared: string[] = [];
    for (const [name, attr] of this.fields) {
      const list = this.values[name];
      const before = toList(entryValue(this.options.entry, name));
      if (list.length === 0) {
        if (before.length > 0) cleared.push(name);
        continue;
      }
      if (
        this.options.entry &&
        list.length === before.length &&
        list.every((value, index) => value === before[index])
      )
        continue;
      values[name] = attr.type === 'array' ? list : list[0];
    }
    this.submitting = true;
    try {
      await this.options.onSubmit(values, cleared);
    } finally {
      this.submitting = false;
    }
  }

  /**
   * Check what the schema says before the round trip. The server checks again;
   * this only spares the user a request to be told what the hint already said.
   *
   * @returns true when every field passes
   */
  private validate(): boolean {
    this.errors = {};
    for (const [name, attr] of this.fields) {
      const list = this.values[name];
      if (attr.required && list.length === 0) {
        this.errors[name] = this.options.translator.t('form.fieldRequired');
        continue;
      }
      const refused = this.ruleProblem(name, attr, list);
      if (refused) {
        this.errors[name] = refused;
        continue;
      }
      const pattern = attr.test || attr.items?.test;
      if (!pattern) continue;
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        continue; // A pattern the browser cannot compile is the server's business
      }
      const bad = list.find(value => !regex.test(value));
      if (bad !== undefined)
        this.errors[name] =
          (attr.normalize === 'byteSize'
            ? this.options.translator.t('form.notSize')
            : attributeHint(attr, this.options.translator.language)) ||
          this.options.translator.t('form.badFormat', {
            value: bad,
            pattern: String(pattern),
          });
    }
    this.showErrors();
    return Object.keys(this.errors).length === 0;
  }

  /**
   * The name the form gives an entry one of its pointer fields offered, or
   * found by a search: an organization by its path, as the field showed it.
   *
   * @param dn the entry pointed at
   * @returns its name, or undefined when the form never showed it
   */
  pointerName(dn: string): string | undefined {
    for (const [candidate, name] of this.picked)
      if (comparableDn(candidate) === comparableDn(dn)) return name;
    return undefined;
  }

  /**
   * Show the server's refusal of a field under it, as a refusal of the form's
   * own is shown: the server checks what the form cannot, a value already
   * used elsewhere, and a toast saying so out of sight of the field left the
   * operator guessing which one to correct. The next save clears it.
   *
   * @param attribute the attribute refused, as the server names it
   * @param message what to show under it
   * @returns false when the form has no such field, for the caller to say it
   *   elsewhere
   */
  refuse(attribute: string, message: string): boolean {
    const name = this.fields
      .map(([candidate]) => candidate)
      .find(candidate => candidate.toLowerCase() === attribute.toLowerCase());
    if (
      name === undefined ||
      !this.root?.querySelector(`[data-field="${selectorValue(name)}"]`)
    )
      return false;
    this.errors = { [name]: message };
    this.showErrors();
    return true;
  }

  /**
   * Draw {@link errors} under their fields, clearing the others, and take
   * the focus to the first field refused.
   */
  private showErrors(): void {
    const root = this.root;
    if (root) {
      for (const [name] of this.fields) {
        const field = root.querySelector<HTMLElement>(
          `[data-field="${selectorValue(name)}"]`
        );
        const holder = field?.querySelector<HTMLElement>('[data-error]');
        if (!holder) continue;
        const message = this.errors[name];
        holder.textContent = message || '';
        holder.hidden = !message;
        // The refusal repeats the hint, so showing both says the same thing
        // twice, once in grey and once in red.
        const hint = field?.querySelector<HTMLElement>('[data-hint]');
        if (hint) hint.hidden = Boolean(message);
        this.markInvalid(field, name, holder.id, message);
        // A refusal folded out of sight would leave the form refusing to
        // save without a word.
        const fold = message
          ? field?.closest<HTMLDetailsElement>('[data-optional]')
          : null;
        if (fold) fold.open = true;
      }
      const { shown, folded } = this.layout();
      const first = [...shown.values(), ...folded.values()]
        .flat()
        .map(([name]) => name)
        .find(name => this.errors[name]);
      if (first) {
        const field = root.querySelector<HTMLElement>(
          `[data-field="${selectorValue(first)}"]`
        );
        field?.scrollIntoView({ block: 'center' });
        // On it, rather than left on the button: a screen reader then says
        // the field, that it is invalid, and why.
        field
          ?.querySelector<HTMLElement>(
            `[id="dc-field-${selectorValue(first)}"]`
          )
          ?.focus({ preventScroll: true });
      }
    }
  }

  /**
   * Say a field's refusal to assistive technology as well as on screen: its
   * control is marked invalid, and described by the message, besides what
   * already describes it.
   *
   * @param field the field's wrapper
   * @param name attribute name
   * @param error id of the field's error message
   * @param message the refusal, or undefined once the field passes
   */
  private markInvalid(
    field: HTMLElement | null | undefined,
    name: string,
    error: string,
    message: string | undefined
  ): void {
    const control = field?.querySelector<HTMLElement>(
      `[id="dc-field-${selectorValue(name)}"]`
    );
    if (!control) return;
    const described = (control.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter(id => id && id !== error);
    if (message) {
      control.setAttribute('aria-invalid', 'true');
      described.push(error);
    } else control.removeAttribute('aria-invalid');
    if (described.length)
      control.setAttribute('aria-describedby', described.join(' '));
    else control.removeAttribute('aria-describedby');
  }

  /**
   * What the server's own rules refuse in a field, where the schema marks the
   * rule rather than spelling it as a pattern: a size it normalizes, and an
   * expiry, which may not be in the past. A date the entry already holds is
   * not judged again: the form does not send it back, and the server judges
   * only what it is sent.
   *
   * @param name attribute name
   * @param attr its schema definition
   * @param list its values
   * @returns the message to show under the field, or undefined
   */
  private ruleProblem(
    name: string,
    attr: SchemaAttribute,
    list: string[]
  ): string | undefined {
    const { translator, entry } = this.options;
    if (
      attr.normalize === 'byteSize' &&
      list.some(value => parseByteSize(value) === undefined)
    )
      // The console's words, with examples, rather than the schema's hint:
      // shown under the field already, it said no more once refused.
      return translator.t('form.notSize');
    if (hasRole(attr, 'accountExpiry')) {
      const stored = toList(entryValue(entry, name));
      if (list.some(value => !stored.includes(value) && beforeToday(value)))
        return translator.t('form.pastDate');
    }
    return undefined;
  }

  /** `20240930220000Z` → `2024-09-30`, for an `input[type=date]`. */
  static toDateInput(value: string): string {
    const generalized = /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (generalized)
      return `${generalized[1]}-${generalized[2]}-${generalized[3]}`;
    const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    return iso ? iso[1] : '';
  }

  /** `2024-09-30` → `20240930000000Z`, the form the directory stores. */
  static toDirectoryDate(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match ? `${match[1]}${match[2]}${match[3]}000000Z` : value;
  }
}
