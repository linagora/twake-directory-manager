/**
 * The memberships of groups: Add to a group… and the × of a group on an
 * account's card, Add members… and the × of a member on a group's, and
 * Add to a group… on the accounts selected in a list (#220).
 *
 * @module twake-directory-manager/actions/groups
 */

import { roleAttribute } from '../api/ConsoleApiClient';
import { SEARCH_MINIMUM } from '../components/EntityList';
import { GroupPicker, type GroupChoice } from '../components/GroupPicker';
import { bulkPanel, bulkWritable } from '../console/bulk';
import type { ConsoleContext } from '../console/context';
import { groupType } from '../console/relations';
import { comparableDn, entryValue, explainRefusal, rdnValue } from '../format';
import { html, render } from '../shared/html';
import type { EntityDescriptor, Entry } from '../types';

/**
 * The panels that add an entry to groups or members to a group, and the
 * ×s that take one out. A class given the context, as the other actions
 * are: it holds nothing between two of them, so the console makes one,
 * with its context, and asks it each time.
 */
export class GroupActions {
  /** @param ctx the console, as an action sees it */
  constructor(private readonly ctx: ConsoleContext) {}

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
  add(entry: Entry, name: string, held: string[]): void {
    const { ctx } = this;
    const holds = new Set(held.map(dn => comparableDn(dn)));
    const search = ctx.api.groupSearch(
      ctx.entities(),
      found =>
        !holds.has(comparableDn(found.dn)) &&
        ctx.rights().writes(found.entity, found.entry)
    );
    if (!search || !entry.dn) return;
    const member = String(entry.dn);
    const t = ctx.t;
    const owners = new Map<string, EntityDescriptor>();
    const picker = new GroupPicker({
      report: ctx.report,
      translator: ctx.translator(),
      search: async (query: string): Promise<GroupChoice[]> =>
        (await search(query)).map(found => {
          owners.set(comparableDn(found.dn), found.entity);
          return this.choice(found);
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
            await ctx.api.addMembers(owner, group.name, [member]);
            joined.push(group.name);
            // Joined: no longer offered, as the server would refuse it twice.
            holds.add(comparableDn(group.dn));
          } catch (err) {
            left.push(group);
            refused.push(this.refusal(err, owner, group.name));
          }
        }
        if (joined.length)
          ctx.toast(t('groups.added', { name, groups: joined.join(', ') }));
        if (left.length === 0) {
          ctx.panel.close(true);
          await this.refreshCard('[data-add-groups]');
        } else if (joined.length) {
          await ctx.refresh();
          // The button the panel gives the focus back to was redrawn.
          ctx.panel.returnFocusTo(
            ctx.main()?.querySelector<HTMLElement>('[data-add-groups]') ?? null
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
      onCancel: (): void => ctx.panel.close(),
    });
    ctx.panel.open(t('groups.title', { name }), body => picker.render(body));
  }

  /**
   * Add the accounts selected to groups chosen in a panel, one request a
   * group. A group that refuses stays chosen in the panel, with why.
   *
   * @param entity the entity listed
   * @param selected the accounts selected, by identifier
   * @returns whether the accounts are in a group chosen, once the panel is
   *   closed
   */
  addMany(
    entity: EntityDescriptor,
    selected: [string, Entry][]
  ): Promise<boolean> {
    const { ctx } = this;
    const { kept, leftOut } = bulkWritable(
      ctx.rights(),
      ctx.translator(),
      entity,
      selected
    );
    const members = kept.map(([, entry]) => String(entry.dn));
    const search = ctx.api.groupSearch(ctx.entities(), found =>
      ctx.rights().writes(found.entity, found.entry)
    );
    if (!search) return Promise.resolve(false);
    if (!members.length) {
      if (leftOut) ctx.toast(leftOut, true);
      return Promise.resolve(false);
    }
    const t = ctx.t;
    const owners = new Map<string, EntityDescriptor>();
    // The members each group found holds already: one sent again fails the
    // whole request, the others with it.
    const holds = new Map<string, Set<string>>();
    const picker = new GroupPicker({
      report: ctx.report,
      translator: ctx.translator(),
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
          return this.choice(found);
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
              await ctx.api.addMembers(owner, group.name, absent);
              for (const dn of absent) held.add(comparableDn(dn));
              sent = true;
              added.set(absent.length, [
                ...(added.get(absent.length) ?? []),
                group.name,
              ]);
            } catch (err) {
              left.push(group);
              refused.push(this.refusal(err, owner, group.name));
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
        if (told.length) ctx.toast(told.join('. '));
        if (left.length === 0 && action.own()) ctx.panel.close(true);
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
      onCancel: (): void => ctx.panel.close(),
    });
    ctx.panel.open(t('bulk.addTitle', { count: members.length }), body => {
      render(
        body,
        html`${
          leftOut ? html`<p class="dc-hint">${leftOut}</p>` : ''
        }<div data-bulk-picker></div>`
      );
      const holder = body.querySelector<HTMLElement>('[data-bulk-picker]');
      if (holder) picker.render(holder);
    });
    if (!ctx.panel.isOpen()) return Promise.resolve(false);
    const action = bulkPanel(ctx.panel);
    return action.settled;
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
  addMembers(
    entity: EntityDescriptor,
    entry: Entry,
    id: string,
    name: string,
    held: string[]
  ): void {
    const { ctx } = this;
    // Nor the group itself.
    const holds = new Set(
      [...held, String(entry.dn ?? '')].map(dn => comparableDn(dn))
    );
    const search = ctx.api.memberSearch(
      'members',
      ctx.entities(),
      dn => !holds.has(comparableDn(dn))
    );
    if (!search) return;
    const domain = this.teamMailboxDomain(entity, entry);
    let leftOut = false;
    const t = ctx.t;
    const picker = new GroupPicker({
      report: ctx.report,
      translator: ctx.translator(),
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
          await ctx.api.addMembers(
            entity,
            id,
            chosen.map(member => member.dn)
          );
        } catch (err) {
          return { left: chosen, error: this.refusal(err, entity, name) };
        }
        ctx.toast(
          t('members.added', {
            count: chosen.length,
            names: chosen.map(member => member.name).join(', '),
            group: name,
          })
        );
        ctx.panel.close(true);
        await this.refreshCard('[data-add-members]');
        return { left: [] };
      },
      onCancel: (): void => ctx.panel.close(),
    });
    ctx.panel.open(t('members.title', { group: name }), body =>
      picker.render(body)
    );
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
  async removeMember(
    entity: EntityDescriptor,
    id: string,
    name: string,
    dn: string
  ): Promise<void> {
    const { ctx } = this;
    const member = rdnValue(dn);
    try {
      await ctx.api.removeMember(entity, id, dn);
    } catch (err) {
      ctx.toast(this.refusal(err, entity, name), true);
      return;
    }
    ctx.toast(ctx.t('groups.removed', { name: member, group: name }));
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
  async leave(entry: Entry, name: string, dn: string): Promise<void> {
    const { ctx } = this;
    const owner = ctx.groupEntity(dn);
    if (!owner || !entry.dn) return;
    const group = rdnValue(dn);
    try {
      await ctx.api.removeMember(owner, group, String(entry.dn));
    } catch (err) {
      ctx.toast(this.refusal(err, owner, group), true);
      return;
    }
    ctx.toast(ctx.t('groups.removed', { name, group }));
    await this.refreshCard('[data-add-groups]');
  }

  /** A group found, as a group picker offers it. */
  private choice(found: {
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
        groupType(
          this.ctx.entities(),
          this.ctx.translator().language,
          found.entity,
          found.entry
        ),
        address ? String(address) : '',
      ]
        .filter(Boolean)
        .join(' — '),
    };
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
    if (!this.ctx.api.teamMailboxesKeepDomain) return undefined;
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
   * Draw the card on screen again, after a change made from it, and give
   * the focus back to a control of it: the one it was on was redrawn.
   *
   * @param focus selector of the control to focus, when the card has it
   */
  private async refreshCard(focus: string): Promise<void> {
    await this.ctx.refresh();
    this.ctx.main()?.querySelector<HTMLElement>(focus)?.focus();
  }

  /**
   * A refusal in the interface's language, naming the fields the way the
   * form does (see {@link explainRefusal}).
   *
   * @param err what the request threw
   * @param entity the entity of the group refused
   * @param name the group, or the entry, the refusal is about
   */
  private refusal(
    err: unknown,
    entity: EntityDescriptor,
    name: string
  ): string {
    return explainRefusal(err, entity.schema, this.ctx.translator(), name)
      .message;
  }
}
