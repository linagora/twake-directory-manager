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

    it('should offer only the attributes the directory defines', () => {
      // OpenLDAP 2.4 refuses pwdMaxLength, pwdMaxIdle, pwdMinDelay and
      // pwdMaxDelay: "attribute type undefined"
      const defined = POLICY_GROUPS.flatMap(group =>
        group.fields.map(field => field.name)
      ).filter(
        name =>
          ![
            'pwdMaxLength',
            'pwdMaxIdle',
            'pwdMinDelay',
            'pwdMaxDelay',
            'pwdMustChange',
            'pwdAllowUserChange',
            'pwdSafeModify',
          ].includes(name)
      );
      const markup = (attributes?: string[]): string => {
        const container = { innerHTML: '', querySelector: () => null };
        new PolicyForm({
          translator: en,
          policy,
          attributes,
          canDelete: true,
          onSave: async () => undefined,
          onDelete: () => undefined,
          onCancel: () => undefined,
        }).render(container as unknown as HTMLElement);
        return container.innerHTML;
      };
      const offered = markup(defined);
      expect(offered).to.include('id="dc-policy-pwdMinLength"');
      for (const name of ['pwdMaxLength', 'pwdMaxIdle', 'pwdMinDelay'])
        expect(offered).not.to.include(`id="dc-policy-${name}"`);
      // A group left with no field is not shown at all
      expect(offered).not.to.include(en.t('policy.group.changes'));
      // A server that does not say offers everything
      expect(markup()).to.include('id="dc-policy-pwdMaxLength"');
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
        .reply(200, { policies: [policy], attributes: ['pwdMaxAge'] });
      expect(await client.passwordPolicies()).to.deep.equal({
        policies: [policy],
        attributes: ['pwdMaxAge'],
      });

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

    const reads = (app: DirectoryConsole): Promise<boolean> =>
      (app as unknown as { readsPolicies(): Promise<boolean> }).readsPolicies();

    it('should offer the policies to whoever the server lets read them', async () => {
      // Its rule, not the scope's: a local administrator of the branch the
      // policies belong to holds them (ldap-rest --authz-global-organization)
      const app = await consoleFor({
        unrestricted: false,
        branches: [
          { dn: 'ou=sales,dc=example,dc=com', read: true, write: true },
        ],
        entities: [],
      } as unknown as Scope);
      nock(baseUrl)
        .get('/api/v1/password-policies')
        .reply(200, { policies: [] });
      expect(await reads(app)).to.equal(true);
      nock(baseUrl)
        .get('/api/v1/password-policies')
        .reply(403, { error: 'Forbidden' });
      expect(await reads(app)).to.equal(false);
      // Any other failure is shown on the page rather than hiding it
      nock(baseUrl)
        .get('/api/v1/password-policies')
        .reply(500, { error: 'LDAP error' });
      expect(await reads(app)).to.equal(true);
    });

    describe('read from the scope', () => {
      const local = {
        user: 'uid=sophie.martin,ou=users,dc=example,dc=com',
        unrestricted: false,
        described: true,
        branches: [
          { dn: 'ou=sales,dc=example,dc=com', read: true, write: true },
        ],
        entities: [],
      } as Scope;
      /** Every request to the policies, which none of these should send. */
      let asked = 0;
      beforeEach(() => {
        asked = 0;
        nock(baseUrl)
          .get('/api/v1/password-policies')
          .times(2)
          .reply(() => {
            asked++;
            return [200, { policies: [] }];
          });
      });
      afterEach(() => nock.cleanAll());

      it('should offer the policies the scope says the caller manages, without asking for them', async () => {
        expect(
          await reads(await consoleFor({ ...local, passwordPolicies: true }))
        ).to.equal(true);
        expect(
          await reads(
            await consoleFor({
              ...local,
              unrestricted: true,
              branches: [],
              passwordPolicies: true,
            })
          )
        ).to.equal(true);
        expect(asked).to.equal(0);
      });

      it('should hide the policies the scope says the caller does not manage, without asking for them', async () => {
        // A local administrator's every page load logged a 403 on them
        expect(
          await reads(await consoleFor({ ...local, passwordPolicies: false }))
        ).to.equal(false);
        expect(asked).to.equal(0);
      });

      it('should ask the server that does not say, or whose scope cannot', async () => {
        // An ldap-rest before 0.25.0, and an undescribed scope, whose
        // `false` is for want of a model
        expect(await reads(await consoleFor(local))).to.equal(true);
        expect(
          await reads(
            await consoleFor({
              ...local,
              described: false,
              branches: [],
              passwordPolicies: false,
            })
          )
        ).to.equal(true);
        expect(asked).to.equal(2);
      });
    });

    it('should list the policies with the reference data', async () => {
      const container = {
        innerHTML: '',
        querySelector: () => null,
        querySelectorAll: () => [],
      };
      const app = await consoleFor(null);
      const inner = app as unknown as {
        container: unknown;
        policiesReadable: boolean;
        drawShell(): void;
      };
      inner.container = container;
      inner.policiesReadable = true;
      inner.drawShell();
      const section = container.innerHTML.slice(
        container.innerHTML.indexOf('id="dc-nav-reference"')
      );
      expect(section).to.match(
        /class="dc-nav-item dc-nav-item-reference" data-nav="password-policies"/
      );
      expect(
        container.innerHTML.match(/data-nav="password-policies"/g)
      ).to.have.length(1);
    });

    it('should not ask a server that manages no policy', async () => {
      const app = new DirectoryConsole({
        containerId: 'console',
        apiBaseUrl: baseUrl,
      });
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, { apiPrefix: '/api', features: {} });
      await (app as unknown as { api: ConsoleApiClient }).api.discover();
      expect(await reads(app)).to.equal(false);
      expect(nock.pendingMocks()).to.deep.equal([]);
    });

    it('should say in words why a policy cannot be deleted', async () => {
      const toast = {
        textContent: '',
        hidden: true,
        onclick: null,
        classList: { toggle: () => undefined },
      };
      const app = await consoleFor(null, { '[data-toast]': toast });
      Object.assign(app, { confirmAction: async () => true });
      nock(baseUrl).delete('/api/v1/password-policies/software').reply(409, {
        error: 'cn=software,ou=policies is still applied to at least one entry',
      });
      await (
        app as unknown as {
          deletePolicy(policy: PasswordPolicy): Promise<void>;
        }
      ).deletePolicy({ dn: 'cn=software', cn: 'software', isDefault: false });
      expect(toast.textContent).to.equal(
        'software est la politique par défaut, ou des comptes l’utilisent encore'
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
