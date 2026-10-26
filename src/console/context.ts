/**
 * What a view or an action is given of the console, instead of reaching into
 * it: the client, the words, the rights, the entities, the panel and the
 * dialog, the toast and the reporter, the ticket of the page drawn, the
 * address, the tree, an entry's relations, the transit count, the words of
 * a creation and the first password of an account created, and what the
 * organizations page asks of the pages and actions still in the console:
 * the names of what entries point at, an organization's entries, Claim…,
 * a list opened on a search, the forms and the deletion (#220).
 *
 * @module twake-directory-manager/console/context
 */

import type { ConsoleApiClient } from '../api/ConsoleApiClient';
import type { AttachedOptions } from '../components/AttachedTables';
import type { ListView } from '../components/EntityList';
import type { OrganizationTree } from '../components/OrganizationTree';
import type { Translator } from '../i18n';
import type { Rights } from '../rights';
import type { Reporter } from '../shared/background';
import type { AttachedEntries, EntityDescriptor, Entry } from '../types';
import type { DialogService } from './dialog';
import type { PanelService } from './panel';
import type { Route } from './route';

/**
 * The entries related to one: the members of a group, the groups an
 * account belongs to, as its card lists them.
 */
export interface Relations {
  title: string;
  attribute: string;
  items: {
    id: string;
    label: string;
    note?: string;
    removable?: boolean;
  }[];
  groups?: boolean;
  /** The groups could not be listed: none is not to be told from it */
  unknown?: boolean;
}

/**
 * The console as a view sees it, built once in `init()` from its own fields
 * and methods. What changes over the console's life — the translator after
 * a language switch, the rights once the scope is read, the entities once the
 * directory is — is asked each time through a function, never copied: a view
 * keeps the context, not what it said.
 *
 * It holds what the views and actions moved out so far need (the password
 * policies and the organizations; the password resets, the state changes,
 * the transit, the deletions and the forms), and grows with each view and
 * action moved out of `DirectoryConsole` (#220): add a member when a moved
 * method needs one, not before.
 */
export interface ConsoleContext {
  /** The client of ldap-rest */
  readonly api: ConsoleApiClient;
  /** The translator of the interface's language now */
  translator(): Translator;
  /** The translator's `t`, in the interface's language now */
  readonly t: (key: string, values?: Record<string, string | number>) => string;
  /** What the caller may do, read from the scope as it is now */
  rights(): Rights;
  /** Show a short message; a refusal interrupts the screen reader */
  toast(message: string, isError?: boolean): void;
  /** Where work nobody waits for ends when it fails (see `background`) */
  readonly report: Reporter;
  /** The side panel every form opens in */
  readonly panel: PanelService;
  /** The question asked before what cannot be taken back */
  readonly dialog: DialogService;
  /**
   * Whether the page this ticket was taken for is still the one asked for:
   * checked after every `await` of a view, so that a late answer never draws
   * over a newer page
   */
  current(generation: number): boolean;
  /**
   * Take a new ticket, as drawing a page does: what a page shows of itself
   * on a click, an organization picked in the tree, is navigation like any
   * other, and an answer for what was asked before draws nothing over it
   */
  ticket(): number;
  /** Title the browser tab after the page, or with the bare title for none */
  titlePage(name?: string): void;
  /** Draw the page the address names again, after a change of what it shows */
  refresh(): Promise<void>;
  /** The entities the directory serves, as discovered: none before */
  entities(): EntityDescriptor[];
  /**
   * A person as a colleague names them: their full name, else as their card
   * names them. The console's own until the names move out with the views
   * that share them.
   */
  personName(entity: EntityDescriptor, entry: Entry, id: string): string;
  /**
   * A new entry named by its full name, else as its card names it; empty
   * when the form gave none and the server named no entry.
   */
  submittedName(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    id: string
  ): string;
  /**
   * An entry named as its card and its list name it: a nomenclature's by
   * the label its schema gives it, else by its identifier.
   */
  entryName(entity: EntityDescriptor, id: string): string;
  /**
   * The first value of the attribute playing a role, trimmed; none when
   * empty
   */
  roleValue(
    entity: EntityDescriptor,
    entry: Entry,
    role: string
  ): string | undefined;
  /** Open the page an address names, after `#/`: the hash's change draws it */
  go(path: string): void;
  /**
   * Name the page in the address without drawing it again; `replace` takes
   * the place of the current address, for a page that no longer exists
   */
  record(path: string, replace?: boolean): void;
  /** The page the address names now */
  route(): Route;
  /**
   * Read what waits in transit again, and count it on the banner: null when
   * there is nothing to read
   */
  readTransit(): Promise<AttachedEntries | null>;
  /** The organization tree drawn last, when the organizations page drew one */
  tree(): OrganizationTree | null;
  /** What to call a collection: the schema's label in the language now */
  plural(entity: EntityDescriptor): string;
  /**
   * How a card or a list names the entries an entity's pointers land on:
   * the names the schema gives, those of the branches it can list read
   */
  pointerNames(
    entity: EntityDescriptor
  ): Promise<(dn: string) => string | undefined>;
  /**
   * The names of what the accounts and the groups attached somewhere point
   * at
   */
  attachedNames(): Promise<(dn: string) => string | undefined>;
  /**
   * The accounts and the groups attached to an organization, each kind
   * asked apart
   */
  readMembers(dn: string): Promise<AttachedEntries>;
  /** The address of a related entry's card, in whichever entity owns its DN */
  relationHref(dn: string): string | undefined;
  /** Claim…, at the end of each row listing what waits in transit */
  claimAction(): NonNullable<AttachedOptions['rowAction']>;
  /**
   * Open an entity's list on a search of its own, kept as where the reader
   * left that list: the list page is the console's until it moves
   */
  openList(entity: EntityDescriptor, view: ListView): void;
  /**
   * Create or edit an entry of a flat or group entity, `here` presetting
   * where it goes and what follows its creation (see `FormActions.open`)
   */
  openForm(
    entity: EntityDescriptor,
    entry?: Entry,
    here?: { preset: Entry; created(): void }
  ): void;
  /**
   * Create or edit an organization, under a parent when named (see
   * `FormActions`)
   */
  openOrganizationForm(
    entity: EntityDescriptor,
    entry?: Entry,
    parentDn?: string
  ): void;
  /** Delete an organization once asked (see `DeletionActions.organization`) */
  deleteOrganization(
    entity: EntityDescriptor,
    entry: Entry,
    dn: string
  ): Promise<void>;
  /**
   * An entry's members or groups, as its card lists them. `strict` fails
   * a search of groups that cannot be made, rather than finding none.
   */
  relations(
    entity: EntityDescriptor,
    entry: Entry,
    strict?: boolean
  ): Promise<Relations | undefined>;
  /** The group entity whose branch holds a DN */
  groupEntity(dn: string): EntityDescriptor | undefined;
  /**
   * Open an account's change of state, a state picked already when named:
   * the deletion's way out (see `StateActions`)
   */
  changeState(
    entity: EntityDescriptor,
    id: string,
    entry: Entry,
    preselect?: string
  ): Promise<void>;
  /**
   * What the button and the panel creating an entry of an entity read, as
   * the Overview and the list name them
   */
  createLabel(entity: EntityDescriptor): string;
  /**
   * Give an account created without a password a generated one, shown in
   * the form's panel before `next` (see `PasswordActions.give`): the forms'
   * way to it, since an action calls no other action
   *
   * @returns whether the form's panel now shows a password, and stays
   */
  givePassword(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    id: string,
    next: () => void,
    own?: () => boolean
  ): Promise<boolean>;
}
