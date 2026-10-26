/**
 * The change of an account's state: from its card, and on the accounts
 * selected in a list, one after the other (#220).
 *
 * @module twake-directory-manager/actions/state
 */

import { stateLabel } from '../components/EntityDetail';
import { bulkPanel, bulkWritable } from '../console/bulk';
import type { ConsoleContext } from '../console/context';
import {
  comparableDn,
  entryValue,
  explainRefusal,
  parentDn as parentOf,
  pointerLabel,
  rdnValue,
} from '../format';
import { background } from '../shared/background';
import { html, render } from '../shared/html';
import type { EntityDescriptor, Entry } from '../types';

/**
 * The states an account may be put in, and the panels that put it there.
 * A class given the context, as a view is (`PoliciesView`): it reaches the
 * console through nothing else. It holds nothing between two actions, so
 * the console makes one, with its context, and asks it each time.
 */
export class StateActions {
  /** @param ctx the console, as an action sees it */
  constructor(private readonly ctx: ConsoleContext) {}

  /**
   * Change an account's state, once a state is picked and the button naming
   * it pressed. The select this replaces wrote the state as soon as its value
   * changed, and an arrow key on it was enough to lock a colleague out.
   *
   * The states are named as the card and the lists name them: by the label
   * the reference data gives the entry each one points at.
   *
   * @param entity the account's entity
   * @param id the account's identifier
   * @param entry the account, as its card read it
   * @param preselect the state picked already, asked for by name
   */
  async change(
    entity: EntityDescriptor,
    id: string,
    entry: Entry,
    preselect?: string
  ): Promise<void> {
    const { ctx } = this;
    const t = ctx.t;
    /** A key of the catalogue, or nothing when it has none for this state */
    const known = (key: string): string | undefined => {
      const shown = t(key);
      return shown === key ? undefined : shown;
    };
    const attribute = entity.accountStatus;
    const states = attribute
      ? entity.schema.attributes[attribute]?.states
      : undefined;
    if (!attribute || !states) return;
    const { language } = ctx.translator();
    const label = (state: string): string =>
      pointerLabel(ctx.entities(), states[state], language) ??
      stateLabel(ctx.translator(), state);

    const stored = [entryValue(entry, attribute) ?? []].flat()[0];
    const current = Object.keys(states).find(
      state =>
        stored !== undefined &&
        comparableDn(states[state]) === comparableDn(String(stored))
    );
    const currentName = current
      ? label(current)
      : stored === undefined
        ? undefined
        : (pointerLabel(ctx.entities(), String(stored), language) ??
          rdnValue(String(stored)));
    const offered = Object.keys(states).filter(state => state !== current);
    const described = await this.descriptions(states);
    const help = (state: string): string | undefined =>
      described[state] ?? known(`status.help.${state}`);
    const name = ctx.personName(entity, entry, id);

    ctx.panel.open(t('status.panelTitle', { name }), body => {
      render(
        body,
        html`
        <form class="dc-form">
          ${
            currentName
              ? html`<p class="dc-hint" data-current-state>${t(
                  'status.current',
                  { state: currentName }
                )}</p>`
              : ''
          }
          <fieldset class="dc-form-group">
            <legend>${t('status.choose')}</legend>
            ${offered.map(state => {
              const field = `dc-state-${state}`;
              const line = help(state);
              return html`
              <div class="dc-field dc-state-choice">
                <input type="radio" id="${field}" name="dc-state"
                  value="${state}"${
                    line ? html` aria-describedby="${field}-help"` : ''
                  } />
                <label for="${field}">${label(state)}</label>
                ${
                  line
                    ? html`<p id="${field}-help" class="dc-hint">${line}</p>`
                    : ''
                }
              </div>`;
            })}
          </fieldset>
          <div class="dc-form-actions">
            <button type="button" class="dc-button" data-cancel>${t(
              'app.cancel'
            )}</button>
            <button type="submit" class="dc-button dc-button-primary" disabled>${t(
              'status.apply'
            )}</button>
          </div>
        </form>`
      );

      const submit = body.querySelector<HTMLButtonElement>(
        'button[type="submit"]'
      );
      const chosen = (): string | undefined =>
        body.querySelector<HTMLInputElement>('input[name="dc-state"]:checked')
          ?.value;
      // Picking a state, by click or arrow key, only names the button: the
      // button writes.
      for (const radio of Array.from(
        body.querySelectorAll<HTMLInputElement>('input[name="dc-state"]')
      )) {
        radio.addEventListener('change', () => {
          const state = chosen();
          if (!submit || !state) return;
          submit.disabled = false;
          submit.textContent =
            known(`status.action.${state}`) ?? t('status.apply');
        });
      }
      body
        .querySelector('[data-cancel]')
        ?.addEventListener('click', () => ctx.panel.close());
      body.querySelector('form')?.addEventListener('submit', event => {
        event.preventDefault();
        const state = chosen();
        if (state)
          background(
            () => this.set(entity, id, state, name, label(state)),
            'setStatus',
            ctx.report
          );
      });
    });
    // Asked for by name, from the deletion's tip: picked, and focused, but
    // still written only by the button.
    if (!preselect) return;
    const picked = Array.from(
      ctx.panel
        .parts()
        .body?.querySelectorAll<HTMLInputElement>('input[name="dc-state"]') ??
        []
    ).find(radio => radio.value === preselect);
    if (picked) {
      picked.checked = true;
      picked.dispatchEvent(new Event('change'));
      picked.focus();
    }
  }

  /**
   * Move the accounts selected to one state, one after the other, the
   * panel counting them as it goes; those refused are listed, with why.
   *
   * @param entity the entity listed
   * @param selected the accounts selected, by identifier
   * @returns whether any account changed state, once the panel is closed
   */
  async changeMany(
    entity: EntityDescriptor,
    selected: [string, Entry][]
  ): Promise<boolean> {
    const { ctx } = this;
    const t = ctx.t;
    const known = (key: string): string | undefined => {
      const shown = t(key);
      return shown === key ? undefined : shown;
    };
    const attribute = entity.accountStatus;
    const states = attribute
      ? entity.schema.attributes[attribute]?.states
      : undefined;
    if (!states) return false;
    const { kept, leftOut } = bulkWritable(
      ctx.rights(),
      ctx.translator(),
      entity,
      selected
    );
    if (!kept.length) {
      if (leftOut) ctx.toast(leftOut, true);
      return false;
    }
    const { language } = ctx.translator();
    const label = (state: string): string =>
      pointerLabel(ctx.entities(), states[state], language) ??
      stateLabel(ctx.translator(), state);
    const address =
      typeof window === 'undefined' ? undefined : window.location.hash;
    const described = await this.descriptions(states);
    // Gone elsewhere, or another panel opened, while the states were read:
    // not opened over it.
    if (
      (typeof window !== 'undefined' && window.location.hash !== address) ||
      ctx.panel.isOpen()
    )
      return false;
    const total = kept.length;
    ctx.panel.open(t('bulk.stateTitle', { count: total }), body => {
      render(
        body,
        html`
          <form class="dc-form">
            ${leftOut ? html`<p class="dc-hint">${leftOut}</p>` : ''}
            <fieldset class="dc-form-group" data-bulk-states>
              <legend>${t('status.choose')}</legend>
              ${Object.keys(states).map(state => {
                const field = `dc-state-${state}`;
                const line = described[state] ?? known(`status.help.${state}`);
                return html`
                <div class="dc-field dc-state-choice">
                  <input type="radio" id="${field}" name="dc-state"
                    value="${state}"${
                      line ? html` aria-describedby="${field}-help"` : ''
                    } />
                  <label for="${field}">${label(state)}</label>
                  ${
                    line
                      ? html`<p id="${field}-help" class="dc-hint">${line}</p>`
                      : ''
                  }
                </div>`;
              })}
            </fieldset>
            <div data-bulk-progress hidden>
              <p class="dc-hint" role="status"></p>
              <div class="dc-progress" role="progressbar" aria-valuemin="0"
                aria-valuemax="${total}" aria-valuenow="0">
                <div class="dc-progress-bar"></div>
              </div>
            </div>
            <div class="dc-form-actions">
              <button type="button" class="dc-button" data-cancel>${t(
                'app.cancel'
              )}</button>
              <button type="submit" class="dc-button dc-button-primary" disabled>${t(
                'status.apply'
              )}</button>
            </div>
          </form>`
      );
    });
    if (!ctx.panel.isOpen()) return false;
    const action = bulkPanel(ctx.panel);
    const body = ctx.panel.parts().body;
    if (!body) return action.settled;
    const submit = body.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    );
    const cancel = body.querySelector<HTMLButtonElement>('[data-cancel]');
    const fieldset =
      body.querySelector<HTMLFieldSetElement>('[data-bulk-states]');
    const progress = body.querySelector<HTMLElement>('[data-bulk-progress]');
    const count = (done: number): void => {
      if (!progress) return;
      progress.hidden = false;
      const line = progress.querySelector<HTMLElement>('[role="status"]');
      if (line) line.textContent = t('bulk.progress', { done, count: total });
      progress
        .querySelector('.dc-progress')
        ?.setAttribute('aria-valuenow', String(done));
      const bar = progress.querySelector<HTMLElement>('.dc-progress-bar');
      if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
    };
    const chosen = (): string | undefined =>
      body.querySelector<HTMLInputElement>('input[name="dc-state"]:checked')
        ?.value;
    let running = false;
    for (const radio of Array.from(
      body.querySelectorAll<HTMLInputElement>('input[name="dc-state"]')
    ))
      radio.addEventListener('change', () => {
        const state = chosen();
        if (!submit || !state || running) return;
        submit.disabled = false;
        submit.textContent =
          known(`status.action.${state}`) ?? t('status.apply');
      });
    cancel?.addEventListener('click', () => ctx.panel.close());
    body.querySelector('form')?.addEventListener('submit', event => {
      event.preventDefault();
      const state = chosen();
      if (!state || running) return;
      running = true;
      if (submit) submit.disabled = true;
      if (cancel) cancel.disabled = true;
      if (fieldset) fieldset.disabled = true;
      action.start();
      background(
        async (): Promise<void> => {
          const refused: string[] = [];
          let done = 0;
          try {
            for (const [id, entry] of kept) {
              if (action.own()) count(done);
              const name = ctx.personName(entity, entry, id);
              try {
                await ctx.api.setStatus(entity, id, state);
              } catch (err) {
                refused.push(`${name}: ${this.refusal(err, entity, name)}`);
              }
              done++;
            }
            if (action.own()) count(done);
          } finally {
            action.finish(done > refused.length);
          }
          const moved = total - refused.length;
          if (moved)
            ctx.toast(
              t('bulk.stateDone', { count: moved, state: label(state) })
            );
          // The panel was taken meanwhile, by another opened over it: a page
          // left does not close work under way (bulkPanel's guard).
          if (!action.own()) return;
          if (!refused.length) {
            ctx.panel.close(true);
            return;
          }
          // Those refused, named with why, in place of the form.
          render(
            body,
            html`
              <div class="dc-form">
                ${leftOut ? html`<p class="dc-hint">${leftOut}</p>` : ''}
                <p>${t('bulk.refused', { count: refused.length })}</p>
                <ul class="dc-confirm-items">${refused.map(
                  line => html`<li>${line}</li>`
                )}</ul>
                <div class="dc-form-actions">
                  <button type="button" class="dc-button dc-button-primary" data-close>${t(
                    'app.close'
                  )}</button>
                </div>
              </div>`
          );
          body
            .querySelector('[data-close]')
            ?.addEventListener('click', () => ctx.panel.close(true));
        },
        'bulkChangeState',
        ctx.report
      );
    });
    return action.settled;
  }

  /**
   * What each state means, as the reference entry it points at describes it:
   * the deployment's own words before the catalogue's. A list that cannot be
   * read leaves the catalogue's.
   *
   * @param states the states, as the schema declares them
   * @returns the descriptions, by state, of the entries that have one
   */
  private async descriptions(
    states: Record<string, string>
  ): Promise<Record<string, string>> {
    const described: Record<string, string> = {};
    const parent = parentOf(Object.values(states)[0] ?? '');
    const owner = parent
      ? this.ctx
          .entities()
          .find(
            candidate =>
              candidate.base &&
              comparableDn(candidate.base) === comparableDn(parent)
          )
      : undefined;
    if (!owner) return described;
    let entries: Record<string, Entry>;
    try {
      entries = await this.ctx.api.list(owner);
    } catch {
      return described;
    }
    for (const [state, dn] of Object.entries(states)) {
      const key = rdnValue(dn).toLowerCase();
      const found = Object.entries(entries).find(
        ([id]) => id.toLowerCase() === key
      )?.[1];
      const text = [entryValue(found, 'description') ?? []].flat()[0];
      if (text && String(text).trim()) described[state] = String(text).trim();
    }
    return described;
  }

  /** Write a state chosen in the panel, and say whose it now is. */
  private async set(
    entity: EntityDescriptor,
    id: string,
    state: string,
    name: string,
    label: string
  ): Promise<void> {
    const { ctx } = this;
    try {
      await ctx.api.setStatus(entity, id, state);
      ctx.panel.close();
      ctx.toast(ctx.t('status.changedFor', { name, state: label }));
      await ctx.refresh();
    } catch (err) {
      ctx.toast(this.refusal(err, entity, name), true);
    }
  }

  /**
   * A refusal of an account's state in the interface's language (see
   * {@link explainRefusal}), as the console says one of any entry.
   *
   * @param err what the request threw
   * @param entity the account's entity
   * @param name the account, as the panel names it
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
