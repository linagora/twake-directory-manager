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

import { ConsoleApiClient, roleAttribute } from './api/ConsoleApiClient';
import { applyContrast, ShellView } from './console/shell';
import { attachedClass } from './components/AttachedTables';
import {
  comparableDn,
  entryValue,
  isDnShaped,
  rdnValue,
  withinDn,
} from './format';
import { Translator } from './i18n';
import { Rights } from './rights';
import { saveDraft, signInAgain, type Draft } from './session';
import type {
  Confirmation,
  AttachedEntries,
  ConsoleOptions,
  EntityDescriptor,
  Scope,
} from './types';
import { background, fromConsole, type Reporter } from './shared/background';
import { html, render } from './shared/html';
import type { ConsoleContext } from './console/context';
import { createLabel } from './console/labels';
import { Names } from './console/names';
import { TransitService } from './console/transit';
import { consoleReporter } from './console/report';
import type { ConsoleDeps } from './console/deps';
import { DialogService } from './console/dialog';
import { groupEntity, readRelations, relationHref } from './console/relations';
import { POLICIES_KEY, type Route, routeOf } from './console/route';
import { PanelService } from './console/panel';
import {
  highContrast,
  onContrastChange,
  storedLanguage,
} from './console/settings';
import { announcer } from './ui/announce';
import { DashboardView } from './views/dashboard';
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
export { ToastController };
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
  /**
   * Whether the console is reloading to sign in again: the browser must not
   * ask about the form it is leaving, whose draft was just kept.
   */
  private leavingForSignIn = false;
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
   * What the form open holds, asked when the server ends the session: none
   * when no form is open. The actions register it when they open one.
   */
  private draftOf: (() => Draft | null) | null = null;
  /** What the console calls things, as views ask (see `Names`). */
  private names!: Names;
  /** The transit branch's count and actions (see `TransitService`). */
  private transitService!: TransitService;
  /** The frame drawn around the pages, and its listeners. */
  private shell!: ShellView;

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
      // What the form open holds is kept before the page goes: the reload
      // would take it with the page (see `Draft`).
      const draft = this.draftOf?.();
      if (draft) saveDraft(draft);
      // Only a draft that was kept makes the reload safe to leave without
      // asking: a form that keeps none would lose what it holds.
      this.leavingForSignIn = !!draft;
      if (!signInAgain()) this.leavingForSignIn = false;
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
    this.names = new Names({
      api: this.api,
      entities: (): EntityDescriptor[] => this.entities,
      translator: (): Translator => this.translator,
    });
    this.transitService = new TransitService({
      rights: (): Rights => this.rights,
      translator: (): Translator => this.translator,
      route: (): Route => this.route,
      link: (): HTMLElement | null =>
        this.container?.querySelector<HTMLElement>('[data-transit-link]') ??
        null,
      readMembers: (dn): Promise<AttachedEntries> => this.readMembers(dn),
      claim: (entity, id, name): Promise<void> =>
        this.transits.claim(entity, id, name),
      report: this.report,
    });
    this.shell = new ShellView({
      container: (): HTMLElement | null => this.container,
      translator: (): Translator => this.translator,
      rights: (): Rights => this.rights,
      entities: (): EntityDescriptor[] => this.entities,
      plural: (entity: EntityDescriptor): string => this.names.plural(entity),
      logoutUrl: (): string | undefined => this.api.logoutUrl,
      transitLabel: (): string => this.transitService.label(),
      main: (): HTMLElement | null => this.main(),
      go: (path: string): void => this.go(path),
      closePanel: (): void => this.panel.close(),
      setLanguage: (code: string): void => {
        this.translator = new Translator(code);
      },
      renderMain: (): Promise<void> => this.renderMain(),
      report: this.report,
    });
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
    document.addEventListener('keydown', event => this.panel.key(event), {
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
      if (this.leavingForSignIn || !this.panel.isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    });

    this.shell.draw();
    // The Overview reads it for its own section, and the transit branch's
    // page reads it as its card's members: no other first page has the
    // banner count it.
    if (!this.transitService.readsOnPage()) this.transitService.refresh();
    await this.renderMain();
    // A form a reload took away, once its draft was kept, is offered back.
    await this.forms.offerDraft();
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
      account: () => this.account,
      personName: (entity, entry, id) =>
        this.names.personName(entity, entry, id),
      submittedName: (entity, values, id) =>
        this.names.submittedName(entity, values, id),
      entryName: (entity, id) => this.names.entryName(entity, id),
      roleValue: (entity, entry, role) =>
        this.names.roleValue(entity, entry, role),
      go: path => this.go(path),
      record: (path, replace) => this.record(path, replace),
      restorePage: path => this.restorePage(path),
      route: () => this.route,
      readTransit: () => this.transitService.read(),
      inTransit: (entity, entry) =>
        this.transitService.inTransit(entity, entry),
      refreshTransit: () => this.transitService.refresh(),
      watchDraft: (ask): void => {
        this.draftOf = ask;
      },
      tree: () => this.organizationsView?.tree() ?? null,
      relations: (entity, entry, strict) =>
        readRelations(this.context, entity, entry, strict),
      groupEntity: dn => groupEntity(this.entities, dn),
      changeState: (entity, id, entry, preselect) =>
        this.states.change(entity, id, entry, preselect),
      resetPassword: (entity, id) => this.passwords.reset(entity, id),
      claim: (entity, id, name) => this.transits.claim(entity, id, name),
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
      deleteSelection: (entity, selected) =>
        this.deletions.many(entity, selected),
      changeSelectionState: (entity, selected) =>
        this.states.changeMany(entity, selected),
      addSelectionToGroups: (entity, selected) =>
        this.groups.addMany(entity, selected),
      createLabel: entity => createLabel(this.translator, entity),
      givePassword: (entity, values, id, next, own) =>
        this.passwords.give(entity, values, id, next, own),
      plural: entity => this.names.plural(entity),
      pointerNames: entity => this.names.pointerNames(entity),
      attachedNames: () => this.names.attachedNames(),
      readMembers: dn => this.readMembers(dn),
      relationHref: (dn, primaryOnly) =>
        relationHref(this.entities, dn, primaryOnly),
      claimAction: () => this.transitService.claimAction(),
      openList: (entity, view) => this.listsView.open(entity, view),
      openForm: (entity, entry, here) => this.forms.open(entity, entry, here),
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
   * Go to the page a draft was opened on, waiting for its hash change: the
   * navigation close it drives has run before the form is restored.
   *
   * @param path what follows `#/`
   */
  private async restorePage(path: string): Promise<void> {
    this.go(path);
    await new Promise<void>(resolve =>
      window.addEventListener('hashchange', () => resolve(), { once: true })
    );
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

  /* ------------------------------------------------------------------ views */

  private main(): HTMLElement | null {
    return this.container?.querySelector<HTMLElement>('[data-main]') || null;
  }

  /** True while the view this ticket was taken for is still the one asked for. */
  private current(generation: number): boolean {
    return generation === this.viewGeneration;
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
        this.shell.reference(true);
      // On a phone the navigation is a row that scrolls sideways: bring the
      // current entry into it, or it may sit past the edge of the screen.
      if (active)
        button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    if (this.route.view === 'dashboard') {
      new DashboardView(this.context).render(main, generation);
      return;
    }
    if (this.route.view === 'organizations')
      return this.organizationsView.render(main, generation);
    if (this.route.view === 'policies') {
      if (this.rights.managesPolicies())
        return new PoliciesView(this.context).render(main, generation);
      new DashboardView(this.context).render(main, generation);
      return;
    }

    const entity = this.entity(this.route.entity);
    if (!entity) return this.renderNotFound(main);
    if (entity.kind === 'organization')
      return this.organizationsView.render(main, generation);
    if (this.route.id)
      return new EntryView(this.context).render(
        main,
        entity,
        this.route.id,
        generation
      );
    return this.listsView.render(main, entity, generation);
  }

  private entity(key?: string): EntityDescriptor | undefined {
    return this.entities.find(entity => entity.key === key);
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
   * The entries attached to an organization, the accounts and the groups
   * each asked on its own when their classes tell them apart: the server
   * caps and counts each answer apart, so each table says what it left out.
   * One answer for both shares one cap, and the count it gives says nothing
   * of which kind it cut.
   *
   * The transit branch's answer also counts on the banner: its card lists
   * the entries the banner would otherwise read the same subnodes for. A
   * later read is the one that counts, whichever page asked.
   *
   * @param dn the organization
   * @returns what the server listed
   */
  private async readMembers(dn: string): Promise<AttachedEntries> {
    // A read of the transit branch counts on the banner; a later read wins.
    const ticket = this.transitService.ticket(dn);
    try {
      const answer = await this.requestMembers(dn);
      this.transitService.settle(ticket, answer);
      return answer;
    } catch (err) {
      this.transitService.settle(ticket, null);
      throw err;
    }
  }

  /** Read an organization's members, without counting the transit branch. */
  private async requestMembers(dn: string): Promise<AttachedEntries> {
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

  /* --------------------------------------------------------------- actions */

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
  private readonly report: Reporter = consoleReporter(
    (key, values) => this.translator.t(key, values),
    (message, isError) => this.toast(message, isError),
    (error, context) => this.options.onError?.(error, context)
  );
}
