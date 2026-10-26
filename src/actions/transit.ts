/**
 * The transit branch's two actions: Claim…, which takes an entry waiting
 * there into one of the caller's organizations, and Hand over, which lets
 * an entry go there for another administrator (#220).
 *
 * @module twake-directory-manager/actions/transit
 */

import type { ConsoleContext } from '../console/context';
import { comparableDn, explainRefusal, rdnValue } from '../format';
import { background } from '../shared/background';
import { html, render } from '../shared/html';
import type { EntityDescriptor, Entry } from '../types';

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
    const separator = ctx.api.organizationPathSeparator;
    let targets: { dn: string; label: string }[];
    try {
      targets = (await ctx.api.organizationOptions(rights.claimRoots())).filter(
        target => comparableDn(target.dn) !== transit
      );
    } catch (err) {
      ctx.toast((err as Error).message, true);
      return;
    }

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
            () =>
              ctx.api
                .move(entity, id, target.dn)
                .then(async () => {
                  ctx.panel.close();
                  ctx.toast(
                    t('transit.claimed', { name, organization: target.label })
                  );
                  // To its card, where its position and its groups wait to be
                  // put right: the Overview's toast left it to be searched for.
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
                })
                // Claiming is judged on the organization chosen alone.
                .catch((err: unknown) =>
                  ctx.toast(
                    explainRefusal(
                      err,
                      entity.schema,
                      ctx.translator(),
                      target.label
                    ).message,
                    true
                  )
                ),
            'api.move',
            ctx.report
          );
        });
      },
      true
    );
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
    try {
      await ctx.api.move(entity, id, transit);
    } catch (err) {
      // Handing over is judged on the organization the entry leaves. Moved
      // first, a refusal leaves the account in its groups as well.
      ctx.toast(
        explainRefusal(
          err,
          entity.schema,
          ctx.translator(),
          organization ?? name
        ).message,
        true
      );
      return;
    }
    // Out of the checked groups once moved: a removal is judged on the group
    // the caller writes, wherever the account now is.
    const still: string[] = [];
    for (const [index, group] of offered.entries()) {
      if (!choices[index].checked) continue;
      const owner = ctx.groupEntity(group.id);
      try {
        if (!owner || !entry.dn) throw new Error();
        await ctx.api.removeMember(owner, rdnValue(group.id), String(entry.dn));
      } catch {
        still.push(group.label);
      }
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
