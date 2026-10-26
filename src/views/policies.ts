/**
 * The password policies page: the table of the policies, and the panel that
 * creates, edits and deletes one. The first view moved out of
 * `DirectoryConsole` (#220), and the pattern of the others.
 *
 * @module twake-directory-manager/views/policies
 */

import { PolicyForm, policyTableMarkup } from '../components/PasswordPolicies';
import type { ConsoleContext } from '../console/context';
import { explainRefusal, readFailure } from '../format';
import { background } from '../shared/background';
import { html, render } from '../shared/html';
import type { PasswordPolicy } from '../types';

/**
 * The page of `#/password-policies`, drawn for a caller who manages them.
 * It holds nothing between two drawings: the console makes one each time it
 * draws the page.
 */
export class PoliciesView {
  /** @param ctx the console, as a view sees it */
  constructor(private readonly ctx: ConsoleContext) {}

  /**
   * Draw the table of the password policies.
   *
   * @param main the console's main area
   * @param generation the ticket of the page, checked after each `await`
   */
  async render(main: HTMLElement, generation: number): Promise<void> {
    const { ctx } = this;
    const t = ctx.t;
    ctx.titlePage(t('nav.policies'));
    render(
      main,
      html`
      <section class="dc-view">
        <header class="dc-view-header">
          <h1>${t('nav.policies')}</h1>
          <div class="dc-view-actions">
            <button type="button" class="dc-button dc-button-primary" data-new>${t(
              'policy.new'
            )}</button>
          </div>
        </header>
        <div data-list><p class="dc-empty">${t('app.loading')}</p></div>
      </section>`
    );
    let attributes: string[] | undefined;
    main
      .querySelector('[data-new]')
      ?.addEventListener('click', () => this.openForm(undefined, attributes));

    const holder = main.querySelector<HTMLElement>(
      '[data-list]'
    ) as HTMLElement;
    let policies: PasswordPolicy[];
    try {
      ({ policies, attributes } = await ctx.api.passwordPolicies());
    } catch (err) {
      if (!ctx.current(generation)) return;
      const failure = readFailure(err, ctx.translator());
      render(
        holder,
        html`<p class="dc-empty${
          failure.refused ? '' : ' dc-error-block'
        }">${failure.message}</p>`
      );
      return;
    }
    if (!ctx.current(generation)) return;
    render(holder, policyTableMarkup(ctx.translator(), policies));
    for (const row of Array.from(
      holder.querySelectorAll<HTMLElement>('[data-policy]')
    )) {
      const open = (): void => {
        // Opened from anywhere on the row, the panel gives the focus back to
        // the name's button when it closes, not to the page.
        row.querySelector<HTMLElement>('[data-policy-open]')?.focus();
        const policy = policies.find(item => item.cn === row.dataset.policy);
        if (policy) this.openForm(policy, attributes);
      };
      // The name is a button whose click, pressed or keyed, bubbles here.
      // Opening on the row's keydown let the same Enter reach the panel's
      // form and submit it, closing the panel at once (#207).
      row.addEventListener('click', open);
    }
  }

  /**
   * Create a password policy, or edit one.
   *
   * @param policy the policy to edit; none to create one
   * @param attributes those the directory defines, all when unknown
   */
  private openForm(policy?: PasswordPolicy, attributes?: string[]): void {
    const { ctx } = this;
    const t = ctx.t;
    ctx.panel.open(
      policy
        ? t('policy.title.edit', { name: policy.cn })
        : t('policy.title.new'),
      body => {
        const form: PolicyForm = new PolicyForm({
          report: ctx.report,
          translator: ctx.translator(),
          policy,
          attributes,
          canDelete: ctx.rights().canDelete(),
          onSave: async (cn, values): Promise<void> => {
            try {
              if (policy) await ctx.api.updatePasswordPolicy(cn, values);
              else await ctx.api.createPasswordPolicy(cn, values);
            } catch (err) {
              // A new policy conflicts with nothing but one of its name.
              if (!policy && (err as { status?: number }).status === 409)
                form.refuse('cn', t('policy.error.taken', { name: cn }));
              else ctx.toast(this.refusal(err, cn), true);
              return;
            }
            ctx.panel.close(true);
            ctx.toast(t(policy ? 'policy.saved' : 'policy.created'));
            await ctx.refresh();
          },
          onDelete: (): void =>
            background(
              () => this.delete(policy as PasswordPolicy),
              'deletePolicy',
              ctx.report
            ),
          onCancel: (): void => ctx.panel.close(),
        });
        form.render(body);
        ctx.panel.guardDiscard(body, () => form.isDirty());
      },
      false,
      true
    );
  }

  /** Delete a policy, asked first over its form. */
  private async delete(policy: PasswordPolicy): Promise<void> {
    const { ctx } = this;
    const t = ctx.t;
    // Asked over the policy's form, which comes back as it was on Cancel.
    if (
      !(await ctx.dialog.confirm({
        title: t('policy.deleteTitle', { name: policy.cn }),
        lines: [t('delete.irreversible')],
        action: t('policy.deleteButton'),
      }))
    )
      return;
    try {
      await ctx.api.deletePasswordPolicy(policy.cn);
    } catch (err) {
      // The server's refusal names the DN, in English: say it in words.
      ctx.toast(
        (err as { status?: number }).status === 409
          ? t('policy.inUse', { name: policy.cn })
          : this.refusal(err, policy.cn),
        true
      );
      return;
    }
    ctx.panel.close(true);
    ctx.toast(t('policy.deleted'));
    await ctx.refresh();
  }

  /**
   * A refusal of a password policy in the interface's language, as an
   * entry's is said (see {@link explainRefusal}). A policy has no schema
   * the console reads: the server's words name its attributes themselves.
   *
   * @param err what the request threw
   * @param name the policy
   */
  private refusal(err: unknown, name: string): string {
    return explainRefusal(err, { attributes: {} }, this.ctx.translator(), name)
      .message;
  }
}
