/**
 * The card of one entry: its details, its relations, and what may be done
 * to it (#220, step 6).
 *
 * @module twake-directory-manager/views/entry
 */

import { EntityDetail } from '../components/EntityDetail';
import type { ConsoleContext } from '../console/context';
import { readFailure } from '../format';
import { splitEntities } from '../rights';
import { background } from '../shared/background';
import { html, render } from '../shared/html';
import type { EntityDescriptor, Entry } from '../types';

/**
 * The page of `#/<entity>/<id>`. Made anew for each drawing: it holds
 * nothing from one to the next, the card it draws reading the entry again.
 * What the card offers — Edit, Delete, Change state…, Reset password,
 * Claim…, Hand over, Add to a group…, Add members…, the ×s — is started
 * through the context, which draws the card again once it is done.
 */
export class EntryView {
  /** @param ctx the console, as a view sees it */
  constructor(private readonly ctx: ConsoleContext) {}

  /**
   * One entry, read-only, with its actions and its relations.
   *
   * @param main the console's main area
   * @param entity the entry's entity
   * @param id the entry's identifier, as the address names it
   * @param generation the ticket of the page, checked after each `await`
   */
  async render(
    main: HTMLElement,
    entity: EntityDescriptor,
    id: string,
    generation: number
  ): Promise<void> {
    const { ctx } = this;
    const t = ctx.t;
    if (ctx.rights().administersNothing()) {
      render(main, html`<p class="dc-empty">${t('scope.nothing')}</p>`);
      return;
    }
    render(main, html`<p class="dc-empty">${t('app.loading')}</p>`);
    const naming = ctx.pointerNames(entity);
    let entry: Entry;
    try {
      entry = await ctx.api.get(entity, id);
      if (!ctx.current(generation)) return;
    } catch (err) {
      if (!ctx.current(generation)) return;
      const failure = readFailure(err, ctx.translator());
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
      ?.addEventListener('click', () => ctx.go(entity.key));

    const [named, relations] = await Promise.all([
      naming,
      ctx.relations(entity, entry),
    ]);
    if (!ctx.current(generation)) return;
    const rights = ctx.rights();
    const transit = rights.transitOf(entity, entry);
    const readOnly = rights.readsReferenceOnly(entity);
    const canWrite = !readOnly && (transit.rights?.write ?? rights.canWrite());
    const groups = relations?.groups && entry.dn ? relations.items : undefined;
    // A group's members, managed from its card as an account's groups are
    // from the account's: the whole form was the only way to change one.
    // Only a group has the routes that add and remove one member: a flat
    // entity's members, a team mailbox's, are saved with the whole entry.
    const members =
      relations &&
      !relations.groups &&
      entity.kind === 'group' &&
      rights.writes(entity, entry)
        ? relations
        : undefined;
    if (members) for (const item of members.items) item.removable = true;
    const joins =
      !!groups &&
      rights.writes(entity, entry) &&
      !!ctx.api.groupSearch(ctx.entities());
    // Said on reference data only: a directory with no tree puts every
    // collection forward, and its accounts are no reference data.
    const reference = splitEntities(ctx.entities()).reference.includes(entity);
    const detail: EntityDetail = new EntityDetail({
      report: ctx.report,
      entity,
      entry,
      translator: ctx.translator(),
      canWrite,
      canDelete: !readOnly && (transit.rights?.delete ?? rights.canDelete()),
      notice: readOnly && reference ? ctx.t('reference.readOnly') : undefined,
      inTransit: transit.inTransit,
      onClaim: transit.claim
        ? (): void =>
            background(
              () => ctx.claim(entity, id, ctx.personName(entity, entry, id)),
              'claim',
              ctx.report
            )
        : undefined,
      onHandOver: transit.handOver
        ? (): void =>
            background(
              () => ctx.handOver(entity, id, entry),
              'handOver',
              ctx.report
            )
        : undefined,
      pointerLabel: named,
      relations,
      onEdit: (): void => {
        background(() => ctx.openForm(entity, entry), 'openForm', ctx.report);
      },
      onDelete: (): void => {
        background(
          () => ctx.deleteEntry(entity, id, entry, canWrite),
          'confirmDelete',
          ctx.report
        );
      },
      onStatus: (): void => {
        background(
          () => ctx.changeState(entity, id, entry),
          'changeState',
          ctx.report
        );
      },
      onResetPassword: (): void => {
        background(
          () => ctx.resetPassword(entity, id),
          'resetPassword',
          ctx.report
        );
      },
      relationHref: (dn: string): string | undefined => ctx.relationHref(dn),
      onAddToGroups:
        groups && joins
          ? (): void =>
              ctx.addToGroups(
                entry,
                detail.heading(),
                groups.map(group => group.id)
              )
          : undefined,
      onLeaveGroup: groups
        ? (dn: string): Promise<void> =>
            ctx.leaveGroup(entry, detail.heading(), dn)
        : members
          ? (dn: string): Promise<void> =>
              ctx.removeMember(entity, id, detail.heading(), dn)
          : undefined,
      onAddMembers:
        members && ctx.api.memberSearch('members', ctx.entities())
          ? (): void =>
              ctx.addMembers(
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
    ctx.titlePage(detail.heading());
  }
}
