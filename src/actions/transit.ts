/**
 * The transit branch's two actions: Claim…, which takes an entry waiting
 * there into one of the caller's organizations, and Hand over, which lets
 * an entry go there for another administrator (#220).
 *
 * @module twake-directory-manager/actions/transit
 */

import { SEARCH_MINIMUM } from '../components/EntityList';
import {
  GroupPicker,
  type GroupAnswer,
  type GroupChoice,
} from '../components/GroupPicker';
import type { ConsoleContext } from '../console/context';
import { comparableDn, explainRefusal, rdnValue, withinDn } from '../format';
import { background } from '../shared/background';
import { html, render } from '../shared/html';
import type { EntityDescriptor, Entry, OrganizationNode } from '../types';

/**
 * Organizations a claim lists into a select when the server can search the
 * tree: past them a select is too long to read, and the walk, one request
 * an organization, kept the panel waiting before it opened.
 */
const LISTED_WHEN_SEARCHABLE = 50;

/**
 * The last segment of an organization path: the organization's own name,
 * for a place that has the whole path next to it.
 *
 * @param path full path, as the directory writes it
 * @param separator the separator the directory writes, when it has one
 * @returns its last non-empty segment, or the path itself when it has none
 */
function pathLeaf(path: string, separator: string | undefined): string {
  // Split on the separator as the directory writes it, blanks included:
  // trimmed to `/`, it cut a name holding a slash, _R&D/IT_, to _IT_.
  if (!separator) return path;
  const segments = path
    .split(separator)
    .map(segment => segment.trim())
    .filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/**
 * Claim… and Hand over, from an entry's card and from the rows listing
 * what waits in transit. A class given the context, as the other actions
 * are: it holds nothing between two calls, and the console makes one.
 */
export class TransitActions {
  /** @param ctx the console, as an action sees it */
  constructor(private readonly ctx: ConsoleContext) {}

  /**
   * Claim an entry in transit into one of the caller's organizations. Only
   * those are offered: the server asks for write on the destination and
   * nothing else, so any other choice would be refused.
   *
   * A tree small enough to walk is offered whole, in a select. A wider one
   * is searched as the operator types, when the server can: the walk stops
   * after a few hundred organizations, and a parent of a thousand left most
   * of its children out of the select, the one the entry was meant for
   * among them. A server that cannot search keeps the select of those
   * walked.
   *
   * @param entity the entry's entity
   * @param id the entry's identifier
   * @param name the entry as a colleague names it
   */
  async claim(entity: EntityDescriptor, id: string, name = id): Promise<void> {
    const { ctx } = this;
    const t = ctx.t;
    const rights = ctx.rights();
    if (!rights.transit) return;
    const transit = comparableDn(rights.transit);
    const roots = rights.claimRoots();
    const searches = ctx.api.searchesOrganizations;
    let targets: { dn: string; label: string }[];
    let partial: boolean;
    try {
      // Walked only to know whether the tree is small, when it can be
      // searched: the walk asks once per organization.
      // Stopped as soon as the tree is known to be wider than the bound: a
      // parent of a thousand, read first, needs no 49 more reads to say so.
      const walk = await ctx.api.organizationWalk(
        roots,
        searches ? LISTED_WHEN_SEARCHABLE : undefined,
        searches
      );
      targets = walk.organizations.filter(
        target => comparableDn(target.dn) !== transit
      );
      partial = walk.partial;
    } catch (err) {
      ctx.toast((err as Error).message, true);
      return;
    }
    if (partial && searches) {
      this.claimSearched(entity, id, name, roots, transit);
      return;
    }

    const separator = ctx.api.organizationPathSeparator;
    ctx.panel.open(
      t('transit.claimTitle', { name }),
      body => {
        if (targets.length === 0) {
          render(body, html`<p class="dc-empty">${t('transit.noTarget')}</p>`);
          return;
        }
        render(
          body,
          html`
          <form class="dc-form">
            <div class="dc-field">
              <label for="dc-claim-target">${t('transit.target')}</label>
              <select id="dc-claim-target" class="dc-input">
                ${targets.map(
                  target =>
                    html`<option value="${target.dn}">${target.label}</option>`
                )}
              </select>
            </div>
            <div class="dc-form-actions">
              <button type="button" class="dc-button" data-cancel>${t(
                'app.cancel'
              )}</button>
              <button type="submit" class="dc-button dc-button-primary">${t(
                'transit.claimButton',
                {
                  organization: pathLeaf(targets[0].label, separator),
                }
              )}</button>
            </div>
          </form>`
        );

        body
          .querySelector('[data-cancel]')
          ?.addEventListener('click', () => ctx.panel.close());
        // The button says where the entry goes, as the select changes: by
        // the organization's own name, the select above it showing the whole
        // path, which repeated on the button ran over three lines.
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
                organization: pathLeaf(chosen.label, separator),
              });
          });
        body.querySelector('form')?.addEventListener('submit', event => {
          event.preventDefault();
          const select =
            body.querySelector<HTMLSelectElement>('#dc-claim-target');
          const target = targets.find(item => item.dn === select?.value);
          if (!target) return;
          background(
            () => this.claimInto(entity, id, name, target),
            'api.move',
            ctx.report
          );
        });
      },
      true
    );
  }

  /**
   * Claim…, over a tree too wide to list: the organizations of the caller's
   * branches searched as the operator types, the one chosen as a token, and
   * the button naming it.
   *
   * @param entity the entry's entity
   * @param id the entry's identifier
   * @param name the entry as a colleague names it
   * @param roots the branches the caller writes
   * @param transit the transit branch, as DNs are compared
   */
  private claimSearched(
    entity: EntityDescriptor,
    id: string,
    name: string,
    roots: OrganizationNode[],
    transit: string
  ): void {
    const { ctx } = this;
    const t = ctx.t;
    const separator = ctx.api.organizationPathSeparator;
    const language = ctx.translator().language;
    // A branch under another the caller writes is in that one's answer, a
    // subtree search holding its base: it is not searched a second time.
    // The transit branch is no choice: searched, its matches were dropped.
    const searched = roots.filter(
      (root, index) =>
        comparableDn(root.dn) !== transit &&
        !roots.some(
          (other, before) =>
            withinDn(root.dn, other.dn) &&
            (comparableDn(other.dn) !== comparableDn(root.dn) || before < index)
        )
    );
    const picker = new GroupPicker({
      report: ctx.report,
      announce: ctx.announce,
      translator: ctx.translator(),
      single: true,
      words: {
        field: t('transit.target'),
        hint: t('transit.search', { count: SEARCH_MINIMUM }),
      },
      search: async (query: string): Promise<GroupAnswer> => {
        // A branch whose search failed hides nothing the others found: they
        // are offered, and the note says some are missing. Only when every
        // branch failed is the search a failure.
        const settled = await Promise.allSettled(
          searched.map(root => ctx.api.organizationSearchRead(query, root.dn))
        );
        const answers = settled.flatMap(result =>
          result.status === 'fulfilled' ? [result.value] : []
        );
        const failed = settled.find(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected'
        );
        if (failed && answers.length === 0) throw failed.reason;
        // An organization two answers hold is offered once; the transit
        // branch, which the server finds among the others, is no choice.
        const seen = new Set<string>([transit]);
        const choices = answers
          .flatMap(answer => answer.organizations)
          .filter(found => {
            const key = comparableDn(found.dn);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) =>
            a.label.localeCompare(b.label, language, {
              sensitivity: 'base',
              numeric: true,
            })
          )
          .map(found => ({
            dn: found.dn,
            name: found.label,
            label: found.label,
          }));
        // The server answers the first matches it found: the one looked for
        // may be among those it left out, which a longer text reaches. It
        // may as well be in a branch that could not be searched.
        const notes = [
          failed ? t('transit.searchFailedBranches') : '',
          answers.some(answer => answer.truncated)
            ? t('transit.searchTruncated')
            : '',
        ].filter(Boolean);
        return notes.length ? { choices, note: notes.join('. ') } : { choices };
      },
      // Where the entry goes, by the organization's own name, as the select
      // says it; the token above shows the whole path.
      confirm: (chosen: GroupChoice[]): string =>
        chosen[0]
          ? t('transit.claimButton', {
              organization: pathLeaf(chosen[0].label, separator),
            })
          : t('transit.claimSubmit'),
      // The picker asks only once one is chosen. A refusal is said in a
      // toast, as from the select, and the choice stays.
      onAdd: async (
        chosen: GroupChoice[]
      ): Promise<{ left: GroupChoice[] }> => {
        const [target] = chosen;
        const moved = await this.claimInto(entity, id, name, {
          dn: target.dn,
          label: target.label,
        });
        return { left: moved ? [] : chosen };
      },
      onCancel: (): void => ctx.panel.close(),
    });
    ctx.panel.open(
      t('transit.claimTitle', { name }),
      body => picker.render(body),
      true
    );
  }

  /**
   * Move the entry claimed into the organization chosen, say so, and open
   * its card; a refusal is said, and the panel stays.
   *
   * @param entity the entry's entity
   * @param id the entry's identifier
   * @param name the entry as a colleague names it
   * @param target the organization chosen
   * @returns whether it moved
   */
  private async claimInto(
    entity: EntityDescriptor,
    id: string,
    name: string,
    target: { dn: string; label: string }
  ): Promise<boolean> {
    const { ctx } = this;
    const t = ctx.t;
    try {
      await ctx.api.move(entity, id, target.dn);
      ctx.panel.close();
      ctx.toast(t('transit.claimed', { name, organization: target.label }));
      // To its card, where its position and its groups wait to be put right:
      // the Overview's toast left it to be searched for.
      const route = ctx.route();
      const here =
        route.view === 'entity' &&
        route.entity === entity.key &&
        route.id === id;
      if (here) await this.afterMove();
      else {
        ctx.go(`${entity.key}/${encodeURIComponent(id)}`);
        await ctx.readTransit();
      }
      return true;
    } catch (err) {
      // Claiming is judged on the organization chosen alone.
      ctx.toast(
        explainRefusal(err, entity.schema, ctx.translator(), target.label)
          .message,
        true
      );
      return false;
    }
  }

  /**
   * Let an entry go into the transit branch, for another administrator,
   * once asked: named as a colleague would name it, with the organization
   * it leaves.
   *
   * @param entity the entry's entity
   * @param id the entry's identifier
   * @param entry the entry, as its card read it
   */
  async handOver(
    entity: EntityDescriptor,
    id: string,
    entry: Entry
  ): Promise<void> {
    const { ctx } = this;
    const t = ctx.t;
    const transit = ctx.rights().transit;
    if (!transit) return;
    const name = ctx.personName(entity, entry, id);
    const organization = ctx.roleValue(entity, entry, 'organizationPath');
    // The department's groups went with the person, a shared mailbox
    // included, and once handed over the caller no longer reached the
    // account's card to take them out: those the caller writes are offered,
    // checked; the others are named.
    // relations() answers its own failures as `unknown` groups; the catch
    // stands for a failure it would not, which no test reaches from the page.
    let failed = false;
    const relations = await ctx.relations(entity, entry, true).catch(() => {
      failed = true;
      return undefined;
    });
    const groups = relations?.groups ? relations.items : [];
    // Groups that could not be listed are no groups: it is said.
    const unknown = failed || !!relations?.unknown;
    const offered = groups.filter(group => group.removable);
    const kept = groups.filter(group => !group.removable);
    const choices = offered.map(group => ({
      label: group.note ? `${group.label} · ${group.note}` : group.label,
      checked: true,
    }));
    if (
      !(await ctx.dialog.confirm({
        title: t('transit.handOverTitle', { name }),
        lines: [
          ...(organization
            ? [t('transit.handOverLeaves', { name, organization })]
            : []),
          t('transit.handOverConfirm'),
          ...(unknown ? [t('delete.groupsUnknown', { name })] : []),
          ...(kept.length
            ? [
                t('transit.staysIn', {
                  name,
                  groups: kept.map(group => group.label).join(', '),
                }),
              ]
            : []),
        ],
        ...(choices.length
          ? {
              choices: {
                title: t('transit.alsoRemove', { name }),
                options: choices,
              },
            }
          : {}),
        action: t('transit.handOver'),
        reversible: true,
      }))
    )
      return;
    // Out of the checked groups before the move: a delegated group's
    // administrator may only remove a member attached to their own
    // organizations, and the move would take the account out of theirs.
    // A removal refused leaves the account in that group; the move goes on.
    const still: string[] = [];
    const left: {
      entity: EntityDescriptor;
      id: string;
      member: string;
      label: string;
    }[] = [];
    for (const [index, group] of offered.entries()) {
      if (!choices[index].checked) continue;
      const owner = ctx.groupEntity(group.id);
      try {
        if (!owner || !entry.dn) throw new Error();
        await ctx.api.removeMember(owner, rdnValue(group.id), String(entry.dn));
        left.push({
          entity: owner,
          id: rdnValue(group.id),
          member: String(entry.dn),
          label: group.label,
        });
      } catch {
        still.push(group.label);
      }
    }
    try {
      await ctx.api.move(entity, id, transit);
    } catch (err) {
      // A refusal (4xx) means the entry stayed where it was: put back the
      // groups it left before the move. A timeout, a server failure, or a
      // status that says nothing of the move (401, 408, 429) leaves its
      // outcome unknown: the groups stay as they are, and the toast says the
      // account is no longer in them.
      const status = (err as { status?: number }).status;
      const refused =
        typeof status === 'number' &&
        status >= 400 &&
        status < 500 &&
        status !== 401 &&
        status !== 408 &&
        status !== 429;
      const lost: string[] = [];
      if (refused) {
        for (const group of left) {
          try {
            await ctx.api.addMembers(group.entity, group.id, [group.member]);
          } catch {
            lost.push(group.label);
          }
        }
      } else {
        for (const group of left) lost.push(group.label);
      }
      const refusal = explainRefusal(
        err,
        entity.schema,
        ctx.translator(),
        organization ?? name
      ).message;
      const message = lost.length
        ? `${refusal.replace(/\.$/, '')}${t('transit.noLongerIn', {
            groups: lost.join(', '),
          })}`
        : refusal;
      ctx.toast(message, true);
      // A group the account left and did not get back: draw the page again
      // so the card does not keep showing it.
      if (lost.length) await ctx.refresh();
      return;
    }
    // Where it comes from is said once more, and only here: the entry, now
    // in transit, no longer names it. A group it stays in is a refusal.
    const done = organization
      ? t('transit.handedOverFrom', { name: id, from: organization })
      : t('transit.handedOver', { name: id });
    ctx.toast(
      still.length
        ? `${done}${t('transit.stillIn', { groups: still.join(', ') })}`
        : done,
      still.length > 0
    );
    await this.afterMove();
  }

  /**
   * Draw the page again after an entry went into or out of transit, and
   * count the branch again on the banner. The Overview counts it itself.
   */
  private async afterMove(): Promise<void> {
    await this.ctx.refresh();
    if (this.ctx.route().view !== 'dashboard') await this.ctx.readTransit();
  }
}
