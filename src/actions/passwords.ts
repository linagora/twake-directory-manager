/**
 * Passwords: the reset of an account's, and the first one of an account
 * created without one, a generated password shown once in the panel that
 * asked for it (#220).
 *
 * @module twake-directory-manager/actions/passwords
 */

import { roleAttribute } from '../api/ConsoleApiClient';
import type { ConsoleContext } from '../console/context';
import { background } from '../shared/background';
import { html, render } from '../shared/html';
import type { EntityDescriptor } from '../types';

/**
 * The panels that set a password and show one generated. A class given the
 * context, as a view is (`PoliciesView`): it reaches the console through
 * nothing else. It holds nothing between two resets — what one waits for
 * is the panel's (`ctx.panel`) — so the console makes one, with its
 * context, and asks it each time.
 */
export class PasswordActions {
  /** @param ctx the console, as an action sees it */
  constructor(private readonly ctx: ConsoleContext) {}

  /**
   * Reset a password. A generated one is shown once, in the panel that asked
   * for it: it cannot be read back afterwards. So the panel is sent once and
   * stays while the server answers: closed in the meantime, it had the
   * password shown over whatever opened next, or a typed one close it. Only
   * Cancel closes it then, should the server never answer; a password
   * generated all the same gets a panel of its own.
   *
   * @param entity the account's entity
   * @param id the account's identifier, which the panel names it by
   */
  reset(entity: EntityDescriptor, id: string): void {
    const { ctx } = this;
    const t = ctx.t;
    ctx.panel.open(t('password.title'), body => {
      render(
        body,
        html`
        <form class="dc-form">
          <div class="dc-field">
            <label for="dc-new-password">${t('password.choose')}</label>
            <input id="dc-new-password" class="dc-input" type="password"
              autocomplete="new-password"
              aria-describedby="dc-new-password-hint" />
            <p id="dc-new-password-hint" class="dc-hint">${t('password.generateHint')}</p>
          </div>
          <div class="dc-field dc-field-inline">
            <input id="dc-force-change" type="checkbox" checked />
            <label for="dc-force-change">${t('password.forceChange')}</label>
          </div>
          <div class="dc-form-actions">
            <button type="button" class="dc-button" data-cancel>${t(
              'app.cancel'
            )}</button>
            <button type="submit" class="dc-button dc-button-primary">${t(
              'password.confirmButton'
            )}</button>
          </div>
        </form>`
      );

      const form = body.querySelector('form');
      const send = body.querySelector<HTMLButtonElement>(
        'button[type="submit"]'
      );
      let pending = false;
      body
        .querySelector('[data-cancel]')
        ?.addEventListener('click', () => ctx.panel.close(pending));
      // Whether the panel still holds this form; a guard it set is its own.
      const own = (): boolean => !!form?.isConnected;
      form?.addEventListener('submit', event => {
        event.preventDefault();
        // A second reset would answer another password, and the one shown
        // might not be the one the server kept.
        if (pending) return;
        pending = true;
        if (send) send.disabled = true;
        // Tied to the request, not set for good: a confirmation asked over
        // the panel meanwhile gives this guard back once it is answered.
        ctx.panel.setGuard((): boolean => !pending);
        const password =
          body.querySelector<HTMLInputElement>('#dc-new-password')?.value || '';
        const force =
          body.querySelector<HTMLInputElement>('#dc-force-change')?.checked ??
          true;
        background(
          () =>
            ctx.api
              .resetPassword(entity, id, password || undefined, force)
              .then(result => {
                pending = false;
                const generated = result.generated
                  ? result.password
                  : undefined;
                if (own()) {
                  ctx.panel.setGuard(null);
                  if (generated)
                    this.show(body, id, generated, result.forceChange ?? force);
                  else {
                    ctx.panel.close();
                    ctx.toast(t('password.set'));
                  }
                  return;
                }
                // Shut by force all the same: the password, the only copy there
                // is, gets a panel of its own rather than none, once the panel
                // opened meanwhile, if any, is closed: replaced, it lost what it
                // held, another password perhaps.
                if (!generated) {
                  ctx.toast(t('password.set'));
                  return;
                }
                ctx.panel.whenFree(() =>
                  ctx.panel.open(t('password.title'), inner =>
                    this.show(inner, id, generated, force)
                  )
                );
              })
              .catch((err: Error) => {
                pending = false;
                if (send) send.disabled = false;
                if (own()) ctx.panel.setGuard(null);
                ctx.toast(err.message, true);
              }),
          'api.resetPassword',
          ctx.report
        );
      });
    });
  }

  /**
   * A first password for an account just created without one: generated
   * and shown in the form's panel, as Reset password shows one, before the
   * account's card opens. An account created empty could not be signed in
   * to, and only a call from its owner said so.
   *
   * The panel may have been closed, or given to another form, while the
   * server answered: the password, the only copy there is, then gets a
   * panel of its own, once the one open meanwhile is closed, and the card is
   * not opened over where the administrator went.
   *
   * @param entity the entity created
   * @param values what the form sent
   * @param id the new entry, empty when the server named none
   * @param next what the creation does once the panel is closed
   * @param own whether the panel still holds the form
   * @returns whether the form's panel now shows a password, and stays
   */
  async give(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    id: string,
    next: () => void,
    own: () => boolean = () => true
  ): Promise<boolean> {
    const { ctx } = this;
    const field = entity.password;
    if (!field || [values[field] ?? []].flat().some(Boolean)) return false;
    const name = ctx.submittedName(entity, values, id);
    if (!id) {
      ctx.toast(ctx.t('create.noPassword', { name }), true);
      return false;
    }
    const reset = roleAttribute(entity.schema, 'passwordReset');
    // A generated password is meant to be changed, unless told otherwise.
    const force =
      !reset || String([values[reset] ?? []].flat()[0] ?? '') !== 'FALSE';
    const address =
      typeof window === 'undefined' ? undefined : window.location.hash;
    let result: {
      generated: boolean;
      password?: string;
      forceChange?: boolean;
    };
    try {
      result = await ctx.api.resetPassword(entity, id, undefined, force);
    } catch {
      ctx.toast(ctx.t('create.noPassword', { name }), true);
      return false;
    }
    const password = result.password;
    if (!result.generated || !password) return false;
    // What the server did, not what was asked: an entity with no reset
    // attribute flags nothing.
    const mustChange = result.forceChange ?? force;
    const body = ctx.panel.parts().body;
    if (own() && body) {
      ctx.panel.setDirty(null);
      // Its card, unless the administrator has gone elsewhere since.
      ctx.panel.afterClose(() => {
        if (typeof window === 'undefined' || window.location.hash === address)
          next();
      });
      this.show(body, name, password, mustChange);
      return true;
    }
    ctx.panel.whenFree(() =>
      ctx.panel.open(ctx.t('password.title'), inner =>
        this.show(inner, name, password, mustChange)
      )
    );
    return true;
  }

  /**
   * The password the server generated, in place of the form that asked for
   * it. It is the one value the console cannot fetch again: a toast lost it
   * to the click that began selecting it, and to the next message. So it
   * stays until the panel is closed on purpose, and closing it uncopied asks
   * first, in the panel rather than in a native dialog.
   *
   * @param body the panel's body, the Reset password form's or a new one's
   * @param name the account, as the panel names it
   * @param password the generated password
   * @param mustChange whether a change is required at the next sign-in
   */
  private show(
    body: HTMLElement,
    name: string,
    password: string,
    mustChange: boolean
  ): void {
    const { ctx } = this;
    const t = ctx.t;
    const heading = ctx.panel.parts().heading;
    if (heading) heading.textContent = t('password.generatedTitle', { name });
    const help = [
      t('password.generatedHelp', { name }),
      ...(mustChange ? [t('password.mustChange')] : []),
    ].join(' ');
    render(
      body,
      html`
      <div class="dc-form">
        <div class="dc-field">
          <div class="dc-generated">
            <input id="dc-generated-password" class="dc-input dc-generated-password"
              readonly value="${password}"
              aria-labelledby="dc-panel-title"
              aria-describedby="dc-generated-password-help" />
            <button type="button" class="dc-button" data-copy-password>${t(
              'detail.copy'
            )}</button>
          </div>
          <p id="dc-generated-password-help" class="dc-hint">${help}</p>
        </div>
        <div class="dc-generated-leave" data-leave hidden>
          <p>${t('password.leaveUncopied')}</p>
          <button type="button" class="dc-button" data-leave-back>${t(
            'app.back'
          )}</button>
          <button type="button" class="dc-button dc-button-primary" data-leave-close>${t(
            'app.close'
          )}</button>
        </div>
        <div class="dc-form-actions" data-done-actions>
          <button type="button" class="dc-button dc-button-primary" data-done>${t(
            'password.done'
          )}</button>
        </div>
      </div>`
    );

    const field = body.querySelector<HTMLInputElement>(
      '#dc-generated-password'
    );
    const leave = body.querySelector<HTMLElement>('[data-leave]');
    const done = body.querySelector<HTMLElement>('[data-done-actions]');
    let copied = false;
    // Asked once per attempt to close: a second Escape, or Close, goes.
    const ask = (shown: boolean): void => {
      if (leave) leave.hidden = !shown;
      if (done) done.hidden = shown;
    };
    ctx.panel.setGuard((): boolean => {
      if (copied || (leave && !leave.hidden)) return true;
      ask(true);
      body.querySelector<HTMLElement>('[data-leave-close]')?.focus();
      return false;
    });

    field?.addEventListener('focus', () => field.select());
    const copy = body.querySelector<HTMLElement>('[data-copy-password]');
    copy?.addEventListener('click', () => {
      // Absent outside a secure context, or refused: the password is
      // selected for the reader to copy by hand.
      const said = (key: string): void => {
        copy.textContent = t(key);
        setTimeout(() => {
          copy.textContent = t('detail.copy');
        }, 2000);
      };
      const failed = (): void => {
        field?.focus();
        field?.select();
        said('password.copyFailed');
      };
      if (!navigator.clipboard) return failed();
      navigator.clipboard.writeText(password).then(() => {
        copied = true;
        ask(false);
        said('detail.copied');
      }, failed);
    });
    body
      .querySelector('[data-done]')
      ?.addEventListener('click', () => ctx.panel.close());
    body.querySelector('[data-leave-back]')?.addEventListener('click', () => {
      ask(false);
      field?.focus();
    });
    body
      .querySelector('[data-leave-close]')
      ?.addEventListener('click', () => ctx.panel.close(true));
    // Said by a screen reader with its name and its help, from the field.
    field?.focus();
  }
}
