/**
 * REST client of the directory console.
 *
 * It discovers what the server offers instead of assuming it: the entity list,
 * their schemas and their endpoints all come from `GET /v1/config`, and the
 * caller's own rights from `GET /v1/authz/scope`.
 *
 * @module twake-directory-manager/api/ConsoleApiClient
 */

import type {
  AttachedEntries,
  AttachedEntry,
  EntityDescriptor,
  EntitySchema,
  Entry,
  EntryList,
  ExternalMembers,
  LocalizedText,
  OrganizationNode,
  PasswordPolicies,
  PasswordPolicy,
  Refusal,
  Scope,
  SchemaAttribute,
} from '../types';
import type { PointerLookup, PointerOption } from '../importer';

/** A member found by searching, with its address when it has one. */
type MemberOption = PointerOption & { token: string; mail?: string };

/** A group found by searching, as read, with the entity it belongs to. */
export interface GroupMatch {
  entity: EntityDescriptor;
  dn: string;
  entry: Entry;
}
import {
  comparableDn,
  entryValue,
  isDnShaped,
  parentDn,
  rdnValue,
  searchableAttributes,
  valueLabel,
  withinDn,
} from '../format';

interface FlatResource {
  name: string;
  singularName: string;
  pluralName: string;
  label?: LocalizedText;
  singularLabel?: LocalizedText;
  mainAttribute: string;
  base: string;
  schema: EntitySchema;
}

interface ConfigResponse {
  apiPrefix: string;
  ldapBase: string;
  features: {
    ldapFlatGeneric?: { flatResources?: FlatResource[] };
    ldapGroups?: {
      enabled?: boolean;
      base?: string;
      mainAttribute?: string;
      schema?: EntitySchema;
    };
    ldapOrganizations?: {
      enabled?: boolean;
      topOrganization?: string;
      organizationClass?: string[];
      pathSeparator?: string;
      endpoints?: { search?: string };
      schema?: EntitySchema;
    };
    openidconnect?: { endpoints?: { logout?: string } };
    /** What the image's own plugin says about the console itself */
    console?: { hiddenAttributes?: string[]; fullNameFormat?: string };
    externalUsersInGroups?: {
      enabled?: boolean;
      branch?: string;
      rdnAttribute?: string;
      managedDomains?: string[];
    };
    /** ldap-rest's `twake/james` */
    james?: { teamMailboxAnyDomain?: boolean };
    /** ldap-rest's `core/ldap/passwordPolicy`, which manages policies from 0.21.0 */
    ldapPasswordPolicy?: { endpoints?: { listPolicies?: string } };
  };
}

/** Tell whether an attribute carries a role, single or among several. */
export function hasRole(
  attr: SchemaAttribute | undefined,
  role: string
): boolean {
  if (!attr?.role) return false;
  return Array.isArray(attr.role)
    ? attr.role.includes(role)
    : attr.role === role;
}

/** Name of the attribute carrying a role, if any. */
export function roleAttribute(
  schema: EntitySchema | undefined,
  role: string
): string | undefined {
  if (!schema) return undefined;
  for (const [name, attr] of Object.entries(schema.attributes || {}))
    if (hasRole(attr, role)) return name;
  return undefined;
}

/**
 * Whether an entry found in an entity's branch is one of its entries: it
 * holds every attribute the schema requires and the server returns.
 *
 * A branch may hold more than the entity's entries. A tree of mail domains
 * keeps a `dc=com` above `dc=example,dc=com` to hang it from; it is no mail
 * domain, has no `associatedDomain`, and a pointer must not land on it.
 *
 * @param entity the entity the branch belongs to
 * @param entry an entry read from that branch
 * @returns false when the entry lacks something the schema requires
 */
export function isEntryOf(entity: EntityDescriptor, entry: Entry): boolean {
  return Object.entries(entity.schema.attributes).every(
    ([name, attr]) =>
      !attr.required ||
      attr.neverReturn ||
      toValues(entryValue(entry, name)).length > 0
  );
}

/**
 * Whether a collection is too large to list unfiltered, or to offer whole in
 * a pointer's select.
 *
 * The schema says so with `entity.large`. Without it, the entries attached
 * to the organization tree — the accounts — are the large ones: a directory
 * with no tree has nothing to tell them by, and marks its own.
 *
 * @param entity collection to classify
 * @returns true when it is searched before it is listed
 */
export function isLarge(entity: EntityDescriptor): boolean {
  return entity.schema.entity?.large ?? !!entity.organizationLink;
}

/**
 * The roles of the attributes an organization card shows of an attached
 * entry, besides its name: those of an account and those of a group.
 */
export const ATTACHED_ROLES = [
  'displayName',
  'primaryEmail',
  'position',
  'accountStatus',
  'mailboxType',
];

/**
 * The entity an entry belongs to: the one whose branch holds it, the
 * deepest when branches nest. Organizations are left out, which hold their
 * own children and nothing attached to them.
 *
 * @param entities entities the console knows
 * @param dn DN of the entry
 * @returns the entity, or undefined when none holds it
 */
export function owningEntity(
  entities: EntityDescriptor[],
  dn: string
): EntityDescriptor | undefined {
  return entities
    .filter(
      entity =>
        entity.kind !== 'organization' &&
        entity.base &&
        comparableDn(entity.base) !== comparableDn(dn) &&
        withinDn(dn, entity.base)
    )
    .sort((a, b) => b.base.length - a.base.length)[0];
}

/**
 * An entry attached to an organization, as its card lists it: its name, the
 * entity holding it, and the first value of each attribute the card shows,
 * read by the role the entity's schema gives it.
 *
 * @param entry the entry as the subnodes endpoint answered it
 * @param entities entities the console knows
 * @returns what the card needs of it
 */
export function attachedEntry(
  entry: Entry,
  entities: EntityDescriptor[]
): AttachedEntry {
  const dn = String(entry.dn || '');
  // `rdnValue` is what the rest of the console reads a DN's own name with:
  // splitting on the first comma loses `cn=Smith\, John`.
  const label = rdnValue(dn);
  const owner = owningEntity(entities, dn);
  if (!owner) return { dn, label };
  const values: Record<string, string> = {};
  for (const role of ATTACHED_ROLES) {
    const name = roleAttribute(owner.schema, role);
    const value = name ? toValues(entryValue(entry, name))[0] : undefined;
    if (value !== undefined && String(value).trim() !== '')
      values[role] = String(value);
  }
  return { dn, label, entity: owner.key, values };
}

/**
 * The entity of the mail domains: the one whose schema names a domain with
 * the `domainName` role, as ldap-rest's `twake/nomenclature/twakeDomain.json`
 * marks `associatedDomain`. Nothing else tells it apart — its branch is the
 * deployment's to choose.
 *
 * @param entities entities the console knows
 * @returns the entity, or undefined when the directory keeps no domains
 */
export function domainEntity(
  entities: EntityDescriptor[]
): EntityDescriptor | undefined {
  return entities.find(
    entity => entity.base && roleAttribute(entity.schema, 'domainName')
  );
}

/**
 * Whether a pointer lands among the mail domains: a domain is known by its
 * name, which a select of every domain makes the operator read from the top.
 *
 * @param entities entities the console knows
 * @param branch DN the pointer must land in
 * @returns true when the branch is the domains' own
 */
export function isDomainBranch(
  entities: EntityDescriptor[],
  branch: string
): boolean {
  const owner = domainEntity(entities);
  return !!owner && comparableDn(owner.base) === comparableDn(branch);
}

/**
 * The mail domains, as one form asks for them: read once, along with the
 * domains each organization links, however often the operator types.
 */
export interface MailDomains {
  /**
   * The domains an entry attached to an organization may hold addresses at,
   * lower-cased and sorted: those it and every organization above it link
   * (`ldap/enterpriseRules`), or every domain of the directory when they
   * link none, link `*`, or when the entry is attached to nothing. `*`
   * itself is no domain to write after an `@`, and is never one of them.
   * Rejects when the domains cannot be read
   */
  names(organization?: string): Promise<string[]>;
  /**
   * DNs of the domains an organization and every one above it link, up to
   * the top of the tree. Rejects when one of them cannot be read: a chain
   * read in part would say less than the server knows
   */
  linked(organization: string): Promise<string[]>;
}

/** Suggestions a pointer search offers: enough to pick from, few to read. */
const POINTER_SEARCH_LIMIT = 20;

/**
 * Entries a pointer lookup asks for when it searches a name: the one it looks
 * for is compared exactly among them, so a few dozen say whether it is there
 * unless the name is so short that it is part of many others.
 */
const POINTER_LOOKUP_LIMIT = 50;

/**
 * A DN the group list can take in a raw filter: ldap-rest refuses any other
 * character there — `.`, `@` and `'` before ldap-rest 0.20.1, `+`
 * still — and `*`, `(`, `)`, `&` and `|`, which it accepts, would change what
 * the filter means.
 */
const FILTER_SAFE_DN = /^[\w=, .@'-]+$/;

/** Organizations walked before a pointer listing stops asking for more. */
const ORGANIZATION_OPTION_LIMIT = 200;

/**
 * The class `organizations` searches its own children on, and the one value
 * its `subnodes` endpoint understands as "child organizations only".
 */
const ORGANIZATION_CLASS = 'organizationalUnit';

/**
 * Tell the row `subnodes` appends when it truncated from a real entry.
 *
 * It is not an entry: its DN is `more-<the organization's own DN>` and its
 * only class is `moreIndicator`. Nothing answers at that DN.
 *
 * @param entry entry to classify
 * @returns true when the row only says how many were left out
 */
function isMoreIndicator(entry: Entry): boolean {
  if (entry._isMoreIndicator) return true;
  const classes = Array.isArray(entry.objectClass)
    ? entry.objectClass
    : [entry.objectClass ?? ''];
  return classes.some(name => String(name) === 'moreIndicator');
}

/**
 * Read an attribute value as a list, whatever shape the API gave it.
 *
 * @param value value as stored, or as the form submitted it
 * @returns its values, in order
 */
function toValues(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/**
 * An `Error` carrying the status the answer came with. The status is what
 * tells an endpoint the server does not serve from one it refused, so it is
 * attached whatever the body turned out to hold. A refusal ldap-rest
 * describes (see {@link Refusal}) is attached too, for the console to say it
 * in its own words.
 *
 * @param message message to show
 * @param status HTTP status of the answer
 * @param body the answer, when it was JSON
 * @returns the error to throw
 */
function statusError(
  message: string,
  status: number,
  body?: unknown
): Error & { status: number; refusal?: Refusal } {
  const error = new Error(message) as Error & {
    status: number;
    refusal?: Refusal;
  };
  error.status = status;
  const { code, attribute, value, domains } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof code === 'string')
    error.refusal = {
      code,
      ...(typeof attribute === 'string' ? { attribute } : {}),
      ...(typeof value === 'string' ? { value } : {}),
      ...(Array.isArray(domains) ? { domains: domains.map(String) } : {}),
    };
  return error;
}

/**
 * Whether a failure is one a search too broad for the directory ends in.
 *
 * `422` is ldap-rest saying so, and `502` or `504` a proxy giving up on the
 * unbounded search before the server did. The last two have other causes
 * too, which is why what is said about them stays hedged — but each is
 * worth trying something narrower after.
 *
 * Not `500`. ldap-rest 0.12.0 reported the same refusal that way, and this
 * read every `500` as too broad for it; on a current server a `500` is a
 * failure of the server's own, and advising a narrower search hid it — a
 * pointer search even passed it off as an answer cut short.
 *
 * @param err what a request threw
 * @returns true for those three statuses
 */
export function tooBroad(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 422 || status === 502 || status === 504;
}

export class ConsoleApiClient {
  private readonly origin: string;
  private apiPrefix = '/api';
  private ldapBase = '';
  private pathSeparator = ' / ';
  private topOrganization?: string;
  /** Attribute carrying the readable path of an organization, from its role */
  private organizationPathAttribute?: string;
  /**
   * Whether the server searches the organization tree (`endpoints.search` of
   * its config). A server that predates the endpoint does not advertise it,
   * and is asked nothing it would answer with a 404.
   */
  private organizationSearchable = false;
  /** Object classes that make an entry an organization rather than a member */
  private organizationClasses: string[] = [];
  /** Route that ends the session, when the server's authentication has one */
  private logoutPath?: string;
  /** Where groups take external members; see externalMembers */
  private external?: ExternalMembers;
  /** Whether the server keeps team mailboxes to their domain; see below */
  private teamMailboxDomain = false;
  /** Attributes the deployment hides, lowercased; see describe() */
  private hidden = new Set<string>();
  /** How the deployment writes a full name; see fullNameFormat */
  private nameFormat?: string;
  /** Where the password policies are served, when they are */
  private policiesPath?: string;
  /**
   * Whether the API lives on another origin than the page. `same-origin`
   * attaches no cookie to a cross-origin request, so a deployment that points
   * the console at its own API host would be answered `401` on every call —
   * a session it holds and does not send. Such a deployment has to allow the
   * origin and credentials in its CORS policy either way.
   */
  private readonly crossOrigin: boolean;
  /**
   * Called when the server answers `401` on the page's own origin: the
   * session ended, and loading the page again can get it back. Not across
   * origins, where reloading the page signs nothing in at the API's host.
   */
  onSessionEnded?: () => void;

  constructor(apiBaseUrl?: string, apiPrefix?: string) {
    const own = typeof window !== 'undefined' ? window.location.origin : '';
    this.origin = apiBaseUrl ?? own;
    this.crossOrigin = this.origin !== '' && this.origin !== own;
    // Everything else is asked at the prefix the configuration advertises;
    // the request that reads that configuration cannot be, so a server
    // started with `--api-prefix /ldap` has to be told once.
    if (apiPrefix) this.apiPrefix = apiPrefix;
  }

  /** Separator the directory puts between the segments of an organization path. */
  get organizationPathSeparator(): string {
    return this.pathSeparator;
  }

  /**
   * Where to send the browser to end its session, when the server says.
   *
   * Only OpenID Connect publishes one: it logs out at the provider too, and
   * without that the provider would log the caller straight back in. Behind
   * any other authentication the session is the host's, and so is ending it.
   * The route belongs to the server, not to its API, hence no prefix.
   */
  get logoutUrl(): string | undefined {
    return this.logoutPath ? `${this.origin}${this.logoutPath}` : undefined;
  }

  /** Root of the organization tree, when the server serves one. */
  get organizationRoot(): string | undefined {
    return this.topOrganization;
  }

  /** Where groups take members outside the directory, when they do. */
  get externalMembers(): ExternalMembers | undefined {
    return this.external;
  }

  /**
   * Whether a team mailbox only takes members whose address is at its
   * domain: what ldap-rest's `twake/james` enforces unless
   * `--james-team-mailbox-any-domain` (linagora/twake-directory-manager#66).
   * A server that publishes nothing about it enforces nothing.
   */
  get teamMailboxesKeepDomain(): boolean {
    return this.teamMailboxDomain;
  }

  /**
   * How a full name is written from its parts, as the deployment says
   * (`DM_CONSOLE_FULL_NAME_FORMAT`): `{givenName}` and `{surname}` stand for
   * the attributes of those roles. Undefined when it says nothing.
   */
  get fullNameFormat(): string | undefined {
    return this.nameFormat;
  }

  /**
   * Whether the server searches the organization tree in one request, for
   * {@link organizationSearch}.
   */
  get searchesOrganizations(): boolean {
    return this.organizationSearchable;
  }

  /** Whether the server lets password policies be managed. */
  get servesPasswordPolicies(): boolean {
    return !!this.policiesPath;
  }

  /**
   * Issue a request and turn a failure into an `Error` carrying the server's
   * own message — the API explains what it refused and why, and repeating that
   * verbatim is more useful than any wording invented here.
   *
   * The body is read as JSON only after the status has been looked at: not
   * every answer comes from the API. Express's own `404` page, a proxy's `502`
   * and a gateway's sign-in redirect are all HTML, and parsing them first
   * raised a `SyntaxError` carrying no status at all — which is how a server
   * without `auth/authzScope` came to be read as a refusal rather than as the
   * `404` it answered, and hid every write button on the console.
   */
  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    return (await this.request<T>(path, init)).payload;
  }

  /**
   * `call()`, with the headers of the answer alongside its body: the list
   * endpoint says in a header, not in the map it answers, that it stopped
   * before the end. Every other caller wants the body alone.
   */
  private async request<T>(
    path: string,
    init?: RequestInit
  ): Promise<{ payload: T; headers: Headers }> {
    const response = await fetch(`${this.origin}${path}`, {
      credentials: this.crossOrigin ? 'include' : 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
    });
    if (response.status === 401 && !this.crossOrigin) this.onSessionEnded?.();
    const text = await response.text();
    const status = `${response.status} ${response.statusText}`;
    let payload: unknown = null;
    let isJson = true;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        isJson = false;
      }
    }
    if (!response.ok)
      throw statusError(
        (isJson && (payload as { error?: string } | null)?.error) || status,
        response.status,
        isJson ? payload : undefined
      );
    // A success nobody can read is still a failure, and it is one the caller
    // should be able to tell apart by its status like any other.
    if (!isJson) throw statusError(status, response.status);
    return { payload: payload as T, headers: response.headers };
  }

  /**
   * Read the server's configuration and turn it into the entity list the
   * console navigates.
   *
   * @returns one descriptor per entity the server exposes
   */
  async discover(): Promise<EntityDescriptor[]> {
    const config = await this.call<ConfigResponse>(
      `${this.apiPrefix}/v1/config`
    );
    this.apiPrefix = config.apiPrefix || this.apiPrefix;
    this.ldapBase = config.ldapBase || '';
    this.logoutPath = config.features.openidconnect?.endpoints?.logout;
    const external = config.features.externalUsersInGroups;
    this.external =
      external?.enabled && external.branch
        ? {
            branch: external.branch,
            rdnAttribute: external.rdnAttribute || 'mail',
            managedDomains: (external.managedDomains || []).map(domain =>
              domain.toLowerCase()
            ),
          }
        : undefined;
    this.policiesPath =
      config.features.ldapPasswordPolicy?.endpoints?.listPolicies;
    const james = config.features.james;
    this.teamMailboxDomain = james !== undefined && !james.teamMailboxAnyDomain;
    this.nameFormat = config.features.console?.fullNameFormat || undefined;
    this.hidden = new Set(
      (config.features.console?.hiddenAttributes || []).map(name =>
        name.toLowerCase()
      )
    );
    const entities: EntityDescriptor[] = [];

    for (const resource of config.features.ldapFlatGeneric?.flatResources ||
      []) {
      if (!resource.schema?.attributes) continue;
      entities.push(
        this.describe({
          key: resource.pluralName,
          pluralName: resource.pluralName,
          singularName: resource.singularName,
          label: resource.label ?? resource.schema.entity?.label,
          singularLabel:
            resource.singularLabel ?? resource.schema.entity?.singularLabel,
          mainAttribute: resource.mainAttribute,
          base: resource.base,
          schema: resource.schema,
          endpoint: `${this.apiPrefix}/v1/ldap/${resource.pluralName}`,
          kind: 'flat',
        })
      );
    }

    const groups = config.features.ldapGroups;
    if (groups?.enabled && groups.schema?.attributes) {
      entities.push(
        this.describe({
          key: 'groups',
          pluralName: 'groups',
          singularName: 'group',
          label: groups.schema.entity?.label,
          singularLabel: groups.schema.entity?.singularLabel,
          mainAttribute: groups.mainAttribute || 'cn',
          base: groups.base || '',
          schema: groups.schema,
          endpoint: `${this.apiPrefix}/v1/ldap/groups`,
          kind: 'group',
        })
      );
    }

    const organizations = config.features.ldapOrganizations;
    if (organizations?.enabled) {
      this.pathSeparator = organizations.pathSeparator || ' / ';
      this.topOrganization = organizations.topOrganization;
      this.organizationSearchable = !!organizations.endpoints?.search;
      this.organizationPathAttribute = roleAttribute(
        organizations.schema,
        'organizationPath'
      );
      this.organizationClasses = (organizations.organizationClass || [])
        .filter(name => name.toLowerCase() !== 'top')
        .map(name => name.toLowerCase());
      if (organizations.schema?.attributes) {
        entities.push(
          this.describe({
            key: 'organizations',
            pluralName: 'organizations',
            singularName: 'organization',
            label: organizations.schema.entity?.label,
            singularLabel: organizations.schema.entity?.singularLabel,
            mainAttribute: 'ou',
            base: organizations.topOrganization || '',
            schema: organizations.schema,
            endpoint: `${this.apiPrefix}/v1/ldap/organizations`,
            kind: 'organization',
          })
        );
      }
    }

    return entities;
  }

  /**
   * Fill in the role-derived fields of a descriptor, and leave out of its
   * schema the attributes the deployment hides.
   *
   * A hidden attribute is one nothing in the deployment acts on — an
   * address no plugin reads, a delivery mode nothing applies — and that an
   * administrator, finding it under "Mailbox settings", would fill in
   * expecting an effect. Left out of the schema, it is left out of the
   * form, the card, the list and the CSV files alike; what the directory
   * holds in it is left as it is.
   */
  private describe(
    entity: Omit<
      EntityDescriptor,
      'organizationLink' | 'organizationPath' | 'accountStatus' | 'password'
    >
  ): EntityDescriptor {
    const base = {
      ...entity,
      schema: {
        ...entity.schema,
        attributes: Object.fromEntries(
          Object.entries(entity.schema.attributes).filter(
            ([name]) => !this.hidden.has(name.toLowerCase())
          )
        ),
      },
    };
    return {
      ...base,
      organizationLink: roleAttribute(base.schema, 'organizationLink'),
      organizationPath: roleAttribute(base.schema, 'organizationPath'),
      accountStatus: roleAttribute(base.schema, 'accountStatus'),
      password: roleAttribute(base.schema, 'password'),
    };
  }

  /**
   * The caller's administration scope, or null when the server serves none.
   *
   * A `404` is the answer of a server that does not load `auth/authzScope`:
   * it has no scope to give, which is not the same thing as refusing to give
   * one. Every other failure is raised, because reading it as "unrestricted"
   * would show a caller who was just told `401` every button on the console.
   */
  async scope(): Promise<Scope | null> {
    try {
      return await this.call<Scope>(`${this.apiPrefix}/v1/authz/scope`);
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }

  /**
   * List the entries of an entity, optionally narrowed by a substring on one
   * attribute.
   *
   * @param entity entity to list
   * @param search substring to look for
   * @param attribute attribute the substring applies to
   * @param limit most entries to ask for
   * @returns the entries, keyed by their identifier
   */
  async list(
    entity: EntityDescriptor,
    search?: string,
    attribute?: string,
    limit?: number
  ): Promise<Record<string, Entry>> {
    return (await this.listBounded(entity, search, attribute, limit)).entries;
  }

  /**
   * `list()`, saying also whether the server left entries out — which only
   * a header tells, hence a method of its own rather than a new shape for
   * `list()`, whose plain map embedders already read.
   *
   * Without a limit the server runs the search unbounded, and a directory
   * refuses one that matches more entries than its own size limit: ldap-rest
   * then answers `422` (an ldap-rest before 0.13.0 answered `500`, which the
   * console no longer reads as that refusal). With one, it answers the first
   * `limit` entries and says in `X-Result-Truncated` that there were more.
   * Across origins the browser hides the header unless the server's CORS
   * policy exposes it.
   *
   * A group list answers its name and members only, unless `attributes` asks
   * for more: the schema's attributes are asked for, or the table's email
   * column, its CSV export and a pointer's labels would stay empty.
   *
   * @param entity entity to list
   * @param search substring to look for
   * @param attribute attribute the substring applies to
   * @param limit most entries to ask for
   * @returns the entries, keyed by their identifier, and whether the server
   *   left some out
   */
  async listBounded(
    entity: EntityDescriptor,
    search?: string,
    attribute?: string,
    limit?: number
  ): Promise<EntryList> {
    const params = new URLSearchParams();
    if (search && attribute) {
      params.set('match', search);
      params.set('attribute', attribute);
    }
    if (limit) params.set('limit', String(limit));
    if (entity.kind === 'group') {
      const attributes = Object.entries(entity.schema.attributes)
        .filter(([, attr]) => !attr.neverReturn)
        .map(([name]) => name);
      if (attributes.length) params.set('attributes', attributes.join(','));
    }
    const query = params.toString();
    const { payload, headers } = await this.request<Record<string, Entry>>(
      `${entity.endpoint}${query ? `?${query}` : ''}`
    );
    return {
      entries: payload,
      truncated: headers.get('X-Result-Truncated')?.trim() === 'true',
    };
  }

  /** Read one entry. */
  async get(entity: EntityDescriptor, id: string): Promise<Entry> {
    return this.call<Entry>(`${entity.endpoint}/${encodeURIComponent(id)}`);
  }

  /** Create an entry, and return it as stored. */
  async create(entity: EntityDescriptor, values: Entry): Promise<Entry> {
    return this.call<Entry>(entity.endpoint, {
      method: 'POST',
      body: JSON.stringify(values),
    });
  }

  /**
   * Replace the given attributes of an entry.
   *
   * A group's membership is the one thing the modify endpoint does not take:
   * it answers `Use dedicated API to replace members` to `replace.member` and
   * to `delete: ['member']` alike, because adding and removing a member is
   * hooked server-side and has endpoints of its own. The form edits that list
   * like any other attribute — which is right, it is one — so what it
   * submitted is turned back here into the additions and the removals it
   * means, and the rest of the entry goes out as usual.
   *
   * @param entity entity the entry belongs to
   * @param id identifier of the entry
   * @param replace attributes to write
   * @param remove attributes to clear
   * @param previous the entry as stored, which the membership is diffed
   *   against; without it every submitted member reads as an addition
   */
  async update(
    entity: EntityDescriptor,
    id: string,
    replace: Record<string, string | string[]>,
    remove: string[] = [],
    previous?: Entry
  ): Promise<void> {
    const attributes = { ...replace };
    const cleared = [...remove];
    const membership = this.membershipAttribute(entity);
    let members: string[] | undefined;
    if (
      membership &&
      (membership in attributes || cleared.includes(membership))
    ) {
      members = toValues(attributes[membership]);
      delete attributes[membership];
      const index = cleared.indexOf(membership);
      if (index >= 0) cleared.splice(index, 1);
    }

    const body: Record<string, unknown> = {};
    if (Object.keys(attributes).length) body.replace = attributes;
    if (cleared.length) body.delete = cleared;
    if (Object.keys(body).length)
      await this.call(`${entity.endpoint}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    if (members && membership)
      await this.setMembers(
        entity,
        id,
        members,
        toValues(entryValue(previous, membership))
      );
  }

  /**
   * The attribute holding the members of a group, when the entity is one. It
   * is read from its role, like everything else the console knows.
   *
   * @param entity entity to look at
   * @returns the attribute name, or undefined when there is no such thing
   */
  private membershipAttribute(entity: EntityDescriptor): string | undefined {
    return entity.kind === 'group'
      ? roleAttribute(entity.schema, 'members')
      : undefined;
  }

  /**
   * Bring a group's members to the list given, through the endpoints the
   * server reserves for it.
   *
   * @param entity group entity
   * @param id identifier of the group
   * @param members members the group should hold
   * @param current members it holds today
   */
  async setMembers(
    entity: EntityDescriptor,
    id: string,
    members: string[],
    current: string[] = []
  ): Promise<void> {
    // A DN is case-insensitive as an identifier, so a member listed under
    // another case is the same member and not one to add and drop again.
    const held = new Set(current.map(dn => dn.toLowerCase()));
    const wanted = new Set(members.map(dn => dn.toLowerCase()));
    const added = members.filter(dn => !held.has(dn.toLowerCase()));
    const removed = current.filter(dn => !wanted.has(dn.toLowerCase()));
    if (added.length) await this.addMembers(entity, id, added);
    // One request per departure: the endpoint names the member in its path.
    for (const dn of removed) await this.removeMember(entity, id, dn);
  }

  /** Add members to a group. */
  async addMembers(
    entity: EntityDescriptor,
    id: string,
    members: string[]
  ): Promise<void> {
    if (!members.length) return;
    await this.call(`${entity.endpoint}/${encodeURIComponent(id)}/members`, {
      method: 'POST',
      body: JSON.stringify({ member: members }),
    });
  }

  /** Remove one member from a group. */
  async removeMember(
    entity: EntityDescriptor,
    id: string,
    member: string
  ): Promise<void> {
    await this.call(
      `${entity.endpoint}/${encodeURIComponent(id)}/members/` +
        encodeURIComponent(member),
      { method: 'DELETE' }
    );
  }

  /**
   * The groups holding a DN among their members, for an account whose
   * `memberOf` the directory does not maintain: only OpenLDAP's `memberof`
   * overlay does.
   *
   * The group list takes a raw LDAP filter in `match`, and `(member=<dn>)`
   * answers exactly the account's groups, however many the directory holds.
   * Nothing else does: a substring search finds nothing, `member` having no
   * substring matching rule, and a flat entity takes no raw filter. An
   * entity that cannot be asked, or refuses — ldap-rest before
   * 0.20.1 answers `400` for a DN holding a dot — adds no
   * group: reading every group with its members to compare them here would
   * not hold on a large directory.
   *
   * @param dn DN of the member
   * @param entities entities the console knows: the groups among them are read
   * @param strict fail instead, for a DN no filter can hold or a group list
   *   that fails: the caller then knows the groups are unknown, not none
   * @returns DN of every group holding it
   */
  async memberships(
    dn: string,
    entities: EntityDescriptor[],
    strict = false
  ): Promise<string[]> {
    if (!FILTER_SAFE_DN.test(dn)) {
      if (strict) throw new Error(`No filter can hold ${dn}`);
      return [];
    }
    const found = await Promise.all(
      entities.map(async entity => {
        const members = roleAttribute(entity.schema, 'members');
        if (!members || entity.kind !== 'group') return [];
        const params = new URLSearchParams({
          match: `(${members}=${dn})`,
          attributes: entity.mainAttribute,
        });
        try {
          const entries = await this.call<Record<string, Entry>>(
            `${entity.endpoint}?${params.toString()}`
          );
          return Object.values(entries)
            .filter(entry => entry.dn)
            .map(entry => String(entry.dn));
        } catch (err) {
          if (strict) throw err;
          return [];
        }
      })
    );
    return found.flat();
  }

  /** Delete an entry. */
  async remove(entity: EntityDescriptor, id: string): Promise<void> {
    await this.call(`${entity.endpoint}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /** Move an entry to another organization. */
  async move(
    entity: EntityDescriptor,
    id: string,
    targetOrgDn: string
  ): Promise<void> {
    await this.call(`${entity.endpoint}/${encodeURIComponent(id)}/move`, {
      method: 'POST',
      body: JSON.stringify({ targetOrgDn }),
    });
  }

  /** Move an account to one of the states its schema declares. */
  async setStatus(
    entity: EntityDescriptor,
    id: string,
    state: string
  ): Promise<void> {
    await this.call(`${entity.endpoint}/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: JSON.stringify({ state }),
    });
  }

  /**
   * Reset an account's credential.
   *
   * @returns the generated password, when the server chose one
   */
  async resetPassword(
    entity: EntityDescriptor,
    id: string,
    password?: string,
    forceChange = true
  ): Promise<{ generated: boolean; password?: string; forceChange?: boolean }> {
    return this.call<{
      generated: boolean;
      password?: string;
      forceChange?: boolean;
    }>(`${entity.endpoint}/${encodeURIComponent(id)}/password`, {
      method: 'POST',
      body: JSON.stringify({ password, forceChange }),
    });
  }

  /**
   * Whether the caller may read the password policies, asked of the server
   * itself: a refusal says no; any other failure says yes, so that the page
   * shows it rather than hiding behind it.
   *
   * @returns false on a 403, true otherwise
   */
  async readsPasswordPolicies(): Promise<boolean> {
    try {
      await this.passwordPolicies();
      return true;
    } catch (err) {
      return (err as { status?: number }).status !== 403;
    }
  }

  /** The password policies, sorted by name, and the attributes they take. */
  async passwordPolicies(): Promise<PasswordPolicies> {
    const { policies, attributes } = await this.call<PasswordPolicies>(
      this.policyPath()
    );
    return { policies, attributes };
  }

  /**
   * Create a password policy.
   *
   * @param cn its name
   * @param values the attributes to set
   * @returns the policy as created
   */
  async createPasswordPolicy(
    cn: string,
    values: Record<string, unknown>
  ): Promise<PasswordPolicy> {
    return this.call<PasswordPolicy>(this.policyPath(), {
      method: 'POST',
      body: JSON.stringify({ ...values, cn }),
    });
  }

  /**
   * Change a password policy.
   *
   * @param cn its name
   * @param changes the attributes to set, `null` removing one
   * @returns the policy as changed
   */
  async updatePasswordPolicy(
    cn: string,
    changes: Record<string, unknown>
  ): Promise<PasswordPolicy> {
    return this.call<PasswordPolicy>(this.policyPath(cn), {
      method: 'PATCH',
      body: JSON.stringify(changes),
    });
  }

  /** Delete a password policy. */
  async deletePasswordPolicy(cn: string): Promise<void> {
    await this.call(this.policyPath(cn), { method: 'DELETE' });
  }

  private policyPath(cn?: string): string {
    if (!this.policiesPath)
      throw new Error('The server manages no password policy');
    return cn === undefined
      ? this.policiesPath
      : `${this.policiesPath}/${encodeURIComponent(cn)}`;
  }

  /**
   * Top of the organization tree, or null when the server serves none.
   *
   * A `404` is the answer of a server with no top organization configured:
   * there is no tree to draw, which is not the same thing as failing to read
   * it. Every other failure is raised, the way `scope()` raises its own —
   * read as "no tree", a `403` left the tree on its loading message and the
   * department select of every form empty, without a word said.
   */
  async organizationTop(): Promise<OrganizationNode | null> {
    try {
      const entry = await this.call<Entry>(
        `${this.apiPrefix}/v1/ldap/organizations/top`
      );
      return entry?.dn ? this.toNode(entry) : null;
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }

  /**
   * What the directory hangs under an organization: its child organizations
   * *and* the entries attached to it.
   *
   * Asked whole, the answer caps the attached entries at
   * `ldap_organization_max_subnodes` and appends a `moreIndicator` row
   * counting the rest. Asked for `organizationalUnit`, it holds the child
   * organizations alone; asked for another class, the attached entries of
   * that class alone, capped and counted on their own.
   *
   * @param dn organization to read
   * @param objectClass class to restrict the answer to
   * @returns the raw entries
   */
  private async subnodes(dn: string, objectClass?: string): Promise<Entry[]> {
    const filter = objectClass
      ? `?objectClass=${encodeURIComponent(objectClass)}`
      : '';
    return (
      (await this.call<Entry[]>(
        `${this.apiPrefix}/v1/ldap/organizations/${encodeURIComponent(dn)}` +
          `/subnodes${filter}`
      )) || []
    );
  }

  /**
   * Tell an organization apart from an entry merely attached to one. The
   * subnodes endpoint returns both, and a tree that shows accounts as branches
   * of the org chart is worse than no tree at all.
   *
   * @param entry entry to classify
   * @returns true when the entry is itself an organization
   */
  private isOrganization(entry: Entry): boolean {
    const classes = (
      Array.isArray(entry.objectClass)
        ? entry.objectClass
        : [entry.objectClass ?? '']
    ).map(name => String(name).toLowerCase());
    if (this.organizationClasses.length)
      return this.organizationClasses.some(name => classes.includes(name));
    // No class list configured: fall back to the shape of the DN.
    return /^ou=/i.test(String(entry.dn || ''));
  }

  /**
   * Direct child organizations of an organization.
   *
   * The endpoint searches its own children on `organizationalUnit` whatever
   * it is asked, so that is the class to ask for; the class list a deployment
   * declares is what tells an *attached* entry apart, below.
   *
   * The indicator row is dropped here as it is for the attached entries. It
   * used to reach only the unfiltered call, which the tree does not make; a
   * branch the directory will not list in one answer now ends with one too,
   * and mapped like an entry it would draw a node whose DN answers nothing.
   */
  async organizationChildren(dn: string): Promise<OrganizationNode[]> {
    return (await this.organizationChildrenRead(dn)).nodes;
  }

  /**
   * {@link organizationChildren}, saying whether the server cut its answer:
   * the indicator row is dropped either way, and a walk that goes on as if
   * it had read every child would take the ones left out for absent.
   *
   * @param dn organization to read
   * @returns its child organizations, and whether some were left out
   */
  private async organizationChildrenRead(
    dn: string
  ): Promise<{ nodes: OrganizationNode[]; truncated: boolean }> {
    const entries = await this.subnodes(dn, ORGANIZATION_CLASS);
    return {
      nodes: entries
        .filter(entry => !isMoreIndicator(entry))
        .map(entry => this.toNode(entry)),
      truncated: entries.some(isMoreIndicator),
    };
  }

  /**
   * Entries attached to an organization without being one — the accounts and
   * groups that answer "who is in this department?".
   *
   * Past `ldap_organization_max_subnodes` the answer is cut, and its
   * indicator row says so, counting the rest when the directory let it.
   * That is kept: a card listing fifty names and stopping there reads as a
   * department of fifty.
   *
   * The server answers each entry whole, so what the card shows of it — the
   * full name, the address, the position, the state, the type of a group —
   * is read from the same answer, by the roles of the schema of the entity
   * holding it: no request per entry.
   *
   * @param dn organization to read
   * @param entities entities the console knows, to tell an account from a
   *          group and read their values by role
   * @param objectClass class to ask for alone, so that the server caps and
   *          counts that kind apart
   * @returns DN, readable name, entity and shown values of each attached
   *          entry, whether the server left some out, and how many when it
   *          counted them
   */
  async organizationMembers(
    dn: string,
    entities: EntityDescriptor[] = [],
    objectClass?: string
  ): Promise<AttachedEntries> {
    const rows = await this.subnodes(dn, objectClass);
    // The child organizations have an indicator of their own, which says
    // nothing about the entries attached to this one.
    const indicator = rows.find(
      row =>
        isMoreIndicator(row) &&
        !String(row.dn || '').startsWith('more-organizations-')
    );
    const total = Number(indicator?._totalCount);
    const displayed = Number(indicator?._displayedCount);
    return {
      entries: rows
        .filter(entry => !isMoreIndicator(entry) && !this.isOrganization(entry))
        .map(entry => attachedEntry(entry, entities)),
      truncated: Boolean(indicator),
      ...(total > displayed ? { more: total - displayed } : {}),
    };
  }

  /** Read one organization. */
  async organization(dn: string): Promise<Entry> {
    return this.call<Entry>(
      `${this.apiPrefix}/v1/ldap/organizations/${encodeURIComponent(dn)}`
    );
  }

  /** Create an organization, optionally under a parent. */
  async createOrganization(
    values: Record<string, unknown>,
    parentDn?: string
  ): Promise<void> {
    await this.call(`${this.apiPrefix}/v1/ldap/organizations`, {
      method: 'POST',
      body: JSON.stringify(parentDn ? { ...values, parentDn } : values),
    });
  }

  /** Replace the given attributes of an organization. */
  async updateOrganization(
    dn: string,
    replace: Record<string, string | string[]>,
    remove: string[] = []
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (Object.keys(replace).length) body.replace = replace;
    if (remove.length) body.delete = remove;
    if (!Object.keys(body).length) return;
    await this.call(
      `${this.apiPrefix}/v1/ldap/organizations/${encodeURIComponent(dn)}`,
      { method: 'PUT', body: JSON.stringify(body) }
    );
  }

  /** Delete an organization. */
  async deleteOrganization(dn: string): Promise<void> {
    await this.call(
      `${this.apiPrefix}/v1/ldap/organizations/${encodeURIComponent(dn)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Entries of a branch, for a pointer field. The branch is a raw DN, so the
   * console reads it through the low-level browsing API when it is available
   * and falls back to the entity that owns the branch otherwise.
   *
   * @param branch DN the pointer must land in
   * @param entities entities the console knows, to find one covering the branch
   * @param language interface language, to name a nomenclature value
   * @returns DN and label of every candidate
   */
  async pointerOptions(
    branch: string,
    entities: EntityDescriptor[],
    language = 'en'
  ): Promise<{ dn: string; label: string }[]> {
    // An organization pointer names the whole tree, which no flat listing
    // covers: walk it instead, so the department field of an account is
    // filled from the organizations themselves.
    if (this.inOrganizationTree(branch)) return this.organizationOptions();

    const owner = entities.find(
      entity =>
        entity.base && branch.toLowerCase() === entity.base.toLowerCase()
    );
    if (owner) {
      const list = await this.list(owner);
      const options = Object.entries(list)
        .filter(([, entry]) => isEntryOf(owner, entry))
        .map(([id, entry]) => ({
          id,
          ...this.pointerOption(owner, id, entry, language),
        }));
      // Two entries may go by the same name, which a select cannot tell
      // apart: their identifiers can.
      const seen = new Map<string, number>();
      for (const { label } of options)
        seen.set(label, (seen.get(label) ?? 0) + 1);
      return options.map(({ id, dn, label }) => ({
        dn,
        label: (seen.get(label) ?? 0) > 1 ? `${label} (${id})` : label,
      }));
    }
    // An unknown branch: ask the raw browser, which every deployment that
    // enables it serves, and give up quietly when it is not there.
    try {
      const answer = await this.call<{
        children?: { dn: string; rdn: string }[];
      }>(
        `${this.apiPrefix}/v1/ldap/raw/children/${encodeURIComponent(branch)}`
      );
      return (answer.children || []).map(child => ({
        dn: child.dn,
        // `rdnValue` again: an RDN is escaped like the DN it comes from.
        label: rdnValue(child.rdn),
      }));
    } catch {
      return [];
    }
  }

  /** Whether a pointer's branch is the organization tree, or holds it. */
  private inOrganizationTree(branch: string): boolean {
    return Boolean(
      this.topOrganization &&
      (branch.toLowerCase() === this.topOrganization.toLowerCase() ||
        this.topOrganization.toLowerCase().endsWith(`,${branch.toLowerCase()}`))
    );
  }

  /** One entry of an entity, as a pointer candidate the way the form lists it. */
  private pointerOption(
    owner: EntityDescriptor,
    id: string,
    entry: Entry,
    language: string
  ): PointerOption {
    const labels = owner.schema.entity?.valueLabels;
    const display = roleAttribute(owner.schema, 'displayName');
    const shown = display ? entryValue(entry, display) : undefined;
    return {
      dn: String(entry.dn || id),
      // A nomenclature names its values, and an entry may carry its own
      // readable name — a mail domain its `example.org`; anything else is
      // known by its id.
      label:
        (labels && valueLabel(labels, id, language)) ||
        (Array.isArray(shown) ? shown[0] : shown) ||
        id,
    };
  }

  /**
   * How the import finds the entries of a branch value by value, for a
   * branch too large to list whole; undefined for a branch no entity owns.
   *
   * Only an entity's branch can be read entry by entry and searched. The
   * organization tree is walked, and bounded, rather than listed; a raw
   * branch has neither a read nor a search to fall back to.
   *
   * A DN is read through the entity's endpoint, which takes one in place of
   * an identifier for a direct child of its base named by its main
   * attribute — anything else is not an entry of that branch, and the full
   * listing would not have held it either. The search looks in the main
   * attribute, where the names the form lists an entry by come from: its
   * identifier and the value of its RDN. A nomenclature's own labels live in
   * its schema, not in the directory, and are not searched: a branch holding
   * one is small enough to be listed.
   *
   * @param branch DN the pointer must land in
   * @param entities entities the console knows, to find the one owning it
   * @param language interface language, to name a nomenclature value
   * @returns the lookup, or undefined
   */
  pointerLookup(
    branch: string,
    entities: EntityDescriptor[],
    language = 'en'
  ): PointerLookup | undefined {
    if (this.inOrganizationTree(branch)) return undefined;
    const owner = entities.find(
      entity =>
        entity.base && branch.toLowerCase() === entity.base.toLowerCase()
    );
    if (!owner?.base) return undefined;
    const base = owner.base;
    const main = owner.mainAttribute;
    return {
      read: async (value: string): Promise<PointerOption | undefined> => {
        let id = value;
        if (isDnShaped(value)) {
          // Spaces around a separator are no part of a DN, and a file
          // written by hand has them: `uid=bob, ou=users, dc=example`.
          const dn = /^\s*([^=\s]+)\s*=((?:\\.|[^,])*?)\s*,\s*(.*)$/.exec(
            value
          );
          if (
            !dn ||
            dn[1].toLowerCase() !== main.toLowerCase() ||
            comparableDn(dn[3]) !== comparableDn(base)
          )
            return undefined;
          // The base as the server spells it: it compares the parent to its
          // own base as written, spaces included.
          id = `${main}=${dn[2]},${base}`;
        }
        let entry: Entry;
        try {
          entry = await this.get(owner, id);
        } catch (err) {
          // Absent, or not a name the endpoint can read as an entry.
          const status = (err as { status?: number }).status;
          if (status === 404 || status === 400) return undefined;
          throw err;
        }
        if (!isEntryOf(owner, entry)) return undefined;
        const own = entryValue(entry, main);
        const key = (Array.isArray(own) ? own[0] : own) || rdnValue(id);
        return this.pointerOption(owner, key, entry, language);
      },
      search: async (
        text: string
      ): Promise<{ options: PointerOption[]; truncated: boolean }> => {
        try {
          const { entries, truncated } = await this.listBounded(
            owner,
            text,
            main,
            POINTER_LOOKUP_LIMIT
          );
          const found = Object.entries(entries);
          const options = found
            .filter(([, entry]) => isEntryOf(owner, entry))
            .map(([id, entry]) =>
              this.pointerOption(owner, id, entry, language)
            );
          return {
            options,
            // Across origins the header may not reach the page — ldap-rest
            // exposes none to CORS — so an answer exactly as long as asked
            // is taken as cut too. Exactly: a server that ignored the bound
            // would answer more than it, which is a whole answer.
            truncated: truncated || found.length === POINTER_LOOKUP_LIMIT,
          };
        } catch (err) {
          // Refused as too broad says no more than an answer cut short: the
          // name may be there.
          if (tooBroad(err)) return { options: [], truncated: true };
          throw err;
        }
      },
    };
  }

  /**
   * A search for the entries of a branch too large to list, for a pointer
   * field to offer as the operator types.
   *
   * A large branch — see `isLarge` — is the one the list view will not show
   * unfiltered either: a select of every account of a directory holds ten
   * thousand options, and building it downloads them all each time a form
   * opens. The search looks in the attributes the list searches, and names
   * each entry the way a person recognises it: by its display name, then by
   * its identifier.
   *
   * Any other branch an entity owns is listed into a select, and can be
   * searched all the same: `failed` asks for its search, once listing it has
   * failed. A raw branch has no search.
   *
   * The organization tree is searched whenever the server can, listing or not:
   * walking it is bounded, so a directory of a thousand organizations would
   * offer a few hundred of them in a select nobody can read. A server that
   * cannot search it keeps the select. Either starts from the caller's top
   * organization, not from the directory's.
   *
   * @param branch DN the pointer must land in
   * @param entities entities the console knows, to find the one owning it
   * @param failed whether listing the branch failed, and a search is wanted
   *   even for a branch meant to be listed
   * @returns a search, or undefined when the branch is to be listed
   */
  pointerSearch(
    branch: string,
    entities: EntityDescriptor[],
    failed = false
  ):
    | ((
        query: string
      ) => Promise<{ dn: string; label: string; token?: string }[]>)
    | undefined {
    // Before the owner is looked for: the tree's branch is the top of an
    // entity or the DN above it, and the pointer needs a search either way.
    if (this.inOrganizationTree(branch)) {
      if (!this.organizationSearchable) return undefined;
      // From the caller's own top, which the server narrows to their scope,
      // as the select walks it: the configured root offers departments a
      // local administrator may not attach anything to. Asked once per field,
      // and again after a failure.
      let top: Promise<OrganizationNode | null> | undefined;
      return async query => {
        top ??= this.organizationTop().catch((err: unknown) => {
          top = undefined;
          throw err;
        });
        const root = await top;
        return root ? this.organizationSearch(query, root.dn) : [];
      };
    }
    const owner = entities.find(
      entity =>
        entity.base && branch.toLowerCase() === entity.base.toLowerCase()
    );
    if (!owner) return undefined;
    if (!failed && !isLarge(owner)) return undefined;
    const scope = searchableAttributes(owner)
      .map(([name]) => name)
      .join(',');
    const display = roleAttribute(owner.schema, 'displayName');
    return async query => {
      // Asked for bounded, because a loose search can match more of the
      // directory than it lets one search return.
      const found = await this.list(owner, query, scope, POINTER_SEARCH_LIMIT);
      return Object.entries(found).map(([id, entry]) => {
        const shown = display ? entryValue(entry, display) : undefined;
        const name = Array.isArray(shown) ? shown[0] : shown;
        return {
          dn: String(entry.dn || id),
          label: name && name !== id ? `${name} (${id})` : id,
          // Once chosen, named as the values the entry already holds.
          token: rdnValue(String(entry.dn || id)),
        };
      });
    };
  }

  /**
   * A search for the entries a group's members or owners name, for the form
   * to offer as the operator types.
   *
   * Those attributes hold DNs the schema types as plain strings, so the form
   * asked for a DN typed by hand: an administrator knows a colleague by their
   * email address, not by `uid=jdoe,ou=users,dc=example,dc=org`. The search
   * looks among the entries that have an email address — the accounts, and
   * for members the groups too, a group being able to hold another — in the
   * attributes the list searches, and names each by its display name and its
   * address.
   *
   * @param role `members` or `owners`
   * @param entities entities the console knows
   * @param keep which of the entries found may be offered, judged before
   *   the cut: a group's members matching the query filled it, leaving
   *   none to add
   * @returns a search, or undefined when no entity has an email address
   */
  memberSearch(
    role: 'members' | 'owners',
    entities: EntityDescriptor[],
    keep?: (dn: string) => boolean
  ):
    | ((
        query: string
      ) => Promise<
        { dn: string; label: string; token: string; mail?: string }[]
      >)
    | undefined {
    const searched = entities.filter(
      entity =>
        (entity.kind === 'flat' ||
          (role === 'members' && entity.kind === 'group')) &&
        roleAttribute(entity.schema, 'primaryEmail')
    );
    if (searched.length === 0) return undefined;
    return async query => {
      const found = await Promise.allSettled(
        searched.map(async entity => {
          const scope = searchableAttributes(entity)
            .map(([name]) => name)
            .join(',');
          const entries = await this.list(
            entity,
            query,
            scope,
            keep ? POINTER_LOOKUP_LIMIT : POINTER_SEARCH_LIMIT
          );
          const mail = roleAttribute(entity.schema, 'primaryEmail') as string;
          const display = roleAttribute(entity.schema, 'displayName');
          // An entry answered without its DN cannot be written as a member:
          // its identifier is no DN, and the save would be refused.
          return Object.entries(entries)
            .filter(
              ([, entry]) => entry.dn && (!keep || keep(String(entry.dn)))
            )
            .map(([id, entry]) => {
              const first = (name?: string): string | undefined => {
                const raw = name ? entryValue(entry, name) : undefined;
                return Array.isArray(raw) ? raw[0] : raw;
              };
              const name = first(display) || id;
              const address = first(mail);
              return {
                dn: String(entry.dn),
                label: address ? `${name} <${address}>` : name,
                // Once chosen, named as the members the group already has.
                token: rdnValue(String(entry.dn)),
                // What a team mailbox judges a member by.
                ...(address ? { mail: address } : {}),
              };
            });
        })
      );
      // A branch the caller may not read leaves the others to answer; the
      // search fails only when none could.
      const answered = found.filter(
        (result): result is PromiseFulfilledResult<MemberOption[]> =>
          result.status === 'fulfilled'
      );
      if (answered.length === 0)
        throw (found[0] as PromiseRejectedResult).reason;
      // Taken in turn from each branch, so that a query matching many
      // accounts still leaves room for the groups it matches.
      const lists = answered.map(result => result.value);
      const options: MemberOption[] = [];
      for (
        let index = 0;
        options.length < POINTER_SEARCH_LIMIT &&
        lists.some(list => index < list.length);
        index++
      )
        for (const list of lists)
          if (index < list.length && options.length < POINTER_SEARCH_LIMIT)
            options.push(list[index]);
      return options;
    };
  }

  /**
   * A search for the groups an account may be added to, for its card to
   * offer as the operator types: the pointer search of the groups' branch,
   * answering the entries themselves rather than their names, since the
   * card says each group's type and address and keeps the groups the
   * caller may not write out of the offer.
   *
   * The groups not to offer are left out before the answer is cut to its
   * length, not after: cut first, a search whose first answers were all
   * groups the caller may not write offered nothing, however many others
   * it matched. The server is asked for more than are offered for that.
   *
   * @param entities entities the console knows: the groups among them are
   *   searched
   * @param keep whether a group found may be offered
   * @returns a search, or undefined when the console knows no group
   */
  groupSearch(
    entities: EntityDescriptor[],
    keep: (found: GroupMatch) => boolean = () => true
  ): ((query: string) => Promise<GroupMatch[]>) | undefined {
    const searched = entities.filter(
      entity =>
        entity.kind === 'group' && roleAttribute(entity.schema, 'members')
    );
    if (searched.length === 0) return undefined;
    return async query => {
      const found = await Promise.allSettled(
        searched.map(async entity => {
          const scope = searchableAttributes(entity)
            .map(([name]) => name)
            .join(',');
          const entries = await this.list(
            entity,
            query,
            scope,
            POINTER_LOOKUP_LIMIT
          );
          // A group answered without its DN cannot be told apart from the
          // account's own groups, nor written to by name.
          return Object.values(entries)
            .filter(entry => entry.dn)
            .map(entry => ({ entity, dn: String(entry.dn), entry }))
            .filter(keep)
            .slice(0, POINTER_SEARCH_LIMIT);
        })
      );
      const answered = found.filter(
        (result): result is PromiseFulfilledResult<GroupMatch[]> =>
          result.status === 'fulfilled'
      );
      if (answered.length === 0)
        throw (found[0] as PromiseRejectedResult).reason;
      return answered.flatMap(result => result.value);
    };
  }

  /**
   * The mail domains and the organizations' links to them, for one form:
   * see `MailDomains`. Each is read when first asked for and kept for as
   * long as the form is open, so that every "@" the operator types costs no
   * request after the first.
   *
   * The organizations are read one by one from the one asked about up to
   * the top of the tree, as the server walks them when it judges an address
   * or a link: every administrator reads the tree, which is reference data.
   * A directory without a tree, or whose organizations link no domain,
   * restricts nothing, and nor does the form.
   *
   * @param entities entities the console knows
   * @returns the lookup, or undefined when the directory keeps no domains
   */
  mailDomains(entities: EntityDescriptor[]): MailDomains | undefined {
    const owner = domainEntity(entities);
    if (!owner) return undefined;
    const named = roleAttribute(owner.schema, 'domainName') as string;
    const link = roleAttribute(
      entities.find(entity => entity.kind === 'organization')?.schema,
      'domainLink'
    );
    const top = this.topOrganization;
    let listed: Promise<{ dn: string; name: string }[]> | undefined;
    const list = (): Promise<{ dn: string; name: string }[]> =>
      (listed ??= this.list(owner).then(entries =>
        Object.entries(entries)
          .filter(([, entry]) => isEntryOf(owner, entry))
          .map(([id, entry]) => ({
            dn: String(entry.dn || id),
            name: (toValues(entryValue(entry, named))[0] ?? '')
              .trim()
              .toLowerCase(),
          }))
          .filter(domain => domain.name)
      ));
    // What each organization links itself, by DN: the chains of two
    // departments of one company share every organization above them.
    const own = new Map<string, Promise<string[]>>();
    const linked = async (organization: string): Promise<string[]> => {
      if (!link || !top || !withinDn(organization, top)) return [];
      const chain: string[] = [];
      for (let dn: string | undefined = organization; dn; dn = parentDn(dn)) {
        chain.push(dn);
        if (comparableDn(dn) === comparableDn(top)) break;
      }
      const links = await Promise.all(
        chain.map(dn => {
          const key = comparableDn(dn);
          let read = own.get(key);
          if (!read) {
            read = this.organization(dn).then(entry =>
              toValues(entryValue(entry, link))
            );
            own.set(key, read);
          }
          return read;
        })
      );
      return links.flat();
    };
    const sorted = (names: string[]): string[] =>
      [...new Set(names)].filter(name => name !== '*').sort();
    return {
      linked,
      names: async (organization?: string): Promise<string[]> => {
        const domains = await list();
        const every = sorted(domains.map(domain => domain.name));
        if (!organization) return every;
        let links: string[];
        try {
          links = await linked(organization);
        } catch {
          // Which domains the tree allows is unknown: the server judges.
          return every;
        }
        const byDn = new Map(
          domains.map(domain => [comparableDn(domain.dn), domain.name])
        );
        const names = links
          .map(dn => byDn.get(comparableDn(dn)))
          .filter((name): name is string => !!name);
        return names.length === 0 || names.includes('*')
          ? every
          : sorted(names);
      },
    };
  }

  /**
   * Every organization, as pointer candidates labelled by their readable path.
   *
   * The walk is breadth-first and bounded: a directory with a very wide tree
   * should not turn opening a form into hundreds of requests.
   *
   * @param from subtrees to walk instead of the whole tree; nested ones are
   * walked once
   * @returns DN and label of each organization found
   */
  async organizationOptions(
    from?: OrganizationNode[]
  ): Promise<{ dn: string; label: string }[]> {
    return (await this.organizationWalk(from)).organizations;
  }

  /**
   * {@link organizationOptions}, saying whether the walk stopped at its
   * bound before the end of the tree: what it did not reach may hold what
   * is looked for.
   *
   * @param from subtrees to walk instead of the whole tree
   * @returns the organizations found, and whether some were left unread
   */
  async organizationWalk(from?: OrganizationNode[]): Promise<{
    organizations: { dn: string; label: string }[];
    partial: boolean;
  }> {
    const roots = from ?? [await this.organizationTop()];
    const options: { dn: string; label: string }[] = [];
    const queue = roots.filter((node): node is OrganizationNode => !!node);
    const seen = new Set<string>();
    let visited = 0;
    // Whether every branch reached was read whole: one the server cut, or
    // could not read, may hold organizations the walk never saw.
    let complete = true;
    while (queue.length > 0 && visited < ORGANIZATION_OPTION_LIMIT) {
      const node = queue.shift() as OrganizationNode;
      const key = comparableDn(node.dn);
      if (seen.has(key)) continue;
      seen.add(key);
      visited++;
      options.push({ dn: node.dn, label: node.path || node.name });
      try {
        const { nodes, truncated } = await this.organizationChildrenRead(
          node.dn
        );
        queue.push(...nodes);
        if (truncated) complete = false;
      } catch (err) {
        // A branch the caller may not read is simply not offered; one that
        // failed otherwise is unknown, not empty.
        if ((err as { status?: number }).status !== 403) complete = false;
      }
    }
    return {
      organizations: options,
      partial:
        !complete || queue.some(node => !seen.has(comparableDn(node.dn))),
    };
  }

  /**
   * Organizations whose name, description or path contain a text, as pointer
   * candidates labelled by their readable path.
   *
   * The server searches the whole subtree in one request, where walking it
   * costs one per organization. It cuts its answer and ends it with an
   * indicator row when more matched: that row is no organization, and the
   * operator refines the text rather than paging.
   *
   * @param query text to look for
   * @param from organization whose subtree is searched; the top by default
   * @param limit most matches kept: few for a list of suggestions, every
   *   one the server answered for the tree's filter
   * @returns DN and label of each match, in reading order
   */
  async organizationSearch(
    query: string,
    from = this.topOrganization,
    limit = POINTER_SEARCH_LIMIT
  ): Promise<{ dn: string; label: string }[]> {
    return (await this.organizationSearchRead(query, from, limit))
      .organizations;
  }

  /**
   * {@link organizationSearch}, saying whether the answer was cut, by the
   * server or by `limit`: the matches kept are the first ones found, not the
   * first in reading order, and a list that looks whole would hide the
   * others.
   *
   * @param query text to look for
   * @param from organization whose subtree is searched; the top by default
   * @param limit most matches kept
   * @returns the matches, in reading order, and whether some were left out
   */
  async organizationSearchRead(
    query: string,
    from = this.topOrganization,
    limit = POINTER_SEARCH_LIMIT
  ): Promise<{
    organizations: { dn: string; label: string }[];
    truncated: boolean;
  }> {
    if (!from) return { organizations: [], truncated: false };
    const found =
      (await this.call<Entry[]>(
        `${this.apiPrefix}/v1/ldap/organizations/${encodeURIComponent(from)}` +
          `/search?q=${encodeURIComponent(query)}`
      )) || [];
    const matches = found
      .filter(entry => !isMoreIndicator(entry))
      .map(entry => this.toNode(entry))
      .map(node => ({ dn: node.dn, label: node.path || node.name }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, {
          sensitivity: 'base',
          numeric: true,
        })
      );
    return {
      organizations: matches.slice(0, limit),
      truncated: found.some(isMoreIndicator) || matches.length > limit,
    };
  }

  /** Turn an organization entry into a tree node. */
  private toNode(entry: Entry): OrganizationNode {
    const dn = String(entry.dn || '');
    const value = (name: string): string | undefined => {
      const raw = entryValue(entry, name);
      return Array.isArray(raw) ? raw[0] : raw;
    };
    return {
      dn,
      // An organization names itself with `ou` or `o`; a directory that used
      // neither is read from its DN, through the reader that knows LDAP's
      // escapes.
      name: value('ou') || value('o') || rdnValue(dn),
      path: this.organizationPathAttribute
        ? value(this.organizationPathAttribute)
        : undefined,
    };
  }

  /** Base DN of the directory, for display. */
  get base(): string {
    return this.ldapBase;
  }
}
