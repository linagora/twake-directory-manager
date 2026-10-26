/**
 * Directory console — the administration interface.
 *
 * It is built entirely from what the server advertises: `GET /v1/config` gives
 * the entities, their schemas and their endpoints, `GET /v1/authz/scope` gives
 * what the signed-in administrator may do. No entity name, attribute name or
 * label is written here, so a deployment that names its things differently
 * gets its own interface without a change.
 *
 * @module twake-directory-manager/DirectoryConsole
 */

import {
  ConsoleApiClient,
  isDomainBranch,
  isLarge,
  roleAttribute,
} from './api/ConsoleApiClient';
import { LINAGORA_LOGO } from './assets';
import { applyContrast, initial, sidebarMarkup } from './console/shell';
import {
  AttachedTables,
  attachedClass,
  attachedEntity,
  type AttachedKind,
} from './components/AttachedTables';
import { EntityDetail } from './components/EntityDetail';
import { EntityForm } from './components/EntityForm';
import { EntityImport } from './components/EntityImport';
import {
  EntityList,
  LIST_LIMIT,
  SEARCH_MINIMUM,
} from './components/EntityList';
import { GroupPicker, type GroupChoice } from './components/GroupPicker';
import { OrganizationTree } from './components/OrganizationTree';
import {
  attributeLabel,
  comparableDn,
  displayValue,
  entryValue,
  explainRefusal,
  isDnShaped,
  readFailure,
  parentDn as parentOf,
  ownValueLabel,
  pointerLabel,
  rdnValue,
  resolveText,
  withinDn,
} from './format';
import { Translator } from './i18n';
import { Rights, splitEntities } from './rights';
import { signInAgain } from './session';
import type { ListView } from './components/EntityList';
import type {
  OrganizationIndex,
  OrganizationMatches,
} from './components/OrganizationTree';
import type { PointerLookup } from './importer';
// Kept where embedders and the tests found them.
export { readFailure } from './format';
export {
  claimRoots,
  isPrimaryEntity,
  organizationParents,
  scopeRestricts,
  splitEntities,
  transitState,
  writesEntry,
  type TransitState,
} from './rights';
import type {
  Confirmation,
  AttachedEntries,
  AttachedEntry,
  ConsoleOptions,
  EntityDescriptor,
  Entry,
  EntryList,
  OrganizationNode,
  Scope,
} from './types';
import { background, fromConsole, type Reporter } from './shared/background';
import { html, render, type SafeHtml } from './shared/html';
import type { ConsoleContext, Relations } from './console/context';
import type { ConsoleDeps } from './console/deps';
import { DialogService } from './console/dialog';
import { POLICIES_KEY, type Route, routeOf } from './console/route';
import { PanelService, overlayMarkup } from './console/panel';
import {
  highContrast,
  onContrastChange,
  referenceOpen,
  rememberContrast,
  rememberLanguage,
  rememberReference,
  storedLanguage,
} from './console/settings';
import { announcer } from './ui/announce';
import { PoliciesView } from './views/policies';
import { PasswordActions } from './actions/passwords';
import { StateActions } from './actions/state';
import { TransitActions } from './actions/transit';
import { DeletionActions } from './actions/deletion';
import { bulkPanel, bulkWritable } from './console/bulk';
import { ToastController } from './ui/toast';

// Kept importable from here, where they were first defined.
export { ToastController };
export type { Confirmation };

/** The signed-in account, as the overview names it. */
interface SignedIn {
  name: string;
  email?: string;
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
  /** Taken away with the console: what it listens to on the window and the document. */
  private mounted = new AbortController();
  /** Says a text to a screen reader, and nothing to the eye (#212). */
  private readonly announce = announcer(() =>
    this.container?.querySelector<HTMLElement>('[data-announce]')
  );
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
   * The side panel every form opens in, and what the form open asks of the
   * console: a guard on its close, a reload to warn of, what waits for it.
   */
  private readonly panel = new PanelService(
    () => this.container,
    key => this.translator.t(key)
  );
  /** The question asked before what cannot be taken back, in the panel. */
  private readonly dialog = new DialogService(this.panel, key =>
    this.translator.t(key)
  );
  /** What the views moved out of the console are given of it, built by `init()` */
  private context!: ConsoleContext;
  /** The password resets, made by `init()` with the context: they hold nothing */
  private passwords!: PasswordActions;
  /** The changes of state, made by `init()` with the context: they hold nothing */
  private states!: StateActions;
  /** Claim… and Hand over, made by `init()` with the context: they hold nothing */
  private transits!: TransitActions;
  /** The deletions, made by `init()` with the context: they hold nothing */
  private deletions!: DeletionActions;

  /**
   * @param options what the page gives the console
   * @param deps what the console would otherwise build itself: the API
   *   client, which a test replaces with one that answers from fixtures
   */
  constructor(options: ConsoleOptions, deps: ConsoleDeps = {}) {
    this.options = options;
    this.api =
      deps.api ?? new ConsoleApiClient(options.apiBaseUrl, options.apiPrefix);
    this.api.onSessionEnded = (): void => {
      signInAgain();
    };
    this.translator = new Translator(options.language || storedLanguage());
  }

  /**
   * Take the console off the page: its listeners on the window and the
   * document go, and its container is emptied. A page that mounts a console
   * more than once (a test, a single-page host) calls it before the next.
   */
  unmount(): void {
    this.mounted.abort();
    this.container?.replaceChildren();
    this.container = null;
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
    // Every listener below goes with `unmount`, which may come while the
    // directory is still being read: nothing is drawn or listened to after.
    // An `init()` on a console still mounted takes the first one's listeners
    // away too, and stops it where it waits.
    this.mounted.abort();
    this.mounted = new AbortController();
    const { signal } = this.mounted;
    this.context = this.contextOf();
    this.passwords = new PasswordActions(this.context);
    this.states = new StateActions(this.context);
    this.transits = new TransitActions(this.context);
    this.deletions = new DeletionActions(this.context);

    render(
      this.container,
      html`<p class="dc-empty">${this.translator.t('app.loading')}</p>`
    );

    try {
      this.entities = await this.api.discover();
    } catch (err) {
      if (this.container)
        render(
          this.container,
          html`<p class="dc-empty dc-error-block">${(err as Error).message}</p>`
        );
      return;
    }
    if (signal.aborted) return;

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
    if (signal.aborted) return;

    this.route = routeOf(window.location.hash);
    const on = <K extends keyof WindowEventMap>(
      type: K,
      listener: (event: WindowEventMap[K]) => void
    ): void => window.addEventListener(type, listener, { signal });
    on('hashchange', () =>
      background(() => this.followHash(), 'followHash', this.report)
    );
    // What slips past `background` — a listener that throws, a promise
    // started without it — is reported too, when it is the console's: the
    // page embedding the console has errors of its own, left to it. An error
    // taken is marked handled, so that the browser does not log it a second
    // time next to the report; the page's own listeners still see it.
    on('unhandledrejection', event => {
      if (!fromConsole(event.reason)) return;
      event.preventDefault();
      this.report(event.reason, 'unhandled');
    });
    on('error', event => {
      if (!fromConsole(event.error)) return;
      event.preventDefault();
      this.report(event.error, 'unhandled');
    });
    document.addEventListener('keydown', event => this.panelKey(event), {
      signal,
    });
    // The system's wish for contrast, followed as it changes, until the
    // reader chooses.
    onContrastChange(
      () => applyContrast(this.container, highContrast()),
      signal
    );
    // A reload or a closed tab loses a form as surely as Escape: the
    // browser's own question then.
    on('beforeunload', event => {
      if (!this.panel.isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    });

    this.drawShell();
    // The Overview reads it for its own section; any other first page has
    // the banner count it.
    if (this.route.view !== 'dashboard')
      background(() => this.readTransit(), 'readTransit', this.report);
    await this.renderMain();
  }

  /**
   * The console as its views see it: what changes over its life — the
   * translator, the scope and so the rights — asked of it each time.
   */
  private contextOf(): ConsoleContext {
    return {
      api: this.api,
      translator: () => this.translator,
      t: (key, values) => this.translator.t(key, values),
      rights: () => this.rights,
      toast: (message, isError) => this.toast(message, isError),
      report: this.report,
      panel: this.panel,
      dialog: this.dialog,
      current: generation => this.current(generation),
      titlePage: name => this.titlePage(name),
      refresh: () => this.renderMain(),
      entities: () => this.entities,
      personName: (entity, entry, id) => this.personName(entity, entry, id),
      submittedName: (entity, values, id) =>
        this.submittedName(entity, values, id),
      entryName: (entity, id) => this.entryName(entity, id),
      roleValue: (entity, entry, role) => this.roleValue(entity, entry, role),
      go: path => this.go(path),
      record: (path, replace) => this.record(path, replace),
      route: () => this.route,
      readTransit: () => this.readTransit(),
      tree: () => this.tree,
      relations: (entity, entry, strict) =>
        this.relations(entity, entry, strict),
      groupEntity: dn => this.groupEntity(dn),
      changeState: (entity, id, entry, preselect) =>
        this.changeState(entity, id, entry, preselect),
    };
  }

  /* ---------------------------------------------------------------- routing */

  /**
   * Draw the page a new hash names. A side panel belongs to the page it was
   * opened on: left over a page reached with Back or a typed address, it
   * covers that page and saves into an entry no longer on screen.
   */
  private async followHash(): Promise<void> {
    // A changed form is not asked about here: kept over the new page, it
    // would save into an entry no longer on screen.
    this.panel.closeOnNavigation();
    this.route = routeOf(window.location.hash);
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
    this.route = routeOf(window.location.hash);
  }

  /* ------------------------------------------------------------------ shell */

  /**
   * Draw the console again in another language. An open side panel is kept
   * as it is, in the language it was opened in: drawn again, it was closed,
   * and what had been typed into it was lost.
   *
   * @param code the language chosen
   */
  private changeLanguage(code: string): void {
    rememberLanguage(code);
    const panel = this.container?.querySelector<HTMLElement>('[data-panel]');
    const kept = panel && !panel.hidden ? panel : null;
    this.translator = new Translator(code);
    this.drawShell();
    if (kept)
      this.container
        ?.querySelector<HTMLElement>('[data-panel]')
        ?.replaceWith(kept);
    // Chosen with the keyboard, the language changes on each arrow: the
    // focus stays on the select, drawn anew, rather than falling to the page.
    this.container
      ?.querySelector<HTMLSelectElement>('[data-language]')
      ?.focus();
    background(() => this.renderMain(), 'renderMain', this.report);
  }

  /** Draw the permanent frame: sidebar, scope, main area, side panel. */
  private drawShell(): void {
    const container = this.container;
    if (!container) return;
    // The page speaks the interface's language: a screen reader reads a
    // French label with a French voice only when the document says so.
    if (typeof document !== 'undefined')
      document.documentElement.lang = this.translator.language;
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    // An account administering nothing finds only "nothing to manage" behind
    // each entry: the overview says it once, and the entries are not offered.
    const { primary, reference } = this.rights.administersNothing()
      ? { primary: [], reference: [] }
      : splitEntities(this.entities);
    const settings = this.settings(reference);

    render(
      container,
      html`
      <div class="dc-app${highContrast() ? ' dc-contrast-high' : ''}">
        <a class="dc-skip-link dc-button dc-button-primary" href="#dc-main"
          data-skip>${t('app.skipToContent')}</a>
        ${sidebarMarkup({
          t,
          primary: primary.map(entity => ({
            key: entity.key,
            label: this.plural(entity),
          })),
          reference: settings,
          language: this.translator.language,
          contrast: highContrast(),
        })}
        <div class="dc-content">
          <header class="dc-header">${this.scopeMarkup()}${this.logoutMarkup()}</header>
          <main class="dc-main" id="dc-main" data-main tabindex="-1"></main>
          <a class="dc-powered" href="https://linagora.com" target="_blank"
            rel="noopener noreferrer">
            <img src="${LINAGORA_LOGO}" alt="LINAGORA" width="100" height="21" />
          </a>
        </div>
        ${overlayMarkup(t('app.close'))}
      </div>`
    );

    for (const button of Array.from(
      container.querySelectorAll<HTMLElement>('[data-nav]')
    )) {
      button.addEventListener('click', () => this.go(button.dataset.nav || ''));
    }

    // The console routes on the hash, and "#dc-main" would be read as a page
    // of that name: the link moves the focus itself and leaves the address.
    container
      .querySelector<HTMLElement>('[data-skip]')
      ?.addEventListener('click', event => {
        event.preventDefault();
        this.main()?.focus();
      });

    // The toggle reads its state from the page, not from what the browser
    // remembers: a reference page opens the section without storing it, and
    // the reader's click then closes it rather than storing "open" first.
    const toggle = container.querySelector<HTMLElement>('[data-nav-toggle]');
    toggle?.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      rememberReference(open);
      this.showReference(open);
    });
    this.showReference(referenceOpen());

    container
      .querySelector<HTMLSelectElement>('[data-language]')
      ?.addEventListener('change', event => {
        this.changeLanguage((event.target as HTMLSelectElement).value);
      });

    container
      .querySelector<HTMLInputElement>('[data-contrast]')
      ?.addEventListener('change', event => {
        const on = (event.target as HTMLInputElement).checked;
        rememberContrast(on);
        applyContrast(this.container, on);
      });

    container
      .querySelector('[data-panel-close]')
      ?.addEventListener('click', () => this.closePanel());
  }

  /** The sign-out control, when the server offers a way to sign out. */
  private logoutMarkup(): SafeHtml {
    const url = this.api.logoutUrl;
    if (!url) return html``;
    return html`<a class="dc-button dc-logout" href="${url}">${this.translator.t(
      'app.logout'
    )}</a>`;
  }

  /**
   * The branches the caller administers, shown permanently.
   *
   * In a local-administration model this is the single most useful thing on
   * the screen, and the interface this replaces showed it nowhere.
   */
  private scopeMarkup(): SafeHtml {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const summary = this.rights.summary;
    if (summary.kind === 'error')
      return html`<span class="dc-scope-error">${t('scope.unavailable', {
        error: summary.error,
      })}</span>`;
    if (summary.kind === 'unrestricted')
      return html`<span class="dc-scope-empty">${t('scope.unrestricted')}</span>`;
    if (summary.kind === 'undescribed')
      return html`<span class="dc-scope-empty">${t('scope.undescribed')}</span>`;
    // Grey, not the green of a scope in order: there is nothing to be had.
    if (summary.kind === 'nothing')
      return html`<span class="dc-scope-empty dc-scope-none">${t(
        'scope.none'
      )}</span>`;
    const transit = summary.transit;
    return html`
      <span class="dc-scope-label">${t('scope.title')}</span>
      <ul class="dc-scope">
        ${summary.branches.map(branch => {
          const rights = [
            branch.read ? t('scope.read') : '',
            branch.write ? t('scope.write') : '',
            branch.delete ? t('scope.delete') : '',
          ]
            .filter(Boolean)
            .join(', ');
          return html`<li title="${branch.path || branch.dn}">
              <strong>${branch.name || branch.dn}</strong>
              <span class="dc-muted">${rights}</span>
            </li>`;
        })}
      </ul>
            ${
              transit
                ? html`${
                    // "Transit Transit (1)" said its name twice: the label goes
                    // when the branch's name is that word already.
                    rdnValue(transit).toLowerCase() ===
                    t('transit.branch').toLowerCase()
                      ? ''
                      : html`<span class="dc-scope-label">${t('transit.branch')}</span>`
                  }
            <a class="dc-scope-transit" data-transit-link href="#/organizations/${encodeURIComponent(
              transit
            )}" title="${
              // Readable, like the branches' paths: the scope gives the
              // transit branch no path, and its name stands in for one.
              rdnValue(transit)
            }">${this.transitLabel()}</a>`
                : ''
            }`;
  }

  /**
   * The banner's Transit link: the branch's name, and how many entries wait
   * there when some do — "Transit (2)" — so that an administrator is told
   * of a hand-over without thinking of looking.
   */
  private transitLabel(): string {
    const transit = this.rights.transit;
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
    const rights = this.rights;
    const transit = rights.transit;
    if (!transit || rights.administersNothing()) return null;
    // Read again after every hand-over and claim: an answer arriving after
    // a later one's is older, and must not count over it.
    const read = ++this.transitReads;
    let waiting: AttachedEntries | null;
    try {
      waiting = await this.readMembers(transit);
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
      offered: (entry, entity) => this.rights.claimable(entry, entity),
      run: (entry, entity) =>
        background(
          () =>
            this.claim(
              entity,
              entry.label,
              entry.values?.displayName || entry.label
            ),
          'claim',
          this.report
        ),
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
      return this.rights.managesPolicies()
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

  /** The notice standing in for a view the server would refuse whole. */
  private nothingMarkup(): SafeHtml {
    return html`<p class="dc-empty">${this.translator.t('scope.nothing')}</p>`;
  }

  /**
   * Whether the caller manages the password policies. Who holds them is the
   * server's rule (`--authz-global-branches`), outside the tree the scope's
   * branches name, so the scope says it in `passwordPolicies`. Only a server
   * that predates it is asked for the policies themselves (see the client):
   * every page load of a local administrator then logged a refusal. An
   * undescribed scope answers `false` for want of a model, and the console
   * asks there too, as it leaves the server to answer whatever else such a
   * scope cannot say.
   */
  private async readsPolicies(): Promise<boolean> {
    if (!this.api.servesPasswordPolicies) return false;
    const told = this.rights.policiesTold;
    return told ?? this.api.readsPasswordPolicies();
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
    const dn = this.rights.user;
    if (!dn || !isDnShaped(dn)) return null;
    const identifier = { name: rdnValue(dn) };
    if (this.rights.administersNothing()) return identifier;
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
      ...(this.rights.managesPolicies()
        ? [{ key: POLICIES_KEY, label: this.translator.t('nav.policies') }]
        : []),
    ];
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
    this.titlePage(t('nav.dashboard'));
    // What waits in transit goes first, once read: it is what may need
    // doing today.
    const sections = this.rights.administersNothing()
      ? [this.noRightsMarkup()]
      : [
          html`<div data-transit-waiting></div>`,
          this.manageMarkup(),
          this.referenceMarkup(),
        ];
    render(
      main,
      html`
      <section class="dc-dashboard">
        <h1>${t('app.title')}</h1>
        ${this.welcomeMarkup()}
        ${sections}
      </section>`
    );

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
        const entity = this.entity(button.dataset.new);
        if (entity)
          background(() => this.openForm(entity), 'openForm', this.report);
      });
    background(
      () => this.showTransitWaiting(main, generation),
      'showTransitWaiting',
      this.report
    );
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
      name: rdnValue(this.rights.transit || ''),
      pointerLabel: names,
      hideEmpty: true,
      rowAction: this.claimAction(),
      onOpen: (href: string): void => {
        window.location.hash = href;
      },
    });
    render(
      holder,
      html`
      <section class="dc-transit-waiting" data-transit-section>
        <h2>${t('transit.waiting', {
          count: `${waiting.entries.length}${waiting.truncated ? '+' : ''}`,
        })}</h2>
        <p class="dc-muted">${t('transit.waitingHelp')}</p>
        ${tables.markup()}
      </section>`
    );
    tables.bind(holder);
  }

  /** Who is signed in: by name and address, else as the scope gives it. */
  private welcomeMarkup(): SafeHtml {
    const user = this.rights.user;
    if (!user) return html``;
    const account = this.account;
    const text = account?.email
      ? this.translator.t('dashboard.welcomeNamed', {
          name: account.name,
          email: account.email,
        })
      : this.translator.t('dashboard.welcome', {
          user: account?.name || user,
        });
    return html`<p class="dc-muted">${text}</p>`;
  }

  /** The cards of the entities, with what can be done to them. */
  private manageMarkup(): SafeHtml {
    const t = (key: string): string => this.translator.t(key);
    const { primary } = splitEntities(this.entities);
    return html`
      <h2>${t('dashboard.entities')}</h2>
      <ul class="dc-cards">
        ${primary.map(entity => {
          const allowed = this.rights.canCreate(entity);
          return html`<li class="dc-card">
              <header class="dc-card-title">
                <span class="dc-entity-icon" aria-hidden="true">${initial(
                  this.plural(entity)
                )}</span>
                <h3>${this.plural(entity)}</h3>
              </header>
              <div class="dc-card-actions">
                <button type="button" class="dc-button" data-open="${
                  entity.key
                }">${t('list.open')}</button>
                ${
                  allowed
                    ? html`<button type="button" class="dc-button dc-button-primary" data-new="${
                        entity.key
                      }">${this.createLabel(entity)}</button>`
                    : html`<span class="dc-muted">${t('dashboard.noCreate')}</span>`
                }
              </div>
            </li>`;
        })}
      </ul>`;
  }

  /** The links to the reference data and the password policies. */
  private referenceMarkup(): SafeHtml {
    const settings = this.settings(splitEntities(this.entities).reference);
    if (!settings.length) return html``;
    return html`
      <h2>${this.translator.t('nav.reference')}</h2>
      <ul class="dc-reference">
        ${settings.map(
          ({ key, label }) =>
            html`<li><button type="button" class="dc-reference-link" data-open="${
              key
            }">${label}</button></li>`
        )}
      </ul>`;
  }

  /**
   * The overview of an account administering nothing. Three cards, each
   * opening on "nothing to manage", were three dead ends: this says it
   * once, and where to turn.
   */
  private noRightsMarkup(): SafeHtml {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const user = this.rights.user || '';
    const logout = this.api.logoutUrl;
    return html`
      <div class="dc-no-rights" data-no-rights>
        <h2>${t('dashboard.noRightsTitle')}</h2>
        <p>${t('dashboard.noRightsBody', {
          name: this.account?.name || user,
        })}</p>
        ${
          logout
            ? html`<a class="dc-button dc-button-primary" href="${
                logout
              }">${t('app.logout')}</a>`
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
    this.titlePage(t('app.notFoundTitle'));
    render(
      main,
      html`
      <section class="dc-view">
        <div class="dc-empty" data-not-found>
          <p>${t('app.notFound')}</p>
          <a class="dc-button" href="#/">${t('app.toOverview')}</a>
        </div>
      </section>`
    );
  }

  /** The table of an entity. */
  private async renderList(
    main: HTMLElement,
    entity: EntityDescriptor
  ): Promise<void> {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const readOnly = this.rights.readsReferenceOnly(entity);
    this.titlePage(this.plural(entity));
    render(
      main,
      html`
      <section class="dc-view">
        <header class="dc-view-header">
          <h1>${this.plural(entity)}</h1>
          ${
            this.rights.canCreate(entity)
              ? html`<div class="dc-view-actions">
                  ${
                    entity.kind === 'flat'
                      ? html`<button type="button" class="dc-button" data-import>${t(
                          'import.open'
                        )}</button>`
                      : ''
                  }
                  <button type="button" class="dc-button dc-button-primary" data-new>${this.createLabel(
                    entity
                  )}</button>
                </div>`
              : ''
          }
        </header>
        ${
          readOnly &&
          this.isReference(entity) &&
          !this.rights.administersNothing()
            ? html`<p class="dc-muted dc-view-notice" data-read-only>${t(
                'reference.readOnly'
              )}</p>`
            : ''
        }
        <div data-list></div>
      </section>`
    );

    main
      .querySelector('[data-new]')
      ?.addEventListener('click', () =>
        background(() => this.openForm(entity), 'openForm', this.report)
      );
    main
      .querySelector('[data-import]')
      ?.addEventListener('click', () => this.openImport(entity));

    const holder = main.querySelector<HTMLElement>(
      '[data-list]'
    ) as HTMLElement;
    if (this.rights.administersNothing()) {
      render(holder, this.nothingMarkup());
      return;
    }
    const named = await this.pointerNames(entity);
    const view = this.listViews.get(entity.key) ?? {};
    this.listViews.set(entity.key, view);
    const list = new EntityList({
      report: this.report,
      announce: this.announce,
      entity,
      title: this.plural(entity),
      view,
      translator: this.translator,
      listable: !isLarge(entity),
      load: listLoader(this.api, entity),
      bulkActions: this.bulkActions(entity),
      pathSeparator: this.api.organizationPathSeparator,
      canDelete: this.rights.canDelete() && !readOnly,
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
    if (this.rights.administersNothing()) {
      render(main, this.nothingMarkup());
      return;
    }
    render(main, html`<p class="dc-empty">${t('app.loading')}</p>`);
    const naming = this.pointerNames(entity);
    let entry: Entry;
    try {
      entry = await this.api.get(entity, id);
      if (!this.current(generation)) return;
    } catch (err) {
      if (!this.current(generation)) return;
      const failure = readFailure(err, this.translator);
      render(
        main,
        html`<p class="dc-empty${
          failure.gone || failure.refused ? '' : ' dc-error-block'
        }">${failure.message}</p>`
      );
      return;
    }

    render(
      main,
      html`
      <section class="dc-view">
        <header class="dc-view-header">
          <button type="button" class="dc-button" data-back>${t('app.back')}</button>
        </header>
        <div data-detail></div>
      </section>`
    );
    main
      .querySelector('[data-back]')
      ?.addEventListener('click', () => this.go(entity.key));

    const [named, relations] = await Promise.all([
      naming,
      this.relations(entity, entry),
    ]);
    if (!this.current(generation)) return;
    const transit = this.rights.transitOf(entity, entry);
    const readOnly = this.rights.readsReferenceOnly(entity);
    const canWrite =
      !readOnly && (transit.rights?.write ?? this.rights.canWrite());
    const groups = relations?.groups && entry.dn ? relations.items : undefined;
    // A group's members, managed from its card as an account's groups are
    // from the account's: the whole form was the only way to change one.
    // Only a group has the routes that add and remove one member: a flat
    // entity's members, a team mailbox's, are saved with the whole entry.
    const members =
      relations &&
      !relations.groups &&
      entity.kind === 'group' &&
      this.rights.writes(entity, entry)
        ? relations
        : undefined;
    if (members) for (const item of members.items) item.removable = true;
    const joins =
      !!groups &&
      this.rights.writes(entity, entry) &&
      !!this.api.groupSearch(this.entities);
    const detail: EntityDetail = new EntityDetail({
      report: this.report,
      entity,
      entry,
      translator: this.translator,
      canWrite,
      canDelete:
        !readOnly && (transit.rights?.delete ?? this.rights.canDelete()),
      notice:
        readOnly && this.isReference(entity)
          ? this.translator.t('reference.readOnly')
          : undefined,
      inTransit: transit.inTransit,
      onClaim: transit.claim
        ? (): void =>
            background(
              () => this.claim(entity, id, this.personName(entity, entry, id)),
              'claim',
              this.report
            )
        : undefined,
      onHandOver: transit.handOver
        ? (): void =>
            background(
              () => this.handOver(entity, id, entry),
              'handOver',
              this.report
            )
        : undefined,
      pointerLabel: named,
      relations,
      onEdit: (): void => {
        background(() => this.openForm(entity, entry), 'openForm', this.report);
      },
      onDelete: (): void => {
        background(
          () => this.confirmDelete(entity, id, entry, canWrite),
          'confirmDelete',
          this.report
        );
      },
      onStatus: (): void => {
        background(
          () => this.changeState(entity, id, entry),
          'changeState',
          this.report
        );
      },
      onResetPassword: (): void => {
        background(
          () => this.resetPassword(entity, id),
          'resetPassword',
          this.report
        );
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
   * Title the browser tab after the page on screen — "Users — Twake Directory
   * Manager", "Alice Moreau — Twake Directory Manager" — so that the tabs of
   * several open pages, the history and a screen reader say which is which.
   *
   * @param name the page's or the entry's name, or none for the bare title
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
   *
   * @param strict whether a group entity that cannot be searched fails the
   * search, which then says `unknown` rather than no group: what is to be
   * done to every group, as a hand-over, cannot take one for the other
   */
  private async relations(
    entity: EntityDescriptor,
    entry: Entry,
    strict = false
  ): Promise<Relations | undefined> {
    let unknown = false;
    for (const role of ['members', 'groupMemberships']) {
      for (const [name, attr] of Object.entries(entity.schema.attributes)) {
        const roles = Array.isArray(attr.role) ? attr.role : [attr.role];
        if (!roles.includes(role)) continue;
        const raw = entryValue(entry, name);
        let list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
        if (role === 'groupMemberships' && !list.length && entry.dn)
          list = await this.api
            .memberships(entry.dn, this.entities, strict)
            .catch(() => {
              unknown = strict;
              return [];
            });
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
          ...(unknown ? { unknown } : {}),
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
          removable: this.rights.writes(owner, group),
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
      !this.rights.canWrite() ||
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

  /** Whether the side panel is open: one opened needs a page to be in. */
  private panelShown(): boolean {
    return this.panel.isOpen();
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
    const { kept, leftOut } = bulkWritable(
      this.rights,
      this.translator,
      entity,
      selected
    );
    const members = kept.map(([, entry]) => String(entry.dn));
    const search = this.api.groupSearch(this.entities, found =>
      this.rights.writes(found.entity, found.entry)
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
      report: this.report,
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
      render(
        body,
        html`${
          leftOut ? html`<p class="dc-hint">${leftOut}</p>` : ''
        }<div data-bulk-picker></div>`
      );
      const holder = body.querySelector<HTMLElement>('[data-bulk-picker]');
      if (holder) picker.render(holder);
    });
    if (!this.panelShown()) return Promise.resolve(false);
    const action = bulkPanel(this.panel);
    return action.settled;
  }

  /** Change the state of the accounts selected (see `StateActions`). */
  private bulkChangeState(
    entity: EntityDescriptor,
    selected: [string, Entry][]
  ): Promise<boolean> {
    return this.states.changeMany(entity, selected);
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
        this.rights.writes(found.entity, found.entry)
    );
    if (!search || !entry.dn) return;
    const member = String(entry.dn);
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const owners = new Map<string, EntityDescriptor>();
    const picker = new GroupPicker({
      report: this.report,
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
          this.panel.returnFocusTo(
            this.main()?.querySelector<HTMLElement>('[data-add-groups]') ?? null
          );
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
      report: this.report,
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
    const entity = this.entities.find(item => item.kind === 'organization');
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    // Named after the page, as the sidebar names it, until a card names it
    // after the organization.
    this.titlePage(entity ? this.plural(entity) : t('tree.title'));
    if (this.rights.administersNothing()) {
      render(main, this.nothingMarkup());
      return;
    }
    render(
      main,
      html`
      <section class="dc-split">
        <div class="dc-split-aside" data-tree></div>
        <div class="dc-split-main" data-org-detail>
          <p class="dc-empty">${t('tree.empty')}</p>
        </div>
      </section>`
    );

    this.tree = new OrganizationTree(
      {
        translator: this.translator,
        report: this.report,
        root: (): Promise<OrganizationNode | null> =>
          this.api.organizationTop(),
        children: (dn: string): Promise<OrganizationNode[]> =>
          this.api.organizationChildren(dn),
        transit: this.rights.transit,
        onSelect: (node: OrganizationNode): void => {
          this.record(`organizations/${encodeURIComponent(node.dn)}`);
          background(
            () => this.showOrganization(node),
            'showOrganization',
            this.report
          );
        },
        // A "+" on a node asks a different question from the card on the
        // overview: the card creates where the scope's `organizations.create`
        // or the caller's written branches allow, while the "+" creates under
        // the node it sits on. The server judges that on the node, so the "+"
        // shows only where the caller writes: a tree drawn from the root
        // offered it on the root to an administrator of a branch below it,
        // and creating there was refused.
        onCreateChild:
          entity && this.rights.canWrite()
            ? (node: OrganizationNode): void => {
                background(
                  () => this.openOrganizationForm(entity, undefined, node.dn),
                  'openOrganizationForm',
                  this.report
                );
              }
            : undefined,
        canCreateChild: (node: OrganizationNode): boolean =>
          this.rights.createsUnder(node.dn),
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
    // shown before, but the page: a card that fails to load leaves it so.
    this.titlePage(this.plural(entity));

    // The address names an organization by its DN, which the server checks
    // before looking for it: `#/organizations/zzz` read its refusal, in
    // English and red, where it names an entry that is simply not there.
    if (!isDnShaped(node.dn)) {
      render(
        holder,
        html`<p class="dc-empty">${this.translator.t('detail.notFound')}</p>`
      );
      return;
    }
    let entry: Entry;
    try {
      entry = await this.api.organization(node.dn);
      if (!this.current(generation)) return;
    } catch (err) {
      if (!this.current(generation)) return;
      const failure = readFailure(err, this.translator);
      render(
        holder,
        html`<p class="dc-empty${
          failure.gone || failure.refused ? '' : ' dc-error-block'
        }">${failure.message}</p>`
      );
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

    const organization = this.rights.organizationRights(node.dn);
    const transit = this.rights.transit;
    const name =
      [entryValue(entry, entity.mainAttribute) ?? []].flat()[0] ||
      rdnValue(node.dn);
    // Said where Edit would be, on the organization the caller administers:
    // the banner names it as theirs, and Save was refused at the end. Not
    // on the top of the tree, which nobody above changes from the console,
    // nor on the transit branch, which every administrator writes.
    const above = parentOf(node.dn);
    const changedAbove =
      !organization.write &&
      !!above &&
      withinDn(above, entity.base) &&
      !(transit && withinDn(node.dn, transit)) &&
      this.rights.administersExactly(node.dn);
    const card = new EntityDetail({
      report: this.report,
      entity,
      entry,
      translator: this.translator,
      canWrite: organization.write,
      canDelete: organization.delete,
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
        partial: !this.rights.readsWhole(node.dn),
        failure,
        onOpen: (href: string): void => {
          window.location.hash = href;
        },
      }),
      relationHref: (dn: string): string | undefined => this.relationHref(dn),
      onEdit: (): void => {
        background(
          () => this.openOrganizationForm(entity, entry),
          'openOrganizationForm',
          this.report
        );
      },
      onDelete: (): void => {
        background(
          () => this.confirmDeleteOrganization(entity, entry, node.dn),
          'confirmDeleteOrganization',
          this.report
        );
      },
      // What the tree's "+" does, said in words where the reader is looking:
      // the "+" shows on a row only once it is pointed at or selected.
      onCreateChild: this.rights.createsUnder(node.dn)
        ? (): void => {
            background(
              () => this.openOrganizationForm(entity, undefined, node.dn),
              'openOrganizationForm',
              this.report
            );
          }
        : undefined,
      onStatus: (): void => undefined,
      onResetPassword: (): void => undefined,
    });
    card.render(holder);
    this.titlePage(card.heading());
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
    const transit = this.rights.transit;
    if (
      !this.rights.createsUnder(node.dn) ||
      (transit && withinDn(node.dn, transit))
    )
      return offered;
    // The path names the department in the form's picker, as it does on an
    // entry being edited: the DN alone would show its last name only.
    const path = organizations.organizationPath
      ? [entryValue(entry, organizations.organizationPath) ?? []].flat()[0]
      : undefined;
    for (const kind of ['people', 'groups'] as const) {
      const target = attachedEntity(this.entities, kind);
      const link = target?.organizationLink;
      if (!target || !link || !this.rights.canCreate(target)) continue;
      const preset: Entry = { [link]: node.dn };
      if (target.organizationPath && path)
        preset[target.organizationPath] = path;
      offered[kind] = (): void =>
        background(
          () =>
            this.openForm(target, undefined, {
              preset,
              // The card is drawn anew, button included: the focus goes back to
              // the new one, for the next creation, rather than to the page.
              created: (): void =>
                background(
                  () =>
                    this.showOrganization(node).then(() =>
                      this.container
                        ?.querySelector<HTMLElement>(
                          `[data-create-attached="${kind}"]`
                        )
                        ?.focus()
                    ),
                  'showOrganization',
                  this.report
                ),
            }),
          'openForm',
          this.report
        );
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

  /* ------------------------------------------------------------ side panel */

  /** Open the side panel with a title and a body builder (`PanelService.open`). */
  private openPanel(
    title: string,
    build: (body: HTMLElement) => void,
    modal = false,
    wide = false
  ): void {
    this.panel.open(title, build, modal, wide);
  }

  /** Close the side panel, unless what it holds asks to stay (`PanelService.close`). */
  private closePanel(force = false): void {
    this.panel.close(force);
  }

  /** The keyboard in the side panel: Tab kept in, Escape closes (`PanelService.key`). */
  private panelKey(event: KeyboardEvent): void {
    this.panel.key(event);
  }

  /** Ask before what cannot be taken back (`DialogService.confirm`). */
  private confirmAction(question: Confirmation): Promise<boolean> {
    return this.dialog.confirm(question);
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
          report: this.report,
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
              await this.api.create(entity, values),
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
              background(() => this.renderMain(), 'renderMain', this.report);
          },
          onClose: (): void => this.closePanel(),
        }).render(body);
      },
      false,
      true
    );
  }

  /**
   * The password policies' page (`PoliciesView`). A view is made for each
   * drawing: it holds nothing from one to the next, and a view made anew
   * cannot draw with what an earlier page left in it. A view that keeps
   * something between drawings, as the lists keep where the reader was, is
   * kept by the console instead (#220).
   */
  private renderPolicies(main: HTMLElement, generation: number): Promise<void> {
    return new PoliciesView(this.context).render(main, generation);
  }

  /**
   * Create or edit an entry of a flat or group entity.
   *
   * @param entity the entity
   * @param entry the entry to edit; none to create one
   * @param here where a creation was asked for: what the new entry starts
   *   with, and what to do once it exists instead of opening its card
   */
  private openForm(
    entity: EntityDescriptor,
    entry?: Entry,
    here?: { preset: Entry; created(): void }
  ): void {
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
      report: this.report,
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
            const created = await this.api.create(entity, values);
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
        background(() => form.render(body), 'form.render', this.report);
        this.guardDiscard(body, () => form.isDirty());
      },
      !form.wantsPanel
    );
  }

  /** Ask before a form loses what was typed in it (`PanelService.guardDiscard`). */
  private guardDiscard(body: HTMLElement, dirty: () => boolean): void {
    this.panel.guardDiscard(body, dirty);
  }

  /**
   * Organizations live in the tree, so their form writes through the
   * organization endpoints rather than the flat ones.
   *
   * A new one given no parent goes where the caller may create it: at the
   * root when the scope allows it there, otherwise under their one written
   * branch, or under the one they pick when they write several.
   */
  private openOrganizationForm(
    entity: EntityDescriptor,
    entry?: Entry,
    parentDn?: string
  ): void {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.translator.t(key, values);
    const parents =
      entry || parentDn ? [] : this.rights.creationParents(entity);
    if (parents.length === 1) parentDn = parents[0].dn;
    let picker: HTMLSelectElement | null = null;
    const parent = (): string | undefined =>
      parents.length > 1
        ? (parents.find(item => item.dn === picker?.value) ?? parents[0]).dn
        : parentDn;
    // Read once for the form, whichever parent is picked meanwhile.
    const domains = this.rights.inheritsDomains(entity)
      ? this.api.mailDomains(this.entities)
      : undefined;
    const form = new EntityForm({
      report: this.report,
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
          background(() => form.render(body), 'form.render', this.report);
          return;
        }
        render(
          body,
          html`
          <div class="dc-field">
            <label for="dc-organization-parent">${t('tree.parent')}</label>
            <select id="dc-organization-parent" class="dc-input">
              ${parents.map(
                item => html`<option value="${item.dn}">${item.label}</option>`
              )}
            </select>
          </div>
          <div data-organization-form></div>`
        );
        picker = body.querySelector<HTMLSelectElement>(
          '#dc-organization-parent'
        );
        picker?.addEventListener('change', () => {
          moved = true;
        });
        background(
          () =>
            form.render(
              body.querySelector<HTMLElement>(
                '[data-organization-form]'
              ) as HTMLElement
            ),
          'form.render',
          this.report
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
    if (!stored || !this.rights.restricted)
      return { name: named(sent), attribute: link };
    const writes = this.rights.writesWithin(sent);
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
      this.rights
        .creationParents(entity)
        .find(item => comparableDn(item.dn) === comparableDn(dn))?.label ??
      this.tree?.nameOf(dn) ??
      rdnValue(dn)
    );
  }

  /* --------------------------------------------------------------- actions */

  /** Change an account's state from its card (see `StateActions`). */
  private changeState(
    entity: EntityDescriptor,
    id: string,
    entry: Entry,
    preselect?: string
  ): Promise<void> {
    return this.states.change(entity, id, entry, preselect);
  }

  /** Reset an account's password (see `PasswordActions`). */
  private resetPassword(entity: EntityDescriptor, id: string): void {
    this.passwords.reset(entity, id);
  }

  /** A first password for an account created without one (see `PasswordActions`). */
  private givePassword(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    id: string,
    next: () => void,
    own?: () => boolean
  ): Promise<boolean> {
    return this.passwords.give(entity, values, id, next, own);
  }

  /**
   * Claim an entry in transit into one of the caller's organizations (see
   * `TransitActions`).
   */
  private claim(
    entity: EntityDescriptor,
    id: string,
    name = id
  ): Promise<void> {
    return this.transits.claim(entity, id, name);
  }

  /** Let an entry go into the transit branch, once asked (see `TransitActions`). */
  private handOver(
    entity: EntityDescriptor,
    id: string,
    entry: Entry
  ): Promise<void> {
    return this.transits.handOver(entity, id, entry);
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
   * Delete an entry once asked (see `DeletionActions`).
   *
   * @param entry the entry, when its card is open
   * @param canChangeState offer an account's state change instead
   */
  private confirmDelete(
    entity: EntityDescriptor,
    id: string,
    entry?: Entry,
    canChangeState = false
  ): Promise<void> {
    return this.deletions.one(entity, id, entry, canChangeState);
  }

  /** Delete an organization once asked (see `DeletionActions`). */
  private confirmDeleteOrganization(
    entity: EntityDescriptor,
    entry: Entry,
    dn: string
  ): Promise<void> {
    return this.deletions.organization(entity, entry, dn);
  }

  /** Delete a selection once asked (see `DeletionActions`): whether any went. */
  private deleteMany(
    entity: EntityDescriptor,
    ids: string[]
  ): Promise<boolean> {
    return this.deletions.many(entity, ids);
  }

  /** Show a short message. */
  private toast(message: string, isError = false): void {
    this.toasts.show(message, isError);
  }

  /**
   * What the caller may do, read from the scope each time: the tests set the
   * scope after construction, and a view asks at the moment it draws.
   */
  private get rights(): Rights {
    return new Rights(this.scope, this.scopeError, this.policiesReadable);
  }

  /**
   * Where the work the console does not wait for ends when it fails (see
   * `background`): the administrator is told, in a toast, that something
   * went wrong and what the failure said; the browser's console gets the
   * failure with the name of what started it, for the operator; and the page
   * embedding the console gets both through `ConsoleOptions.onError`, to
   * send wherever it collects its errors. A property rather than a method,
   * so that it is handed to the components bound.
   *
   * The failure is said in the server's own words when it has some: a
   * refusal reaching here was not caught by the action that asked, and the
   * reader's wording for a read (`readFailure`) could misdescribe it. The
   * reporter is the last thing standing between a failure and silence, so
   * nothing in it may throw: a rejection with no error at all, a toast
   * element gone, a hook that throws, each is logged and the rest goes on.
   */
  private readonly report: Reporter = (error, context): void => {
    try {
      console.error('[twake-directory-manager]', context, error);
      const cause =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : '';
      this.toast(
        cause
          ? this.translator.t('app.failed', { cause })
          : this.translator.t('app.error'),
        true
      );
    } catch (shown) {
      // A `message` getter that throws, a toast element gone: logged.
      console.error('[twake-directory-manager] toast', shown);
    }
    try {
      this.options.onError?.(error, context);
    } catch (hook) {
      // The hook's own failure is not reported through itself.
      console.error('[twake-directory-manager] onError', hook);
    }
  };
}
