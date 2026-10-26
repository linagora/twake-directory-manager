/**
 * The deletions: an entry from its card, an organization from its own, and
 * the entries selected in a list, each asked first (#220).
 *
 * @module twake-directory-manager/actions/deletion
 */

import { roleAttribute } from '../api/ConsoleApiClient';
import type { ConsoleContext } from '../console/context';
import {
  attributeLabel,
  comparableDn,
  entryValue,
  explainRefusal,
  rdnValue,
} from '../format';
import { background } from '../shared/background';
import type { Confirmation, EntityDescriptor, Entry } from '../types';

/**
 * What is asked before a deletion, and the deletion once confirmed. A class
 * given the context, as the other actions are: it holds nothing between two
 * calls, and the console makes one.
 */
export class DeletionActions {
  /** @param ctx the console, as an action sees it */
  constructor(private readonly ctx: ConsoleContext) {}

  /**
   * What to ask before deleting an entry. An account is named by its full
   * name, email and organization, the way to tell two "jmartin" apart, with
   * the groups it leaves and the state change offered instead. A group says
   * its members stay. Anything else, a position or a mail domain, is named
   * as its card names it.
   *
   * @param entity the entry's entity
   * @param id the entry's identifier
   * @param entry the entry, when its card is open
   * @param canChangeState offer an account's state change instead
   */
  async question(
    entity: EntityDescriptor,
    id: string,
    entry?: Entry,
    canChangeState = false
  ): Promise<Confirmation> {
    const { ctx } = this;
    const t = ctx.t;
    const irreversible = t('delete.irreversible');
    const name = entry
      ? ctx.personName(entity, entry, id)
      : ctx.entryName(entity, id);
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
      ctx.roleValue(entity, entry, 'primaryEmail'),
      ctx.roleValue(entity, entry, 'organizationPath'),
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
        name: ctx.roleValue(entity, entry, 'givenName') ?? name,
      }),
      alternative: offer
        ? {
            label: t('delete.preferDisable'),
            run: (): void =>
              background(
                () => ctx.changeState(entity, id, entry, 'disabled'),
                'changeState',
                ctx.report
              ),
          }
        : undefined,
    };
  }

  /**
   * Delete an entry once asked, then open its list.
   *
   * @param entity the entry's entity
   * @param id the entry's identifier
   * @param entry the entry, when its card is open
   * @param canChangeState offer an account's state change instead
   */
  async one(
    entity: EntityDescriptor,
    id: string,
    entry?: Entry,
    canChangeState = false
  ): Promise<void> {
    const { ctx } = this;
    // Named as the dialog names it.
    const name = entry
      ? ctx.personName(entity, entry, id)
      : ctx.entryName(entity, id);
    if (
      !(await ctx.dialog.confirm(
        await this.question(entity, id, entry, canChangeState)
      ))
    )
      return;
    try {
      await ctx.api.remove(entity, id);
      ctx.toast(ctx.t('delete.done'));
      ctx.go(entity.key);
    } catch (err) {
      ctx.toast(
        this.inUse(err, entity, id) ??
          explainRefusal(err, entity.schema, ctx.translator(), name).message,
        true
      );
    }
  }

  /**
   * Delete an organization once asked, its parent shown in its place.
   *
   * @param entity the organizations' entity
   * @param entry the organization, as its card read it
   * @param dn the organization's DN
   */
  async organization(
    entity: EntityDescriptor,
    entry: Entry,
    dn: string
  ): Promise<void> {
    const { ctx } = this;
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
      !(await ctx.dialog.confirm({
        title: ctx.t('delete.title', { name }),
        lines: [ctx.t('delete.irreversible')],
        action: ctx.t('delete.organizationButton'),
      }))
    )
      return;
    try {
      await ctx.api.deleteOrganization(dn);
      ctx.toast(ctx.t('delete.done'));
      // Its parent takes its place: where it was, beside its siblings. Its
      // address is replaced, as Back could only lead to a page now gone.
      const tree = ctx.tree();
      const parent = tree?.parentOf(dn);
      if (parent) {
        await tree?.refresh(parent).catch(() => []);
        ctx.record(`organizations/${encodeURIComponent(parent)}`, true);
      } else ctx.record('organizations', true);
      await ctx.refresh();
    } catch (err) {
      // The server's refusal names the DN, in English: say it in words.
      if ((err as { status?: number }).status === 409)
        ctx.toast(ctx.t('delete.notEmpty', { name }), true);
      else
        ctx.toast(
          explainRefusal(err, entity.schema, ctx.translator(), name).message,
          true
        );
    }
  }

  /**
   * Delete a selection, reporting each refusal on its own: a bulk action that
   * stops at the first error leaves the operator guessing which entries went.
   *
   * @param entity the entity listed
   * @param ids the selection, by identifier
   * @returns whether any entry was deleted: none on Cancel, and the list
   *   then stays as it was, selection and focus with it
   */
  async many(entity: EntityDescriptor, ids: string[]): Promise<boolean> {
    const { ctx } = this;
    const t = ctx.t;
    if (ids.length === 0) return false;
    // The first few by name, enough to see the selection is the right one.
    const named = ids.slice(0, 5).map(id => ctx.entryName(entity, id));
    const more = ids.length - named.length;
    if (
      !(await ctx.dialog.confirm({
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
        await ctx.api.remove(entity, id);
        deleted++;
      } catch (err) {
        const name = ctx.entryName(entity, id);
        const { refusal } = err as { refusal?: { code?: string } };
        const said = explainRefusal(
          err,
          entity.schema,
          ctx.translator(),
          name
        ).message;
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
    ctx.toast(
      failures.length === 0 ? t('delete.done') : failures.join(' · '),
      failures.length > 0
    );
    return deleted > 0;
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
    const { ctx } = this;
    const { status, message } = err as { status?: number; message?: string };
    const attribute = /still referenced[^(]*\(([^)]+)\)\s*$/i.exec(
      message ?? ''
    )?.[1];
    if (status !== 409 || !attribute) return undefined;
    const { language } = ctx.translator();
    const base = entity.base ? comparableDn(entity.base) : undefined;
    let field: string | undefined;
    for (const candidate of ctx.entities()) {
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
    return ctx.t('delete.inUse', {
      name: ctx.entryName(entity, id),
      field: field ?? attribute,
    });
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
          list = await this.ctx.api.memberships(
            entry.dn,
            this.ctx.entities(),
            true
          );
        } catch {
          return undefined;
        }
      }
      return list.map(dn => rdnValue(String(dn)));
    }
    return [];
  }
}
