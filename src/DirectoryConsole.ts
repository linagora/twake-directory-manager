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
import { EntityDetail, stateLabel } from './components/EntityDetail';
import { EntityForm } from './components/EntityForm';
import { EntityImport } from './components/EntityImport';
import {
  EntityList,
  LIST_LIMIT,
  SEARCH_MINIMUM,
} from './components/EntityList';
import { OrganizationTree } from './components/OrganizationTree';
import { PolicyForm, policyTableMarkup } from './components/PasswordPolicies';
import {
  attributeLabel,
  comparableDn,
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
import type { PointerLookup } from './importer';
import type {
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
): (search: string, attribute: string) => Promise<EntryList> {
  return (search, attribute) =>
    search.length >= SEARCH_MINIMUM
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

    this.drawShell();
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
    this.closePanel();
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
        <a class="dc-powered" href="https://linagora.com" target="_blank"
          rel="noopener noreferrer">
          <img src="${LINAGORA_LOGO}" alt="LINAGORA" width="100" height="21" />
        </a>
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
          ? `<span class="dc-scope-label">${escapeHtml(t('transit.branch'))}</span>
            <a class="dc-scope-transit" href="#/organizations/${encodeURIComponent(
              this.scope.transit
            )}" title="${escapeHtml(
              // Readable, like the branches' paths: the scope gives the
              // transit branch no path, and its name stands in for one.
              rdnValue(this.scope.transit)
            )}">${escapeHtml(rdnValue(this.scope.transit))}</a>`
          : ''
      }`;
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
   * identifier, the one it signed in with.
   *
   * @returns how to name the account, or null to show the scope's own
   *   words for it, when the read fails or there is nothing to read
   */
  private async readAccount(): Promise<SignedIn | null> {
    const dn = this.scope?.user;
    if (!dn || !isDnShaped(dn)) return null;
    if (this.administersNothing()) return { name: rdnValue(dn) };
    const owner = this.entities.find(
      entity =>
        entity.kind === 'flat' &&
        entity.base &&
        comparableDn(dn) !== comparableDn(entity.base) &&
        withinDn(dn, entity.base)
    );
    if (!owner) return null;
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
      return null;
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
    const sections = this.administersNothing()
      ? [this.noRightsMarkup()]
      : [this.manageMarkup(), this.referenceMarkup()];
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
      canDelete: this.canDelete(),
      pointerLabel: named,
      onOpen: (id: string): void =>
        this.go(`${entity.key}/${encodeURIComponent(id)}`),
      onDelete: (ids: string[]): Promise<void> => this.deleteMany(entity, ids),
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
    const canWrite = transit.rights?.write ?? this.canWrite();
    const detail = new EntityDetail({
      entity,
      entry,
      translator: this.translator,
      canWrite,
      canDelete: transit.rights?.delete ?? this.canDelete(),
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
      onOpenRelation: (target: string): void => this.openRelation(target),
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
        items: { id: string; label: string }[];
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
        return {
          title: attributeLabel(name, attr, this.translator.language),
          attribute: name,
          items: list.map(dn => ({
            id: String(dn),
            label: rdnValue(String(dn)),
          })),
        };
      }
    }
    return undefined;
  }

  /** Follow a relation to whichever entity owns the DN. */
  private openRelation(dn: string): void {
    const owner = this.entities.find(
      entity =>
        entity.base &&
        dn.toLowerCase().endsWith(`,${entity.base.toLowerCase()}`)
    );
    if (!owner) return;
    // `rdnValue`, not a split on the first comma: `cn=Smith\, John,…` holds
    // one, and the truncated id it produced answered "no longer exists".
    const id = rdnValue(dn);
    this.go(`${owner.key}/${encodeURIComponent(id)}`);
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
        // Walked from the root the tree is drawn from: the server roots a
        // local administrator's tree at their branch, and the filter finds
        // what the tree can open down to, no more.
        everywhere: (): Promise<{ dn: string; label: string }[]> =>
          this.api.organizationOptions(),
      },
      this.tree
    );
    await this.tree.render(
      main.querySelector<HTMLElement>('[data-tree]') as HTMLElement
    );

    if (this.route.id && this.current(generation)) {
      const node = { dn: this.route.id, name: this.route.id };
      await this.tree.reveal(this.route.id);
      if (this.current(generation)) await this.showOrganization(node);
    }
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
    const [members, named] = await Promise.all([
      this.api
        .organizationMembers(node.dn)
        .catch(() => ({ entries: [], truncated: false, more: undefined })),
      this.pointerNames(entity),
    ]);
    if (!this.current(generation)) return;

    const card = new EntityDetail({
      entity,
      entry,
      translator: this.translator,
      canWrite: this.canWrite(),
      canDelete: this.canDelete(),
      pointerLabel: named,
      relations: {
        title: this.translator.t('detail.members'),
        items: members.entries.map(member => ({
          id: member.dn,
          label: member.label,
        })),
        truncated: members.truncated,
        more: members.more,
      },
      onOpenRelation: (target: string): void => this.openRelation(target),
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
    heading.textContent = title;
    this.panelGuard = null;
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
   * @param force close it whatever it holds
   */
  private closePanel(force = false): void {
    const panel = this.container?.querySelector<HTMLElement>('[data-panel]');
    if (!panel || panel.hidden) return;
    if (!force && this.panelGuard && !this.panelGuard()) return;
    this.panelGuard = null;
    panel.hidden = true;
    const opener = this.panelOpener;
    this.panelOpener = null;
    if (opener?.isConnected) opener.focus();
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
          focus: document.activeElement as HTMLElement | null,
        };
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
          ): Promise<void> => {
            await this.api.create(entity, values as Entry);
          },
          onDone: (created: number): void => {
            if (created > 0 && this.route.entity === entity.key)
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
      body =>
        new PolicyForm({
          translator: this.translator,
          policy,
          attributes,
          canDelete: this.canDelete(),
          onSave: async (cn, values): Promise<void> => {
            try {
              if (policy) await this.api.updatePasswordPolicy(cn, values);
              else await this.api.createPasswordPolicy(cn, values);
            } catch (err) {
              this.toast((err as Error).message, true);
              return;
            }
            this.closePanel();
            this.toast(t(policy ? 'policy.saved' : 'policy.created'));
            await this.renderMain();
          },
          onDelete: (): void =>
            void this.deletePolicy(policy as PasswordPolicy),
          onCancel: (): void => this.closePanel(),
        }).render(body),
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
          : (err as Error).message,
        true
      );
      return;
    }
    this.closePanel();
    this.toast(t('policy.deleted'));
    await this.renderMain();
  }

  /** Create or edit an entry of a flat or group entity. */
  private async openForm(
    entity: EntityDescriptor,
    entry?: Entry
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
            this.closePanel();
            await this.renderMain();
          } else {
            const created = await this.api.create(entity, values as Entry);
            const createdId = createdEntryId(entity, created, values);
            this.toast(this.createdToast(entity, values, createdId));
            this.closePanel();
            this.go(
              createdId
                ? `${entity.key}/${encodeURIComponent(createdId)}`
                : entity.key
            );
          }
        } catch (err) {
          this.refuseSave(
            err,
            entity,
            form,
            entry
              ? this.personName(entity, entry, id)
              : this.submittedName(entity, values, id)
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
      },
      !form.wantsPanel
    );
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
   * @param name the entry the change was about
   */
  private refusal(
    err: unknown,
    entity: EntityDescriptor,
    name?: string
  ): { message: string; attribute?: string } {
    return explainRefusal(err, entity.schema, this.translator, name);
  }

  /**
   * Say why a save was refused: under the field at fault when the form shows
   * it, the toast then only pointing there — it disappears while the form
   * stays open — and in the toast otherwise.
   *
   * @param err what the request threw
   * @param entity the entity of the entry refused
   * @param form the form that was saved
   * @param name the entry the change was about
   */
  private refuseSave(
    err: unknown,
    entity: EntityDescriptor,
    form: EntityForm | undefined,
    name: string
  ): void {
    const { message, attribute } = this.refusal(err, entity, name || undefined);
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
        this.closePanel();
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
        this.closePanel();
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
      // Named as the panel's title names it.
      const id = entry
        ? String(entryValue(entry, entity.mainAttribute) ?? '')
        : createdEntryId(entity, undefined, values);
      this.refuseSave(
        err,
        entity,
        form,
        entry
          ? this.entryName(entity, id)
          : this.submittedName(entity, values, id)
      );
    }
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
      this.toast((err as Error).message, true);
    }
  }

  /**
   * Reset a password. A generated one is shown once, in the panel that asked
   * for it: it cannot be read back afterwards.
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

      body
        .querySelector('[data-cancel]')
        ?.addEventListener('click', () => this.closePanel());
      body.querySelector('form')?.addEventListener('submit', event => {
        event.preventDefault();
        const password =
          body.querySelector<HTMLInputElement>('#dc-new-password')?.value || '';
        const force =
          body.querySelector<HTMLInputElement>('#dc-force-change')?.checked ??
          true;
        void this.api
          .resetPassword(entity, id, password || undefined, force)
          .then(result => {
            if (result.generated && result.password) {
              this.showGeneratedPassword(body, id, result.password, force);
              return;
            }
            this.closePanel();
            this.toast(t('password.set'));
          })
          .catch((err: Error) => this.toast(err.message, true));
      });
    });
  }

  /**
   * The password the server generated, in place of the form that asked for
   * it. It is the one value the console cannot fetch again: a toast lost it
   * to the click that began selecting it, and to the next message. So it
   * stays until the panel is closed on purpose, and closing it uncopied asks
   * first, in the panel rather than in a native dialog.
   *
   * @param body the Reset password panel's body
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
              await this.renderMain();
            })
            .catch((err: Error) => this.toast(err.message, true));
        });
      },
      true
    );
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
      this.toast(this.translator.t('transit.handedOver', { name: id }));
      await this.renderMain();
    } catch (err) {
      this.toast((err as Error).message, true);
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
   */
  private async groupsOf(
    entity: EntityDescriptor,
    entry: Entry
  ): Promise<string[]> {
    for (const [name, attr] of Object.entries(entity.schema.attributes)) {
      const roles = Array.isArray(attr.role) ? attr.role : [attr.role];
      if (!roles.includes('groupMemberships')) continue;
      let list = [entryValue(entry, name) ?? []].flat();
      if (!list.length && entry.dn)
        list = await this.api
          .memberships(entry.dn, this.entities)
          .catch(() => []);
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
        groups.length
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
    const name = this.entryName(entity, id);
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
   */
  private async deleteMany(
    entity: EntityDescriptor,
    ids: string[]
  ): Promise<void> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    if (ids.length === 0) return;
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
      return;

    const failures: string[] = [];
    for (const id of ids) {
      try {
        await this.api.remove(entity, id);
      } catch (err) {
        failures.push(
          this.inUse(err, entity, id) ??
            t('delete.failed', {
              name: this.entryName(entity, id),
              error: (err as Error).message,
            })
        );
      }
    }
    this.toast(
      failures.length === 0 ? t('delete.done') : failures.join(' · '),
      failures.length > 0
    );
  }

  /** Show a short message. */
  private toast(message: string, isError = false): void {
    this.toasts.show(message, isError);
  }
}
