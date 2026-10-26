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
  isLarge,
  roleAttribute,
} from './api/ConsoleApiClient';
import { LINAGORA_LOGO } from './assets';
import { applyContrast, initial, sidebarMarkup } from './console/shell';
import {
  AttachedTables,
  attachedClass,
  attachedEntity,
} from './components/AttachedTables';
import {
  comparableDn,
  createdEntryId,
  entryValue,
  isDnShaped,
  ownValueLabel,
  pointerLabel,
  rdnValue,
  resolveText,
  withinDn,
} from './format';
import { Translator } from './i18n';
import { Rights, splitEntities } from './rights';
import { signInAgain } from './session';
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
  Scope,
} from './types';
import { background, fromConsole, type Reporter } from './shared/background';
import { html, render, type SafeHtml } from './shared/html';
import type { ConsoleContext } from './console/context';
import type { ConsoleDeps } from './console/deps';
import { DialogService } from './console/dialog';
import { groupEntity, readRelations, relationHref } from './console/relations';
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
import { OrganizationsView } from './views/organizations';
import { EntryView } from './views/entry';
import { ListsView } from './views/list';
import { PasswordActions } from './actions/passwords';
import { StateActions } from './actions/state';
import { TransitActions } from './actions/transit';
import { DeletionActions } from './actions/deletion';
import { FormActions } from './actions/forms';
import { GroupActions } from './actions/groups';
import { ToastController } from './ui/toast';

// Kept importable from here, where they were first defined.
export { ToastController, createdEntryId };
export { listLoader } from './views/list';
export type { Confirmation };

/** The signed-in account, as the overview names it. */
interface SignedIn {
  name: string;
  email?: string;
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
  /** The create and edit forms, made by `init()` with the context: they hold nothing */
  private forms!: FormActions;
  /** The memberships of groups, made by `init()` with the context: they hold nothing */
  private groups!: GroupActions;
  /**
   * The organizations page, made by `init()` with the context and kept
   * between its drawings: it holds the tree, which the next drawing, the
   * forms and the deletion find as it was left
   */
  private organizationsView!: OrganizationsView;
  /**
   * The lists, made by `init()` with the context and kept between their
   * drawings: they hold where the reader left each list, which Back from a
   * card finds as it was left
   */
  private listsView!: ListsView;

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
    this.forms = new FormActions(this.context);
    this.groups = new GroupActions(this.context);
    // A console mounted again keeps the tree it drew, as it did when the
    // tree was its own.
    this.organizationsView = new OrganizationsView(
      this.context,
      this.organizationsView?.tree()
    );
    // And where it left its lists.
    this.listsView = new ListsView(this.context, this.listsView?.lists());

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
      announce: this.announce,
      report: this.report,
      panel: this.panel,
      dialog: this.dialog,
      current: generation => this.current(generation),
      ticket: () => ++this.viewGeneration,
      titlePage: name => this.titlePage(name),
      refresh: () => this.renderMain(),
      main: () => this.main(),
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
      tree: () => this.organizationsView?.tree() ?? null,
      relations: (entity, entry, strict) =>
        readRelations(this.context, entity, entry, strict),
      groupEntity: dn => groupEntity(this.entities, dn),
      changeState: (entity, id, entry, preselect) =>
        this.states.change(entity, id, entry, preselect),
      resetPassword: (entity, id) => this.passwords.reset(entity, id),
      claim: (entity, id, name) => this.claim(entity, id, name),
      handOver: (entity, id, entry) =>
        this.transits.handOver(entity, id, entry),
      deleteEntry: (entity, id, entry, canChangeState) =>
        this.deletions.one(entity, id, entry, canChangeState),
      addToGroups: (entry, name, held) => this.groups.add(entry, name, held),
      leaveGroup: (entry, name, dn) => this.groups.leave(entry, name, dn),
      addMembers: (entity, entry, id, name, held) =>
        this.groups.addMembers(entity, entry, id, name, held),
      removeMember: (entity, id, name, dn) =>
        this.groups.removeMember(entity, id, name, dn),
      deleteSelection: (entity, ids) => this.deletions.many(entity, ids),
      changeSelectionState: (entity, selected) =>
        this.states.changeMany(entity, selected),
      addSelectionToGroups: (entity, selected) =>
        this.groups.addMany(entity, selected),
      createLabel: entity => this.createLabel(entity),
      givePassword: (entity, values, id, next, own) =>
        this.passwords.give(entity, values, id, next, own),
      plural: entity => this.plural(entity),
      pointerNames: entity => this.pointerNames(entity),
      attachedNames: () => this.attachedNames(),
      readMembers: dn => this.readMembers(dn),
      relationHref: dn => relationHref(this.entities, dn),
      claimAction: () => this.claimAction(),
      openList: (entity, view) => this.listsView.open(entity, view),
      openForm: (entity, entry, here) => this.openForm(entity, entry, here),
      openOrganizationForm: (entity, entry, parentDn) =>
        this.forms.openOrganization(entity, entry, parentDn),
      deleteOrganization: (entity, entry, dn) =>
        this.deletions.organization(entity, entry, dn),
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

  /**
   * Draw an entity's list (see `ListsView`): kept for `renderMain` and the
   * routing tests that replace it until #220's last step.
   */
  private renderList(
    main: HTMLElement,
    entity: EntityDescriptor
  ): Promise<void> {
    return this.listsView.render(main, entity);
  }

  /**
   * Draw an entry's card (see `EntryView`): kept for `renderMain` and the
   * routing tests that replace it until #220's last step. A view is made
   * for each drawing, as the card holds nothing from one to the next.
   */
  private renderDetail(
    main: HTMLElement,
    entity: EntityDescriptor,
    id: string,
    generation: number
  ): Promise<void> {
    return new EntryView(this.context).render(main, entity, id, generation);
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
   * Draw the organizations page (see `OrganizationsView`): kept for
   * `renderMain` and the routing tests that replace it until #220's last
   * step.
   */
  private renderOrganizations(
    main: HTMLElement,
    generation: number
  ): Promise<void> {
    return this.organizationsView.render(main, generation);
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
   * The password policies' page (`PoliciesView`). A view is made for each
   * drawing: it holds nothing from one to the next, and a view made anew
   * cannot draw with what an earlier page left in it. A view that keeps
   * something between drawings, as the lists keep where the reader was, is
   * kept by the console instead (#220).
   */
  private renderPolicies(main: HTMLElement, generation: number): Promise<void> {
    return new PoliciesView(this.context).render(main, generation);
  }

  /** Create or edit an entry of a flat or group entity (see `FormActions`). */
  private openForm(
    entity: EntityDescriptor,
    entry?: Entry,
    here?: { preset: Entry; created(): void }
  ): void {
    this.forms.open(entity, entry, here);
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

  /* --------------------------------------------------------------- actions */

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
