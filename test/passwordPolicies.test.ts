/**
 * Tests for the password policy screen.
 */
import { expect } from 'chai';
import nock from 'nock';

import { ConsoleApiClient } from '../src/api/ConsoleApiClient';
import { DirectoryConsole } from '../src/DirectoryConsole';
import {
  POLICY_GROUPS,
  PolicyForm,
  durationText,
  fieldValue,
  lockoutText,
  policyChanges,
  policyTableMarkup,
  splitDuration,
} from '../src/components/PasswordPolicies';
import { availableLanguages, Translator } from '../src/i18n';
import type { PasswordPolicy, Scope } from '../src/types';

const baseUrl = 'http://localhost:8099';
const en = new Translator('en');

const policy: PasswordPolicy = {
  dn: 'cn=default,ou=policies,dc=example,dc=com',
  cn: 'default',
  isDefault: true,
  pwdAttribute: 'userPassword',
  pwdMaxAge: 31536000,
  pwdLockout: true,
  pwdMaxFailure: 3,
  pwdLockoutDuration: 120,
  pwdMinLength: 8,
  pwdCheckModuleArg: 'minQuality 3\nclass-digit 0123456789 0 1 0\n',
};

/** Configuration of a server managing password policies. */
function policyConfig(): nock.Scope {
  return nock(baseUrl)
    .get('/api/v1/config')
    .reply(200, {
      apiPrefix: '/api',
      features: {
        ldapPasswordPolicy: {
          endpoints: { listPolicies: '/api/v1/password-policies' },
        },
      },
    });
}

/** A form control the form reads its value from. */
function control(value: string): { value: string } {
  return { value };
}

/** An error slot, which records what the form says in it. */
function errorSlot(): { textContent: string; hidden: boolean } {
  return { textContent: '', hidden: true };
}

describe('Password policies', () => {
  afterEach(() => nock.cleanAll());

  describe('durations', () => {
    it('should be shown in the largest unit holding them exactly', () => {
      expect(splitDuration(31536000)).to.deep.equal({
        amount: 365,
        unit: 'days',
      });
      expect(splitDuration(7200)).to.deep.equal({ amount: 2, unit: 'hours' });
      expect(splitDuration(120)).to.deep.equal({ amount: 2, unit: 'minutes' });
      expect(splitDuration(90)).to.deep.equal({ amount: 90, unit: 'seconds' });
      expect(splitDuration(0)).to.deep.equal({ amount: 0, unit: 'seconds' });
      expect(splitDuration(0, 'days')).to.deep.equal({
        amount: 0,
        unit: 'days',
      });
      expect(durationText(new Translator('fr'), 86400)).to.equal('1 jour');
    });
  });

  describe('reading a field', () => {
    it('should take an empty field as an attribute to remove', () => {
      expect(fieldValue('integer', ' ')).to.equal(null);
      expect(fieldValue('boolean', '')).to.equal(null);
      expect(fieldValue('text', '\n')).to.equal(null);
    });

    it('should type what it reads', () => {
      expect(fieldValue('integer', '12')).to.equal(12);
      expect(fieldValue('duration', '30', 'days')).to.equal(2592000);
      expect(fieldValue('boolean', 'TRUE')).to.equal(true);
      expect(fieldValue('boolean', 'FALSE')).to.equal(false);
      expect(fieldValue('quality', '2')).to.equal(2);
      // ppm reads its configuration line by line: kept as typed
      expect(fieldValue('text', 'minQuality 3\n')).to.equal('minQuality 3\n');
    });

    it('should refuse what the server would', () => {
      expect(fieldValue('integer', '-1')).to.equal(undefined);
      expect(fieldValue('integer', '1.5')).to.equal(undefined);
      expect(fieldValue('duration', 'ten', 'days')).to.equal(undefined);
      expect(fieldValue('quality', '3')).to.equal(undefined);
    });
  });

  describe('the changes sent', () => {
    it('should name only what differs, null removing an attribute', () => {
      expect(
        policyChanges(policy, {
          pwdMaxAge: 31536000,
          pwdMinLength: 12,
          pwdLockout: null,
          pwdInHistory: null,
        })
      ).to.deep.equal({ pwdMinLength: 12, pwdLockout: null });
    });
  });

  describe('the table', () => {
    it('should sum each policy up', () => {
      const markup = policyTableMarkup(en, [
        policy,
        { dn: 'cn=software', cn: 'software', isDefault: false },
      ]);
      expect(markup).to.include('365 days');
      expect(markup).to.include('After 3 failures, 2 minutes');
      expect(markup).to.include('Never');
      expect(markup).to.include('Off');
      expect(markup.match(/dc-tag/g)).to.have.length(1);
    });

    it('should escape a policy name', () => {
      const markup = policyTableMarkup(en, [
        { dn: 'cn=x', cn: '<img src=x>', isDefault: false },
      ]);
      expect(markup).not.to.include('<img');
    });

    it('should say when a lockout lasts until an unlock', () => {
      expect(
        lockoutText(en, { ...policy, pwdLockoutDuration: undefined })
      ).to.equal('After 3 failures, until unlocked');
    });
  });

  describe('the form', () => {
    /** A form over a container holding these controls. */
    function formWith(
      controls: Record<string, unknown>,
      saved: { cn: string; values: Record<string, unknown> }[],
      edited: PasswordPolicy | null = policy
    ): PolicyForm {
      const form = new PolicyForm({
        translator: en,
        policy: edited ?? undefined,
        canDelete: true,
        onSave: async (cn, values): Promise<void> => {
          saved.push({ cn, values });
        },
        onDelete: () => undefined,
        onCancel: () => undefined,
      });
      form.render({
        innerHTML: '',
        querySelector: (selector: string) => controls[selector] ?? null,
        querySelectorAll: (selector: string) =>
          selector === '[data-error]'
            ? Object.entries(controls)
                .filter(([key]) => key.endsWith('[data-error]'))
                .map(([, value]) => value)
            : [],
      } as unknown as HTMLElement);
      return form;
    }

    const submit = (form: PolicyForm): Promise<void> =>
      (form as unknown as { submit(): Promise<void> }).submit();

    it('should send what changed, in seconds', async () => {
      const saved: { cn: string; values: Record<string, unknown> }[] = [];
      await submit(
        formWith(
          {
            '#dc-policy-pwdMaxAge': control('30'),
            '[data-field="pwdMaxAge"] [data-unit]': control('days'),
            '#dc-policy-pwdLockout': control(''),
            '#dc-policy-pwdMinLength': control('8'),
            '#dc-policy-pwdCheckModuleArg': control(
              policy.pwdCheckModuleArg as string
            ),
          },
          saved
        )
      );
      expect(saved).to.deep.equal([
        { cn: 'default', values: { pwdMaxAge: 2592000, pwdLockout: null } },
      ]);
    });

    it('should send nothing while a field holds a wrong value', async () => {
      const saved: { cn: string; values: Record<string, unknown> }[] = [];
      const error = errorSlot();
      await submit(
        formWith(
          {
            '#dc-policy-pwdMinLength': control('eight'),
            '[data-field="pwdMinLength"] [data-error]': error,
          },
          saved
        )
      );
      expect(saved).to.deep.equal([]);
      expect(error.hidden).to.equal(false);
      expect(error.textContent).to.equal('A whole number, 0 or more');
    });

    it('should create a policy with the fields filled in', async () => {
      const saved: { cn: string; values: Record<string, unknown> }[] = [];
      await submit(
        formWith(
          {
            '#dc-policy-cn': control(' software '),
            '#dc-policy-pwdMaxFailure': control('10'),
            '#dc-policy-pwdMinLength': control(''),
          },
          saved,
          null
        )
      );
      expect(saved).to.deep.equal([
        { cn: 'software', values: { pwdMaxFailure: 10 } },
      ]);
    });

    it('should not offer to delete the default policy', () => {
      const container = { innerHTML: '', querySelector: () => null };
      new PolicyForm({
        translator: en,
        policy,
        canDelete: true,
        onSave: async () => undefined,
        onDelete: () => undefined,
        onCancel: () => undefined,
      }).render(container as unknown as HTMLElement);
      expect(container.innerHTML).not.to.include('data-delete');
      // What the server refuses to write is shown, not offered
      expect(container.innerHTML).to.include('<code>userPassword</code>');
      expect(container.innerHTML).not.to.include('id="dc-policy-pwdAttribute"');
    });
  });

  describe('ConsoleApiClient', () => {
    it('should learn whether the server manages policies', async () => {
      const client = new ConsoleApiClient(baseUrl);
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, { apiPrefix: '/api', features: {} });
      await client.discover();
      expect(client.servesPasswordPolicies).to.equal(false);
      policyConfig();
      await client.discover();
      expect(client.servesPasswordPolicies).to.equal(true);
    });

    it('should list, create, change and delete policies', async () => {
      const client = new ConsoleApiClient(baseUrl);
      policyConfig();
      await client.discover();

      nock(baseUrl)
        .get('/api/v1/password-policies')
        .reply(200, { policies: [policy] });
      expect(await client.passwordPolicies()).to.deep.equal([policy]);

      nock(baseUrl)
        .post('/api/v1/password-policies', {
          pwdMaxFailure: 10,
          cn: 'soft ware',
        })
        .reply(201, { ...policy, cn: 'soft ware' });
      await client.createPasswordPolicy('soft ware', { pwdMaxFailure: 10 });

      nock(baseUrl)
        .patch('/api/v1/password-policies/soft%20ware', { pwdLockout: null })
        .reply(200, policy);
      await client.updatePasswordPolicy('soft ware', { pwdLockout: null });

      nock(baseUrl)
        .delete('/api/v1/password-policies/soft%20ware')
        .reply(200, { success: true });
      await client.deletePasswordPolicy('soft ware');
      expect(nock.isDone()).to.equal(true);
    });
  });

  describe('the console', () => {
    /** A console whose server manages policies, for a caller of this scope. */
    async function consoleFor(
      scope: Scope | null,
      elements: Record<string, unknown> = {}
    ): Promise<DirectoryConsole> {
      const app = new DirectoryConsole({
        containerId: 'console',
        apiBaseUrl: baseUrl,
        language: 'fr',
      });
      const inner = app as unknown as {
        container: unknown;
        api: ConsoleApiClient;
        scope: Scope | null;
      };
      inner.container = {
        querySelector: (selector: string) => elements[selector] ?? null,
        querySelectorAll: () => [],
      };
      policyConfig();
      await inner.api.discover();
      inner.scope = scope;
      return app;
    }

    const manages = (app: DirectoryConsole): boolean =>
      (app as unknown as { managesPolicies(): boolean }).managesPolicies();

    it('should leave the policies to callers whose scope restricts nothing', async () => {
      expect(manages(await consoleFor(null))).to.equal(true);
      expect(
        manages(
          await consoleFor({
            unrestricted: false,
            branches: [
              {
                dn: 'ou=sales,dc=example,dc=com',
                read: true,
                write: true,
                delete: true,
              },
            ],
            entities: [],
          } as unknown as Scope)
        )
      ).to.equal(false);
    });

    it('should say in words why a policy cannot be deleted', async () => {
      const toast = {
        textContent: '',
        hidden: true,
        onclick: null,
        classList: { toggle: () => undefined },
      };
      const app = await consoleFor(null, { '[data-toast]': toast });
      const g = globalThis as Record<string, unknown>;
      const original = g.window;
      g.window = { confirm: () => true };
      try {
        nock(baseUrl).delete('/api/v1/password-policies/software').reply(409, {
          error:
            'cn=software,ou=policies is still applied to at least one entry',
        });
        await (
          app as unknown as {
            deletePolicy(policy: PasswordPolicy): Promise<void>;
          }
        ).deletePolicy({ dn: 'cn=software', cn: 'software', isDefault: false });
      } finally {
        g.window = original;
      }
      expect(toast.textContent).to.equal(
        "software est la politique par défaut, ou des comptes l'utilisent encore"
      );
    });
  });

  describe('translations', () => {
    it('should name every field in every language', () => {
      const keys = [
        'nav.policies',
        'policy.new',
        'policy.title.new',
        'policy.boolean.unset',
        'policy.quality.unset',
        'policy.inUse',
        ...POLICY_GROUPS.map(group => `policy.group.${group.key}`),
        ...POLICY_GROUPS.flatMap(group =>
          group.fields.map(field => `policy.attr.${field.name}`)
        ),
        'policy.attr.pwdAttribute',
        'policy.attr.pwdCheckModule',
      ];
      for (const language of availableLanguages) {
        const translator = new Translator(language);
        for (const key of keys)
          expect(translator.t(key), `${language} ${key}`).to.not.equal(key);
        for (const unit of ['days', 'hours', 'minutes', 'seconds'])
          expect(
            translator.t(`policy.duration.${unit}`, { count: 2 }),
            `${language} ${unit}`
          ).to.include('2');
        expect(translator.t('policy.lockoutAfter', { count: 1 })).to.include(
          '1'
        );
      }
    });
  });
});
