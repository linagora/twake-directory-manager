/**
 * The organizations page: the tree, and the card of the organization
 * selected beside it, with its people and groups and what may be created
 * there (#220, step 6).
 *
 * @module twake-directory-manager/views/organizations
 */

import {
  AttachedTables,
  attachedEntity,
  type AttachedKind,
} from '../components/AttachedTables';
import { EntityDetail } from '../components/EntityDetail';
import {
  OrganizationTree,
  type OrganizationIndex,
  type OrganizationMatches,
} from '../components/OrganizationTree';
import type { ConsoleContext } from '../console/context';
import {
  comparableDn,
  entryValue,
  isDnShaped,
  parentDn as parentOf,
  rdnValue,
  readFailure,
  withinDn,
} from '../format';
import { background } from '../shared/background';
import { html, render } from '../shared/html';
import type { EntityDescriptor, Entry, OrganizationNode } from '../types';

/**
 * The page of `#/organizations` and `#/organizations/<dn>`. Kept by the
 * console from one drawing to the next, for the tree it holds: drawn again
 * after a save, Back or a change of language, the page finds the branches
 * the reader opened still open, and the forms and the deletion find the
 * tree drawn last through the context.
 */
export class OrganizationsView {
  /** The tree drawn last, carried over to the next drawing */
  private drawn: OrganizationTree | null;
  /** The main area the page was drawn into last, where its card goes */
  private main: HTMLElement | null = null;

  /**
   * @param ctx the console, as a view sees it
   * @param tree the tree of a view this one takes the place of
   */
  constructor(
    private readonly ctx: ConsoleContext,
    tree: OrganizationTree | null = null
  ) {
    this.drawn = tree;
  }

  /** The organization tree drawn last, when the page drew one. */
  tree(): OrganizationTree | null {
    return this.drawn;
  }

  /**
   * The organization tree, with the selected node's card beside it.
   *
   * The tree is drawn in place of the one shown last, so the branches the
   * reader opened stay open; the node the address names is revealed in it.
   *
   * @param main the console's main area
   * @param generation the ticket of the page, checked after each `await`
   */
  async render(main: HTMLElement, generation: number): Promise<void> {
    const { ctx } = this;
    const entity = ctx.entities().find(item => item.kind === 'organization');
    const t = ctx.t;
    this.main = main;
    // Named after the page, as the sidebar names it, until a card names it
    // after the organization.
    ctx.titlePage(entity ? ctx.plural(entity) : t('tree.title'));
    const rights = ctx.rights();
    if (rights.administersNothing()) {
      render(main, html`<p class="dc-empty">${t('scope.nothing')}</p>`);
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

    const tree = new OrganizationTree(
      {
        translator: ctx.translator(),
        report: ctx.report,
        root: (): Promise<OrganizationNode | null> => ctx.api.organizationTop(),
        children: (dn: string): Promise<OrganizationNode[]> =>
          ctx.api.organizationChildren(dn),
        transit: rights.transit,
        onSelect: (node: OrganizationNode): void => {
          ctx.record(`organizations/${encodeURIComponent(node.dn)}`);
          background(() => this.show(node), 'showOrganization', ctx.report);
        },
        // A "+" on a node asks a different question from the card on the
        // overview: the card creates where the scope's `organizations.create`
        // or the caller's written branches allow, while the "+" creates under
        // the node it sits on. The server judges that on the node, so the "+"
        // shows only where the caller writes: a tree drawn from the root
        // offered it on the root to an administrator of a branch below it,
        // and creating there was refused.
        onCreateChild:
          entity && rights.canWrite()
            ? (node: OrganizationNode): void => {
                background(
                  () => ctx.openOrganizationForm(entity, undefined, node.dn),
                  'openOrganizationForm',
                  ctx.report
                );
              }
            : undefined,
        canCreateChild: (node: OrganizationNode): boolean =>
          ctx.rights().createsUnder(node.dn),
        // Walked, or searched, from the root the tree is drawn from: the
        // server roots a local administrator's tree at their branch, and the
        // filter finds what the tree can open down to, no more. A server
        // that searches the tree is asked once per filter rather than walked
        // an organization at a time, up to a bound a wide tree goes past;
        // it keeps the first matches of a broad text, and says so.
        everywhere: (): Promise<OrganizationIndex> =>
          ctx.api.organizationWalk(),
        search: ctx.api.searchesOrganizations
          ? (query: string, root: string): Promise<OrganizationMatches> =>
              ctx.api.organizationSearchRead(query, root, Infinity)
          : undefined,
      },
      this.drawn
    );
    this.drawn = tree;
    await tree.render(
      main.querySelector<HTMLElement>('[data-tree]') as HTMLElement
    );

    if (!ctx.current(generation)) return;
    const { id } = ctx.route();
    if (id) {
      const node = { dn: id, name: id };
      await tree.reveal(id);
      if (ctx.current(generation)) await this.show(node);
      return;
    }
    // Opened on "Select an organization" beside a tree of one root, the page
    // was always left by a click on that root: it is shown at once, the
    // address naming it in place of the bare one, so that Back leaves the
    // page rather than coming back to the empty box.
    const top = tree.top();
    if (!top) return;
    ctx.record(`organizations/${encodeURIComponent(top.dn)}`, true);
    tree.select(top.dn);
    await this.show(top);
  }

  /**
   * Whether an organization holds others, read from the tree when it has
   * read it: its People table lists only those attached to it directly.
   */
  private async holdsOthers(dn: string): Promise<boolean> {
    const known = this.drawn?.hasChildren(dn);
    if (known !== undefined) return known;
    try {
      return (await this.ctx.api.organizationChildren(dn)).length > 0;
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
    const people = attachedEntity(this.ctx.entities(), 'people');
    const field = people?.organizationPath;
    const stored = entity.organizationPath
      ? entryValue(entry, entity.organizationPath)
      : undefined;
    const path =
      String((Array.isArray(stored) ? stored[0] : stored) ?? '') ||
      this.drawn?.nameOf(dn);
    if (!people || !field || !path) return undefined;
    return (): void =>
      this.ctx.openList(people, {
        search: path,
        searchAttribute: field,
        under: path,
      });
  }

  /** Show one organization in the right-hand pane, tree still visible. */
  private async show(node: OrganizationNode): Promise<void> {
    const { ctx } = this;
    const entities = ctx.entities();
    const entity = entities.find(item => item.kind === 'organization');
    // The page drawn last, if it is still on screen: a card asked for once
    // another page took its place has nowhere to go.
    const holder = this.main?.querySelector<HTMLElement>('[data-org-detail]');
    if (!holder?.isConnected || !entity) return;
    // Clicking through a tree is navigation like any other: the node asked
    // for last is the node whose card should end up on screen.
    const generation = ctx.ticket();
    // Until its card is drawn, the tab no longer names the organization
    // shown before, but the page: a card that fails to load leaves it so.
    ctx.titlePage(ctx.plural(entity));

    // The address names an organization by its DN, which the server checks
    // before looking for it: `#/organizations/zzz` read its refusal, in
    // English and red, where it names an entry that is simply not there.
    if (!isDnShaped(node.dn)) {
      render(holder, html`<p class="dc-empty">${ctx.t('detail.notFound')}</p>`);
      return;
    }
    let entry: Entry;
    try {
      entry = await ctx.api.organization(node.dn);
      if (!ctx.current(generation)) return;
    } catch (err) {
      if (!ctx.current(generation)) return;
      const failure = readFailure(err, ctx.translator());
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
      ctx.readMembers(node.dn).catch((err: unknown) => {
        failure = readFailure(err, ctx.translator()).message;
        return { entries: [], truncated: false };
      }),
      ctx.pointerNames(entity),
      ctx.attachedNames(),
      listEveryone ? this.holdsOthers(node.dn) : false,
    ]);
    if (!ctx.current(generation)) return;

    const rights = ctx.rights();
    const translator = ctx.translator();
    const organization = rights.organizationRights(node.dn);
    const transit = rights.transit;
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
      rights.administersExactly(node.dn);
    const card = new EntityDetail({
      report: ctx.report,
      entity,
      entry,
      translator,
      canWrite: organization.write,
      canDelete: organization.delete,
      notice: changedAbove ? ctx.t('org.changedAbove', { name }) : undefined,
      pointerLabel: named,
      attached: new AttachedTables({
        entities,
        members,
        translator,
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
            ? ctx.claimAction()
            : undefined,
        partial: !rights.readsWhole(node.dn),
        failure,
        onOpen: (href: string): void => {
          window.location.hash = href;
        },
      }),
      relationHref: (dn: string): string | undefined => ctx.relationHref(dn),
      onEdit: (): void => {
        background(
          () => ctx.openOrganizationForm(entity, entry),
          'openOrganizationForm',
          ctx.report
        );
      },
      onDelete: (): void => {
        background(
          () => ctx.deleteOrganization(entity, entry, node.dn),
          'confirmDeleteOrganization',
          ctx.report
        );
      },
      // What the tree's "+" does, said in words where the reader is looking:
      // the "+" shows on a row only once it is pointed at or selected.
      onCreateChild: rights.createsUnder(node.dn)
        ? (): void => {
            background(
              () => ctx.openOrganizationForm(entity, undefined, node.dn),
              'openOrganizationForm',
              ctx.report
            );
          }
        : undefined,
      onStatus: (): void => undefined,
      onResetPassword: (): void => undefined,
    });
    card.render(holder);
    ctx.titlePage(card.heading());
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
    const { ctx } = this;
    const offered: Partial<Record<AttachedKind, () => void>> = {};
    const rights = ctx.rights();
    // The global administrator writes above the transit branch, and may
    // grow it, but an account is handed over into it, not created there.
    const transit = rights.transit;
    if (
      !rights.createsUnder(node.dn) ||
      (transit && withinDn(node.dn, transit))
    )
      return offered;
    // The path names the department in the form's picker, as it does on an
    // entry being edited: the DN alone would show its last name only.
    const path = organizations.organizationPath
      ? [entryValue(entry, organizations.organizationPath) ?? []].flat()[0]
      : undefined;
    for (const kind of ['people', 'groups'] as const) {
      const target = attachedEntity(ctx.entities(), kind);
      const link = target?.organizationLink;
      if (!target || !link || !rights.canCreate(target)) continue;
      const preset: Entry = { [link]: node.dn };
      if (target.organizationPath && path)
        preset[target.organizationPath] = path;
      offered[kind] = (): void =>
        background(
          () =>
            ctx.openForm(target, undefined, {
              preset,
              // The card is drawn anew, button included: the focus goes back to
              // the new one, for the next creation, rather than to the page.
              created: (): void =>
                background(
                  () =>
                    this.show(node).then(() =>
                      this.main
                        ?.querySelector<HTMLElement>(
                          `[data-create-attached="${kind}"]`
                        )
                        ?.focus()
                    ),
                  'showOrganization',
                  ctx.report
                ),
            }),
          'openForm',
          ctx.report
        );
    }
    return offered;
  }
}
