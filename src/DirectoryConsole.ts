/**
 * Directory console — the administration interface.
 *
 * It is built entirely from what the server advertises: `GET /v1/config` gives
 * the entities, their schemas and their endpoints, `GET /v1/authz/scope` gives
 * what the signed-in administrator may do. No entity name, attribute name or
 * label is written here, so a deployment that names its things differently
 * gets its own interface without a change.
 *
 * @module browser/directory-console/DirectoryConsole
 */

import { escapeHtml } from './shared/dom';

import {
  ConsoleApiClient,
  isDomainBranch,
  isLarge,
  roleAttribute,
} from './api/ConsoleApiClient';
import { CONSOLE_LOGO, LINAGORA_LOGO } from './assets';
import {
  AttachedTables,
  attachedClass,
  attachedEntity,
  type AttachedKind,
} from './components/AttachedTables';
import { EntityDetail, stateLabel } from './components/EntityDetail';
import { EntityForm } from './components/EntityForm';
import { EntityImport } from './components/EntityImport';
import {
  EntityList,
  LIST_LIMIT,
  SEARCH_MINIMUM,
} from './components/EntityList';
import { GroupPicker, type GroupChoice } from './components/GroupPicker';
import { OrganizationTree } from './components/OrganizationTree';
import { PolicyForm, policyTableMarkup } from './components/PasswordPolicies';
import {
  attributeLabel,
  comparableDn,
  displayValue,
  entryValue,
  explainRefusal,
  isDnShaped,
  parentDn as parentOf,
  ownValueLabel,
  pointerLabel,
  rdnValue,
  resolveText,
  withinDn,
} from './format';
import { availableLanguages, languageName, Translator } from './i18n';
import { signInAgain } from './session';
import type { ListView } from './components/EntityList';
import type {
  OrganizationIndex,
  OrganizationMatches,
} from './components/OrganizationTree';
import type { PointerLookup } from './importer';
import type {
  AttachedEntries,
  AttachedEntry,
  ConsoleOptions,
  EntityDescriptor,
  Entry,
  EntryList,
  OrganizationNode,
  PasswordPolicy,
  Scope,
} from './types';

/** The signed-in account, as the overview names it. */
interface SignedIn {
  name: string;
  email?: string;
}

/** Where the console currently is. */
interface Route {
  view: 'dashboard' | 'entity' | 'organizations' | 'policies';
  entity?: string;
  id?: string;
}

/** What the console asks before an action it cannot take back. */
export interface Confirmation {
  /** The question, as the dialog's heading: "Delete Alice Martin?" */
  title: string;
  /** Paragraphs under it, as text */
  lines: string[];
  /** Names listed after the paragraphs: the entries of a selection */
  items?: string[];
  /** The button that acts, named after the action: "Delete Alice" */
  action: string;
  /** The action deletes nothing: its button is not the red one */
  reversible?: boolean;
  /**
   * A safer way to the same end, offered as a link under the paragraphs:
   * following it cancels the action and runs `run`
   */
  alternative?: { label: string; run: () => void };
}

const LANGUAGE_KEY = 'ldap-rest.console.language';
const POLICIES_KEY = 'password-policies';
const REFERENCE_OPEN_KEY = 'ldap-rest.console.referenceOpen';

/**
 * Whether a collection is one an administrator works in every day.
 *
 * What an administrator manages lives in the organization tree: the tree
 * itself, and the entries attached to a node of it — accounts, groups. What is
 * attached to no node is what those entries point at — positions, titles,
 * account states, mail domains — reference data, set up once and rarely
 * touched. The schema already says which is which, through the
 * `organizationLink` role, so the console needs no list of names to tell them
 * apart.
 *
 * @param entity collection to classify
 * @returns true for the tree and the entries attached to it
 */
export function isPrimaryEntity(entity: EntityDescriptor): boolean {
  return entity.kind === 'organization' || !!entity.organizationLink;
}

/**
 * The collections to put forward and the ones to tuck away. A directory with
 * no organization tree has nothing to tell apart: every collection is then
 * put forward rather than all of them hidden.
 *
 * @param entities every collection the server serves
 * @returns both lists, in the order the server gave them
 */
export function splitEntities(entities: EntityDescriptor[]): {
  primary: EntityDescriptor[];
  reference: EntityDescriptor[];
} {
  const primary = entities.filter(isPrimaryEntity);
  if (primary.length === 0) return { primary: entities, reference: [] };
  return {
    primary,
    reference: entities.filter(entity => !isPrimaryEntity(entity)),
  };
}

/**
 * The letter standing for a collection in the navigation and on its card.
 * Collections are named by the deployment, so a drawn icon could only guess
 * what one holds; its own initial never does.
 */
function initial(label: string): string {
  return (Array.from(label.trim())[0] || '').toLocaleUpperCase();
}

/** A chevron, turned by CSS when its section is open. */
const CHEVRON_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="m6 4 4 4-4 4"/></svg>';

/** Four squares: the overview, which is every collection at once. */
const OVERVIEW_ICON =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.6"/>' +
  '<rect x="9" y="1.5" width="5.5" height="5.5" rx="1.6"/>' +
  '<rect x="1.5" y="9" width="5.5" height="5.5" rx="1.6"/>' +
  '<rect x="9" y="9" width="5.5" height="5.5" rx="1.6"/></svg>';

/** What Tab can reach in the side panel. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

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
 * Identifier of an entry the console has just created, to open it.
 *
 * A flat entity answers the entry, keyed with the schema's spelling — or with
 * the directory's, which is not always the same: reading `created[uid]`
 * straight threw on a directory answering `UID`, and the console reported an
 * error for an entry it had created. A group answers only `{success: true}`,
 * so its identifier is the one the form sent: without it the console opened
 * `#/groups/` and the operator never saw the group.
 *
 * @param entity entity the entry belongs to
 * @param created what the create endpoint answered
 * @param values what the form submitted
 * @returns the identifier, or an empty string when neither holds one
 */
export function createdEntryId(
  entity: EntityDescriptor,
  created: unknown,
  values: Record<string, string | string[]>
): string {
  const first = (value: unknown): string | undefined => {
    const one = Array.isArray(value) ? (value[0] as unknown) : value;
    return typeof one === 'string' && one !== '' ? one : undefined;
  };
  const answered =
    created && typeof created === 'object'
      ? first(entryValue(created as Entry, entity.mainAttribute))
      : undefined;
  return answered ?? first(values[entity.mainAttribute]) ?? '';
}

/**
 * Whether the scope decides which actions the console offers.
 *
 * It does not when there is none — a server without `authzScope` — when it is
 * unrestricted, or when the server could not describe it. Each action is then
 * offered and the server answers it. An undescribed scope carries no branch
 * and no entity, and reading that as "no right" left a deployment gating its
 * routes with `authzPerRoute` a read-only console.
 *
 * @param scope what `GET /v1/authz/scope` answered
 * @returns true when the scope's branches and entities are the rights
 */
export function scopeRestricts(scope: Scope | null): scope is Scope {
  return !!scope && !scope.unrestricted && scope.described !== false;
}

/** Where an entry stands with the transit branch, and what the caller may do. */
export interface TransitState {
  /** Waiting for an administrator to claim it */
  inTransit: boolean;
  /** The caller may move it into an organization of theirs */
  claim: boolean;
  /** The caller may let it go into the transit branch */
  handOver: boolean;
  /**
   * What the caller may do to an entry in transit besides moving it. The
   * server judges those changes on the transit branch, or on the entry's
   * parent when it is attached to nothing, so an entry is usually claimed
   * first. Absent when the entry is not in transit
   */
  rights?: { write: boolean; delete: boolean };
}

/**
 * The transit moves offered on an entry.
 *
 * ldap-rest also counts an entry attached to no organization as in transit,
 * but `transit: null` does not tell a server judging by attachment without a
 * transit branch from one not judging by attachment at all, where nobody may
 * claim such an entry. The console therefore speaks of transit only when the
 * server names a transit branch.
 *
 * `POST /groups/:cn/move` refuses a group attached to no organization, so
 * such a group is in transit but cannot be claimed.
 *
 * @param scope what `GET /v1/authz/scope` answered
 * @param entity entity the entry belongs to
 * @param entry the entry as read
 * @returns whether it is in transit, and the moves offered
 */
export function transitState(
  scope: Scope | null,
  entity: EntityDescriptor,
  entry: Entry
): TransitState {
  const none = { inTransit: false, claim: false, handOver: false };
  if (!scopeRestricts(scope) || !scope.transit || !entity.organizationLink)
    return none;
  const raw = entryValue(entry, entity.organizationLink);
  const link = String((Array.isArray(raw) ? raw[0] : raw) ?? '');
  if (!link || comparableDn(link) === comparableDn(scope.transit)) {
    // The parent: everything up to the first comma the DN does not escape.
    const judged =
      link || String(entry.dn ?? '').replace(/^(?:\\.|[^,\\])*,/, '');
    const grants = (right: 'write' | 'delete'): boolean =>
      !!judged &&
      scope.branches.some(
        branch => branch[right] && withinDn(judged, branch.dn)
      );
    return {
      inTransit: true,
      claim:
        (!!link || entity.kind !== 'group') &&
        scope.branches.some(branch => branch.write),
      handOver: false,
      rights: { write: grants('write'), delete: grants('delete') },
    };
  }
  return {
    inTransit: false,
    claim: false,
    handOver: scope.branches.some(
      branch => branch.write && withinDn(link, branch.dn)
    ),
  };
}

/**
 * Whether the caller may change one entry, as the server judges it.
 *
 * ldap-rest judges a change on the organization the entry is attached to
 * only when it filters entries by attachment — always under `authzLinid1`,
 * under the other plugins only with `--authz-filter-attached-entries`, off
 * by default — and on the entry's parent otherwise: `ou=groups` for every
 * group. The scope does not say which, but a transit branch is named only
 * where entries are judged by attachment. Without one, either is taken, so
 * that nothing the server allows is hidden: what it refuses after all is
 * said in the console's words.
 *
 * An entry in transit is judged as {@link transitState} judges it: a local
 * administrator changes nothing in it before claiming it.
 *
 * @param scope what `GET /v1/authz/scope` answered
 * @param entity entity the entry belongs to
 * @param entry the entry as read
 * @returns false only when the scope says the server would refuse
 */
export function writesEntry(
  scope: Scope | null,
  entity: EntityDescriptor,
  entry: Entry
): boolean {
  if (!scopeRestricts(scope)) return true;
  const transit = transitState(scope, entity, entry);
  if (transit.rights) return transit.rights.write;
  const writes = (dn: string | undefined): boolean =>
    !!dn &&
    scope.branches.some(branch => branch.write && withinDn(dn, branch.dn));
  const raw = entity.organizationLink
    ? entryValue(entry, entity.organizationLink)
    : undefined;
  const link = String((Array.isArray(raw) ? raw[0] : raw) ?? '').trim();
  const parent = parentOf(String(entry.dn ?? ''));
  if (scope.transit) return writes(link || parent);
  return writes(link) || writes(parent);
}

/**
 * The branches an entry in transit can be claimed into: those the caller
 * writes, each standing for its subtree.
 *
 * @param scope what `GET /v1/authz/scope` answered
 * @returns the roots to offer the organizations of
 */
export function claimRoots(scope: Scope): OrganizationNode[] {
  return scope.branches
    .filter(branch => branch.write)
    .map(branch => ({
      dn: branch.dn,
      name: branch.name || rdnValue(branch.dn),
      path: branch.path,
    }));
}

/**
 * The branches a new organization can go under: the organizations the caller
 * writes, each standing for its subtree. The server judges a creation on the
 * parent it is given, so these are the parents it would accept.
 *
 * The transit branch is left out: every administrator writes it to hand
 * entries over, which makes it no organization of theirs to grow. One a
 * written branch above it holds is still covered by that branch.
 *
 * @param scope what `GET /v1/authz/scope` answered
 * @param top the root of the organization tree
 * @returns the branches, as the scope names them
 */
export function organizationParents(
  scope: Scope,
  top: string
): Scope['branches'] {
  const transit = scope.transit;
  return scope.branches.filter(
    branch =>
      branch.write &&
      !!top &&
      withinDn(branch.dn, top) &&
      !(transit && withinDn(branch.dn, transit))
  );
}

/**
 * How the list of an entity fetches its entries: a search once the operator
 * typed enough of one, the whole branch otherwise.
 *
 * Asks for `LIST_LIMIT` entries at most either way (a server predating
 * `limit` ignores it): the whole branch is what "List without searching"
 * asks for, and a search as loose as three letters can match more
 * of a large directory than it lets one search return. The list says so when
 * the server left entries out.
 *
 * @param api client to ask
 * @param entity entity listed
 * @returns the loader `EntityList` calls
 */
export function listLoader(
  api: ConsoleApiClient,
  entity: EntityDescriptor
): (search: string, attribute: string, cut?: boolean) => Promise<EntryList> {
  // A department's path is searched whatever its length: "IT" listed the
  // whole directory, bounded, and cut it in the browser.
  return (search, attribute, cut) =>
    search.length >= SEARCH_MINIMUM || (cut && search)
      ? api.listBounded(entity, search, attribute, LIST_LIMIT)
      : api.listBounded(entity, undefined, undefined, LIST_LIMIT);
}

/**
 * The console's one toast element: a message, then hidden after a while.
 *
 * Every message replaces the previous one, and so must its timer. A timer left
 * running from an earlier message hid the next one early. Nothing that cannot
 * be shown again goes here: a generated password stays in its panel.
 *
 * It sits in a live region drawn with the shell, so that a screen reader
 * says each message as it shows: a region that is hidden, or new, when its
 * text changes is not announced. A refusal interrupts; the others wait.
 */
export class ToastController {
  private timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * @param element finds the toast element, which survives re-renders
   * @param delay how long a message stays, in milliseconds
   */
  constructor(
    private readonly element: () => HTMLElement | null | undefined,
    private readonly delay = 5000
  ) {}

  /** Show a message. */
  show(message: string, isError = false): void {
    const toast = this.element();
    if (!toast) return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    toast
      .closest?.('[data-toast-region]')
      ?.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    toast.classList.toggle('dc-toast-error', isError);
    // Shown before it is written, for the region to announce the text.
    toast.hidden = false;
    toast.textContent = message;
    this.timer = setTimeout((): void => {
      this.timer = undefined;
      toast.hidden = true;
    }, this.delay);
  }
}

export class DirectoryConsole {
  private readonly options: ConsoleOptions;
  private readonly api: ConsoleApiClient;
  private translator: Translator;
  private container: HTMLElement | null = null;
  private entities: EntityDescriptor[] = [];
  private scope: Scope | null = null;
  /**
   * Why the scope could not be read, when it could not. A missing endpoint
   * is `scope = null` and means the server restricts nothing; a request that
   * failed means the console does not know what the caller may do, and it
   * offers nothing rather than every button.
   */
  private scopeError: string | null = null;
  /** Whether the server lets the caller read the password policies */
  private policiesReadable = false;
  /** The signed-in account, when it could be named rather than shown as a DN */
  private account: SignedIn | null = null;
  /**
   * What waits in the transit branch, as last read: counted on the banner's
   * Transit link, listed on the Overview. Null until read, or when there is
   * no transit branch to read
   */
  private transitWaiting: AttachedEntries | null = null;
  /** How many times it was asked for, so that only the last answer counts */
  private transitReads = 0;
  /**
   * Which view is the current one. Opening an entry, then another before the
   * first has answered, raced exactly the way the entity list did: whichever
   * `get` resolved last wrote its card, so entry A could end up on entry B's
   * URL. Every view takes a ticket and writes nothing once another has been
   * asked for.
   */
  private viewGeneration = 0;
  /** The page's own title, which a card puts the entry's name before */
  private pageTitle = '';
  private route: Route = { view: 'dashboard' };
  private readonly toasts = new ToastController(() =>
    this.container?.querySelector<HTMLElement>('[data-toast]')
  );
  private tree: OrganizationTree | null = null;
  /**
   * Where the reader left the list of each entity, by key. A list is drawn
   * anew each time its page is shown, and without this Back from a card
   * found it empty, the search typed and the page reached gone.
   */
  private readonly listViews = new Map<string, ListView>();
  /**
   * What had the focus when the side panel opened, given it back on close:
   * a keyboard user is otherwise left at the top of the page.
   */
  private panelOpener: HTMLElement | null = null;
  /**
   * Asked before the side panel closes, when it holds what cannot be shown
   * again: `false` keeps it open. Each panel opens without one.
   */
  private panelGuard: (() => boolean) | null = null;
  /** Whether the form in the panel holds what closing it would lose */
  private panelDirty: (() => boolean) | null = null;
  /** The address changed: the page the panel belongs to is gone */
  private navigating = false;
  /** What waits for the panel to close before it opens: a late password */
  private afterPanel: (() => void)[] = [];
  /**
   * Told when the panel open now closes, or another replaces it: an action
   * that waits on its panel, as the list's bulk actions do
   */
  private panelClosed: (() => void) | null = null;

  constructor(options: ConsoleOptions) {
    this.options = options;
    this.api = new ConsoleApiClient(options.apiBaseUrl, options.apiPrefix);
    this.api.onSessionEnded = (): void => void signInAgain();
    this.translator = new Translator(options.language || this.storedLanguage());
  }

  /** Language remembered from a previous visit, if any. */
  private storedLanguage(): string | undefined {
    try {
      return localStorage.getItem(LANGUAGE_KEY) || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Discover the directory and draw the console.
   *
   * @throws Error when the container does not exist
   */
  async init(): Promise<void> {
    this.container = document.getElementById(this.options.containerId);
    if (!this.container)
      throw new Error(`Container #${this.options.containerId} not found`);
    this.pageTitle = document.title || '';

    this.container.innerHTML = `<p class="dc-empty">${escapeHtml(
      this.translator.t('app.loading')
    )}</p>`;

    try {
      this.entities = await this.api.discover();
    } catch (err) {
      this.container.innerHTML = `<p class="dc-empty dc-error-block">${escapeHtml(
        (err as Error).message
      )}</p>`;
      return;
    }

    // The scope is not worth a dead page: a console that lists and reads is
    // still a console. But it stops offering to write, since what came back
    // was a failure rather than a permission.
    try {
      this.scope = await this.api.scope();
      this.scopeError = null;
    } catch (err) {
      this.scope = null;
      this.scopeError = (err as Error).message;
    }
    [this.policiesReadable, this.account] = await Promise.all([
      this.readsPolicies(),
      this.readAccount(),
    ]);

    this.readRoute();
    window.addEventListener('hashchange', () => void this.followHash());
    document.addEventListener('keydown', event => this.panelKey(event));
    // A reload or a closed tab loses a form as surely as Escape: the
    // browser's own question then.
    window.addEventListener('beforeunload', event => {
      const panel = this.container?.querySelector<HTMLElement>('[data-panel]');
      if (!panel || panel.hidden || !this.panelDirty?.()) return;
      event.preventDefault();
      event.returnValue = '';
    });

    this.drawShell();
    // The Overview reads it for its own section; any other first page has
    // the banner count it.
    if (this.route.view !== 'dashboard') void this.readTransit();
    await this.renderMain();
  }

  /* ---------------------------------------------------------------- routing */

  /** Read `#/entity/id` into the current route. */
  private readRoute(): void {
    const hash = window.location.hash.replace(/^#\/?/, '');
    // A hash is typed, pasted and mailed around, so it is not always the one
    // `go()` wrote: `#/users/50%` throws out of `decodeURIComponent`, and an
    // exception here leaves the console on "Loading…" for good. A segment
    // that does not decode is taken as it stands.
    const [first, second] = hash.split('/').map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
    if (!first) {
      this.route = { view: 'dashboard' };
      return;
    }
    if (first === 'organizations') {
      this.route = { view: 'organizations', id: second };
      return;
    }
    if (first === POLICIES_KEY) {
      this.route = { view: 'policies' };
      return;
    }
    this.route = { view: 'entity', entity: first, id: second };
  }

  /**
   * Draw the page a new hash names. A side panel belongs to the page it was
   * opened on: left over a page reached with Back or a typed address, it
   * covers that page and saves into an entry no longer on screen.
   */
  private async followHash(): Promise<void> {
    // A changed form is not asked about here: kept over the new page, it
    // would save into an entry no longer on screen.
    this.navigating = true;
    try {
      this.closePanel();
    } finally {
      this.navigating = false;
    }
    this.readRoute();
    await this.renderMain();
  }

  /** Navigate, letting the hash change drive the render. */
  private go(path: string): void {
    window.location.hash = `#/${path}`;
  }

  /**
   * Name the page in the address without drawing it again.
   *
   * A node picked in the tree is already on screen, card included: drawing
   * the view anew for it would repaint the tree and read the card twice. The
   * address must still name it, or a reload, Back and the view drawn again
   * after a save forget it. `pushState` and `replaceState` change the
   * address without the `hashchange` that drives a render.
   *
   * @param path what follows `#/`
   * @param replace take the place of the current address rather than adding
   *   one, for a page that no longer exists
   */
  private record(path: string, replace = false): void {
    const hash = `#/${path}`;
    if (window.location.hash !== hash) {
      if (replace) window.history.replaceState(null, '', hash);
      else window.history.pushState(null, '', hash);
    }
    this.readRoute();
  }

  /* ------------------------------------------------------------------ shell */

  /** Draw the permanent frame: sidebar, scope, main area, side panel. */
  /**
   * Draw the console again in another language. An open side panel is kept
   * as it is, in the language it was opened in: drawn again, it was closed,
   * and what had been typed into it was lost.
   *
   * @param code the language chosen
   */
  private changeLanguage(code: string): void {
    try {
      localStorage.setItem(LANGUAGE_KEY, code);
      // eslint-disable-next-line no-empty
    } catch {}
    const panel = this.container?.querySelector<HTMLElement>('[data-panel]');
    const kept = panel && !panel.hidden ? panel : null;
    this.translator = new Translator(code);
    this.drawShell();
    if (kept)
      this.container
        ?.querySelector<HTMLElement>('[data-panel]')
        ?.replaceWith(kept);
    void this.renderMain();
  }

  private drawShell(): void {
    const container = this.container;
    if (!container) return;
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    // An account administering nothing finds only "nothing to manage" behind
    // each entry: the overview says it once, and the entries are not offered.
    const { primary, reference } = this.administersNothing()
      ? { primary: [], reference: [] }
      : splitEntities(this.entities);
    const settings = this.settings(reference);

    container.innerHTML = `
      <div class="dc-app">
        <aside class="dc-sidebar">
          <div class="dc-brand">
            <span class="dc-brand-logo" aria-hidden="true">${CONSOLE_LOGO}</span>
            <span class="dc-brand-name">${escapeHtml(t('app.title'))}</span>
          </div>
          <nav class="dc-nav">
            <button type="button" class="dc-nav-item" data-nav="">
              <span class="dc-nav-icon">${OVERVIEW_ICON}</span>
              <span class="dc-nav-label">${escapeHtml(t('nav.dashboard'))}</span>
            </button>
            ${primary
              .map(
                entity =>
                  `<button type="button" class="dc-nav-item" data-nav="${escapeHtml(
                    entity.key
                  )}">
                    <span class="dc-nav-icon" aria-hidden="true">${escapeHtml(
                      initial(this.plural(entity))
                    )}</span>
                    <span class="dc-nav-label">${escapeHtml(this.plural(entity))}</span>
                  </button>`
              )
              .join('')}
            ${
              settings.length
                ? `<div class="dc-nav-section">
                    <button type="button" class="dc-nav-toggle" data-nav-toggle
                      aria-expanded="false" aria-controls="dc-nav-reference">
                      <span>${escapeHtml(t('nav.reference'))}</span>
                      <span class="dc-nav-chevron">${CHEVRON_ICON}</span>
                    </button>
                    <div class="dc-nav-reference" id="dc-nav-reference" hidden>
                      ${settings
                        .map(
                          ({ key, label }) =>
                            `<button type="button" class="dc-nav-item dc-nav-item-reference" data-nav="${escapeHtml(
                              key
                            )}"><span class="dc-nav-label">${escapeHtml(
                              label
                            )}</span></button>`
                        )
                        .join('')}
                    </div>
                  </div>`
                : ''
            }
          </nav>
          <div class="dc-sidebar-footer">
            <label class="dc-language">
              <span>${escapeHtml(t('app.language'))}</span>
              <select class="dc-input" data-language>
                ${availableLanguages
                  .map(
                    code =>
                      `<option value="${code}" lang="${code}"${
                        code === this.translator.language ? ' selected' : ''
                      }>${escapeHtml(languageName(code))}</option>`
                  )
                  .join('')}
              </select>
            </label>
          </div>
        </aside>
        <div class="dc-content">
          <header class="dc-header">${this.scopeMarkup()}${this.logoutMarkup()}</header>
          <main class="dc-main" data-main></main>
          <a class="dc-powered" href="https://linagora.com" target="_blank"
            rel="noopener noreferrer">
            <img src="${LINAGORA_LOGO}" alt="LINAGORA" width="100" height="21" />
          </a>
        </div>
        <div class="dc-panel" data-panel hidden>
          <div class="dc-panel-inner" data-panel-dialog role="dialog"
            aria-modal="true" aria-labelledby="dc-panel-title" tabindex="-1">
            <header class="dc-panel-header">
              <h2 id="dc-panel-title" data-panel-title></h2>
              <button type="button" class="dc-icon-button" data-panel-close
                aria-label="${escapeHtml(t('app.close'))}">×</button>
            </header>
            <div class="dc-panel-body" data-panel-body></div>
          </div>
        </div>
        <div data-toast-region role="status" aria-live="polite" aria-atomic="true">
          <div class="dc-toast" data-toast hidden></div>
        </div>
      </div>`;

    for (const button of Array.from(
      container.querySelectorAll<HTMLElement>('[data-nav]')
    )) {
      button.addEventListener('click', () => this.go(button.dataset.nav || ''));
    }

    container
      .querySelector<HTMLElement>('[data-nav-toggle]')
      ?.addEventListener('click', () => {
        const open = !this.referenceOpen();
        try {
          localStorage.setItem(REFERENCE_OPEN_KEY, open ? '1' : '');
          // eslint-disable-next-line no-empty
        } catch {}
        this.showReference(open);
      });
    this.showReference(this.referenceOpen());

    container
      .querySelector<HTMLSelectElement>('[data-language]')
      ?.addEventListener('change', event => {
        this.changeLanguage((event.target as HTMLSelectElement).value);
      });

    container
      .querySelector('[data-panel-close]')
      ?.addEventListener('click', () => this.closePanel());
  }

  /** The sign-out control, when the server offers a way to sign out. */
  private logoutMarkup(): string {
    const url = this.api.logoutUrl;
    if (!url) return '';
    return `<a class="dc-button dc-logout" href="${escapeHtml(url)}">${escapeHtml(
      this.translator.t('app.logout')
    )}</a>`;
  }

  /**
   * The branches the caller administers, shown permanently.
   *
   * In a local-administration model this is the single most useful thing on
   * the screen, and the interface this replaces showed it nowhere.
   */
  private scopeMarkup(): string {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    if (this.scopeError)
      return `<span class="dc-scope-error">${escapeHtml(
        t('scope.unavailable', { error: this.scopeError })
      )}</span>`;
    if (!this.scope)
      return `<span class="dc-scope-empty">${escapeHtml(t('scope.unrestricted'))}</span>`;
    if (this.scope.unrestricted)
      return `<span class="dc-scope-empty">${escapeHtml(t('scope.unrestricted'))}</span>`;
    if (this.scope.described === false)
      return `<span class="dc-scope-empty">${escapeHtml(t('scope.undescribed'))}</span>`;
    // Grey, not the green of a scope in order: there is nothing to be had.
    if (this.scope.branches.length === 0)
      return `<span class="dc-scope-empty dc-scope-none">${escapeHtml(
        t('scope.none')
      )}</span>`;

    return `
      <span class="dc-scope-label">${escapeHtml(t('scope.title'))}</span>
      <ul class="dc-scope">
        ${this.scope.branches
          .map(branch => {
            const rights = [
              branch.read ? t('scope.read') : '',
              branch.write ? t('scope.write') : '',
              branch.delete ? t('scope.delete') : '',
            ]
              .filter(Boolean)
              .join(', ');
            return `<li title="${escapeHtml(branch.path || branch.dn)}">
              <strong>${escapeHtml(branch.name || branch.dn)}</strong>
              <span class="dc-muted">${escapeHtml(rights)}</span>
            </li>`;
          })
          .join('')}
      </ul>
      ${
        this.scope.transit
          ? `${
              // "Transit Transit (1)" said its name twice: the label goes
              // when the branch's name is that word already.
              rdnValue(this.scope.transit).toLowerCase() ===
              t('transit.branch').toLowerCase()
                ? ''
                : `<span class="dc-scope-label">${escapeHtml(t('transit.branch'))}</span>`
            }
            <a class="dc-scope-transit" data-transit-link href="#/organizations/${encodeURIComponent(
              this.scope.transit
            )}" title="${escapeHtml(
              // Readable, like the branches' paths: the scope gives the
              // transit branch no path, and its name stands in for one.
              rdnValue(this.scope.transit)
            )}">${escapeHtml(this.transitLabel())}</a>`
          : ''
      }`;
  }

  /**
   * The banner's Transit link: the branch's name, and how many entries wait
   * there when some do — "Transit (2)" — so that an administrator is told
   * of a hand-over without thinking of looking.
   */
  private transitLabel(): string {
    const transit = this.scope?.transit;
    if (!transit) return '';
    const name = rdnValue(transit);
    const waiting = this.transitWaiting;
    if (!waiting?.entries.length) return name;
    return `${name} (${waiting.entries.length}${waiting.truncated ? '+' : ''})`;
  }

  /**
   * Read what waits in transit, and count it on the banner.
   *
   * Only for an administrator whose scope names a transit branch: the
   * console speaks of transit only then (see {@link transitState}). A read
   * that fails counts nothing rather than an error: the branch is still a
   * link away.
   *
   * @returns what waits there, or null when there is nothing to read
   */
  private async readTransit(): Promise<AttachedEntries | null> {
    const scope = this.scope;
    if (!scopeRestricts(scope) || !scope.transit || this.administersNothing())
      return null;
    // Read again after every hand-over and claim: an answer arriving after
    // a later one's is older, and must not count over it.
    const read = ++this.transitReads;
    let waiting: AttachedEntries | null;
    try {
      waiting = await this.readMembers(scope.transit);
    } catch {
      waiting = null;
    }
    if (read !== this.transitReads) return waiting;
    this.transitWaiting = waiting;
    const link = this.container?.querySelector<HTMLElement>(
      '[data-transit-link]'
    );
    if (link) link.textContent = this.transitLabel();
    return waiting;
  }

  /**
   * Whether the caller may claim an entry listed in transit: as its card
   * would say, from the entity holding it, attached to the transit branch.
   */
  private claimable(entry: AttachedEntry, entity: EntityDescriptor): boolean {
    const transit = this.scope?.transit;
    if (!transit || !entity.organizationLink) return false;
    return transitState(this.scope, entity, {
      dn: entry.dn,
      [entity.organizationLink]: transit,
    }).claim;
  }

  /** Claim…, at the end of each row listing what waits in transit. */
  private claimAction(): {
    label: string;
    named(name: string): string;
    offered(entry: AttachedEntry, entity: EntityDescriptor): boolean;
    run(entry: AttachedEntry, entity: EntityDescriptor): void;
  } {
    return {
      label: this.translator.t('transit.claim'),
      named: name => this.translator.t('transit.claimTitle', { name }),
      offered: (entry, entity) => this.claimable(entry, entity),
      run: (entry, entity) => void this.claim(entity, entry.label),
    };
  }

  /* ------------------------------------------------------------------ views */

  private main(): HTMLElement | null {
    return this.container?.querySelector<HTMLElement>('[data-main]') || null;
  }

  /** True while the view this ticket was taken for is still the one asked for. */
  private current(generation: number): boolean {
    return generation === this.viewGeneration;
  }

  /** Whether the reader left the reference section open last time. */
  private referenceOpen(): boolean {
    try {
      return localStorage.getItem(REFERENCE_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** Open or close the reference section of the navigation. */
  private showReference(open: boolean): void {
    const toggle =
      this.container?.querySelector<HTMLElement>('[data-nav-toggle]');
    const section =
      this.container?.querySelector<HTMLElement>('#dc-nav-reference');
    if (!toggle || !section) return;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    section.hidden = !open;
  }

  /** Draw whatever the current route asks for. */
  private async renderMain(): Promise<void> {
    const main = this.main();
    if (!main) return;
    const generation = ++this.viewGeneration;
    this.titlePage();

    for (const button of Array.from(
      this.container?.querySelectorAll<HTMLElement>('[data-nav]') || []
    )) {
      const key = button.dataset.nav || '';
      const active =
        (this.route.view === 'dashboard' && key === '') ||
        (this.route.view === 'organizations' && key === 'organizations') ||
        (this.route.view === 'policies' && key === POLICIES_KEY) ||
        (this.route.view === 'entity' && key === this.route.entity);
      button.classList.toggle('dc-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
      // Reference data is tucked away, not out of reach: a page of it being
      // shown opens its section, or the reader would not see where they are.
      if (active && button.classList.contains('dc-nav-item-reference'))
        this.showReference(true);
      // On a phone the navigation is a row that scrolls sideways: bring the
      // current entry into it, or it may sit past the edge of the screen.
      if (active)
        button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    if (this.route.view === 'dashboard') return this.renderDashboard(main);
    if (this.route.view === 'organizations')
      return this.renderOrganizations(main, generation);
    if (this.route.view === 'policies')
      return this.managesPolicies()
        ? this.renderPolicies(main, generation)
        : this.renderDashboard(main);

    const entity = this.entity(this.route.entity);
    if (!entity) return this.renderNotFound(main);
    if (entity.kind === 'organization')
      return this.renderOrganizations(main, generation);
    if (this.route.id)
      return this.renderDetail(main, entity, this.route.id, generation);
    return this.renderList(main, entity);
  }

  private entity(key?: string): EntityDescriptor | undefined {
    return this.entities.find(entity => entity.key === key);
  }

  /**
   * What to call a collection: the schema's label in the current language,
   * falling back to the name the schema gives it.
   *
   * @param entity entity to name
   * @returns the plural name to show
   */
  private plural(entity: EntityDescriptor): string {
    return (
      resolveText(entity.label, this.translator.language) ||
      // The organization tree is the one collection the product itself names,
      // because it is the product that draws it.
      (entity.kind === 'organization'
        ? this.translator.t('tree.title')
        : entity.pluralName)
    );
  }

  /**
   * What to call one entry of a collection.
   *
   * @param entity entity to name
   * @returns the singular name to show
   */
  private singular(entity: EntityDescriptor): string {
    return (
      resolveText(entity.singularLabel, this.translator.language) ||
      entity.singularName
    );
  }

  /**
   * What the button and the panel creating an entry of an entity read. The
   * catalogue may name it for an entity it knows: French puts an article that
   * agrees with the noun, _Créer une organisation_, which a template around
   * the schema's name cannot.
   *
   * @param entity entity an entry is created in
   * @returns the label
   */
  private createLabel(entity: EntityDescriptor): string {
    const own = `dashboard.create.${entity.key}`;
    const label = this.translator.t(own);
    return label !== own
      ? label
      : this.translator.t('dashboard.create', {
          entity: this.singular(entity),
        });
  }

  /** Whether the caller may create an entry of this entity. */
  private canCreate(entity: EntityDescriptor): boolean {
    if (this.scopeError) return false;
    if (!scopeRestricts(this.scope)) return true;
    const declared = this.scope.entities.find(
      item => item.name === entity.pluralName
    );
    // The server enumerates every entity it serves, so an entity it did not
    // name is one it does not know: its add hook is what would answer, and it
    // would answer 403.
    if (!declared) return false;
    return declared.create || this.creationParents(entity).length > 0;
  }

  /**
   * Where a new organization goes when the caller may not create one at the
   * root of the tree.
   *
   * `organizations.create` answers for a creation without a parent, which
   * lands at the root: a global administrator appointed one level below it
   * read "Creation not allowed here", though the server accepts the
   * organization under any branch they write. Those branches are offered
   * instead, by the name the banner gives them.
   *
   * @param entity the entity about to be created
   * @returns the parents to offer, sorted; none when the root is allowed,
   *   when the scope restricts nothing, or for any other entity
   */
  private creationParents(
    entity: EntityDescriptor
  ): { dn: string; label: string }[] {
    if (entity.kind !== 'organization' || !scopeRestricts(this.scope))
      return [];
    const declared = this.scope.entities.find(
      item => item.name === entity.pluralName
    );
    if (!declared || declared.create) return [];
    return organizationParents(this.scope, entity.base)
      .map(branch => ({
        dn: branch.dn,
        label: branch.path || branch.name || branch.dn,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Whether the caller links an organization only to the mail domains one
   * above it links already. ldap-rest's authorization holds every caller to
   * that (`authzLinid1`, "Mail domains") but the one who writes the top
   * organization, who hands each organization its domains; a scope that
   * restricts nothing leaves it to the server to say.
   *
   * The server says so itself in `linksAnyDomain`: the administrators of
   * `--authz-global-organization`, the functional root right under a bare
   * top, link any domain too, and read from the branches they were offered
   * none. Only a server that predates it is read the old way.
   *
   * @param entity the organizations
   * @returns true when the domains offered are to be narrowed
   */
  private inheritsDomains(entity: EntityDescriptor): boolean {
    if (this.scopeError || !scopeRestricts(this.scope) || !entity.base)
      return false;
    const any = (this.scope as { linksAnyDomain?: unknown }).linksAnyDomain;
    if (typeof any === 'boolean') return !any;
    const top = entity.base;
    return !this.scope.branches.some(
      branch => branch.write && withinDn(top, branch.dn)
    );
  }

  /**
   * Whether the caller may create an organization under this one.
   *
   * Every written branch counts here, not only the organizations among
   * them: a branch written above the root of the tree, as an administrator
   * of the whole directory has, covers every node. The transit branch is
   * still no organization of theirs to grow.
   *
   * @param dn the organization a new one would hang from
   */
  private createsUnder(dn: string): boolean {
    if (!this.canWrite()) return false;
    if (!scopeRestricts(this.scope)) return true;
    const transit = this.scope.transit;
    return this.scope.branches.some(
      branch =>
        branch.write &&
        !(transit && withinDn(branch.dn, transit)) &&
        withinDn(dn, branch.dn)
    );
  }

  /** Whether the caller may write anywhere at all. */
  private canWrite(): boolean {
    if (this.scopeError) return false;
    if (!scopeRestricts(this.scope)) return true;
    return this.scope.branches.some(branch => branch.write);
  }

  /**
   * Whether the caller administers no branch at all. The server then refuses
   * every read, so the views say so calmly rather than ask and show each
   * refusal as an error. An unrestricted or undescribed scope names no
   * branch either, but restricts nothing.
   */
  private administersNothing(): boolean {
    return scopeRestricts(this.scope) && this.scope.branches.length === 0;
  }

  /** The notice standing in for a view the server would refuse whole. */
  private nothingMarkup(): string {
    return `<p class="dc-empty">${escapeHtml(
      this.translator.t('scope.nothing')
    )}</p>`;
  }

  /**
   * Whether the caller manages the password policies. Who holds them is the
   * server's rule (`--authz-global-branches`), outside the tree the scope's
   * branches name, so the scope says it in `passwordPolicies`. Only a server
   * that predates it is asked for the policies themselves: every page load
   * of a local administrator then logged a refusal. An undescribed scope
   * answers `false` for want of a model, and the console asks there too, as
   * it leaves the server to answer whatever else such a scope cannot say. A
   * refusal hides the page; any other failure shows it, with the failure on
   * it.
   */
  private async readsPolicies(): Promise<boolean> {
    if (!this.api.servesPasswordPolicies) return false;
    const told = this.scope?.passwordPolicies;
    if (typeof told === 'boolean' && this.scope?.described !== false)
      return told;
    try {
      await this.api.passwordPolicies();
      return true;
    } catch (err) {
      return (err as { status?: number }).status !== 403;
    }
  }

  /**
   * The signed-in account, by its name and address: the overview greeted
   * everyone with their DN. It is read the way its card reads it, from the
   * entity whose branch holds it. An account administering nothing is not
   * read, since the server refuses it every read: it is named by its own
   * identifier, the one it signed in with. So is an account the read fails
   * for, or no entity holds: authz-linid1 hides an account attached to an
   * organization outside the caller's branches, a department head's own one
   * attached to the organization above, which was greeted by its DN. The
   * scope cannot tell that refusal beforehand: the account's link to its
   * organization decides it, not where its DN lies, and only the read gives
   * the link.
   *
   * @returns how to name the account, or null to show the scope's own
   *   words for it, when they are no DN
   */
  private async readAccount(): Promise<SignedIn | null> {
    const dn = this.scope?.user;
    if (!dn || !isDnShaped(dn)) return null;
    const identifier = { name: rdnValue(dn) };
    if (this.administersNothing()) return identifier;
    const owner = this.entities.find(
      entity =>
        entity.kind === 'flat' &&
        entity.base &&
        comparableDn(dn) !== comparableDn(entity.base) &&
        withinDn(dn, entity.base)
    );
    if (!owner) return identifier;
    try {
      const entry = await this.api.get(owner, rdnValue(dn));
      const first = (role: string): string | undefined => {
        const name = roleAttribute(owner.schema, role);
        const value = name
          ? [entryValue(entry, name) ?? []].flat()[0]
          : undefined;
        return value && String(value).trim() ? String(value).trim() : undefined;
      };
      return {
        name: first('displayName') || rdnValue(dn),
        email: first('primaryEmail'),
      };
    } catch {
      return identifier;
    }
  }

  /**
   * What the reference section lists: the reference data, and the password
   * policies, set up once and rarely touched like it.
   */
  private settings(
    reference: EntityDescriptor[]
  ): { key: string; label: string }[] {
    return [
      ...reference.map(entity => ({
        key: entity.key,
        label: this.plural(entity),
      })),
      ...(this.managesPolicies()
        ? [{ key: POLICIES_KEY, label: this.translator.t('nav.policies') }]
        : []),
    ];
  }

  private managesPolicies(): boolean {
    return this.policiesReadable;
  }

  private canDelete(): boolean {
    if (this.scopeError) return false;
    if (!scopeRestricts(this.scope)) return true;
    return this.scope.branches.some(branch => branch.delete);
  }

  /**
   * The overview: the scope, and the entities with what can be done to them.
   * A page of four cards that only repeat the sidebar is decoration; this one
   * answers "what am I allowed to do here?". It is a heading, a greeting and
   * a list of sections, each drawn by its own method.
   */
  private renderDashboard(main: HTMLElement): void {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const generation = this.viewGeneration;
    // What waits in transit goes first, once read: it is what may need
    // doing today.
    const sections = this.administersNothing()
      ? [this.noRightsMarkup()]
      : [
          '<div data-transit-waiting></div>',
          this.manageMarkup(),
          this.referenceMarkup(),
        ];
    main.innerHTML = `
      <section class="dc-dashboard">
        <h1>${escapeHtml(t('app.title'))}</h1>
        ${this.welcomeMarkup()}
        ${sections.join('')}
      </section>`;

    for (const button of Array.from(
      main.querySelectorAll<HTMLElement>('[data-open]')
    ))
      button.addEventListener('click', () =>
        this.go(button.dataset.open as string)
      );
    for (const button of Array.from(
      main.querySelectorAll<HTMLElement>('[data-new]')
    ))
      button.addEventListener('click', () => {
        const entity = this.entity(button.dataset.new as string);
        if (entity) void this.openForm(entity);
      });
    void this.showTransitWaiting(main, generation);
  }

  /**
   * _Waiting in transit (N)_, on the Overview: what other administrators
   * handed over, each with Claim…. Nothing told the receiving side of a
   * hand-over, and an entry nobody noticed stayed in transit, managed by no
   * one. Absent when nothing waits.
   *
   * @param main the Overview
   * @param generation the view it was drawn for
   */
  private async showTransitWaiting(
    main: HTMLElement,
    generation: number
  ): Promise<void> {
    const waiting = await this.readTransit();
    if (!this.current(generation) || !waiting?.entries.length) return;
    const names = await this.attachedNames();
    const holder = main.querySelector<HTMLElement>('[data-transit-waiting]');
    if (!this.current(generation) || !holder) return;
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const tables = new AttachedTables({
      entities: this.entities,
      members: waiting,
      translator: this.translator,
      name: rdnValue(this.scope?.transit || ''),
      pointerLabel: names,
      hideEmpty: true,
      rowAction: this.claimAction(),
      onOpen: (href: string): void => {
        window.location.hash = href;
      },
    });
    holder.innerHTML = `
      <section class="dc-transit-waiting" data-transit-section>
        <h2>${escapeHtml(
          t('transit.waiting', {
            count: `${waiting.entries.length}${waiting.truncated ? '+' : ''}`,
          })
        )}</h2>
        <p class="dc-muted">${escapeHtml(t('transit.waitingHelp'))}</p>
        ${tables.markup()}
      </section>`;
    tables.bind(holder);
  }

  /** Who is signed in: by name and address, else as the scope gives it. */
  private welcomeMarkup(): string {
    const user = this.scope?.user;
    if (!user) return '';
    const account = this.account;
    const text = account?.email
      ? this.translator.t('dashboard.welcomeNamed', {
          name: account.name,
          email: account.email,
        })
      : this.translator.t('dashboard.welcome', {
          user: account?.name || user,
        });
    return `<p class="dc-muted">${escapeHtml(text)}</p>`;
  }

  /** The cards of the entities, with what can be done to them. */
  private manageMarkup(): string {
    const t = (key: string): string => this.translator.t(key);
    const { primary } = splitEntities(this.entities);
    return `
      <h2>${escapeHtml(t('dashboard.entities'))}</h2>
      <ul class="dc-cards">
        ${primary
          .map(entity => {
            const allowed = this.canCreate(entity);
            return `<li class="dc-card">
              <header class="dc-card-title">
                <span class="dc-entity-icon" aria-hidden="true">${escapeHtml(
                  initial(this.plural(entity))
                )}</span>
                <h3>${escapeHtml(this.plural(entity))}</h3>
              </header>
              <div class="dc-card-actions">
                <button type="button" class="dc-button" data-open="${escapeHtml(
                  entity.key
                )}">${escapeHtml(t('list.open'))}</button>
                ${
                  allowed
                    ? `<button type="button" class="dc-button dc-button-primary" data-new="${escapeHtml(
                        entity.key
                      )}">${escapeHtml(this.createLabel(entity))}</button>`
                    : `<span class="dc-muted">${escapeHtml(t('dashboard.noCreate'))}</span>`
                }
              </div>
            </li>`;
          })
          .join('')}
      </ul>`;
  }

  /** The links to the reference data and the password policies. */
  private referenceMarkup(): string {
    const settings = this.settings(splitEntities(this.entities).reference);
    if (!settings.length) return '';
    return `
      <h2>${escapeHtml(this.translator.t('nav.reference'))}</h2>
      <ul class="dc-reference">
        ${settings
          .map(
            ({ key, label }) =>
              `<li><button type="button" class="dc-reference-link" data-open="${escapeHtml(
                key
              )}">${escapeHtml(label)}</button></li>`
          )
          .join('')}
      </ul>`;
  }

  /**
   * The overview of an account administering nothing. Three cards, each
   * opening on "nothing to manage", were three dead ends: this says it
   * once, and where to turn.
   */
  private noRightsMarkup(): string {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const user = this.scope?.user || '';
    const logout = this.api.logoutUrl;
    return `
      <div class="dc-no-rights" data-no-rights>
        <h2>${escapeHtml(t('dashboard.noRightsTitle'))}</h2>
        <p>${escapeHtml(
          t('dashboard.noRightsBody', { name: this.account?.name || user })
        )}</p>
        ${
          logout
            ? `<a class="dc-button dc-button-primary" href="${escapeHtml(
                logout
              )}">${escapeHtml(t('app.logout'))}</a>`
            : ''
        }
      </div>`;
  }

  /**
   * What an address naming no page shows. It drew the overview, which made
   * a mistyped or outdated link, `#/passwordPolicies` for
   * `#/password-policies`, look as though it had worked.
   */
  private renderNotFound(main: HTMLElement): void {
    const t = (key: string): string => this.translator.t(key);
    main.innerHTML = `
      <section class="dc-view">
        <div class="dc-empty" data-not-found>
          <p>${escapeHtml(t('app.notFound'))}</p>
          <a class="dc-button" href="#/">${escapeHtml(t('app.toOverview'))}</a>
        </div>
      </section>`;
  }

  /** The table of an entity. */
  private async renderList(
    main: HTMLElement,
    entity: EntityDescriptor
  ): Promise<void> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const readOnly = this.readsReferenceOnly(entity);
    main.innerHTML = `
      <section class="dc-view">
        <header class="dc-view-header">
          <h1>${escapeHtml(this.plural(entity))}</h1>
          ${
            this.canCreate(entity)
              ? `<div class="dc-view-actions">
                  ${
                    entity.kind === 'flat'
                      ? `<button type="button" class="dc-button" data-import>${escapeHtml(
                          t('import.open')
                        )}</button>`
                      : ''
                  }
                  <button type="button" class="dc-button dc-button-primary" data-new>${escapeHtml(
                    this.createLabel(entity)
                  )}</button>
                </div>`
              : ''
          }
        </header>
        ${
          readOnly && this.isReference(entity) && !this.administersNothing()
            ? `<p class="dc-muted dc-view-notice" data-read-only>${escapeHtml(
                t('reference.readOnly')
              )}</p>`
            : ''
        }
        <div data-list></div>
      </section>`;

    main
      .querySelector('[data-new]')
      ?.addEventListener('click', () => void this.openForm(entity));
    main
      .querySelector('[data-import]')
      ?.addEventListener('click', () => this.openImport(entity));

    const holder = main.querySelector<HTMLElement>(
      '[data-list]'
    ) as HTMLElement;
    if (this.administersNothing()) {
      holder.innerHTML = this.nothingMarkup();
      return;
    }
    const named = await this.pointerNames(entity);
    const view = this.listViews.get(entity.key) ?? {};
    this.listViews.set(entity.key, view);
    const list = new EntityList({
      entity,
      view,
      translator: this.translator,
      listable: !isLarge(entity),
      load: listLoader(this.api, entity),
      bulkActions: this.bulkActions(entity),
      pathSeparator: this.api.organizationPathSeparator,
      canDelete: this.canDelete() && !readOnly,
      pointerLabel: named,
      read: (id: string): Promise<Entry> => this.api.get(entity, id),
      onOpen: (id: string): void =>
        this.go(`${entity.key}/${encodeURIComponent(id)}`),
      onDelete: (ids: string[]): Promise<boolean> =>
        this.deleteMany(entity, ids),
    });
    await list.render(holder);
  }

  /** One entry, read-only, with its actions and its relations. */
  private async renderDetail(
    main: HTMLElement,
    entity: EntityDescriptor,
    id: string,
    generation: number
  ): Promise<void> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    if (this.administersNothing()) {
      main.innerHTML = this.nothingMarkup();
      return;
    }
    main.innerHTML = `<p class="dc-empty">${escapeHtml(t('app.loading'))}</p>`;
    const naming = this.pointerNames(entity);
    let entry: Entry;
    try {
      entry = await this.api.get(entity, id);
      if (!this.current(generation)) return;
    } catch (err) {
      if (!this.current(generation)) return;
      const failure = readFailure(err, this.translator);
      main.innerHTML = `<p class="dc-empty${
        failure.gone || failure.refused ? '' : ' dc-error-block'
      }">${escapeHtml(failure.message)}</p>`;
      return;
    }

    main.innerHTML = `
      <section class="dc-view">
        <header class="dc-view-header">
          <button type="button" class="dc-button" data-back>${escapeHtml(t('app.back'))}</button>
        </header>
        <div data-detail></div>
      </section>`;
    main
      .querySelector('[data-back]')
      ?.addEventListener('click', () => this.go(entity.key));

    const [named, relations] = await Promise.all([
      naming,
      this.relations(entity, entry),
    ]);
    if (!this.current(generation)) return;
    const transit = transitState(this.scope, entity, entry);
    const readOnly = this.readsReferenceOnly(entity);
    const canWrite = !readOnly && (transit.rights?.write ?? this.canWrite());
    const groups = relations?.groups && entry.dn ? relations.items : undefined;
    // A group's members, managed from its card as an account's groups are
    // from the account's: the whole form was the only way to change one.
    // Only a group has the routes that add and remove one member: a flat
    // entity's members, a team mailbox's, are saved with the whole entry.
    const members =
      relations &&
      !relations.groups &&
      entity.kind === 'group' &&
      this.writes(entity, entry)
        ? relations
        : undefined;
    if (members) for (const item of members.items) item.removable = true;
    const joins =
      !!groups &&
      this.writes(entity, entry) &&
      !!this.api.groupSearch(this.entities);
    const detail: EntityDetail = new EntityDetail({
      entity,
      entry,
      translator: this.translator,
      canWrite,
      canDelete: !readOnly && (transit.rights?.delete ?? this.canDelete()),
      notice:
        readOnly && this.isReference(entity)
          ? this.translator.t('reference.readOnly')
          : undefined,
      inTransit: transit.inTransit,
      onClaim: transit.claim
        ? (): void => void this.claim(entity, id)
        : undefined,
      onHandOver: transit.handOver
        ? (): void => void this.handOver(entity, id, entry)
        : undefined,
      pointerLabel: named,
      relations,
      onEdit: (): void => {
        void this.openForm(entity, entry);
      },
      onDelete: (): void => {
        void this.confirmDelete(entity, id, entry, canWrite);
      },
      onStatus: (): void => {
        void this.changeState(entity, id, entry);
      },
      onResetPassword: (): void => {
        void this.resetPassword(entity, id);
      },
      relationHref: (dn: string): string | undefined => this.relationHref(dn),
      onAddToGroups:
        groups && joins
          ? (): void =>
              this.addToGroups(
                entry,
                detail.heading(),
                groups.map(group => group.id)
              )
          : undefined,
      onLeaveGroup: groups
        ? (dn: string): Promise<void> =>
            this.leaveGroup(entry, detail.heading(), dn)
        : members
          ? (dn: string): Promise<void> =>
              this.removeMember(entity, id, detail.heading(), dn)
          : undefined,
      onAddMembers:
        members && this.api.memberSearch('members', this.entities)
          ? (): void =>
              this.addMembers(
                entity,
                entry,
                id,
                detail.heading(),
                members.items.map(item => item.id)
              )
          : undefined,
    });
    detail.render(
      main.querySelector<HTMLElement>('[data-detail]') as HTMLElement
    );
    this.titlePage(detail.heading());
  }

  /**
   * Title the browser tab after the card on screen — "Alice Moreau — Twake
   * Directory Manager" — so that the tabs of several open accounts, and the
   * history, say whose they are.
   *
   * @param name the entry's name, or none for a page that is no card
   */
  private titlePage(name?: string): void {
    if (typeof document === 'undefined' || !this.pageTitle) return;
    document.title = name ? `${name} — ${this.pageTitle}` : this.pageTitle;
  }

  /**
   * Entries related to this one: the members of a group, the groups an account
   * belongs to. Both are read from roles, so an entity that models them under
   * other names still gets the section.
   *
   * An account's groups come from its `memberOf`, which only a directory
   * running OpenLDAP's `memberof` overlay fills in. Without it they are
   * searched among the groups; a search that fails leaves the section empty
   * rather than the card unshown.
   */
  private async relations(
    entity: EntityDescriptor,
    entry: Entry
  ): Promise<
    | {
        title: string;
        attribute: string;
        items: {
          id: string;
          label: string;
          note?: string;
          removable?: boolean;
        }[];
        groups?: boolean;
      }
    | undefined
  > {
    for (const role of ['members', 'groupMemberships']) {
      for (const [name, attr] of Object.entries(entity.schema.attributes)) {
        const roles = Array.isArray(attr.role) ? attr.role : [attr.role];
        if (!roles.includes(role)) continue;
        const raw = entryValue(entry, name);
        let list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
        if (role === 'groupMemberships' && !list.length && entry.dn)
          list = await this.api
            .memberships(entry.dn, this.entities)
            .catch(() => []);
        // An empty value stands for no member in some directories: it is
        // neither counted nor offered a ×, as the deletion's count skips it.
        const items = list
          .filter(dn => String(dn).trim())
          .map(dn => ({
            id: String(dn),
            label: rdnValue(String(dn)),
          }));
        if (role === 'members')
          return {
            title: attributeLabel(name, attr, this.translator.language),
            attribute: name,
            items,
          };
        // Groups, whatever the schema calls them: a deployment's "Mailing
        // lists" listed shared mailboxes and simple groups as well.
        return {
          title: this.translator.t('groups.section'),
          attribute: name,
          items: await this.groupItems(items),
          groups: true,
        };
      }
    }
    return undefined;
  }

  /**
   * An account's groups, each with its type and whether the caller may take
   * the account out of it. Each group is read for that, all at once; one
   * that cannot be read is named alone, and offers no ×.
   *
   * @param items the groups, by DN and name
   * @returns the same groups, said in full
   */
  private async groupItems(
    items: { id: string; label: string }[]
  ): Promise<
    { id: string; label: string; note?: string; removable?: boolean }[]
  > {
    return Promise.all(
      items.map(async item => {
        const owner = this.groupEntity(item.id);
        if (!owner) return item;
        let group: Entry;
        try {
          group = await this.api.get(owner, item.label);
        } catch {
          return item;
        }
        const note = this.groupType(owner, group);
        return {
          ...item,
          ...(note ? { note } : {}),
          removable: this.writes(owner, group),
        };
      })
    );
  }

  /** The group entity whose branch holds a DN. */
  private groupEntity(dn: string): EntityDescriptor | undefined {
    const parent = parentOf(dn);
    return parent
      ? this.entities.find(
          entity =>
            entity.kind === 'group' &&
            entity.base &&
            comparableDn(entity.base) === comparableDn(parent)
        )
      : undefined;
  }

  /**
   * A group's type — _Mailing list_, _Shared mailbox_ — named as its card
   * names it, from the nomenclature's own labels.
   *
   * @param entity the groups' entity
   * @param group the group as read
   * @returns its type, or nothing for a schema or a group with none
   */
  private groupType(entity: EntityDescriptor, group: Entry): string {
    const type = roleAttribute(entity.schema, 'mailboxType');
    const value = type ? [entryValue(group, type) ?? []].flat()[0] : undefined;
    if (!type || !value) return '';
    const { language } = this.translator;
    return displayValue(
      entity.schema.attributes[type],
      String(value),
      dn => pointerLabel(this.entities, dn, language),
      language
    );
  }

  /**
   * Whether the caller may change an entry, judged on the entry itself
   * rather than on the scope as a whole (see {@link writesEntry}).
   */
  private writes(entity: EntityDescriptor, entry: Entry): boolean {
    return this.canWrite() && writesEntry(this.scope, entity, entry);
  }

  /** The card of a related entry, in whichever entity owns its DN. */
  private relationHref(dn: string): string | undefined {
    const owner = this.entities.find(
      entity =>
        entity.base &&
        dn.toLowerCase().endsWith(`,${entity.base.toLowerCase()}`)
    );
    if (!owner) return undefined;
    // `rdnValue`, not a split on the first comma: `cn=Smith\, John,…` holds
    // one, and the truncated id it produced answered "no longer exists".
    const id = rdnValue(dn);
    return `#/${owner.key}/${encodeURIComponent(id)}`;
  }

  /** A group found, as a group picker offers it. */
  private groupChoice(found: {
    dn: string;
    entity: EntityDescriptor;
    entry: Entry;
  }): GroupChoice {
    const group = rdnValue(found.dn);
    const mail = roleAttribute(found.entity.schema, 'primaryEmail');
    const address = mail
      ? [entryValue(found.entry, mail) ?? []].flat()[0]
      : undefined;
    return {
      dn: found.dn,
      name: group,
      // sales-team — Shared mailbox — sales@example.com
      label: [
        group,
        this.groupType(found.entity, found.entry),
        address ? String(address) : '',
      ]
        .filter(Boolean)
        .join(' — '),
    };
  }

  /**
   * What a list of accounts may give its selection at once: Add to a
   * group… and Change state…, one action where it took a visit to each
   * card — forty after an import of forty.
   *
   * @param entity the entity listed
   * @returns the actions, none for another entity or a caller who writes
   *   nothing
   */
  private bulkActions(entity: EntityDescriptor): {
    label: string;
    run(selected: [string, Entry][]): Promise<boolean>;
  }[] {
    if (
      !this.canWrite() ||
      attachedEntity(this.entities, 'people')?.key !== entity.key
    )
      return [];
    const t = (key: string): string => this.translator.t(key);
    const actions: {
      label: string;
      run(selected: [string, Entry][]): Promise<boolean>;
    }[] = [];
    if (this.api.groupSearch(this.entities))
      actions.push({
        label: t('bulk.addToGroups'),
        run: selected => this.bulkAddToGroups(entity, selected),
      });
    const status = entity.accountStatus;
    if (status && entity.schema.attributes[status]?.states)
      actions.push({
        label: t('bulk.changeState'),
        run: selected => this.bulkChangeState(entity, selected),
      });
    return actions;
  }

  /**
   * The accounts selected that the caller writes, and how many others were
   * left out: an account in transit, or in a branch only read, is listed
   * as well, and its card offers neither action.
   */
  private bulkWritable(
    entity: EntityDescriptor,
    selected: [string, Entry][]
  ): { kept: [string, Entry][]; leftOut: string | undefined } {
    const kept = selected.filter(
      ([, entry]) => entry.dn && this.writes(entity, entry)
    );
    const count = selected.length - kept.length;
    return {
      kept,
      leftOut: count ? this.translator.t('bulk.leftOut', { count }) : undefined,
    };
  }

  /** Whether the side panel is open: one opened needs a page to be in. */
  private panelShown(): boolean {
    return (
      this.container?.querySelector<HTMLElement>('[data-panel]')?.hidden ===
      false
    );
  }

  /**
   * Opened for one action: the panel's close, or its replacement, settles
   * it unless its work is under way, which settles it once done.
   *
   * @returns `own`, whether the panel is still the action's, `start` and
   *   `finish` around the work, and `settled`, its outcome once known
   */
  private bulkPanel(): {
    own(): boolean;
    start(): void;
    finish(changed: boolean): void;
    settled: Promise<boolean>;
  } {
    let closed = false;
    let running = false;
    let changed = false;
    let settle = (_changed: boolean): void => undefined;
    const settled = new Promise<boolean>(resolve => (settle = resolve));
    this.panelClosed = (): void => {
      closed = true;
      if (!running) settle(changed);
    };
    return {
      own: () => !closed,
      start: (): void => {
        running = true;
        // Escape and Cancel would leave the work going, unseen; a reload
        // would stop it halfway, and the browser asks first.
        this.panelGuard = (): boolean => !running;
        this.panelDirty = (): boolean => running;
      },
      finish: (done: boolean): void => {
        running = false;
        changed ||= done;
        if (closed) settle(changed);
        else {
          this.panelGuard = null;
          this.panelDirty = null;
        }
      },
      settled,
    };
  }

  /**
   * Add the accounts selected to groups chosen in a panel, one request a
   * group. A group that refuses stays chosen in the panel, with why.
   *
   * @returns whether the accounts are in a group chosen, once the panel is
   *   closed
   */
  private bulkAddToGroups(
    entity: EntityDescriptor,
    selected: [string, Entry][]
  ): Promise<boolean> {
    const { kept, leftOut } = this.bulkWritable(entity, selected);
    const members = kept.map(([, entry]) => String(entry.dn));
    const search = this.api.groupSearch(this.entities, found =>
      this.writes(found.entity, found.entry)
    );
    if (!search) return Promise.resolve(false);
    if (!members.length) {
      if (leftOut) this.toast(leftOut, true);
      return Promise.resolve(false);
    }
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const owners = new Map<string, EntityDescriptor>();
    // The members each group found holds already: one sent again fails the
    // whole request, the others with it.
    const holds = new Map<string, Set<string>>();
    const picker = new GroupPicker({
      translator: this.translator,
      search: async (query: string): Promise<GroupChoice[]> =>
        (await search(query)).map(found => {
          const key = comparableDn(found.dn);
          owners.set(key, found.entity);
          const role = roleAttribute(found.entity.schema, 'members');
          holds.set(
            key,
            new Set(
              (role ? [entryValue(found.entry, role) ?? []].flat() : []).map(
                dn => comparableDn(String(dn))
              )
            )
          );
          return this.groupChoice(found);
        }),
      onAdd: async (
        chosen: GroupChoice[]
      ): Promise<{ left: GroupChoice[]; error?: string }> => {
        const already: string[] = [];
        const left: GroupChoice[] = [];
        const refused: string[] = [];
        // How many each group joined took: one already in it is not said
        // to be added.
        const added = new Map<number, string[]>();
        let sent = false;
        action.start();
        try {
          for (const group of chosen) {
            const key = comparableDn(group.dn);
            const owner = owners.get(key);
            if (!owner) continue;
            const held = holds.get(key) ?? new Set<string>();
            const absent = members.filter(dn => !held.has(comparableDn(dn)));
            if (!absent.length) {
              already.push(group.name);
              continue;
            }
            try {
              await this.api.addMembers(owner, group.name, absent);
              for (const dn of absent) held.add(comparableDn(dn));
              sent = true;
              added.set(absent.length, [
                ...(added.get(absent.length) ?? []),
                group.name,
              ]);
            } catch (err) {
              left.push(group);
              refused.push(this.refusal(err, owner, group.name).message);
            }
          }
        } finally {
          // Everyone in the groups chosen already is done as well: the
          // selection goes.
          action.finish(sent || already.length > 0);
        }
        const told = [
          ...[...added].map(([count, groups]) =>
            t('bulk.added', { count, groups: groups.join(', ') })
          ),
          ...(already.length
            ? [
                t('bulk.alreadyIn', {
                  count: members.length,
                  groups: already.join(', '),
                }),
              ]
            : []),
        ];
        if (told.length) this.toast(told.join('. '));
        if (left.length === 0 && action.own()) this.closePanel(true);
        return {
          left,
          // Each refusal said with the group it is about.
          error: refused.length
            ? refused
                .map((message, index) => `${left[index].name}: ${message}`)
                .join(' ')
            : undefined,
        };
      },
      onCancel: (): void => this.closePanel(),
    });
    this.openPanel(t('bulk.addTitle', { count: members.length }), body => {
      body.innerHTML = `${
        leftOut ? `<p class="dc-hint">${escapeHtml(leftOut)}</p>` : ''
      }<div data-bulk-picker></div>`;
      const holder = body.querySelector<HTMLElement>('[data-bulk-picker]');
      if (holder) picker.render(holder);
    });
    if (!this.panelShown()) return Promise.resolve(false);
    const action = this.bulkPanel();
    return action.settled;
  }

  /**
   * Move the accounts selected to one state, one after the other, the
   * panel counting them as it goes; those refused are listed, with why.
   *
   * @returns whether any account changed state, once the panel is closed
   */
  private async bulkChangeState(
    entity: EntityDescriptor,
    selected: [string, Entry][]
  ): Promise<boolean> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const known = (key: string): string | undefined => {
      const shown = t(key);
      return shown === key ? undefined : shown;
    };
    const attribute = entity.accountStatus;
    const states = attribute
      ? entity.schema.attributes[attribute]?.states
      : undefined;
    if (!states) return false;
    const { kept, leftOut } = this.bulkWritable(entity, selected);
    if (!kept.length) {
      if (leftOut) this.toast(leftOut, true);
      return false;
    }
    const { language } = this.translator;
    const label = (state: string): string =>
      pointerLabel(this.entities, states[state], language) ??
      stateLabel(this.translator, state);
    const address =
      typeof window === 'undefined' ? undefined : window.location.hash;
    const described = await this.stateDescriptions(states);
    // Gone elsewhere, or another panel opened, while the states were read:
    // not opened over it.
    if (
      (typeof window !== 'undefined' && window.location.hash !== address) ||
      this.container?.querySelector<HTMLElement>('[data-panel]')?.hidden ===
        false
    )
      return false;
    const total = kept.length;
    this.openPanel(t('bulk.stateTitle', { count: total }), body => {
      body.innerHTML = `
          <form class="dc-form">
            ${leftOut ? `<p class="dc-hint">${escapeHtml(leftOut)}</p>` : ''}
            <fieldset class="dc-form-group" data-bulk-states>
              <legend>${escapeHtml(t('status.choose'))}</legend>
              ${Object.keys(states)
                .map(state => {
                  const field = `dc-state-${state}`;
                  const line =
                    described[state] ?? known(`status.help.${state}`);
                  return `
                <div class="dc-field dc-state-choice">
                  <input type="radio" id="${escapeHtml(field)}" name="dc-state"
                    value="${escapeHtml(state)}"${
                      line
                        ? ` aria-describedby="${escapeHtml(field)}-help"`
                        : ''
                    } />
                  <label for="${escapeHtml(field)}">${escapeHtml(label(state))}</label>
                  ${
                    line
                      ? `<p id="${escapeHtml(field)}-help" class="dc-hint">${escapeHtml(line)}</p>`
                      : ''
                  }
                </div>`;
                })
                .join('')}
            </fieldset>
            <div data-bulk-progress hidden>
              <p class="dc-hint" role="status"></p>
              <div class="dc-progress" role="progressbar" aria-valuemin="0"
                aria-valuemax="${total}" aria-valuenow="0">
                <div class="dc-progress-bar" style="width:0%"></div>
              </div>
            </div>
            <div class="dc-form-actions">
              <button type="button" class="dc-button" data-cancel>${escapeHtml(
                t('app.cancel')
              )}</button>
              <button type="submit" class="dc-button dc-button-primary" disabled>${escapeHtml(
                t('status.apply')
              )}</button>
            </div>
          </form>`;
    });
    if (!this.panelShown()) return false;
    const action = this.bulkPanel();
    const body =
      this.container?.querySelector<HTMLElement>('[data-panel-body]');
    if (!body) return action.settled;
    const submit = body.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    );
    const cancel = body.querySelector<HTMLButtonElement>('[data-cancel]');
    const fieldset =
      body.querySelector<HTMLFieldSetElement>('[data-bulk-states]');
    const progress = body.querySelector<HTMLElement>('[data-bulk-progress]');
    const count = (done: number): void => {
      if (!progress) return;
      progress.hidden = false;
      const line = progress.querySelector<HTMLElement>('[role="status"]');
      if (line) line.textContent = t('bulk.progress', { done, count: total });
      progress
        .querySelector('.dc-progress')
        ?.setAttribute('aria-valuenow', String(done));
      const bar = progress.querySelector<HTMLElement>('.dc-progress-bar');
      if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
    };
    const chosen = (): string | undefined =>
      body.querySelector<HTMLInputElement>('input[name="dc-state"]:checked')
        ?.value;
    let running = false;
    for (const radio of Array.from(
      body.querySelectorAll<HTMLInputElement>('input[name="dc-state"]')
    ))
      radio.addEventListener('change', () => {
        const state = chosen();
        if (!submit || !state || running) return;
        submit.disabled = false;
        submit.textContent =
          known(`status.action.${state}`) ?? t('status.apply');
      });
    cancel?.addEventListener('click', () => this.closePanel());
    body.querySelector('form')?.addEventListener('submit', event => {
      event.preventDefault();
      const state = chosen();
      if (!state || running) return;
      running = true;
      if (submit) submit.disabled = true;
      if (cancel) cancel.disabled = true;
      if (fieldset) fieldset.disabled = true;
      action.start();
      void (async (): Promise<void> => {
        const refused: string[] = [];
        let done = 0;
        try {
          for (const [id, entry] of kept) {
            if (action.own()) count(done);
            const name = this.personName(entity, entry, id);
            try {
              await this.api.setStatus(entity, id, state);
            } catch (err) {
              refused.push(
                `${name}: ${this.refusal(err, entity, name).message}`
              );
            }
            done++;
          }
          if (action.own()) count(done);
        } finally {
          action.finish(done > refused.length);
        }
        const moved = total - refused.length;
        if (moved)
          this.toast(
            t('bulk.stateDone', { count: moved, state: label(state) })
          );
        // The panel closed meanwhile, by a page left: another may be open.
        if (!action.own()) return;
        if (!refused.length) {
          this.closePanel(true);
          return;
        }
        // Those refused, named with why, in place of the form.
        body.innerHTML = `
              <div class="dc-form">
                ${leftOut ? `<p class="dc-hint">${escapeHtml(leftOut)}</p>` : ''}
                <p>${escapeHtml(t('bulk.refused', { count: refused.length }))}</p>
                <ul class="dc-confirm-items">${refused
                  .map(line => `<li>${escapeHtml(line)}</li>`)
                  .join('')}</ul>
                <div class="dc-form-actions">
                  <button type="button" class="dc-button dc-button-primary" data-close>${escapeHtml(
                    t('app.close')
                  )}</button>
                </div>
              </div>`;
        body
          .querySelector('[data-close]')
          ?.addEventListener('click', () => this.closePanel(true));
      })();
    });
    return action.settled;
  }

  /**
   * Add an account to groups, chosen in the panel _Add to a group…_ opens.
   * The groups offered are those the caller writes: any other would be
   * refused. Each is joined on its own, so that one refused leaves the
   * others joined, and stays chosen in the panel with why.
   *
   * @param entry the account
   * @param name what its card is headed with
   * @param held DN of the groups it is in already, not offered again
   */
  private addToGroups(entry: Entry, name: string, held: string[]): void {
    const holds = new Set(held.map(dn => comparableDn(dn)));
    const search = this.api.groupSearch(
      this.entities,
      found =>
        !holds.has(comparableDn(found.dn)) &&
        this.writes(found.entity, found.entry)
    );
    if (!search || !entry.dn) return;
    const member = String(entry.dn);
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const owners = new Map<string, EntityDescriptor>();
    const picker = new GroupPicker({
      translator: this.translator,
      search: async (query: string): Promise<GroupChoice[]> =>
        (await search(query)).map(found => {
          owners.set(comparableDn(found.dn), found.entity);
          return this.groupChoice(found);
        }),
      onAdd: async (
        chosen: GroupChoice[]
      ): Promise<{ left: GroupChoice[]; error?: string }> => {
        const joined: string[] = [];
        const left: GroupChoice[] = [];
        const refused: string[] = [];
        for (const group of chosen) {
          const owner = owners.get(comparableDn(group.dn));
          if (!owner) continue;
          try {
            await this.api.addMembers(owner, group.name, [member]);
            joined.push(group.name);
            // Joined: no longer offered, as the server would refuse it twice.
            holds.add(comparableDn(group.dn));
          } catch (err) {
            left.push(group);
            refused.push(this.refusal(err, owner, group.name).message);
          }
        }
        if (joined.length)
          this.toast(t('groups.added', { name, groups: joined.join(', ') }));
        if (left.length === 0) {
          this.closePanel(true);
          await this.refreshCard('[data-add-groups]');
        } else if (joined.length) {
          await this.renderMain();
          // The button the panel gives the focus back to was redrawn.
          this.panelOpener =
            this.main()?.querySelector<HTMLElement>('[data-add-groups]') ??
            null;
        }
        // Several refused: each said with the group it is about.
        const error =
          refused.length > 1
            ? refused
                .map((message, index) => `${left[index].name}: ${message}`)
                .join(' ')
            : refused[0];
        return { left, error };
      },
      onCancel: (): void => this.closePanel(),
    });
    this.openPanel(t('groups.title', { name }), body => picker.render(body));
  }

  /**
   * Add members to a group, chosen in a panel as an account's groups are:
   * found by name, address or employee ID, added in one request.
   *
   * A team mailbox the server keeps to its domain is offered the accounts
   * of that domain only, as in the form. A DN typed whole, or an outside
   * address, is still the form's to add.
   *
   * @param entity the group's entity
   * @param entry the group
   * @param id the group
   * @param name what its card is headed with
   * @param held DN of its members, not offered again
   */
  private addMembers(
    entity: EntityDescriptor,
    entry: Entry,
    id: string,
    name: string,
    held: string[]
  ): void {
    // Nor the group itself.
    const holds = new Set(
      [...held, String(entry.dn ?? '')].map(dn => comparableDn(dn))
    );
    const search = this.api.memberSearch(
      'members',
      this.entities,
      dn => !holds.has(comparableDn(dn))
    );
    if (!search) return;
    const domain = this.teamMailboxDomain(entity, entry);
    let leftOut = false;
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const picker = new GroupPicker({
      translator: this.translator,
      words: {
        field: t('members.field'),
        hint: t('form.searchMember', { count: SEARCH_MINIMUM }),
      },
      search: async (query: string): Promise<GroupChoice[]> => {
        const found = (await search(query)).filter(
          candidate => !holds.has(comparableDn(candidate.dn))
        );
        const kept = found.filter(
          candidate =>
            !domain ||
            candidate.mail
              ?.slice(candidate.mail.lastIndexOf('@') + 1)
              .toLowerCase() === domain
        );
        leftOut = kept.length < found.length;
        return kept.map(candidate => ({
          dn: candidate.dn,
          name: rdnValue(candidate.dn),
          label: candidate.label,
        }));
      },
      // An address typed at another domain is said to be refused as well,
      // as the form says it: the search found no account of it to leave out.
      emptyNote: (query: string): string | undefined => {
        if (!domain) return undefined;
        const at = query.lastIndexOf('@');
        const typed =
          at > 0
            ? query
                .slice(at + 1)
                .trim()
                .toLowerCase()
            : undefined;
        return leftOut || (typed && !domain.startsWith(typed))
          ? t('form.otherDomain', { domain })
          : undefined;
      },
      onAdd: async (
        chosen: GroupChoice[]
      ): Promise<{ left: GroupChoice[]; error?: string }> => {
        try {
          await this.api.addMembers(
            entity,
            id,
            chosen.map(member => member.dn)
          );
        } catch (err) {
          return {
            left: chosen,
            error: this.refusal(err, entity, name).message,
          };
        }
        this.toast(
          t('members.added', {
            count: chosen.length,
            names: chosen.map(member => member.name).join(', '),
            group: name,
          })
        );
        this.closePanel(true);
        await this.refreshCard('[data-add-members]');
        return { left: [] };
      },
      onCancel: (): void => this.closePanel(),
    });
    this.openPanel(t('members.title', { group: name }), body =>
      picker.render(body)
    );
  }

  /**
   * The domain a group keeps its members to: a team mailbox's, when the
   * server keeps them to theirs. What `EntityForm` reads from the form, read
   * from the group as stored.
   */
  private teamMailboxDomain(
    entity: EntityDescriptor,
    entry: Entry
  ): string | undefined {
    if (!this.api.teamMailboxesKeepDomain) return undefined;
    const type = roleAttribute(entity.schema, 'mailboxType');
    const mail = roleAttribute(entity.schema, 'primaryEmail');
    if (!type || !mail) return undefined;
    const types = [entryValue(entry, type) ?? []].flat().map(String);
    if (!types.some(dn => /^\s*cn=teamMailbox\s*,/i.test(dn))) return undefined;
    const address = String([entryValue(entry, mail) ?? []].flat()[0] ?? '');
    const at = address.lastIndexOf('@');
    return at > 0
      ? address
          .slice(at + 1)
          .trim()
          .toLowerCase()
      : undefined;
  }

  /**
   * Take a member out of a group, from the × on the member: one click, as
   * the × of a group on an account's card.
   *
   * @param entity the group's entity
   * @param id the group
   * @param name what its card is headed with
   * @param dn DN of the member
   */
  private async removeMember(
    entity: EntityDescriptor,
    id: string,
    name: string,
    dn: string
  ): Promise<void> {
    const member = rdnValue(dn);
    try {
      await this.api.removeMember(entity, id, dn);
    } catch (err) {
      this.toast(this.refusal(err, entity, name).message, true);
      return;
    }
    this.toast(
      this.translator.t('groups.removed', { name: member, group: name })
    );
    await this.refreshCard('[data-add-members]');
  }

  /**
   * Take an account out of one of its groups, from the × on the group: one
   * click, as the × of a member in the group's form, and as easily undone.
   *
   * @param entry the account
   * @param name what its card is headed with
   * @param dn DN of the group
   */
  private async leaveGroup(
    entry: Entry,
    name: string,
    dn: string
  ): Promise<void> {
    const owner = this.groupEntity(dn);
    if (!owner || !entry.dn) return;
    const group = rdnValue(dn);
    try {
      await this.api.removeMember(owner, group, String(entry.dn));
    } catch (err) {
      this.toast(this.refusal(err, owner, group).message, true);
      return;
    }
    this.toast(this.translator.t('groups.removed', { name, group }));
    await this.refreshCard('[data-add-groups]');
  }

  /**
   * Draw the card on screen again, after a change made from it, and give
   * the focus back to a control of it: the one it was on was redrawn.
   *
   * @param focus selector of the control to focus, when the card has it
   */
  private async refreshCard(focus: string): Promise<void> {
    await this.renderMain();
    this.main()?.querySelector<HTMLElement>(focus)?.focus();
  }

  /**
   * The organization tree, with the selected node's card beside it.
   *
   * The tree is drawn in place of the one shown last, so the branches the
   * reader opened stay open; the node the address names is revealed in it.
   */
  private async renderOrganizations(
    main: HTMLElement,
    generation: number
  ): Promise<void> {
    if (this.administersNothing()) {
      main.innerHTML = this.nothingMarkup();
      return;
    }
    const entity = this.entities.find(item => item.kind === 'organization');
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    main.innerHTML = `
      <section class="dc-split">
        <div class="dc-split-aside" data-tree></div>
        <div class="dc-split-main" data-org-detail>
          <p class="dc-empty">${escapeHtml(t('tree.empty'))}</p>
        </div>
      </section>`;

    this.tree = new OrganizationTree(
      {
        translator: this.translator,
        root: (): Promise<OrganizationNode | null> =>
          this.api.organizationTop(),
        children: (dn: string): Promise<OrganizationNode[]> =>
          this.api.organizationChildren(dn),
        transit: this.scope?.transit || undefined,
        onSelect: (node: OrganizationNode): void => {
          this.record(`organizations/${encodeURIComponent(node.dn)}`);
          void this.showOrganization(node);
        },
        // A "+" on a node asks a different question from the card on the
        // overview: the card creates where the scope's `organizations.create`
        // or the caller's written branches allow, while the "+" creates under
        // the node it sits on. The server judges that on the node, so the "+"
        // shows only where the caller writes: a tree drawn from the root
        // offered it on the root to an administrator of a branch below it,
        // and creating there was refused.
        onCreateChild:
          entity && this.canWrite()
            ? (node: OrganizationNode): void => {
                void this.openOrganizationForm(entity, undefined, node.dn);
              }
            : undefined,
        canCreateChild: (node: OrganizationNode): boolean =>
          this.createsUnder(node.dn),
        // Walked, or searched, from the root the tree is drawn from: the
        // server roots a local administrator's tree at their branch, and the
        // filter finds what the tree can open down to, no more. A server
        // that searches the tree is asked once per filter rather than walked
        // an organization at a time, up to a bound a wide tree goes past;
        // it keeps the first matches of a broad text, and says so.
        everywhere: (): Promise<OrganizationIndex> =>
          this.api.organizationWalk(),
        search: this.api.searchesOrganizations
          ? (query: string, root: string): Promise<OrganizationMatches> =>
              this.api.organizationSearchRead(query, root, Infinity)
          : undefined,
      },
      this.tree
    );
    await this.tree.render(
      main.querySelector<HTMLElement>('[data-tree]') as HTMLElement
    );

    if (!this.current(generation)) return;
    if (this.route.id) {
      const node = { dn: this.route.id, name: this.route.id };
      await this.tree.reveal(this.route.id);
      if (this.current(generation)) await this.showOrganization(node);
      return;
    }
    // Opened on "Select an organization" beside a tree of one root, the page
    // was always left by a click on that root: it is shown at once, the
    // address naming it in place of the bare one, so that Back leaves the
    // page rather than coming back to the empty box.
    const top = this.tree.top();
    if (!top) return;
    this.record(`organizations/${encodeURIComponent(top.dn)}`, true);
    this.tree.select(top.dn);
    await this.showOrganization(top);
  }

  /**
   * Whether an organization holds others, read from the tree when it has
   * read it: its People table lists only those attached to it directly.
   */
  private async holdsOthers(dn: string): Promise<boolean> {
    const known = this.tree?.hasChildren(dn);
    if (known !== undefined) return known;
    try {
      return (await this.api.organizationChildren(dn)).length > 0;
    } catch {
      return false;
    }
  }

  /**
   * The Users list cut to an organization and what lies under it: who is in
   * Sales was a question only reading the whole directory answered. It is
   * searched by department path, and cut to the path itself and those under
   * it, which a search by substring is not.
   *
   * @returns what the People table's button does, or nothing when no
   *   entity lists the people with a path
   */
  private listEveryone(
    entity: EntityDescriptor,
    entry: Entry,
    dn: string
  ): (() => void) | undefined {
    // The top of the tree is in no path: its children's start with their
    // own name. Listed by its path, it gave the people attached to it alone.
    if (comparableDn(dn) === comparableDn(entity.base)) return undefined;
    const people = attachedEntity(this.entities, 'people');
    const field = people?.organizationPath;
    const stored = entity.organizationPath
      ? entryValue(entry, entity.organizationPath)
      : undefined;
    const path =
      String((Array.isArray(stored) ? stored[0] : stored) ?? '') ||
      this.tree?.nameOf(dn);
    if (!people || !field || !path) return undefined;
    return (): void => {
      this.listViews.set(people.key, {
        search: path,
        searchAttribute: field,
        under: path,
      });
      this.go(people.key);
    };
  }

  /** Show one organization in the right-hand pane, tree still visible. */
  private async showOrganization(node: OrganizationNode): Promise<void> {
    const entity = this.entities.find(item => item.kind === 'organization');
    const holder =
      this.container?.querySelector<HTMLElement>('[data-org-detail]');
    if (!holder || !entity) return;
    // Clicking through a tree is navigation like any other: the node asked
    // for last is the node whose card should end up on screen.
    const generation = ++this.viewGeneration;
    // Until its card is drawn, the tab no longer names the organization
    // shown before: a card that fails to load leaves it named after none.
    this.titlePage();

    // The address names an organization by its DN, which the server checks
    // before looking for it: `#/organizations/zzz` read its refusal, in
    // English and red, where it names an entry that is simply not there.
    if (!isDnShaped(node.dn)) {
      holder.innerHTML = `<p class="dc-empty">${escapeHtml(
        this.translator.t('detail.notFound')
      )}</p>`;
      return;
    }
    let entry: Entry;
    try {
      entry = await this.api.organization(node.dn);
      if (!this.current(generation)) return;
    } catch (err) {
      if (!this.current(generation)) return;
      const failure = readFailure(err, this.translator);
      holder.innerHTML = `<p class="dc-empty${
        failure.gone || failure.refused ? '' : ' dc-error-block'
      }">${escapeHtml(failure.message)}</p>`;
      return;
    }

    // "Who is in this department?" is the question an organization card is
    // opened to answer, and the tree deliberately does not show accounts.
    let failure: string | undefined;
    const listEveryone = this.listEveryone(entity, entry, node.dn);
    const [members, named, attachedNames, holdsOthers] = await Promise.all([
      // A failure is said where the entries would be: an empty table read
      // as an empty department.
      this.readMembers(node.dn).catch((err: unknown) => {
        failure = readFailure(err, this.translator).message;
        return { entries: [], truncated: false };
      }),
      this.pointerNames(entity),
      this.attachedNames(),
      listEveryone ? this.holdsOthers(node.dn) : false,
    ]);
    if (!this.current(generation)) return;

    const rights = this.organizationRights(node.dn);
    const transit = this.scope?.transit;
    const name =
      [entryValue(entry, entity.mainAttribute) ?? []].flat()[0] ||
      rdnValue(node.dn);
    // Said where Edit would be, on the organization the caller administers:
    // the banner names it as theirs, and Save was refused at the end. Not
    // on the top of the tree, which nobody above changes from the console,
    // nor on the transit branch, which every administrator writes.
    const above = parentOf(node.dn);
    const changedAbove =
      !rights.write &&
      scopeRestricts(this.scope) &&
      !!above &&
      withinDn(above, entity.base) &&
      !(transit && withinDn(node.dn, transit)) &&
      this.scope.branches.some(
        branch =>
          branch.write && comparableDn(branch.dn) === comparableDn(node.dn)
      );
    const card = new EntityDetail({
      entity,
      entry,
      translator: this.translator,
      canWrite: rights.write,
      canDelete: rights.delete,
      notice: changedAbove
        ? this.translator.t('org.changedAbove', { name })
        : undefined,
      pointerLabel: named,
      attached: new AttachedTables({
        entities: this.entities,
        members,
        translator: this.translator,
        name,
        pointerLabel: attachedNames,
        onCreate: this.createsHere(entity, entry, node),
        onListEveryone:
          holdsOthers ||
          (('cut' in members ? members.cut?.people?.truncated : undefined) ??
            members.truncated)
            ? listEveryone
            : undefined,
        // The transit branch's card is where its link leads: what waits
        // there is claimed from it as from the Overview.
        rowAction:
          transit && comparableDn(transit) === comparableDn(node.dn)
            ? this.claimAction()
            : undefined,
        partial: !this.readsWhole(node.dn),
        failure,
        onOpen: (href: string): void => {
          window.location.hash = href;
        },
      }),
      relationHref: (dn: string): string | undefined => this.relationHref(dn),
      onEdit: (): void => {
        void this.openOrganizationForm(entity, entry);
      },
      onDelete: (): void => {
        void this.confirmDeleteOrganization(entity, entry, node.dn);
      },
      // What the tree's "+" does, said in words where the reader is looking:
      // the "+" shows on a row only once it is pointed at or selected.
      onCreateChild: this.createsUnder(node.dn)
        ? (): void => {
            void this.openOrganizationForm(entity, undefined, node.dn);
          }
        : undefined,
      onStatus: (): void => undefined,
      onResetPassword: (): void => undefined,
    });
    card.render(holder);
    this.titlePage(card.heading());
  }

  /**
   * What the caller may do to an organization itself, judged as the server
   * judges it: by its parent, on the most specific branch holding it, a
   * branch naming the organization itself granting the right as well, and
   * for Delete every branch at or below it. The administrator of Sales
   * changes what Sales holds, not Sales itself.
   *
   * Writing anywhere was enough to be offered Edit and Delete on any card,
   * the transit branch's included. Every administrator writes the transit
   * branch, to hand entries over, and that gives them no right to change it:
   * Save was refused at the end. On it and below it, only a branch written
   * above it counts — the global administrator's — as the rights on an
   * entry in transit are read from the scope (see {@link transitState}).
   *
   * @param dn the organization
   * @returns whether Edit and Delete are offered
   */
  private organizationRights(dn: string): { write: boolean; delete: boolean } {
    const scope = this.scope;
    if (!scopeRestricts(scope))
      return { write: this.canWrite(), delete: this.canDelete() };
    const transit = scope.transit;
    if (transit && withinDn(dn, transit)) {
      const above = (right: 'write' | 'delete'): boolean =>
        !this.scopeError &&
        scope.branches.some(
          branch =>
            branch[right] &&
            withinDn(dn, branch.dn) &&
            !withinDn(branch.dn, transit)
        );
      return { write: above('write'), delete: above('delete') };
    }
    // Offered on Sales to its administrator, Edit ended in "You do not
    // administer Sales" once the form was typed in.
    const parent = parentOf(dn);
    // RDNs, by the commas no backslash escapes.
    const depth = (branch: string): number =>
      (comparableDn(branch).match(/(?:^|[^\\]),/g) ?? []).length + 1;
    const holding = parent
      ? scope.branches
          .filter(branch => withinDn(parent, branch.dn))
          .sort((a, b) => depth(b.dn) - depth(a.dn))[0]
      : undefined;
    const judged = (right: 'write' | 'delete'): boolean =>
      !this.scopeError &&
      !!holding?.[right] &&
      !scope.branches.some(
        branch =>
          !branch[right] &&
          (comparableDn(branch.dn) === comparableDn(dn) ||
            (right === 'delete' && withinDn(branch.dn, dn)))
      );
    return { write: judged('write'), delete: judged('delete') };
  }

  /**
   * Whether an entity is shown as reference data: what the sentence saying
   * it is kept outside the console is about. A directory with no tree puts
   * every collection forward, and its accounts are no reference data.
   */
  private isReference(entity: EntityDescriptor): boolean {
    return splitEntities(this.entities).reference.includes(entity);
  }

  /**
   * Whether the caller only reads the entries of a reference entity:
   * positions, states, mail domains. They lie outside every department, and
   * the server judges them on their branch, which a local administrator does
   * not administer; the scope says so of each entity in `create`. A scope
   * that restricts nothing leaves it to the server.
   */
  private readsReferenceOnly(entity: EntityDescriptor): boolean {
    // A scope the console could not read withholds every action already,
    // and the banner says why: this is no reason to give.
    if (this.scopeError) return false;
    return !isPrimaryEntity(entity) && !this.changesReference(entity);
  }

  /**
   * Whether the scope lets the caller write a reference entity. It says
   * so in `create`, the right to write its branch; it names no right to
   * delete there, and the same answer stands for Delete.
   */
  private changesReference(entity: EntityDescriptor): boolean {
    if (this.scopeError) return false;
    if (!scopeRestricts(this.scope)) return true;
    return !!this.scope.entities.find(item => item.name === entity.pluralName)
      ?.create;
  }

  /**
   * Readable names of what the attached entries point at — a position, a
   * state, a type of group — read for both the accounts and the groups.
   */
  private async attachedNames(): Promise<(dn: string) => string | undefined> {
    const named = await Promise.all(
      (['people', 'groups'] as const)
        .map(kind => attachedEntity(this.entities, kind))
        .filter((entity): entity is EntityDescriptor => !!entity)
        .map(entity => this.pointerNames(entity))
    );
    return (dn: string): string | undefined =>
      named.map(name => name(dn)).find(Boolean);
  }

  /**
   * New user here and New group here, on an organization's card: the New
   * user form with the department already set to it, as the Overview's card
   * opens it, and the entry, once created, listed on the card.
   *
   * Offered where the Overview offers the creation, and only on an
   * organization the caller writes: the server judges a new account on the
   * department it is attached to. Not in the transit branch, which is no
   * organization of anyone's to grow.
   *
   * @param organizations the organizations' entity
   * @param entry the organization, as read
   * @param node the organization, as the tree has it
   * @returns the creations offered, by table
   */
  private createsHere(
    organizations: EntityDescriptor,
    entry: Entry,
    node: OrganizationNode
  ): Partial<Record<AttachedKind, () => void>> {
    const offered: Partial<Record<AttachedKind, () => void>> = {};
    // The global administrator writes above the transit branch, and may
    // grow it, but an account is handed over into it, not created there.
    const transit = this.scope?.transit;
    if (!this.createsUnder(node.dn) || (transit && withinDn(node.dn, transit)))
      return offered;
    // The path names the department in the form's picker, as it does on an
    // entry being edited: the DN alone would show its last name only.
    const path = organizations.organizationPath
      ? [entryValue(entry, organizations.organizationPath) ?? []].flat()[0]
      : undefined;
    for (const kind of ['people', 'groups'] as const) {
      const target = attachedEntity(this.entities, kind);
      const link = target?.organizationLink;
      if (!target || !link || !this.canCreate(target)) continue;
      const preset: Entry = { [link]: node.dn };
      if (target.organizationPath && path)
        preset[target.organizationPath] = path;
      offered[kind] = (): void =>
        void this.openForm(target, undefined, {
          preset,
          // The card is drawn anew, button included: the focus goes back to
          // the new one, for the next creation, rather than to the page.
          created: (): void =>
            void this.showOrganization(node).then(() =>
              this.container
                ?.querySelector<HTMLElement>(`[data-create-attached="${kind}"]`)
                ?.focus()
            ),
        });
    }
    return offered;
  }

  /**
   * The entries attached to an organization, the accounts and the groups
   * each asked on its own when their classes tell them apart: the server
   * caps and counts each answer apart, so each table says what it left out.
   * One answer for both shares one cap, and the count it gives says nothing
   * of which kind it cut.
   *
   * @param dn the organization
   * @returns what the server listed
   */
  private async readMembers(dn: string): Promise<AttachedEntries> {
    const kinds = (['people', 'groups'] as const).map(kind => ({
      kind,
      objectClass: attachedClass(this.entities, kind),
    }));
    if (kinds.some(({ objectClass }) => !objectClass))
      return this.api.organizationMembers(dn, this.entities);
    const answers = await Promise.all(
      kinds.map(({ objectClass }) =>
        this.api.organizationMembers(dn, this.entities, objectClass)
      )
    );
    // An entry of both classes is listed once.
    const seen = new Set<string>();
    return {
      entries: answers
        .flatMap(answer => answer.entries)
        .filter(entry => {
          const key = comparableDn(entry.dn);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      truncated: answers.some(answer => answer.truncated),
      cut: Object.fromEntries(
        kinds.map(({ kind }, index) => [
          kind,
          { truncated: answers[index].truncated, more: answers[index].more },
        ])
      ),
    };
  }

  /**
   * Whether the server lists the caller everything attached to an
   * organization. It lists only the entries of the branches they
   * administer, so on another administrator's organization an empty table
   * says only that none of theirs is there. The transit branch is every
   * administrator's to read.
   *
   * @param dn the organization
   */
  private readsWhole(dn: string): boolean {
    const scope = this.scope;
    if (!scopeRestricts(scope)) return true;
    if (scope.transit && withinDn(dn, scope.transit)) return true;
    return scope.branches.some(branch => withinDn(dn, branch.dn));
  }

  /* ------------------------------------------------------------ side panel */

  /** Open the side panel with a title and a body builder. */
  /**
   * Show the overlay.
   *
   * A long form docks to the side, so its Save button stays put instead of
   * scrolling off the bottom of a modal — that was the complaint the brief
   * makes. A form of three fields does not need half the screen, and reads
   * better centred, which is what `modal` asks for.
   *
   * @param title heading of the overlay
   * @param build fills the body
   * @param modal centre it rather than docking it to the side
   */
  private openPanel(
    title: string,
    build: (body: HTMLElement) => void,
    modal = false,
    wide = false
  ): void {
    const panel = this.container?.querySelector<HTMLElement>('[data-panel]');
    const heading =
      this.container?.querySelector<HTMLElement>('[data-panel-title]');
    const body =
      this.container?.querySelector<HTMLElement>('[data-panel-body]');
    const dialog = this.container?.querySelector<HTMLElement>(
      '[data-panel-dialog]'
    );
    if (!panel || !heading || !body) return;
    // A panel opened over another keeps the first one's opener: that is
    // where the reader was before any panel.
    if (panel.hidden && typeof document !== 'undefined')
      this.panelOpener = document.activeElement as HTMLElement | null;
    const replaced = this.panelClosed;
    this.panelClosed = null;
    replaced?.();
    heading.textContent = title;
    this.panelGuard = null;
    this.panelDirty = null;
    panel.classList.toggle('dc-panel-modal', modal);
    panel.classList.toggle('dc-panel-wide', wide);
    body.innerHTML = '';
    build(body);
    panel.hidden = false;
    // One body serves every form, and a hidden one keeps the offset the last
    // form was left at: the next would open scrolled past its first fields.
    // Reset once shown, since an element with no box ignores the write.
    body.scrollTop = 0;
    // Into the panel, on its first field: left on the button that opened
    // it, the keyboard went on through the page behind it. A panel with no
    // field holds the focus itself.
    (this.focusables(body)[0] ?? dialog)?.focus();
  }

  /**
   * Close the side panel, unless what it holds asks to stay.
   *
   * What it held goes with it: hidden, a password typed or generated in it
   * stayed in the page, for any script or open developer tools to read, until
   * the next panel replaced it.
   *
   * @param force close it whatever it holds
   */
  private closePanel(force = false): void {
    const panel = this.container?.querySelector<HTMLElement>('[data-panel]');
    if (!panel || panel.hidden) return;
    if (!force && this.panelGuard && !this.panelGuard()) return;
    this.panelGuard = null;
    this.panelDirty = null;
    panel.hidden = true;
    const body =
      this.container?.querySelector<HTMLElement>('[data-panel-body]');
    if (body) body.innerHTML = '';
    const opener = this.panelOpener;
    this.panelOpener = null;
    if (opener?.isConnected) opener.focus();
    const closed = this.panelClosed;
    this.panelClosed = null;
    closed?.();
    this.afterPanel.shift()?.();
  }

  /** What Tab reaches in an element: its enabled controls not hidden. */
  private focusables(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      element => !element.closest('[hidden]')
    );
  }

  /**
   * Keep the keyboard in the side panel while it is open, and close it on
   * Escape. Listened to on the document, so that Tab is caught even once
   * the focus has strayed onto the backdrop.
   *
   * @param event the key pressed
   */
  private panelKey(event: KeyboardEvent): void {
    const panel = this.container?.querySelector<HTMLElement>('[data-panel]');
    const dialog = this.container?.querySelector<HTMLElement>(
      '[data-panel-dialog]'
    );
    if (!panel || panel.hidden || !dialog) return;
    if (event.key === 'Escape') {
      // A control that answers Escape itself, such as a picker closing its
      // suggestions, prevents its default: that press is spent.
      if (event.defaultPrevented) return;
      event.preventDefault();
      this.closePanel();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = this.focusables(dialog);
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && items.includes(active);
    if (!first) {
      event.preventDefault();
      dialog.focus();
    } else if (!inside || active === (event.shiftKey ? first : last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  /**
   * Ask before an action that cannot be taken back, in the centred dialog
   * Claim uses. The browser's own confirm() named an entry by its identifier
   * alone, said nothing of what went with it, and spoke the browser's
   * language with buttons in the browser's order.
   *
   * The focus starts on Cancel, so an Enter pressed out of habit deletes
   * nothing, and Escape cancels. Asked over an open panel, a policy's form,
   * the dialog gives that panel back as it was once answered.
   *
   * @param question what to ask
   * @returns whether the action was confirmed
   */
  private confirmAction(question: Confirmation): Promise<boolean> {
    const panel = this.container?.querySelector<HTMLElement>('[data-panel]');
    const heading =
      this.container?.querySelector<HTMLElement>('[data-panel-title]');
    const body =
      this.container?.querySelector<HTMLElement>('[data-panel-body]');
    const dialog = this.container?.querySelector<HTMLElement>(
      '[data-panel-dialog]'
    );
    if (!panel || !heading || !body || !dialog) return Promise.resolve(false);
    const covered = panel.hidden
      ? undefined
      : {
          title: heading.textContent ?? '',
          nodes: Array.from(body.childNodes),
          modal: panel.classList.contains('dc-panel-modal'),
          wide: panel.classList.contains('dc-panel-wide'),
          guard: this.panelGuard,
          dirty: this.panelDirty,
          closed: this.panelClosed,
          focus: document.activeElement as HTMLElement | null,
        };
    // A question over a panel does not close it.
    this.panelClosed = null;
    return new Promise(resolve => {
      let answered = false;
      const answer = (confirmed: boolean): void => {
        if (answered) return;
        answered = true;
        this.panelGuard = null;
        // An alert dialog only while it asks.
        dialog.setAttribute('role', 'dialog');
        dialog.removeAttribute('aria-describedby');
        if (covered) {
          heading.textContent = covered.title;
          panel.classList.toggle('dc-panel-modal', covered.modal);
          panel.classList.toggle('dc-panel-wide', covered.wide);
          body.replaceChildren(...covered.nodes);
          this.panelGuard = covered.guard;
          this.panelDirty = covered.dirty;
          this.panelClosed = covered.closed;
          (covered.focus?.isConnected ? covered.focus : dialog).focus();
        } else this.closePanel(true);
        resolve(confirmed);
      };
      this.openPanel(
        question.title,
        inner => {
          inner.innerHTML = `
            <div class="dc-confirm" id="dc-confirm-body" data-confirm-body>
              ${question.lines
                .map(line => `<p>${escapeHtml(line)}</p>`)
                .join('')}
              ${
                question.items?.length
                  ? `<ul class="dc-confirm-items">${question.items
                      .map(item => `<li>${escapeHtml(item)}</li>`)
                      .join('')}</ul>`
                  : ''
              }
            </div>
            ${
              question.alternative
                ? `<p class="dc-confirm-alternative"><button type="button" class="dc-link" data-confirm-alternative>${escapeHtml(
                    question.alternative.label
                  )}</button></p>`
                : ''
            }
            <div class="dc-form-actions">
              <button type="button" class="dc-button" data-cancel>${escapeHtml(
                this.translator.t('app.cancel')
              )}</button>
              <button type="button" class="dc-button ${
                question.reversible
                  ? 'dc-button-primary'
                  : 'dc-button-destructive'
              }" data-confirm>${escapeHtml(question.action)}</button>
            </div>`;
          inner
            .querySelector('[data-cancel]')
            ?.addEventListener('click', () => answer(false));
          inner
            .querySelector('[data-confirm]')
            ?.addEventListener('click', () => answer(true));
          inner
            .querySelector('[data-confirm-alternative]')
            ?.addEventListener('click', () => {
              answer(false);
              question.alternative?.run();
            });
        },
        true
      );
      // The form it covers still holds what a reload would lose.
      this.panelDirty = covered?.dirty ?? null;
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-describedby', 'dc-confirm-body');
      // Escape, the close button and a page left all cancel.
      this.panelGuard = (): boolean => {
        answer(false);
        return false;
      };
      body.querySelector<HTMLElement>('[data-cancel]')?.focus();
    });
  }

  /**
   * Create entries of a flat entity from a CSV file. Each row goes through
   * the create endpoint the form uses, so the server holds an imported entry
   * to the same rules as one typed in.
   */
  private openImport(entity: EntityDescriptor): void {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    this.openPanel(
      t('import.title', {
        entities: this.plural(entity),
        lowerEntities: this.plural(entity).toLocaleLowerCase(
          this.translator.language
        ),
      }),
      body => {
        new EntityImport({
          entity,
          translator: this.translator,
          pointerOptions: (
            branch: string
          ): Promise<{ dn: string; label: string }[]> =>
            this.api.pointerOptions(
              branch,
              this.entities,
              this.translator.language
            ),
          pointerLookup: (branch: string): PointerLookup | undefined =>
            this.api.pointerLookup(
              branch,
              this.entities,
              this.translator.language
            ),
          create: async (
            values: Record<string, string | string[]>
          ): Promise<string> =>
            createdEntryId(
              entity,
              await this.api.create(entity, values as Entry),
              values
            ),
          onDone: (created: string[]): void => {
            // The list shows what was just created, rather than its search:
            // checking each new entry took a search of its own. An import
            // that created nothing puts the search back, rather than leave
            // the last one's entries looking like its own.
            const view = this.listViews.get(entity.key) ?? {};
            this.listViews.set(entity.key, view);
            const shown = !!view.imported;
            if (created.length) view.imported = { ids: created };
            else delete view.imported;
            if ((created.length || shown) && this.route.entity === entity.key)
              void this.renderMain();
          },
          onClose: (): void => this.closePanel(),
        }).render(body);
      },
      false,
      true
    );
  }

  /** The table of the password policies. */
  private async renderPolicies(
    main: HTMLElement,
    generation: number
  ): Promise<void> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    main.innerHTML = `
      <section class="dc-view">
        <header class="dc-view-header">
          <h1>${escapeHtml(t('nav.policies'))}</h1>
          <div class="dc-view-actions">
            <button type="button" class="dc-button dc-button-primary" data-new>${escapeHtml(
              t('policy.new')
            )}</button>
          </div>
        </header>
        <div data-list><p class="dc-empty">${escapeHtml(t('app.loading'))}</p></div>
      </section>`;
    let attributes: string[] | undefined;
    main
      .querySelector('[data-new]')
      ?.addEventListener('click', () =>
        this.openPolicyForm(undefined, attributes)
      );

    const holder = main.querySelector<HTMLElement>(
      '[data-list]'
    ) as HTMLElement;
    let policies: PasswordPolicy[];
    try {
      ({ policies, attributes } = await this.api.passwordPolicies());
    } catch (err) {
      if (!this.current(generation)) return;
      const failure = readFailure(err, this.translator);
      holder.innerHTML = `<p class="dc-empty${
        failure.refused ? '' : ' dc-error-block'
      }">${escapeHtml(failure.message)}</p>`;
      return;
    }
    if (!this.current(generation)) return;
    holder.innerHTML = policyTableMarkup(this.translator, policies);
    for (const row of Array.from(
      holder.querySelectorAll<HTMLElement>('[data-policy]')
    )) {
      const open = (): void => {
        const policy = policies.find(item => item.cn === row.dataset.policy);
        if (policy) this.openPolicyForm(policy, attributes);
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter') open();
      });
    }
  }

  /**
   * Create a password policy, or edit one.
   *
   * @param attributes those the directory defines, all when unknown
   */
  private openPolicyForm(policy?: PasswordPolicy, attributes?: string[]): void {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    this.openPanel(
      policy
        ? t('policy.title.edit', { name: policy.cn })
        : t('policy.title.new'),
      body => {
        const form: PolicyForm = new PolicyForm({
          translator: this.translator,
          policy,
          attributes,
          canDelete: this.canDelete(),
          onSave: async (cn, values): Promise<void> => {
            try {
              if (policy) await this.api.updatePasswordPolicy(cn, values);
              else await this.api.createPasswordPolicy(cn, values);
            } catch (err) {
              // A new policy conflicts with nothing but one of its name.
              if (!policy && (err as { status?: number }).status === 409)
                form.refuse('cn', t('policy.error.taken', { name: cn }));
              else this.toast(this.policyRefusal(err, cn), true);
              return;
            }
            this.closePanel(true);
            this.toast(t(policy ? 'policy.saved' : 'policy.created'));
            await this.renderMain();
          },
          onDelete: (): void =>
            void this.deletePolicy(policy as PasswordPolicy),
          onCancel: (): void => this.closePanel(),
        });
        form.render(body);
        this.guardDiscard(body, () => form.isDirty());
      },
      false,
      true
    );
  }

  private async deletePolicy(policy: PasswordPolicy): Promise<void> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    // Asked over the policy's form, which comes back as it was on Cancel.
    if (
      !(await this.confirmAction({
        title: t('policy.deleteTitle', { name: policy.cn }),
        lines: [t('delete.irreversible')],
        action: t('policy.deleteButton'),
      }))
    )
      return;
    try {
      await this.api.deletePasswordPolicy(policy.cn);
    } catch (err) {
      // The server's refusal names the DN, in English: say it in words.
      this.toast(
        (err as { status?: number }).status === 409
          ? t('policy.inUse', { name: policy.cn })
          : this.policyRefusal(err, policy.cn),
        true
      );
      return;
    }
    this.closePanel(true);
    this.toast(t('policy.deleted'));
    await this.renderMain();
  }

  /**
   * A refusal of a password policy in the interface's language, as an
   * entry's is said (see {@link explainRefusal}). A policy has no schema
   * the console reads: the server's words name its attributes themselves.
   *
   * @param err what the request threw
   * @param name the policy
   */
  private policyRefusal(err: unknown, name: string): string {
    return explainRefusal(err, { attributes: {} }, this.translator, name)
      .message;
  }

  /**
   * Create or edit an entry of a flat or group entity.
   *
   * @param entity the entity
   * @param entry the entry to edit; none to create one
   * @param here where a creation was asked for: what the new entry starts
   *   with, and what to do once it exists instead of opening its card
   */
  private async openForm(
    entity: EntityDescriptor,
    entry?: Entry,
    here?: { preset: Entry; created(): void }
  ): Promise<void> {
    // Organizations are written through their own endpoints, whatever offered
    // the form. The dashboard's "New organization" button came through here,
    // and this path reads the new entry's id from the create response, which
    // the organizations endpoint does not return: the organization was
    // created and the console then navigated to no entry at all.
    if (entity.kind === 'organization')
      return this.openOrganizationForm(entity, entry);
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    // Read once for the form, however many addresses it completes.
    const domains = this.api.mailDomains(this.entities);
    const form = new EntityForm({
      entity,
      entry,
      preset: here?.preset,
      translator: this.translator,
      typeAhead: (branch: string): boolean =>
        isDomainBranch(this.entities, branch),
      mailDomains: domains
        ? (organization?: string): Promise<string[]> =>
            domains.names(organization)
        : undefined,
      pointerOptions: (
        branch: string
      ): Promise<{ dn: string; label: string }[]> =>
        this.api.pointerOptions(
          branch,
          this.entities,
          this.translator.language
        ),
      pointerSearch: (
        branch: string,
        failed?: boolean
      ):
        | ((
            query: string
          ) => Promise<{ dn: string; label: string; token?: string }[]>)
        | undefined => this.api.pointerSearch(branch, this.entities, failed),
      memberSearch: (
        role: 'members' | 'owners'
      ):
        | ((query: string) => Promise<{ dn: string; label: string }[]>)
        | undefined => this.api.memberSearch(role, this.entities),
      externalMembers: this.api.externalMembers,
      teamMailboxesKeepDomain: this.api.teamMailboxesKeepDomain,
      fullNameFormat: this.api.fullNameFormat,
      onCancel: (): void => this.closePanel(),
      onSubmit: async (
        values: Record<string, string | string[]>,
        cleared: string[]
      ): Promise<void> => {
        const id = entry
          ? String(entryValue(entry, entity.mainAttribute) ?? '')
          : createdEntryId(entity, undefined, values);
        try {
          if (entry) {
            // The entry as stored: what a membership change is diffed against.
            await this.api.update(entity, id, values, cleared, entry);
            this.toast(t('save.done'));
            this.closePanel(true);
            await this.renderMain();
          } else {
            const created = await this.api.create(entity, values as Entry);
            const createdId = createdEntryId(entity, created, values);
            this.toast(this.createdToast(entity, values, createdId));
            // Created from an organization's card, the entry joins its table
            // there: the next one is often created right after it.
            const next = (): void => {
              if (here) here.created();
              else
                this.go(
                  createdId
                    ? `${entity.key}/${encodeURIComponent(createdId)}`
                    : entity.key
                );
            };
            if (
              await this.givePassword(entity, values, createdId, next, () =>
                form.isShown()
              )
            )
              return;
            // Gone elsewhere while the server answered, the creation or a
            // failed reset: neither the panel now open nor the card are its
            // own to take.
            if (!form.isShown()) return;
            this.closePanel(true);
            next();
          }
        } catch (err) {
          // Refused the rights to the organization it goes to, that is the
          // one named; refused them to the entry itself, the entry.
          const organization = this.organizationRefused(
            entity,
            values,
            entry,
            form
          );
          this.refuseSave(
            err,
            entity,
            form,
            organization?.name ??
              (entry
                ? this.personName(entity, entry, id)
                : this.submittedName(entity, values, id)),
            organization?.attribute
          );
        }
      },
    });

    this.openPanel(
      entry
        ? `${t('app.edit')} — ${this.entryName(entity, String(entryValue(entry, entity.mainAttribute) ?? ''))}`
        : this.createLabel(entity),
      (body: HTMLElement): void => {
        void form.render(body);
        this.guardDiscard(body, () => form.isDirty());
      },
      !form.wantsPanel
    );
  }

  /**
   * Ask before a form loses what was typed in it: Escape, the panel's × and
   * Cancel closed a long form at once, and the Escape that closes a list of
   * suggestions is a press away from the one that closed the panel. The
   * question takes the place of the form's actions, as the generated
   * password's does; a second Escape, or Discard, closes.
   *
   * @param body the panel's body, holding the form
   * @param dirty whether the form holds what closing it would lose
   */
  private guardDiscard(body: HTMLElement, dirty: () => boolean): void {
    const t = (key: string): string => this.translator.t(key);
    let asking: HTMLElement | null = null;
    let before: HTMLElement | null = null;
    const actions = (): HTMLElement | null =>
      body.querySelector<HTMLElement>('.dc-form-actions');
    const keep = (): void => {
      asking?.remove();
      asking = null;
      const row = actions();
      if (row) row.hidden = false;
      (before?.isConnected
        ? before
        : row?.querySelector<HTMLElement>('button')
      )?.focus();
    };
    this.panelDirty = dirty;
    this.panelGuard = (): boolean => {
      if (asking || this.navigating || !dirty()) return true;
      const row = actions();
      if (!row || typeof document === 'undefined') return true;
      before = document.activeElement as HTMLElement | null;
      row.hidden = true;
      asking = document.createElement('div');
      asking.className = 'dc-form-leave';
      asking.setAttribute('data-discard', '');
      asking.innerHTML = `
        <p>${escapeHtml(t('form.discardQuestion'))}</p>
        <button type="button" class="dc-button" data-discard-keep>${escapeHtml(
          t('form.keepEditing')
        )}</button>
        <button type="button" class="dc-button dc-button-danger" data-discard-confirm>${escapeHtml(
          t('form.discard')
        )}</button>`;
      row.after(asking);
      asking
        .querySelector('[data-discard-keep]')
        ?.addEventListener('click', keep);
      asking
        .querySelector('[data-discard-confirm]')
        ?.addEventListener('click', () => this.closePanel(true));
      asking.querySelector<HTMLElement>('[data-discard-keep]')?.focus();
      return false;
    };
  }

  /**
   * Organizations live in the tree, so their form writes through the
   * organization endpoints rather than the flat ones.
   *
   * A new one given no parent goes where the caller may create it: at the
   * root when the scope allows it there, otherwise under their one written
   * branch, or under the one they pick when they write several.
   */
  private async openOrganizationForm(
    entity: EntityDescriptor,
    entry?: Entry,
    parentDn?: string
  ): Promise<void> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const parents = entry || parentDn ? [] : this.creationParents(entity);
    if (parents.length === 1) parentDn = parents[0].dn;
    let picker: HTMLSelectElement | null = null;
    const parent = (): string | undefined =>
      parents.length > 1
        ? (parents.find(item => item.dn === picker?.value) ?? parents[0]).dn
        : parentDn;
    // Read once for the form, whichever parent is picked meanwhile.
    const domains = this.inheritsDomains(entity)
      ? this.api.mailDomains(this.entities)
      : undefined;
    const form = new EntityForm({
      entity,
      entry,
      translator: this.translator,
      typeAhead: (branch: string): boolean =>
        isDomainBranch(this.entities, branch),
      // The organization the new one goes under, or the one an edited one
      // hangs from: the server walks up from there.
      linkableDomains: domains
        ? (): Promise<string[]> =>
            domains.linked(
              (entry?.dn ? parentOf(entry.dn) : parent()) ?? entity.base
            )
        : undefined,
      pointerOptions: (
        branch: string
      ): Promise<{ dn: string; label: string }[]> =>
        this.api.pointerOptions(
          branch,
          this.entities,
          this.translator.language
        ),
      pointerSearch: (
        branch: string,
        failed?: boolean
      ):
        | ((
            query: string
          ) => Promise<{ dn: string; label: string; token?: string }[]>)
        | undefined => this.api.pointerSearch(branch, this.entities, failed),
      onCancel: (): void => this.closePanel(),
      onSubmit: (
        values: Record<string, string | string[]>,
        cleared: string[]
      ): Promise<void> =>
        this.submitOrganization(entity, values, cleared, entry, parent(), form),
    });

    this.openPanel(
      entry
        ? `${t('app.edit')} — ${this.entryName(entity, String(entryValue(entry, entity.mainAttribute) ?? ''))}`
        : this.createLabel(entity),
      (body: HTMLElement): void => {
        // The parent picked is outside the form, and as much typed in it.
        let moved = false;
        this.guardDiscard(body, () => moved || form.isDirty());
        if (parents.length < 2) {
          void form.render(body);
          return;
        }
        body.innerHTML = `
          <div class="dc-field">
            <label for="dc-organization-parent">${escapeHtml(t('tree.parent'))}</label>
            <select id="dc-organization-parent" class="dc-input">
              ${parents
                .map(
                  item =>
                    `<option value="${escapeHtml(item.dn)}">${escapeHtml(
                      item.label
                    )}</option>`
                )
                .join('')}
            </select>
          </div>
          <div data-organization-form></div>`;
        picker = body.querySelector<HTMLSelectElement>(
          '#dc-organization-parent'
        );
        picker?.addEventListener('change', () => {
          moved = true;
        });
        void form.render(
          body.querySelector<HTMLElement>(
            '[data-organization-form]'
          ) as HTMLElement
        );
      },
      !form.wantsPanel
    );
  }

  /**
   * How a card or a list names the entries an entity's pointers land on.
   *
   * A schema names a nomenclature's values itself, and `pointerLabel` reads
   * them there. An entry that carries its own name — a mail domain, stored
   * as `dc=sales` and called `sales.example.org` — has to be read:
   * its branch is listed, as the form's select lists it, when its entity
   * marks a display name and is small enough to list. Read on every view
   * rather than kept, so a domain renamed a moment ago reads renamed. A
   * branch that cannot be read leaves its entries named by their RDN.
   *
   * @param entity the entity whose entries are shown
   * @returns the names, by DN, falling back on the schema's
   */
  private async pointerNames(
    entity: EntityDescriptor
  ): Promise<(dn: string) => string | undefined> {
    const { language } = this.translator;
    const branches = new Set<string>();
    for (const attr of Object.values(entity.schema.attributes)) {
      if (attr.type !== 'pointer' && attr.items?.type !== 'pointer') continue;
      for (const branch of attr.branch || attr.items?.branch || []) {
        const owner = this.entities.find(
          candidate =>
            candidate.base &&
            comparableDn(candidate.base) === comparableDn(branch)
        );
        if (
          owner &&
          !isLarge(owner) &&
          roleAttribute(owner.schema, 'displayName')
        )
          branches.add(owner.base);
      }
    }
    const names = new Map<string, string>();
    await Promise.all(
      [...branches].map(async branch => {
        try {
          const options = await this.api.pointerOptions(
            branch,
            this.entities,
            language
          );
          for (const { dn, label } of options)
            names.set(comparableDn(dn), label);
        } catch {
          // Named by their RDN, as before the branch was read.
        }
      })
    );
    return (dn: string): string | undefined =>
      names.get(comparableDn(dn)) ?? pointerLabel(this.entities, dn, language);
  }

  /**
   * A refusal in the interface's language, naming the fields the way the
   * form does (see {@link explainRefusal}).
   *
   * @param err what the request threw
   * @param entity the entity of the entry refused
   * @param name what a refusal of rights is about: the entry, or the
   *   organization it goes to
   * @param field the attribute naming that organization
   */
  private refusal(
    err: unknown,
    entity: EntityDescriptor,
    name?: string,
    field?: string
  ): { message: string; attribute?: string } {
    return explainRefusal(err, entity.schema, this.translator, name, field);
  }

  /**
   * The organization a refusal of the caller's rights is about, when the
   * write puts an entry in one.
   *
   * ldap-rest judges a new entry on the organization it is attached to, not
   * on the entry: "You do not administer Alice Martin" said of an account
   * that does not exist yet. A change of organization is judged on both
   * ends — reading where the entry is, writing where it goes — and the scope
   * says which the caller lacks; where it says nothing, the destination is
   * the one asked more of. Any other change is judged on the entry, and
   * none is returned.
   *
   * @param entity the entity of the entry written
   * @param values what the form sent
   * @param entry the entry as stored; none for a new one
   * @param form the form, which names the organizations it offered
   * @returns the organization by its path, and the field naming it
   */
  private organizationRefused(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    entry?: Entry,
    form?: EntityForm
  ): { name: string; attribute: string } | undefined {
    const link = entity.organizationLink;
    const sent = link ? [values[link] ?? []].flat()[0]?.trim() : undefined;
    if (!link || !sent) return undefined;
    const named = (dn: string): string =>
      form?.pointerName(dn) ??
      pointerLabel(this.entities, dn, this.translator.language) ??
      rdnValue(dn);
    const stored = entry
      ? String([entryValue(entry, link) ?? []].flat()[0] ?? '').trim()
      : '';
    if (!stored || !scopeRestricts(this.scope))
      return { name: named(sent), attribute: link };
    const writes = this.scope.branches.some(
      branch => branch.write && withinDn(sent, branch.dn)
    );
    return {
      name: writes
        ? (this.roleValue(entity, entry as Entry, 'organizationPath') ??
          named(stored))
        : named(sent),
      attribute: link,
    };
  }

  /**
   * Say why a save was refused: under the field at fault when the form shows
   * it, the toast then only pointing there — it disappears while the form
   * stays open — and in the toast otherwise.
   *
   * @param err what the request threw
   * @param entity the entity of the entry refused
   * @param form the form that was saved
   * @param name what a refusal of rights is about: the entry, or the
   *   organization it goes to
   * @param field the attribute naming that organization
   */
  private refuseSave(
    err: unknown,
    entity: EntityDescriptor,
    form: EntityForm | undefined,
    name: string,
    field?: string
  ): void {
    const { message, attribute } = this.refusal(
      err,
      entity,
      name || undefined,
      field
    );
    if (attribute && form?.refuse(attribute, message))
      this.toast(this.translator.t('refusal.seeField'), true);
    else this.toast(message, true);
  }

  /**
   * Write what the organization form submitted, then draw the view again
   * with the organization on screen.
   *
   * Only the branch the change happened in is read again: the rest of the
   * tree, and the branches the administrator had opened, stay as they were.
   *
   * @param entity the organization entity
   * @param values what the form submitted
   * @param cleared attributes the form emptied
   * @param entry the organization edited; none for a new one
   * @param parentDn where a new one goes; the server's default when omitted
   * @param form the form submitted, to show a refusal under its field
   */
  private async submitOrganization(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    cleared: string[],
    entry?: Entry,
    parentDn?: string,
    form?: EntityForm
  ): Promise<void> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    try {
      if (entry?.dn) {
        const dn = String(entry.dn);
        await this.api.updateOrganization(dn, values, cleared);
        this.toast(t('save.done'));
        this.closePanel(true);
        // Its parent's children are read again, for a changed name. The
        // address already names it, so the view drawn again shows its card,
        // the tree open down to it.
        const parent = this.tree?.parentOf(dn);
        if (parent) await this.tree?.refresh(parent).catch(() => []);
      } else {
        await this.api.createOrganization(values, parentDn);
        this.toast(
          this.createdToast(
            entity,
            values,
            createdEntryId(entity, undefined, values)
          )
        );
        this.closePanel(true);
        // The new organization is found among its parent's children by the
        // name it was given, since the server answers no DN. From the tree,
        // it is then shown and selected where it was created; from the
        // overview, the overview stays.
        const children =
          (await this.tree?.refresh(parentDn).catch(() => [])) ?? [];
        const raw = values[entity.mainAttribute];
        const name = String(
          (Array.isArray(raw) ? raw[0] : raw) ?? ''
        ).toLowerCase();
        const created = children.find(
          child =>
            rdnValue(child.dn).toLowerCase() === name ||
            child.name.toLowerCase() === name
        );
        if (created && this.route.view !== 'dashboard')
          this.record(`organizations/${encodeURIComponent(created.dn)}`);
      }
      await this.renderMain();
    } catch (err) {
      // Named as the panel's title names it. A new one is judged on the
      // organization it goes under, which is the one named then.
      const id = entry
        ? String(entryValue(entry, entity.mainAttribute) ?? '')
        : createdEntryId(entity, undefined, values);
      const parent = parentDn ?? this.api.organizationRoot;
      this.refuseSave(
        err,
        entity,
        form,
        entry
          ? this.entryName(entity, id)
          : parent
            ? this.organizationName(entity, parent)
            : this.submittedName(entity, values, id)
      );
    }
  }

  /**
   * An organization by the name the console gives it elsewhere: its path,
   * as the parent picker and the banner say it, else its name in the tree.
   *
   * @param entity the organizations
   * @param dn the organization
   */
  private organizationName(entity: EntityDescriptor, dn: string): string {
    return (
      this.creationParents(entity).find(
        item => comparableDn(item.dn) === comparableDn(dn)
      )?.label ??
      this.tree?.nameOf(dn) ??
      rdnValue(dn)
    );
  }

  /* --------------------------------------------------------------- actions */

  /**
   * Change an account's state, once a state is picked and the button naming
   * it pressed. The select this replaces wrote the state as soon as its value
   * changed, and an arrow key on it was enough to lock a colleague out.
   *
   * The states are named as the card and the lists name them: by the label
   * the reference data gives the entry each one points at.
   */
  private async changeState(
    entity: EntityDescriptor,
    id: string,
    entry: Entry,
    preselect?: string
  ): Promise<void> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    /** A key of the catalogue, or nothing when it has none for this state */
    const known = (key: string): string | undefined => {
      const shown = t(key);
      return shown === key ? undefined : shown;
    };
    const attribute = entity.accountStatus;
    const states = attribute
      ? entity.schema.attributes[attribute]?.states
      : undefined;
    if (!attribute || !states) return;
    const { language } = this.translator;
    const label = (state: string): string =>
      pointerLabel(this.entities, states[state], language) ??
      stateLabel(this.translator, state);

    const stored = [entryValue(entry, attribute) ?? []].flat()[0];
    const current = Object.keys(states).find(
      state =>
        stored !== undefined &&
        comparableDn(states[state]) === comparableDn(String(stored))
    );
    const currentName = current
      ? label(current)
      : stored === undefined
        ? undefined
        : (pointerLabel(this.entities, String(stored), language) ??
          rdnValue(String(stored)));
    const offered = Object.keys(states).filter(state => state !== current);
    const described = await this.stateDescriptions(states);
    const help = (state: string): string | undefined =>
      described[state] ?? known(`status.help.${state}`);
    const name = this.personName(entity, entry, id);

    this.openPanel(t('status.panelTitle', { name }), body => {
      body.innerHTML = `
        <form class="dc-form">
          ${
            currentName
              ? `<p class="dc-hint" data-current-state>${escapeHtml(
                  t('status.current', { state: currentName })
                )}</p>`
              : ''
          }
          <fieldset class="dc-form-group">
            <legend>${escapeHtml(t('status.choose'))}</legend>
            ${offered
              .map(state => {
                const field = `dc-state-${state}`;
                const line = help(state);
                return `
              <div class="dc-field dc-state-choice">
                <input type="radio" id="${escapeHtml(field)}" name="dc-state"
                  value="${escapeHtml(state)}"${
                    line ? ` aria-describedby="${escapeHtml(field)}-help"` : ''
                  } />
                <label for="${escapeHtml(field)}">${escapeHtml(label(state))}</label>
                ${
                  line
                    ? `<p id="${escapeHtml(field)}-help" class="dc-hint">${escapeHtml(line)}</p>`
                    : ''
                }
              </div>`;
              })
              .join('')}
          </fieldset>
          <div class="dc-form-actions">
            <button type="button" class="dc-button" data-cancel>${escapeHtml(
              t('app.cancel')
            )}</button>
            <button type="submit" class="dc-button dc-button-primary" disabled>${escapeHtml(
              t('status.apply')
            )}</button>
          </div>
        </form>`;

      const submit = body.querySelector<HTMLButtonElement>(
        'button[type="submit"]'
      );
      const chosen = (): string | undefined =>
        body.querySelector<HTMLInputElement>('input[name="dc-state"]:checked')
          ?.value;
      // Picking a state, by click or arrow key, only names the button: the
      // button writes.
      for (const radio of Array.from(
        body.querySelectorAll<HTMLInputElement>('input[name="dc-state"]')
      )) {
        radio.addEventListener('change', () => {
          const state = chosen();
          if (!submit || !state) return;
          submit.disabled = false;
          submit.textContent =
            known(`status.action.${state}`) ?? t('status.apply');
        });
      }
      body
        .querySelector('[data-cancel]')
        ?.addEventListener('click', () => this.closePanel());
      body.querySelector('form')?.addEventListener('submit', event => {
        event.preventDefault();
        const state = chosen();
        if (state) void this.setStatus(entity, id, state, name, label(state));
      });
    });
    // Asked for by name, from the deletion's tip: picked, and focused, but
    // still written only by the button.
    if (!preselect) return;
    const picked = Array.from(
      this.container?.querySelectorAll<HTMLInputElement>(
        '[data-panel-body] input[name="dc-state"]'
      ) ?? []
    ).find(radio => radio.value === preselect);
    if (picked) {
      picked.checked = true;
      picked.dispatchEvent(new Event('change'));
      picked.focus();
    }
  }

  /**
   * What each state means, as the reference entry it points at describes it:
   * the deployment's own words before the catalogue's. A list that cannot be
   * read leaves the catalogue's.
   *
   * @param states the states, as the schema declares them
   * @returns the descriptions, by state, of the entries that have one
   */
  private async stateDescriptions(
    states: Record<string, string>
  ): Promise<Record<string, string>> {
    const described: Record<string, string> = {};
    const parent = parentOf(Object.values(states)[0] ?? '');
    const owner = parent
      ? this.entities.find(
          candidate =>
            candidate.base &&
            comparableDn(candidate.base) === comparableDn(parent)
        )
      : undefined;
    if (!owner) return described;
    let entries: Record<string, Entry>;
    try {
      entries = await this.api.list(owner);
    } catch {
      return described;
    }
    for (const [state, dn] of Object.entries(states)) {
      const key = rdnValue(dn).toLowerCase();
      const found = Object.entries(entries).find(
        ([id]) => id.toLowerCase() === key
      )?.[1];
      const text = [entryValue(found, 'description') ?? []].flat()[0];
      if (text && String(text).trim()) described[state] = String(text).trim();
    }
    return described;
  }

  /** Write a state chosen in the panel, and say whose it now is. */
  private async setStatus(
    entity: EntityDescriptor,
    id: string,
    state: string,
    name: string,
    label: string
  ): Promise<void> {
    try {
      await this.api.setStatus(entity, id, state);
      this.closePanel();
      this.toast(
        this.translator.t('status.changedFor', { name, state: label })
      );
      await this.renderMain();
    } catch (err) {
      this.toast(this.refusal(err, entity, name).message, true);
    }
  }

  /**
   * Reset a password. A generated one is shown once, in the panel that asked
   * for it: it cannot be read back afterwards. So the panel is sent once and
   * stays while the server answers: closed in the meantime, it had the
   * password shown over whatever opened next, or a typed one close it. Only
   * Cancel closes it then, should the server never answer; a password
   * generated all the same gets a panel of its own.
   */
  private async resetPassword(
    entity: EntityDescriptor,
    id: string
  ): Promise<void> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    this.openPanel(t('password.title'), body => {
      body.innerHTML = `
        <form class="dc-form">
          <div class="dc-field">
            <label for="dc-new-password">${escapeHtml(t('password.choose'))}</label>
            <input id="dc-new-password" class="dc-input" type="password"
              autocomplete="new-password"
              aria-describedby="dc-new-password-hint" />
            <p id="dc-new-password-hint" class="dc-hint">${escapeHtml(t('password.generateHint'))}</p>
          </div>
          <div class="dc-field dc-field-inline">
            <input id="dc-force-change" type="checkbox" checked />
            <label for="dc-force-change">${escapeHtml(t('password.forceChange'))}</label>
          </div>
          <div class="dc-form-actions">
            <button type="button" class="dc-button" data-cancel>${escapeHtml(
              t('app.cancel')
            )}</button>
            <button type="submit" class="dc-button dc-button-primary">${escapeHtml(
              t('password.confirmButton')
            )}</button>
          </div>
        </form>`;

      const form = body.querySelector('form');
      const send = body.querySelector<HTMLButtonElement>(
        'button[type="submit"]'
      );
      let pending = false;
      body
        .querySelector('[data-cancel]')
        ?.addEventListener('click', () => this.closePanel(pending));
      // Whether the panel still holds this form; a guard it set is its own.
      const own = (): boolean => !!form?.isConnected;
      form?.addEventListener('submit', event => {
        event.preventDefault();
        // A second reset would answer another password, and the one shown
        // might not be the one the server kept.
        if (pending) return;
        pending = true;
        if (send) send.disabled = true;
        // Tied to the request, not set for good: a confirmation asked over
        // the panel meanwhile gives this guard back once it is answered.
        this.panelGuard = (): boolean => !pending;
        const password =
          body.querySelector<HTMLInputElement>('#dc-new-password')?.value || '';
        const force =
          body.querySelector<HTMLInputElement>('#dc-force-change')?.checked ??
          true;
        void this.api
          .resetPassword(entity, id, password || undefined, force)
          .then(result => {
            pending = false;
            const generated = result.generated ? result.password : undefined;
            if (own()) {
              this.panelGuard = null;
              if (generated)
                this.showGeneratedPassword(
                  body,
                  id,
                  generated,
                  result.forceChange ?? force
                );
              else {
                this.closePanel();
                this.toast(t('password.set'));
              }
              return;
            }
            // Shut by force all the same: the password, the only copy there
            // is, gets a panel of its own rather than none, once the panel
            // opened meanwhile, if any, is closed: replaced, it lost what it
            // held, another password perhaps.
            if (!generated) {
              this.toast(t('password.set'));
              return;
            }
            const show = (): void =>
              this.openPanel(t('password.title'), inner =>
                this.showGeneratedPassword(inner, id, generated, force)
              );
            if (
              this.container?.querySelector<HTMLElement>('[data-panel]')
                ?.hidden === false
            )
              this.afterPanel.push(show);
            else show();
          })
          .catch((err: Error) => {
            pending = false;
            if (send) send.disabled = false;
            if (own()) this.panelGuard = null;
            this.toast(err.message, true);
          });
      });
    });
  }

  /**
   * A first password for an account just created without one: generated
   * and shown in the form's panel, as Reset password shows one, before the
   * account's card opens. An account created empty could not be signed in
   * to, and only a call from its owner said so.
   *
   * The panel may have been closed, or given to another form, while the
   * server answered: the password, the only copy there is, then gets a
   * panel of its own, once the one open meanwhile is closed, and the card is
   * not opened over where the administrator went.
   *
   * @param entity the entity created
   * @param values what the form sent
   * @param id the new entry, empty when the server named none
   * @param next what the creation does once the panel is closed
   * @param own whether the panel still holds the form
   * @returns whether the form's panel now shows a password, and stays
   */
  private async givePassword(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    id: string,
    next: () => void,
    own: () => boolean = () => true
  ): Promise<boolean> {
    const field = entity.password;
    if (!field || [values[field] ?? []].flat().some(Boolean)) return false;
    const name = this.submittedName(entity, values, id);
    if (!id) {
      this.toast(this.translator.t('create.noPassword', { name }), true);
      return false;
    }
    const reset = roleAttribute(entity.schema, 'passwordReset');
    // A generated password is meant to be changed, unless told otherwise.
    const force =
      !reset || String([values[reset] ?? []].flat()[0] ?? '') !== 'FALSE';
    const address =
      typeof window === 'undefined' ? undefined : window.location.hash;
    let result: {
      generated: boolean;
      password?: string;
      forceChange?: boolean;
    };
    try {
      result = await this.api.resetPassword(entity, id, undefined, force);
    } catch {
      this.toast(this.translator.t('create.noPassword', { name }), true);
      return false;
    }
    const password = result.password;
    if (!result.generated || !password) return false;
    // What the server did, not what was asked: an entity with no reset
    // attribute flags nothing.
    const mustChange = result.forceChange ?? force;
    const body =
      this.container?.querySelector<HTMLElement>('[data-panel-body]');
    if (own() && body) {
      this.panelDirty = null;
      // Its card, unless the administrator has gone elsewhere since.
      this.afterPanel.push(() => {
        if (typeof window === 'undefined' || window.location.hash === address)
          next();
      });
      this.showGeneratedPassword(body, name, password, mustChange);
      return true;
    }
    const show = (): void =>
      this.openPanel(this.translator.t('password.title'), inner =>
        this.showGeneratedPassword(inner, name, password, mustChange)
      );
    if (
      this.container?.querySelector<HTMLElement>('[data-panel]')?.hidden ===
      false
    )
      this.afterPanel.push(show);
    else show();
    return true;
  }

  /**
   * The password the server generated, in place of the form that asked for
   * it. It is the one value the console cannot fetch again: a toast lost it
   * to the click that began selecting it, and to the next message. So it
   * stays until the panel is closed on purpose, and closing it uncopied asks
   * first, in the panel rather than in a native dialog.
   *
   * @param body the panel's body, the Reset password form's or a new one's
   * @param name the account, as the panel names it
   * @param password the generated password
   * @param mustChange whether a change is required at the next sign-in
   */
  private showGeneratedPassword(
    body: HTMLElement,
    name: string,
    password: string,
    mustChange: boolean
  ): void {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const heading =
      this.container?.querySelector<HTMLElement>('[data-panel-title]');
    if (heading) heading.textContent = t('password.generatedTitle', { name });
    const help = [
      t('password.generatedHelp', { name }),
      ...(mustChange ? [t('password.mustChange')] : []),
    ].join(' ');
    body.innerHTML = `
      <div class="dc-form">
        <div class="dc-field">
          <div class="dc-generated">
            <input id="dc-generated-password" class="dc-input dc-generated-password"
              readonly value="${escapeHtml(password)}"
              aria-labelledby="dc-panel-title"
              aria-describedby="dc-generated-password-help" />
            <button type="button" class="dc-button" data-copy-password>${escapeHtml(
              t('detail.copy')
            )}</button>
          </div>
          <p id="dc-generated-password-help" class="dc-hint">${escapeHtml(help)}</p>
        </div>
        <div class="dc-generated-leave" data-leave hidden>
          <p>${escapeHtml(t('password.leaveUncopied'))}</p>
          <button type="button" class="dc-button" data-leave-back>${escapeHtml(
            t('app.back')
          )}</button>
          <button type="button" class="dc-button dc-button-primary" data-leave-close>${escapeHtml(
            t('app.close')
          )}</button>
        </div>
        <div class="dc-form-actions" data-done-actions>
          <button type="button" class="dc-button dc-button-primary" data-done>${escapeHtml(
            t('password.done')
          )}</button>
        </div>
      </div>`;

    const field = body.querySelector<HTMLInputElement>(
      '#dc-generated-password'
    );
    const leave = body.querySelector<HTMLElement>('[data-leave]');
    const done = body.querySelector<HTMLElement>('[data-done-actions]');
    let copied = false;
    // Asked once per attempt to close: a second Escape, or Close, goes.
    const ask = (shown: boolean): void => {
      if (leave) leave.hidden = !shown;
      if (done) done.hidden = shown;
    };
    this.panelGuard = (): boolean => {
      if (copied || (leave && !leave.hidden)) return true;
      ask(true);
      body.querySelector<HTMLElement>('[data-leave-close]')?.focus();
      return false;
    };

    field?.addEventListener('focus', () => field.select());
    const copy = body.querySelector<HTMLElement>('[data-copy-password]');
    copy?.addEventListener('click', () => {
      // Absent outside a secure context, or refused: the password is
      // selected for the reader to copy by hand.
      const said = (key: string): void => {
        copy.textContent = t(key);
        setTimeout(() => {
          copy.textContent = t('detail.copy');
        }, 2000);
      };
      const failed = (): void => {
        field?.focus();
        field?.select();
        said('password.copyFailed');
      };
      if (!navigator.clipboard) return failed();
      navigator.clipboard.writeText(password).then(() => {
        copied = true;
        ask(false);
        said('detail.copied');
      }, failed);
    });
    body
      .querySelector('[data-done]')
      ?.addEventListener('click', () => this.closePanel());
    body.querySelector('[data-leave-back]')?.addEventListener('click', () => {
      ask(false);
      field?.focus();
    });
    body
      .querySelector('[data-leave-close]')
      ?.addEventListener('click', () => this.closePanel(true));
    // Said by a screen reader with its name and its help, from the field.
    field?.focus();
  }

  /**
   * Claim an entry in transit into one of the caller's organizations. Only
   * those are offered: the server asks for write on the destination and
   * nothing else, so any other choice would be refused.
   */
  private async claim(entity: EntityDescriptor, id: string): Promise<void> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const scope = this.scope;
    if (!scopeRestricts(scope) || !scope.transit) return;
    const transit = comparableDn(scope.transit);
    let targets: { dn: string; label: string }[];
    try {
      targets = (await this.api.organizationOptions(claimRoots(scope))).filter(
        target => comparableDn(target.dn) !== transit
      );
    } catch (err) {
      this.toast((err as Error).message, true);
      return;
    }

    this.openPanel(
      t('transit.claimTitle', { name: id }),
      body => {
        if (targets.length === 0) {
          body.innerHTML = `<p class="dc-empty">${escapeHtml(t('transit.noTarget'))}</p>`;
          return;
        }
        body.innerHTML = `
          <form class="dc-form">
            <div class="dc-field">
              <label for="dc-claim-target">${escapeHtml(t('transit.target'))}</label>
              <select id="dc-claim-target" class="dc-input">
                ${targets
                  .map(
                    target =>
                      `<option value="${escapeHtml(target.dn)}">${escapeHtml(
                        target.label
                      )}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="dc-form-actions">
              <button type="button" class="dc-button" data-cancel>${escapeHtml(
                t('app.cancel')
              )}</button>
              <button type="submit" class="dc-button dc-button-primary">${escapeHtml(
                t('transit.claimButton', { organization: targets[0].label })
              )}</button>
            </div>
          </form>`;

        body
          .querySelector('[data-cancel]')
          ?.addEventListener('click', () => this.closePanel());
        // The button says where the entry goes, as the select changes.
        const submit = body.querySelector<HTMLButtonElement>(
          'button[type="submit"]'
        );
        body
          .querySelector<HTMLSelectElement>('#dc-claim-target')
          ?.addEventListener('change', event => {
            const chosen = targets.find(
              item => item.dn === (event.target as HTMLSelectElement).value
            );
            if (submit && chosen)
              submit.textContent = t('transit.claimButton', {
                organization: chosen.label,
              });
          });
        body.querySelector('form')?.addEventListener('submit', event => {
          event.preventDefault();
          const select =
            body.querySelector<HTMLSelectElement>('#dc-claim-target');
          const target = targets.find(item => item.dn === select?.value);
          if (!target) return;
          void this.api
            .move(entity, id, target.dn)
            .then(async () => {
              this.closePanel();
              this.toast(
                t('transit.claimed', { name: id, organization: target.label })
              );
              await this.afterTransitMove();
            })
            // Claiming is judged on the organization chosen alone.
            .catch((err: unknown) =>
              this.toast(this.refusal(err, entity, target.label).message, true)
            );
        });
      },
      true
    );
  }

  /**
   * Draw the page again after an entry went into or out of transit, and
   * count the branch again on the banner. The Overview counts it itself.
   */
  private async afterTransitMove(): Promise<void> {
    await this.renderMain();
    if (this.route.view !== 'dashboard') await this.readTransit();
  }

  /**
   * Let an entry go into the transit branch, for another administrator,
   * once asked: named as a colleague would name it, with the organization
   * it leaves.
   */
  private async handOver(
    entity: EntityDescriptor,
    id: string,
    entry: Entry
  ): Promise<void> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const transit = this.scope?.transit;
    if (!transit) return;
    const name = this.personName(entity, entry, id);
    const organization = this.roleValue(entity, entry, 'organizationPath');
    if (
      !(await this.confirmAction({
        title: t('transit.handOverTitle', { name }),
        lines: [
          ...(organization
            ? [t('transit.handOverLeaves', { name, organization })]
            : []),
          t('transit.handOverConfirm'),
        ],
        action: t('transit.handOver'),
        reversible: true,
      }))
    )
      return;
    try {
      await this.api.move(entity, id, transit);
      // Where it comes from is said once more, and only here: the entry,
      // now in transit, no longer names it.
      this.toast(
        organization
          ? t('transit.handedOverFrom', { name: id, from: organization })
          : t('transit.handedOver', { name: id })
      );
      await this.afterTransitMove();
    } catch (err) {
      // Handing over is judged on the organization the entry leaves.
      this.toast(this.refusal(err, entity, organization ?? name).message, true);
    }
  }

  /**
   * An entry named as its card and its list name it: a nomenclature's by the
   * label its schema gives it, _Members only_ for `memberRestrictedList`.
   *
   * @param entity the entity the entry belongs to
   * @param id the entry's main attribute value
   * @returns the name
   */
  private entryName(entity: EntityDescriptor, id: string): string {
    return (
      ownValueLabel(
        entity,
        entity.mainAttribute,
        id,
        this.translator.language
      ) || id
    );
  }

  /**
   * What says an entry was created: named by its full name, else as its
   * card names it. "Created" alone did not say what.
   *
   * @param entity the entity the entry belongs to
   * @param values what the form sent
   * @param id the entry's main attribute value; empty when unknown
   */
  private createdToast(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    id: string
  ): string {
    const name = this.submittedName(entity, values, id);
    return name
      ? this.translator.t('create.doneNamed', { name })
      : this.translator.t('create.done');
  }

  /**
   * A new entry named by its full name, else as its card names it.
   *
   * @param entity the entity the entry belongs to
   * @param values what the form sent
   * @param id the entry's main attribute value; empty when unknown
   * @returns the name, empty when the form gave none
   */
  private submittedName(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    id: string
  ): string {
    const display = roleAttribute(entity.schema, 'displayName');
    const full = display ? values[display] : undefined;
    return (
      (Array.isArray(full) ? full[0] : full)?.trim() ||
      (id ? this.entryName(entity, id) : '')
    );
  }

  /*
   * A person as a colleague names them: their full name, else the name
   * {@link entryName} gives.
   */
  private personName(
    entity: EntityDescriptor,
    entry: Entry,
    id: string
  ): string {
    const display = roleAttribute(entity.schema, 'displayName');
    const full = display
      ? [entryValue(entry, display) ?? []].flat()[0]
      : undefined;
    return full && String(full).trim()
      ? String(full).trim()
      : this.entryName(entity, id);
  }

  /**
   * The first value of the attribute playing a role, trimmed.
   *
   * @returns the value, or undefined when the entry has none
   */
  private roleValue(
    entity: EntityDescriptor,
    entry: Entry,
    role: string
  ): string | undefined {
    const attribute = roleAttribute(entity.schema, role);
    const value = attribute
      ? [entryValue(entry, attribute) ?? []].flat()[0]
      : undefined;
    return value && String(value).trim() ? String(value).trim() : undefined;
  }

  /**
   * The groups an account belongs to, by name: from its `memberOf`, else
   * searched among the groups, as its card finds them.
   *
   * @returns their names, or undefined when the search failed or could not
   *   be made: the account may belong to groups all the same
   */
  private async groupsOf(
    entity: EntityDescriptor,
    entry: Entry
  ): Promise<string[] | undefined> {
    for (const [name, attr] of Object.entries(entity.schema.attributes)) {
      const roles = Array.isArray(attr.role) ? attr.role : [attr.role];
      if (!roles.includes('groupMemberships')) continue;
      let list = [entryValue(entry, name) ?? []].flat();
      if (!list.length && entry.dn) {
        try {
          list = await this.api.memberships(entry.dn, this.entities, true);
        } catch {
          return undefined;
        }
      }
      return list.map(dn => rdnValue(String(dn)));
    }
    return [];
  }

  /**
   * What to ask before deleting an entry. An account is named by its full
   * name, email and organization, the way to tell two "jmartin" apart, with
   * the groups it leaves and the state change offered instead. A group says
   * its members stay. Anything else, a position or a mail domain, is named
   * as its card names it.
   *
   * @param entry the entry, when its card is open
   * @param canChangeState offer an account's state change instead
   */
  private async deletion(
    entity: EntityDescriptor,
    id: string,
    entry?: Entry,
    canChangeState = false
  ): Promise<Confirmation> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const irreversible = t('delete.irreversible');
    const name = entry
      ? this.personName(entity, entry, id)
      : this.entryName(entity, id);
    const title = t('delete.title', { name });
    if (entry && entity.kind === 'group') {
      const members = roleAttribute(entity.schema, 'members');
      // groupOfNames needs a member: an empty DN stands for none.
      const count = members
        ? [entryValue(entry, members) ?? []]
            .flat()
            .filter(member => String(member).trim()).length
        : 0;
      return {
        title,
        lines: [
          ...(count ? [t('delete.membersStay', { count })] : []),
          irreversible,
        ],
        action: t('delete.groupButton'),
      };
    }
    if (!entry || !roleAttribute(entity.schema, 'displayName'))
      return {
        title,
        lines: [irreversible],
        action: t('delete.button', { name }),
      };

    const groups = await this.groupsOf(entity, entry);
    const summary = [
      name,
      this.roleValue(entity, entry, 'primaryEmail'),
      this.roleValue(entity, entry, 'organizationPath'),
    ].filter(Boolean);
    // Offered only where Disabled is a state the account is not already in.
    const status = entity.accountStatus;
    const disabled = status
      ? entity.schema.attributes[status]?.states?.disabled
      : undefined;
    const current = status
      ? [entryValue(entry, status) ?? []].flat()[0]
      : undefined;
    const offer =
      canChangeState &&
      !!disabled &&
      comparableDn(disabled) !== comparableDn(String(current ?? ''));
    return {
      title,
      lines: [
        summary.join(' · '),
        // Groups that could not be listed are not none: it says so, and
        // leaves the deletion to the administrator.
        !groups
          ? `${irreversible} ${t('delete.groupsUnknown', { name })}`
          : groups.length
            ? `${irreversible} ${t('delete.leavesGroups', {
                name,
                groups: groups.join(', '),
              })}`
            : irreversible,
      ],
      action: t('delete.button', {
        name: this.roleValue(entity, entry, 'givenName') ?? name,
      }),
      alternative: offer
        ? {
            label: t('delete.preferDisable'),
            run: (): void =>
              void this.changeState(entity, id, entry, 'disabled'),
          }
        : undefined,
    };
  }

  /**
   * Delete an entry once asked.
   *
   * @param entry the entry, when its card is open
   * @param canChangeState offer an account's state change instead
   */
  private async confirmDelete(
    entity: EntityDescriptor,
    id: string,
    entry?: Entry,
    canChangeState = false
  ): Promise<void> {
    // Named as the dialog names it.
    const name = entry
      ? this.personName(entity, entry, id)
      : this.entryName(entity, id);
    if (
      !(await this.confirmAction(
        await this.deletion(entity, id, entry, canChangeState)
      ))
    )
      return;
    try {
      await this.api.remove(entity, id);
      this.toast(this.translator.t('delete.done'));
      this.go(entity.key);
    } catch (err) {
      this.toast(
        this.inUse(err, entity, id) ?? this.refusal(err, entity, name).message,
        true
      );
    }
  }

  /**
   * Why an entry still pointed at may not be deleted, in words. The server
   * refuses with a 409 naming the entry by its DN and the pointer by its
   * attribute, in English: `Cannot delete cn=Sales Manager,…: still
   * referenced by another entry (title)`. The pointer is named by the label
   * of a field landing in the entry's branch, _Position_.
   *
   * @param err the refusal
   * @param entity the entity of the entry
   * @param id the entry's main attribute value
   * @returns the message, or undefined for another refusal
   */
  private inUse(
    err: unknown,
    entity: EntityDescriptor,
    id: string
  ): string | undefined {
    const { status, message } = err as { status?: number; message?: string };
    const attribute = /still referenced[^(]*\(([^)]+)\)\s*$/i.exec(
      message ?? ''
    )?.[1];
    if (status !== 409 || !attribute) return undefined;
    const { language } = this.translator;
    const base = entity.base ? comparableDn(entity.base) : undefined;
    let field: string | undefined;
    for (const candidate of this.entities) {
      const found = Object.entries(candidate.schema.attributes).find(
        ([name, attr]) =>
          name.toLowerCase() === attribute.toLowerCase() &&
          (attr.branch || attr.items?.branch || []).some(
            branch => comparableDn(branch) === base
          )
      );
      if (found) {
        field = attributeLabel(found[0], found[1], language);
        break;
      }
    }
    return this.translator.t('delete.inUse', {
      name: this.entryName(entity, id),
      field: field ?? attribute,
    });
  }

  private async confirmDeleteOrganization(
    entity: EntityDescriptor,
    entry: Entry,
    dn: string
  ): Promise<void> {
    // Named the way the console shows it, by its path: a DN is no name.
    const named = (attribute?: string): string | undefined => {
      const value = attribute ? entryValue(entry, attribute) : undefined;
      return Array.isArray(value) ? value[0] : value;
    };
    const name =
      named(entity.organizationPath) ||
      named(entity.mainAttribute) ||
      rdnValue(dn);
    if (
      !(await this.confirmAction({
        title: this.translator.t('delete.title', { name }),
        lines: [this.translator.t('delete.irreversible')],
        action: this.translator.t('delete.organizationButton'),
      }))
    )
      return;
    try {
      await this.api.deleteOrganization(dn);
      this.toast(this.translator.t('delete.done'));
      // Its parent takes its place: where it was, beside its siblings. Its
      // address is replaced, as Back could only lead to a page now gone.
      const parent = this.tree?.parentOf(dn);
      if (parent) {
        await this.tree?.refresh(parent).catch(() => []);
        this.record(`organizations/${encodeURIComponent(parent)}`, true);
      } else this.record('organizations', true);
      await this.renderMain();
    } catch (err) {
      // The server's refusal names the DN, in English: say it in words.
      if ((err as { status?: number }).status === 409)
        this.toast(this.translator.t('delete.notEmpty', { name }), true);
      else this.toast(this.refusal(err, entity, name).message, true);
    }
  }

  /**
   * Delete a selection, reporting each refusal on its own: a bulk action that
   * stops at the first error leaves the operator guessing which entries went.
   *
   * @returns whether any entry was deleted: none on Cancel, and the list
   *   then stays as it was, selection and focus with it
   */
  private async deleteMany(
    entity: EntityDescriptor,
    ids: string[]
  ): Promise<boolean> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    if (ids.length === 0) return false;
    // The first few by name, enough to see the selection is the right one.
    const named = ids.slice(0, 5).map(id => this.entryName(entity, id));
    const more = ids.length - named.length;
    if (
      !(await this.confirmAction({
        title: t('delete.manyTitle', { count: ids.length }),
        lines: [t('delete.irreversible')],
        items: more ? [...named, t('delete.andMore', { count: more })] : named,
        action: t('delete.manyButton', { count: ids.length }),
      }))
    )
      return false;

    const failures: string[] = [];
    let deleted = 0;
    for (const id of ids) {
      try {
        await this.api.remove(entity, id);
        deleted++;
      } catch (err) {
        const name = this.entryName(entity, id);
        const { refusal } = err as { refusal?: { code?: string } };
        const said = this.refusal(err, entity, name).message;
        // A refusal of rights names the entry itself; any other is said
        // after its name.
        failures.push(
          this.inUse(err, entity, id) ??
            (refusal?.code === 'forbidden'
              ? said
              : t('delete.failed', { name, error: said }))
        );
      }
    }
    this.toast(
      failures.length === 0 ? t('delete.done') : failures.join(' · '),
      failures.length > 0
    );
    return deleted > 0;
  }

  /** Show a short message. */
  private toast(message: string, isError = false): void {
    this.toasts.show(message, isError);
  }
}
