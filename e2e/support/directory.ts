import { randomInt } from 'node:crypto';

import {
  Attribute,
  Change,
  Client,
  NoSuchObjectError,
  NotAllowedOnNonLeafError,
} from 'ldapts';

import { type Account, ORG } from './accounts';
import { env, stack } from './env';

const BASE = 'dc=example,dc=com';
const BIND_DN = `cn=admin,${BASE}`;
const BIND_PASSWORD = 'admin';
const USERS = `ou=users,${BASE}`;
const GROUPS = `ou=groups,${BASE}`;
const STATUS = `ou=twakeAccountStatus,ou=nomenclature,${BASE}`;
const MAILBOX_TYPE = `ou=twakeMailboxType,ou=nomenclature,${BASE}`;
/** DM_PPOLICY_BASE of the stack */
export const POLICIES = `ou=policies,${BASE}`;
/** The seeded default policy, slapd's olcPPolicyDefault */
export const DEFAULT_POLICY = `cn=default,${POLICIES}`;
/** The mail domains, which DM_AUTHZ_GLOBAL_WRITE_BRANCHES lets admin add and delete */
export const DOMAINS = `ou=domains,ou=nomenclature,${BASE}`;
/**
 * The top-level domain of the mail domains a test adds: reserved (RFC 2606), and how the tests
 * reading the whole list of domains tell them from the seed's
 */
export const TEST_DOMAIN = /\.test$/;

/**
 * Consonants only: a unique part never holds a vowel nor a digit, so it never matches the
 * searches the test plan runs on the seed (`ali`, `Moreau`, `E002`, `eng`, `sal`, `Ger`…).
 */
const ALPHABET = 'bcdfghjkmnpqrstvwxz';

/** A random, lower case, unique part for the names of a test's entries */
export function uniquePart(length = 6): string {
  let part = '';
  for (let i = 0; i < length; i++) part += ALPHABET[randomInt(ALPHABET.length)];
  return part;
}

export interface Organization {
  dn: string;
  name: string;
  /** twakeDepartmentPath: "Sales / France" */
  path: string;
}

export interface CreateOrganizationOptions {
  parent?: string;
  /**
   * Readable start of the name: `France` gives `France <unique>`. An organization name is
   * unique in the whole directory (the server refuses a second "France"), as the tests running
   * beside this one may create theirs.
   */
  name?: string;
  description?: string;
  localAdmins?: Account[];
  managers?: Account[];
}

export interface CreateUserOptions {
  /** Organization of the account, Human Resources by default */
  org?: Organization;
  /** Readable start of the uid: `tom` gives `tom.<unique>` */
  prefix?: string;
  /** The whole uid, for an account taking the place of a deleted one; `prefix` is ignored */
  uid?: string;
  firstName?: string;
  lastName?: string;
  employeeNumber?: string;
  status?: 'active' | 'disabled' | 'noaccess' | 'todelete';
  extra?: Record<string, string | string[]>;
}

export interface CreateGroupOptions {
  org?: Organization;
  /** Readable start of the cn: `qa` gives `qa-<unique>` */
  prefix?: string;
  mail?: string;
  members?: Account[];
  owners?: Account[];
  mailboxType?: 'group' | 'mailingList' | 'teamMailbox';
}

export interface Group {
  cn: string;
  dn: string;
  mail: string | undefined;
}

/** The seeded Human Resources, which nobody but admin administers */
export const HUMAN_RESOURCES: Organization = {
  dn: ORG.humanResources,
  name: 'Human Resources',
  path: 'Human Resources',
};

/** The seeded Transit, whose entries every administrator sees */
export const TRANSIT: Organization = {
  dn: ORG.transit,
  name: 'Transit',
  path: 'Transit',
};

/**
 * Writes the entries a test works on straight into OpenLDAP, as the seed does, and removes
 * them after the test. The seed itself is never changed: a test that edits, moves, hands over or
 * deletes does it on entries of its own, named with a unique part, so that tests run in
 * parallel on one stack. An entry the test creates through the console is registered with
 * `track(dn)` to be removed the same way.
 */
export class Directory {
  readonly #created: string[] = [];
  #client: Client | null = null;

  async #ldap(): Promise<Client> {
    if (this.#client === null) {
      const client = new Client({ url: `ldap://${stack().ldap}:389` });
      await client.bind(BIND_DN, BIND_PASSWORD);
      this.#client = client;
    }
    return this.#client;
  }

  /** Registers an entry for removal after the test (removed in the reverse order) */
  track(dn: string): void {
    this.#created.push(dn);
  }

  /** Registers an account the console creates (form, import) for removal; returns its DN */
  trackUser(uid: string): string {
    const dn = `uid=${uid},${USERS}`;
    this.track(dn);
    return dn;
  }

  /** Registers a group the console creates for removal; returns its DN */
  trackGroup(cn: string): string {
    const dn = `cn=${cn},${GROUPS}`;
    this.track(dn);
    return dn;
  }

  async createOrganization(
    options: CreateOrganizationOptions = {}
  ): Promise<Organization> {
    const parent = options.parent ?? ORG.root;
    const name = `${options.name ?? 'QA'} ${uniquePart()}`;
    const dn = `ou=${name},${parent}`;
    const parentPath = parent === ORG.root ? '' : await this.#pathOf(parent);
    const path = parentPath === '' ? name : `${parentPath} / ${name}`;
    const attributes: Record<string, string | string[]> = {
      objectClass: ['top', 'organizationalUnit', 'twakeDepartment'],
      ou: name,
      twakeDepartmentPath: path,
    };
    if (options.description) attributes.description = options.description;
    if (options.localAdmins?.length)
      attributes.twakeLocalAdminLink = options.localAdmins.map(a => a.dn);
    if (options.managers?.length)
      attributes.twakeManagerLink = options.managers.map(a => a.dn);
    await (await this.#ldap()).add(dn, attributes);
    this.track(dn);
    return { dn, name, path };
  }

  async createUser(options: CreateUserOptions = {}): Promise<Account> {
    const org = options.org ?? HUMAN_RESOURCES;
    const unique = uniquePart();
    const prefix = options.prefix ?? 'qa';
    const uid = options.uid ?? `${prefix}.${unique}`;
    const firstName = options.firstName ?? capitalize(prefix);
    const lastName = options.lastName ?? capitalize(unique);
    const displayName = `${firstName} ${lastName}`;
    const mail = `${uid}@example.com`;
    const dn = `uid=${uid},${USERS}`;
    await (
      await this.#ldap()
    ).add(dn, {
      objectClass: ['top', 'twakeAccount', 'twakeWhitePages'],
      uid,
      employeeNumber: options.employeeNumber ?? `Q-${unique}`,
      cn: displayName,
      givenName: firstName,
      sn: lastName,
      displayName,
      mail,
      userPassword: env.password,
      twakeDepartmentLink: org.dn,
      twakeDepartmentPath: org.path,
      twakeAccountStatus: `cn=${options.status ?? 'active'},${STATUS}`,
      ...options.extra,
    });
    this.track(dn);
    return { uid, dn, password: env.password, displayName, mail };
  }

  /** Several accounts sharing a last name, so that a search finds exactly them */
  async createUsers(
    count: number,
    options: Omit<CreateUserOptions, 'lastName'> = {}
  ): Promise<{ lastName: string; users: Account[] }> {
    const lastName = capitalize(uniquePart(8));
    const users: Account[] = [];
    for (let i = 0; i < count; i++)
      users.push(await this.createUser({ ...options, lastName }));
    return { lastName, users };
  }

  async createGroup(options: CreateGroupOptions = {}): Promise<Group> {
    const org = options.org ?? HUMAN_RESOURCES;
    const cn = `${options.prefix ?? 'qa'}-${uniquePart()}`;
    const dn = `cn=${cn},${GROUPS}`;
    const members = options.members ?? [];
    const attributes: Record<string, string | string[]> = {
      objectClass: ['top', 'groupOfNames', 'twakeStaticGroup'],
      cn,
      description: `Group of the test ${cn}`,
      twakeMailboxType: `cn=${options.mailboxType ?? 'group'},${MAILBOX_TYPE}`,
      twakeDepartmentLink: org.dn,
      twakeDepartmentPath: org.path,
      // groupOfNames needs a member: the empty DN stands for none, as ldap-rest writes it
      member: members.length ? members.map(m => m.dn) : [''],
    };
    if (options.mail) attributes.mail = options.mail;
    if (options.owners?.length)
      attributes.owner = options.owners.map(o => o.dn);
    await (await this.#ldap()).add(dn, attributes);
    this.track(dn);
    return { cn, dn, mail: options.mail };
  }

  /** A position nobody holds, which may be deleted */
  async createPosition(): Promise<{ cn: string; dn: string }> {
    const cn = `QA position ${uniquePart()}`;
    const dn = `cn=${cn},ou=positions,${BASE}`;
    await (await this.#ldap()).add(dn, { objectClass: 'twakePosition', cn });
    this.track(dn);
    return { cn, dn };
  }

  /**
   * A password policy under the stack's DM_PPOLICY_BASE, as ldap-rest writes one: `attributes`
   * are its ppolicy attributes (`{ pwdMinLength: '12' }`)
   */
  async createPolicy(
    attributes: Record<string, string | string[]> = {}
  ): Promise<{ cn: string; dn: string }> {
    const cn = `qa-${uniquePart()}`;
    const dn = `cn=${cn},${POLICIES}`;
    await (
      await this.#ldap()
    ).add(dn, {
      objectClass: ['top', 'person', 'pwdPolicy'],
      cn,
      sn: cn,
      pwdAttribute: 'userPassword',
      ...attributes,
    });
    this.track(dn);
    return { cn, dn };
  }

  /** A mail domain `qa<unique>.test`, as the seed's are written */
  async createDomain(): Promise<{ id: string; name: string; dn: string }> {
    const id = `qa${uniquePart()}`;
    const name = `${id}.test`;
    const dn = `dc=${id},${DOMAINS}`;
    await (
      await this.#ldap()
    ).add(dn, {
      objectClass: ['top', 'domain', 'domainRelatedObject'],
      dc: id,
      associatedDomain: name,
    });
    this.track(dn);
    return { id, name, dn };
  }

  /** Values of the attributes of an entry, `null` when it does not exist */
  async read(
    dn: string,
    attributes: string[] = ['*']
  ): Promise<Record<string, string[]> | null> {
    try {
      const { searchEntries } = await (
        await this.#ldap()
      ).search(dn, { scope: 'base', attributes });
      const entry = searchEntries[0];
      if (!entry) return null;
      const values: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(entry)) {
        if (key === 'dn') continue;
        values[key] = (Array.isArray(value) ? value : [value]).map(String);
      }
      return values;
    } catch (error: unknown) {
      if (error instanceof NoSuchObjectError) return null;
      throw error;
    }
  }

  /** Values of one attribute of an entry, `[]` when it has none or does not exist */
  async values(dn: string, attribute: string): Promise<string[]> {
    const entry = await this.read(dn, [attribute]);
    if (entry === null) return [];
    const key = Object.keys(entry).find(
      name => name.toLowerCase() === attribute.toLowerCase()
    );
    return key === undefined ? [] : (entry[key] ?? []);
  }

  async exists(dn: string): Promise<boolean> {
    return (await this.read(dn, ['1.1'])) !== null;
  }

  /** The DNs of the accounts whose uid starts with `prefix` */
  async usersStartingWith(prefix: string): Promise<string[]> {
    const { searchEntries } = await (
      await this.#ldap()
    ).search(USERS, {
      scope: 'one',
      filter: `(uid=${prefix}*)`,
      attributes: ['1.1'],
    });
    return searchEntries.map(entry => entry.dn);
  }

  async addValues(
    dn: string,
    attribute: string,
    values: string[]
  ): Promise<void> {
    await (
      await this.#ldap()
    ).modify(
      dn,
      new Change({
        operation: 'add',
        modification: new Attribute({ type: attribute, values }),
      })
    );
  }

  /** Removes what the test created, deepest last created first; gone entries are fine */
  async cleanUp(): Promise<void> {
    if (this.#created.length === 0 && this.#client === null) return;
    const client = await this.#ldap();
    try {
      for (const dn of [...this.#created].reverse())
        await this.#deleteTree(client, dn);
    } finally {
      this.#created.length = 0;
      await client.unbind();
      this.#client = null;
    }
  }

  /** Deletes an entry, and first what the console created below it (an organization's children) */
  async #deleteTree(client: Client, dn: string): Promise<void> {
    try {
      await client.del(dn);
    } catch (error: unknown) {
      if (error instanceof NoSuchObjectError) return;
      if (!(error instanceof NotAllowedOnNonLeafError)) throw error;
      const { searchEntries } = await client.search(dn, {
        scope: 'one',
        attributes: ['1.1'],
      });
      for (const child of searchEntries)
        await this.#deleteTree(client, child.dn);
      await client.del(dn);
    }
  }

  async #pathOf(dn: string): Promise<string> {
    const [path] = await this.values(dn, 'twakeDepartmentPath');
    if (path === undefined) throw new Error(`${dn} has no twakeDepartmentPath`);
    return path;
  }
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
