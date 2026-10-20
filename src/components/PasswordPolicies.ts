/**
 * Password policies: the table of them, and the form editing one.
 *
 * A policy is OpenLDAP's, an entry of ppolicy attributes that ldap-rest's
 * `core/ldap/passwordPolicy` serves typed. Unlike the entities, it comes with
 * no schema: the attributes are the overlay's, so the product names them.
 *
 * @module browser/directory-console/components/PasswordPolicies
 */

import { escapeHtml } from '../shared/dom';
import type { Translator } from '../i18n';
import type { PasswordPolicy } from '../types';

type FieldKind = 'duration' | 'integer' | 'quality' | 'boolean' | 'text';

interface PolicyField {
  name: string;
  kind: FieldKind;
  /** What the overlay does when the attribute is absent, for a boolean */
  unset?: boolean;
  /** The unit an empty duration is typed in */
  unit?: DurationUnit;
}

/** The attributes the form edits, in the order it shows them. */
export const POLICY_GROUPS: { key: string; fields: PolicyField[] }[] = [
  {
    key: 'expiry',
    fields: [
      { name: 'pwdMaxAge', kind: 'duration', unit: 'days' },
      { name: 'pwdExpireWarning', kind: 'duration', unit: 'days' },
      { name: 'pwdGraceAuthNLimit', kind: 'integer' },
      { name: 'pwdGraceExpiry', kind: 'duration', unit: 'days' },
      { name: 'pwdMaxIdle', kind: 'duration', unit: 'days' },
      { name: 'pwdMinAge', kind: 'duration', unit: 'hours' },
    ],
  },
  {
    key: 'quality',
    fields: [
      { name: 'pwdMinLength', kind: 'integer' },
      { name: 'pwdMaxLength', kind: 'integer' },
      { name: 'pwdInHistory', kind: 'integer' },
      { name: 'pwdCheckQuality', kind: 'quality' },
      { name: 'pwdUseCheckModule', kind: 'boolean', unset: false },
      { name: 'pwdCheckModuleArg', kind: 'text' },
    ],
  },
  {
    key: 'lockout',
    fields: [
      { name: 'pwdLockout', kind: 'boolean', unset: false },
      { name: 'pwdMaxFailure', kind: 'integer' },
      { name: 'pwdLockoutDuration', kind: 'duration', unit: 'minutes' },
      { name: 'pwdFailureCountInterval', kind: 'duration', unit: 'minutes' },
      { name: 'pwdMaxRecordedFailure', kind: 'integer' },
      { name: 'pwdMinDelay', kind: 'duration', unit: 'seconds' },
      { name: 'pwdMaxDelay', kind: 'duration', unit: 'seconds' },
    ],
  },
  {
    key: 'changes',
    fields: [
      { name: 'pwdMustChange', kind: 'boolean', unset: false },
      { name: 'pwdAllowUserChange', kind: 'boolean', unset: true },
      { name: 'pwdSafeModify', kind: 'boolean', unset: false },
    ],
  },
];

/** Shown, never written: the server refuses them. */
const READ_ONLY = ['pwdAttribute', 'pwdCheckModule'];

/** Attributes whose hint says what an empty field means. */
const HINTED = ['pwdMaxAge', 'pwdLockoutDuration', 'pwdCheckModuleArg'];

export type DurationUnit = 'days' | 'hours' | 'minutes' | 'seconds';

const UNITS: [DurationUnit, number][] = [
  ['days', 86400],
  ['hours', 3600],
  ['minutes', 60],
  ['seconds', 1],
];

/**
 * A duration in the largest unit that holds it exactly: 31536000 seconds is
 * 365 days, 90 seconds stays 90 seconds. 0 is in any unit: in `zero`'s.
 */
export function splitDuration(
  seconds: number,
  zero: DurationUnit = 'seconds'
): {
  amount: number;
  unit: DurationUnit;
} {
  if (seconds === 0) return { amount: 0, unit: zero };
  for (const [unit, size] of UNITS)
    if (seconds >= size && seconds % size === 0)
      return { amount: seconds / size, unit };
  return { amount: seconds, unit: 'seconds' };
}

/** Seconds in a unit. */
export function unitSeconds(unit: string): number {
  return UNITS.find(([name]) => name === unit)?.[1] ?? 1;
}

/** A duration in words: "365 days", "2 minutes". */
export function durationText(translator: Translator, seconds: number): string {
  const { amount, unit } = splitDuration(seconds);
  return translator.t(`policy.duration.${unit}`, { count: amount });
}

/**
 * The value a field holds, as the server takes it: `null` for an empty
 * field, which removes the attribute.
 *
 * @param kind the kind of the field
 * @param raw what the reader typed or picked
 * @param unit the unit picked next to a duration
 * @returns the value, or `undefined` when it is not one the field accepts
 */
export function fieldValue(
  kind: FieldKind,
  raw: string,
  unit?: string
): number | boolean | string | null | undefined {
  if (kind === 'text') return raw.trim() ? raw : null;
  const typed = raw.trim();
  if (typed === '') return null;
  if (kind === 'boolean') return typed === 'TRUE';
  if (!/^\d+$/.test(typed)) return undefined;
  const value = Number(typed);
  if (kind === 'quality') return value <= 2 ? value : undefined;
  return kind === 'duration' ? value * unitSeconds(unit ?? 'seconds') : value;
}

/**
 * What to send to change a policy: the attributes whose value differs from
 * the one it holds, `null` for one to remove.
 *
 * @param current the policy as served
 * @param wanted every edited attribute, `null` when its field is empty
 */
export function policyChanges(
  current: Record<string, unknown>,
  wanted: Record<string, unknown>
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(wanted))
    if (value !== (current[name] ?? null)) changes[name] = value;
  return changes;
}

/** How a policy locks accounts out, in words. */
export function lockoutText(
  translator: Translator,
  policy: PasswordPolicy
): string {
  if (policy.pwdLockout !== true) return translator.t('policy.noLockout');
  const failures =
    typeof policy.pwdMaxFailure === 'number' ? policy.pwdMaxFailure : 0;
  const after = translator.t('policy.lockoutAfter', { count: failures });
  const duration =
    typeof policy.pwdLockoutDuration === 'number'
      ? policy.pwdLockoutDuration
      : 0;
  return translator.t('policy.lockoutFor', {
    after,
    duration: duration
      ? durationText(translator, duration)
      : translator.t('policy.untilUnlocked'),
  });
}

/** The table of the policies. */
export function policyTableMarkup(
  translator: Translator,
  policies: PasswordPolicy[]
): string {
  const t = (key: string, values?: Record<string, string | number>): string =>
    translator.t(key, values);
  if (policies.length === 0)
    return `<p class="dc-empty">${escapeHtml(t('policy.empty'))}</p>`;
  return `
    <div class="dc-table-scroll">
      <table class="dc-table dc-policy-table">
        <thead>
          <tr>
            <th>${escapeHtml(t('policy.name'))}</th>
            <th>${escapeHtml(t('policy.column.maxAge'))}</th>
            <th>${escapeHtml(t('policy.column.minLength'))}</th>
            <th>${escapeHtml(t('policy.column.lockout'))}</th>
          </tr>
        </thead>
        <tbody>
          ${policies
            .map(policy => {
              const maxAge =
                typeof policy.pwdMaxAge === 'number' ? policy.pwdMaxAge : 0;
              return `<tr data-policy="${escapeHtml(policy.cn)}" tabindex="0">
                <td>${escapeHtml(policy.cn)}${
                  policy.isDefault
                    ? ` <span class="dc-tag">${escapeHtml(t('policy.default'))}</span>`
                    : ''
                }</td>
                <td>${escapeHtml(
                  maxAge ? durationText(translator, maxAge) : t('policy.never')
                )}</td>
                <td>${escapeHtml(
                  typeof policy.pwdMinLength === 'number'
                    ? String(policy.pwdMinLength)
                    : '—'
                )}</td>
                <td>${escapeHtml(lockoutText(translator, policy))}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

export interface PolicyFormOptions {
  translator: Translator;
  /** The policy to edit; none to create one */
  policy?: PasswordPolicy;
  canDelete: boolean;
  /**
   * Send the form: the name and every attribute to set for a new policy,
   * the changed attributes for an existing one
   */
  onSave(cn: string, values: Record<string, unknown>): Promise<void>;
  onDelete(): void;
  onCancel(): void;
}

export class PolicyForm {
  private readonly options: PolicyFormOptions;
  private container: HTMLElement | null = null;

  constructor(options: PolicyFormOptions) {
    this.options = options;
  }

  render(container: HTMLElement): void {
    this.container = container;
    const { translator, policy, canDelete } = this.options;
    const t = (key: string, values?: Record<string, string | number>): string =>
      translator.t(key, values);
    const fixed = READ_ONLY.filter(name => policy?.[name] !== undefined);

    container.innerHTML = `
      <form class="dc-form dc-policy-form" novalidate>
        ${
          policy
            ? ''
            : `<div class="dc-field" data-field="cn">
                <label for="dc-policy-cn">${escapeHtml(t('policy.name'))} <span class="dc-required">*</span></label>
                <input id="dc-policy-cn" class="dc-input" type="text" autocomplete="off" />
                <p class="dc-error" data-error hidden></p>
              </div>`
        }
        ${POLICY_GROUPS.map(
          group => `
          <fieldset class="dc-form-group">
            <legend>${escapeHtml(t(`policy.group.${group.key}`))}</legend>
            ${group.fields.map(field => this.fieldMarkup(field)).join('')}
          </fieldset>`
        ).join('')}
        ${
          fixed.length
            ? `<fieldset class="dc-form-group">
                <legend>${escapeHtml(t('policy.group.directory'))}</legend>
                <dl class="dc-policy-fixed">
                  ${fixed
                    .map(
                      name => `<dt>${escapeHtml(t(`policy.attr.${name}`))}</dt>
                        <dd><code>${escapeHtml(String(policy?.[name]))}</code></dd>`
                    )
                    .join('')}
                </dl>
              </fieldset>`
            : ''
        }
        <div class="dc-form-actions">
          ${
            policy && canDelete && !policy.isDefault
              ? `<button type="button" class="dc-button dc-button-danger" data-delete>${escapeHtml(
                  t('app.delete')
                )}</button>`
              : ''
          }
          <button type="button" class="dc-button" data-cancel>${escapeHtml(
            t('app.cancel')
          )}</button>
          <button type="submit" class="dc-button dc-button-primary">${escapeHtml(
            t(policy ? 'app.save' : 'app.create')
          )}</button>
        </div>
      </form>`;

    container
      .querySelector('[data-cancel]')
      ?.addEventListener('click', () => this.options.onCancel());
    container
      .querySelector('[data-delete]')
      ?.addEventListener('click', () => this.options.onDelete());
    container.querySelector('form')?.addEventListener('submit', event => {
      event.preventDefault();
      void this.submit();
    });
  }

  private fieldMarkup(field: PolicyField): string {
    const { translator, policy } = this.options;
    const t = (key: string, values?: Record<string, string | number>): string =>
      translator.t(key, values);
    const id = `dc-policy-${field.name}`;
    const current = policy?.[field.name];
    const hint = HINTED.includes(field.name)
      ? `<p class="dc-hint">${escapeHtml(t(`policy.hint.${field.name}`))}</p>`
      : '';
    return `
      <div class="dc-field" data-field="${escapeHtml(field.name)}">
        <label for="${id}">${escapeHtml(t(`policy.attr.${field.name}`))}
          <code class="dc-policy-attribute">${escapeHtml(field.name)}</code></label>
        ${this.controlMarkup(field, id, current)}
        ${hint}
        <p class="dc-error" data-error hidden></p>
      </div>`;
  }

  private controlMarkup(
    field: PolicyField,
    id: string,
    current: unknown
  ): string {
    const t = (key: string, values?: Record<string, string | number>): string =>
      this.options.translator.t(key, values);
    const option = (value: string, label: string, selected: boolean): string =>
      `<option value="${value}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;

    switch (field.kind) {
      case 'boolean':
        return `<select id="${id}" class="dc-input">
          ${option(
            '',
            t('policy.boolean.unset', {
              value: t(
                field.unset ? 'policy.boolean.yes' : 'policy.boolean.no'
              ),
            }),
            current === undefined
          )}
          ${option('TRUE', t('policy.boolean.yes'), current === true)}
          ${option('FALSE', t('policy.boolean.no'), current === false)}
        </select>`;
      case 'quality':
        return `<select id="${id}" class="dc-input">
          ${option('', t('policy.quality.unset'), current === undefined)}
          ${[0, 1, 2]
            .map(level =>
              option(
                String(level),
                t(`policy.quality.${level}`),
                current === level
              )
            )
            .join('')}
        </select>`;
      case 'text':
        return `<textarea id="${id}" class="dc-input dc-policy-text" rows="6"
          spellcheck="false">${escapeHtml(
            typeof current === 'string' ? current : ''
          )}</textarea>`;
      case 'duration': {
        const split =
          typeof current === 'number'
            ? splitDuration(current, field.unit)
            : undefined;
        return `<div class="dc-policy-duration">
          <input id="${id}" class="dc-input" type="number" min="0" step="1"
            inputmode="numeric" value="${split ? split.amount : ''}" />
          <select class="dc-input" data-unit
            aria-label="${escapeHtml(t('policy.unit'))}">
            ${UNITS.map(([unit]) =>
              option(
                unit,
                t(`policy.unit.${unit}`),
                unit === (split?.unit ?? field.unit ?? 'days')
              )
            ).join('')}
          </select>
        </div>`;
      }
      default:
        return `<input id="${id}" class="dc-input" type="number" min="0" step="1"
          inputmode="numeric" value="${
            typeof current === 'number' ? current : ''
          }" />`;
    }
  }

  /** Read the form, or show what is wrong in it and read nothing. */
  private read(): { cn: string; wanted: Record<string, unknown> } | null {
    const container = this.container;
    if (!container) return null;
    const t = (key: string): string => this.options.translator.t(key);
    let valid = true;
    const fail = (name: string, message: string): void => {
      valid = false;
      const error = container.querySelector<HTMLElement>(
        `[data-field="${name}"] [data-error]`
      );
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
    };
    for (const error of Array.from(
      container.querySelectorAll<HTMLElement>('[data-error]')
    ))
      error.hidden = true;

    const cn = this.options.policy
      ? this.options.policy.cn
      : (
          container.querySelector<HTMLInputElement>('#dc-policy-cn')?.value ||
          ''
        ).trim();
    if (!cn) fail('cn', t('policy.error.name'));

    const wanted: Record<string, unknown> = {};
    for (const group of POLICY_GROUPS)
      for (const field of group.fields) {
        const control = container.querySelector<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >(`#dc-policy-${field.name}`);
        if (!control) continue;
        const unit = container.querySelector<HTMLSelectElement>(
          `[data-field="${field.name}"] [data-unit]`
        )?.value;
        const value = fieldValue(field.kind, control.value, unit);
        if (value === undefined) fail(field.name, t('policy.error.integer'));
        else wanted[field.name] = value;
      }
    return valid ? { cn, wanted } : null;
  }

  private async submit(): Promise<void> {
    const read = this.read();
    if (!read) return;
    const { policy } = this.options;
    const values = policy
      ? policyChanges(policy, read.wanted)
      : Object.fromEntries(
          Object.entries(read.wanted).filter(([, value]) => value !== null)
        );
    if (policy && Object.keys(values).length === 0) {
      this.options.onCancel();
      return;
    }
    await this.options.onSave(read.cn, values);
  }
}
