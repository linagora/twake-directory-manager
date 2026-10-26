/**
 * Types of the directory console.
 *
 * Everything the console knows about a directory comes from
 * `GET {apiPrefix}/v1/config` and from the schemas it points at. No entity
 * name, attribute name or label is written here: an entity the deployment
 * adds appears in the interface without a line of code.
 *
 * @module twake-directory-manager/types
 */

/** Semantic role of an attribute, as declared by the server-side schema. */
export type SchemaRole = string;

/**
 * A piece of text the server supplies, in one or several languages. A plain
 * string is the text itself; a map is keyed by language tag.
 */
export type LocalizedText = string | Record<string, string>;

/**
 * Where a group takes members outside the directory: a member named by its
 * address alone is created there by the server's `externalUsersInGroups`.
 */
export interface ExternalMembers {
  /** DN the server creates external members under */
  branch: string;
  /** Attribute of their RDN, holding the address */
  rdnAttribute: string;
  /** Lower-cased domains whose addresses belong to accounts instead */
  managedDomains: string[];
}

/** One attribute of an entity schema. */
export interface SchemaAttribute {
  type:
    'string' | 'number' | 'integer' | 'boolean' | 'date' | 'array' | 'pointer';
  items?: {
    type: string;
    test?: string;
    hint?: LocalizedText;
    branch?: string[];
  };
  default?: unknown;
  required?: boolean;
  test?: string;
  /** Plain-language description of `test`, shown under the field */
  hint?: LocalizedText;
  branch?: string[];
  fixed?: boolean;
  /**
   * No two entries may hold the value. An object widens the namespace to
   * other attributes — an address must not already be someone's alias.
   */
  unique?: boolean | { attributes?: string[]; branches?: string[] };
  /**
   * Which mail domains an address may be at, as ldap-rest's
   * `ldap/enterpriseRules` checks it: those of the entry's organization and
   * of the organizations above it, or those of the whole directory
   */
  mailDomainScope?: 'organization' | 'directory';
  /** Whether a subdomain of an allowed mail domain is allowed too */
  allowSubdomains?: boolean;
  /** Server-side normalisation, which decides how the value reads back */
  normalize?: 'byteSize';
  /** Whether "search everywhere" includes this attribute; see the schema doc */
  searchable?: boolean;
  role?: SchemaRole | SchemaRole[];
  /** Computed server-side: shown, never edited */
  generated?: boolean;
  /** How the server derives a generated value from another attribute */
  generatedFrom?: {
    attribute: string;
    extract?: string;
    lowercase?: boolean;
    /** Characters taken out, after `extract` and `lowercase` */
    strip?: string;
    onCollision?: 'error' | 'suffix';
    regenerateOnChange?: boolean;
  };
  /** Derived elsewhere: shown, never edited */
  readOnly?: boolean;
  /** Never returned by the API: offered on creation only */
  neverReturn?: boolean;
  /** Named lifecycle states this attribute can be moved to */
  states?: Record<string, string>;
  /** What the attribute is, shown on demand next to its label */
  help?: LocalizedText;
  /** Heading the form groups the field under */
  group?: LocalizedText;
  /** Name to show instead of the attribute name, in one or several languages */
  label?: LocalizedText;
}

export interface EntitySchema {
  strict?: boolean;
  attributes: Record<string, SchemaAttribute>;
  /** Metadata the server carries alongside the attributes */
  entity?: {
    label?: LocalizedText;
    singularLabel?: LocalizedText;
    /** Readable name of an entry, keyed by its main attribute value */
    valueLabels?: Record<string, LocalizedText>;
    /** Searched before listed, and searched from a pointer; see isLarge() */
    large?: boolean;
  };
}

/** An entity the console can browse, as advertised by the server. */
export interface EntityDescriptor {
  /** Key used in the URL fragment and in the sidebar */
  key: string;
  /** Plural name, from the schema — the deployment's own vocabulary */
  pluralName: string;
  singularName: string;
  /** Names to show for the collection and for one entry, per language */
  label?: LocalizedText;
  singularLabel?: LocalizedText;
  /** Attribute holding the RDN value */
  mainAttribute: string;
  base: string;
  schema: EntitySchema;
  /** Base path of the REST collection */
  endpoint: string;
  /** How the console presents it */
  kind: 'flat' | 'group' | 'organization';
  /** Attribute carrying the DN of the owning organization, when there is one */
  organizationLink?: string;
  /** Attribute carrying the readable path of that organization */
  organizationPath?: string;
  /** Attribute carrying the lifecycle state, when the entity has one */
  accountStatus?: string;
  /** Attribute carrying the credential, when the entity has one */
  password?: string;
}

/** A single directory entry, as the API returns it. */
export type Entry = Record<string, string | string[] | undefined> & {
  dn?: string;
};

/** Entries of a list request, and whether the server stopped before the end. */
export interface EntryList {
  entries: Record<string, Entry>;
  truncated: boolean;
}

/** An entry attached to an organization, as its card lists it. */
export interface AttachedEntry {
  dn: string;
  /** Its own name: the value of its RDN */
  label: string;
  /** Key of the entity holding it, absent when the console knows none */
  entity?: string;
  /**
   * The first value of what the card shows of it, keyed by the role of the
   * attribute holding it: the full name, the address, the position and the
   * state of an account, the address and the type of a group. A pointer is
   * kept as the DN it holds
   */
  values?: Record<string, string>;
}

/** Entries attached to an organization, as many as the server listed. */
export interface AttachedEntries {
  entries: AttachedEntry[];
  /** The server left some out */
  truncated: boolean;
  /** How many it left out, when the directory let it count them */
  more?: number;
  /**
   * What it left out of the accounts and of the groups, each asked on its
   * own: the server caps and counts each answer apart. Absent when both
   * were asked in one answer, whose cut says nothing of the kind
   */
  cut?: Partial<
    Record<'people' | 'groups', { truncated: boolean; more?: number }>
  >;
}

/** Answer of `GET /v1/authz/scope`. */
export interface Scope {
  user: string | null;
  unrestricted: boolean;
  /**
   * `false` when the plugins judging the caller gate routes or read a token,
   * and none can say what the caller may do: `branches` and `entities` are
   * then empty for want of a model, not of rights. Absent before ldap-rest
   * 0.9.0, which answered `unrestricted: true` there
   */
  described?: boolean;
  branches: {
    dn: string;
    name?: string;
    path?: string;
    read?: boolean;
    write?: boolean;
    delete?: boolean;
  }[];
  entities: { name: string; base: string; create: boolean }[];
  /**
   * The organization entries are handed over through between administrators,
   * `null` when there is none. Absent before ldap-rest 0.11.1
   */
  transit?: string | null;
  /**
   * Whether the caller links an organization to any mail domain, not only to
   * those an organization above it links: the writer of the top organization
   * and of the global one do. Absent before the ldap-rest that added it,
   * whose rule the console then reads from the branches
   */
  linksAnyDomain?: boolean;
  /**
   * Whether the caller may list the password policies. Absent when the
   * server serves none, and before ldap-rest 0.25.0, whose console then asks
   * for them to know
   */
  passwordPolicies?: boolean;
}

/** Options accepted by the console. */
export interface ConsoleOptions {
  /** Id of the element the console renders into */
  containerId: string;
  /** Origin of the API; defaults to the page's own */
  apiBaseUrl?: string;
  /**
   * Prefix the server serves its API under, when it is not the default
   * `/api` — the console reads the rest from `GET {apiPrefix}/v1/config`,
   * but that first request has nothing to read it from
   */
  apiPrefix?: string;
  /** Interface language; defaults to the browser's, falling back to English */
  language?: string;
  /**
   * Told of a failure in work the console started without waiting for it
   * (a view drawn again after a save, a count read for the banner…), after
   * the console has shown it to the administrator and logged it. `context`
   * names what was started. For the page to send where it collects its
   * errors; the console reports nowhere itself.
   */
  onError?: (error: unknown, context: string) => void;
}

/** One organization of the tree. */
export interface OrganizationNode {
  dn: string;
  name: string;
  path?: string;
  children?: OrganizationNode[];
  loaded?: boolean;
}

/**
 * An OpenLDAP password policy, as ldap-rest's `core/ldap/passwordPolicy`
 * serves it: the attributes the entry holds, durations in seconds, `TRUE` /
 * `FALSE` as booleans. An attribute the entry lacks is absent.
 */
export interface PasswordPolicy {
  dn: string;
  cn: string;
  /** The policy accounts without `pwdPolicySubentry` get */
  isDefault: boolean;
  [attribute: string]: unknown;
}

/** The password policies, as `GET /password-policies` serves them. */
export interface PasswordPolicies {
  policies: PasswordPolicy[];
  /**
   * The attributes a policy can be given, those the directory's schema
   * defines; absent when the server does not tell them
   */
  attributes?: string[];
}

/**
 * What ldap-rest (0.25.0 and later) says of a common refusal besides its
 * sentence, in the fields of its answer: enough to say it in the interface's
 * language, next to the field at fault, without reading the sentence back.
 */
export interface Refusal {
  /**
   * `unique` (a value already used), `mailDomain` (an address outside the
   * authorised domains) or `forbidden` (outside the caller's branches); a
   * code the console does not know is said as the server worded it
   */
  code: string;
  /** The attribute refused */
  attribute?: string;
  /** The value refused */
  value?: string;
  /** The authorised mail domains, for `mailDomain` */
  domains?: string[];
}
