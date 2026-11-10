/**
 * The Overview: who is signed in, the entities with what may be done to them,
 * the reference data, and what waits in transit — the page answering "what am
 * I allowed to do here?" (#220, step 6, last view).
 *
 * @module twake-directory-manager/views/dashboard
 */

import { AttachedTables } from '../components/AttachedTables';
import type { ConsoleContext } from '../console/context';
import { POLICIES_KEY } from '../console/route';
import { initial } from '../console/shell';
import { rdnValue } from '../format';
import { splitEntities } from '../rights';
import { background } from '../shared/background';
import { html, render, type SafeHtml } from '../shared/html';

/**
 * The Overview of `#/`, drawn from the context the console gives each view.
 * It holds nothing between drawings: the transit section is read again when
 * the page is drawn again.
 */
export class DashboardView {
  /**
   * @param ctx the console, as a view sees it
   */
  constructor(private readonly ctx: ConsoleContext) {}

  /**
   * Draw the Overview and read what waits in transit.
   *
   * @param main the console's main area
   * @param generation the ticket of the page, checked after each `await`
   */
  render(main: HTMLElement, generation: number): void {
    const { ctx } = this;
    const t = ctx.t;
    ctx.titlePage(t('nav.dashboard'));
    // What waits in transit goes first, once read: it is what may need
    // doing today.
    const sections = ctx.rights().administersNothing()
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
        ctx.go(button.dataset.open as string)
      );
    for (const button of Array.from(
      main.querySelectorAll<HTMLElement>('[data-new]')
    ))
      button.addEventListener('click', () => {
        const entity = ctx
          .entities()
          .find(candidate => candidate.key === button.dataset.new);
        if (entity)
          background(() => ctx.openForm(entity), 'openForm', ctx.report);
      });
    background(
      () => this.showTransitWaiting(main, generation),
      'showTransitWaiting',
      ctx.report
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
  async showTransitWaiting(
    main: HTMLElement,
    generation: number
  ): Promise<void> {
    const { ctx } = this;
    const waiting = await ctx.readTransit();
    if (!ctx.current(generation) || !waiting?.entries.length) return;
    const names = await ctx.attachedNames();
    const holder = main.querySelector<HTMLElement>('[data-transit-waiting]');
    if (!ctx.current(generation) || !holder) return;
    const t = ctx.t;
    const entities = ctx.entities();
    const rights = ctx.rights();
    // Only invite a caller who can claim at least one of the entries: a
    // read-only administrator sees the list but no Claim… button, and the
    // help text must not ask for an action the page does not offer.
    const claimable = waiting.entries.some(entry => {
      const entity = entities.find(item => item.key === entry.entity);
      return !!entity && rights.claimable(entry, entity);
    });
    const tables = new AttachedTables({
      entities,
      members: waiting,
      translator: ctx.translator(),
      name: rdnValue(rights.transit || ''),
      pointerLabel: names,
      hideEmpty: true,
      rowAction: ctx.claimAction(),
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
        <p class="dc-muted">${t(
          claimable ? 'transit.waitingHelp' : 'transit.waitingHelpReadOnly'
        )}</p>
        ${tables.markup()}
      </section>`
    );
    tables.bind(holder);
  }

  /** Who is signed in: by name and address, else as the scope gives it. */
  private welcomeMarkup(): SafeHtml {
    const { ctx } = this;
    const user = ctx.rights().user;
    if (!user) return html``;
    const account = ctx.account();
    const text = account?.email
      ? ctx.t('dashboard.welcomeNamed', {
          name: account.name,
          email: account.email,
        })
      : ctx.t('dashboard.welcome', {
          user: account?.name || user,
        });
    return html`<p class="dc-muted">${text}</p>`;
  }

  /** The cards of the entities, with what can be done to them. */
  private manageMarkup(): SafeHtml {
    const { ctx } = this;
    const t = ctx.t;
    const { primary } = splitEntities(ctx.entities());
    return html`
      <h2>${t('dashboard.entities')}</h2>
      <ul class="dc-cards">
        ${primary.map(entity => {
          const allowed = ctx.rights().canCreate(entity);
          return html`<li class="dc-card">
              <header class="dc-card-title">
                <span class="dc-entity-icon" aria-hidden="true">${initial(
                  ctx.plural(entity)
                )}</span>
                <h3>${ctx.plural(entity)}</h3>
              </header>
              <div class="dc-card-actions">
                <button type="button" class="dc-button" data-open="${
                  entity.key
                }">${t('list.open')}</button>
                ${
                  allowed
                    ? html`<button type="button" class="dc-button dc-button-primary" data-new="${
                        entity.key
                      }">${ctx.createLabel(entity)}</button>`
                    : html`<span class="dc-muted">${t('dashboard.noCreate')}</span>`
                }
              </div>
            </li>`;
        })}
      </ul>`;
  }

  /** The links to the reference data and the password policies. */
  private referenceMarkup(): SafeHtml {
    const { ctx } = this;
    const settings = [
      ...splitEntities(ctx.entities()).reference.map(entity => ({
        key: entity.key,
        label: ctx.plural(entity),
      })),
      ...(ctx.rights().managesPolicies()
        ? [{ key: POLICIES_KEY, label: ctx.t('nav.policies') }]
        : []),
    ];
    if (!settings.length) return html``;
    return html`
      <h2>${ctx.t('nav.reference')}</h2>
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
    const { ctx } = this;
    const t = ctx.t;
    const name = ctx.account()?.name || ctx.rights().user;
    const logout = ctx.api.logoutUrl;
    return html`
      <div class="dc-no-rights" data-no-rights>
        <h2>${t('dashboard.noRightsTitle')}</h2>
        <p>${
          name
            ? t('dashboard.noRightsBody', { name })
            : t('dashboard.noRightsBodyUnknown')
        }</p>
        ${
          logout
            ? html`<a class="dc-button dc-button-primary" href="${
                logout
              }">${t('app.logout')}</a>`
            : ''
        }
      </div>`;
  }
}
