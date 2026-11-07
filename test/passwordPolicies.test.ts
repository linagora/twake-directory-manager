/**
 * Tests for the password policy screen.
 */
import { expect } from 'chai';
import nock from 'nock';

import { ConsoleApiClient } from '../src/api/ConsoleApiClient';
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
import { mountConsole, type Mounted } from './support/mount';
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
const POLICY_CONFIG = {
  apiPrefix: '/api',
  features: {
    ldapPasswordPolicy: {
      endpoints: { listPolicies: '/api/v1/password-policies' },
    },
  },
};

function policyConfig(): nock.Scope {
  return nock(baseUrl).get('/api/v1/config').reply(200, POLICY_CONFIG);
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
      ]).markup;
      expect(markup).to.include('365 days');
      expect(markup).to.include('After 3 failures, 2 minutes');
      expect(markup).to.include('Never');
      expect(markup).to.include('Off');
      expect(markup.match(/dc-tag/g)).to.have.length(1);
    });

    it('should name the table and make each name a button the keyboard presses', () => {
      // Enter on the focused row opened the panel and submitted its form at
      // once; Space did nothing (#207).
      const markup = policyTableMarkup(en, [
        policy,
        { dn: 'cn=software', cn: 'software', isDefault: false },
      ]).markup;
      expect(markup)
        .to.include(
          '<caption class="dc-visually-hidden">Password policies</caption>'
        )
        .and.include('<th scope="col">Name</th>')
        .and.include('<tr data-policy="software">')
        .and.match(
          /<button type="button" class="dc-row-link dc-row-button"\s+data-policy-open="software"\s+aria-label="Open the policy software">software<\/button>/
        );
      expect(markup).to.not.include('tabindex');
    });

    it('should escape a policy name', () => {
      const markup = policyTableMarkup(en, [
        { dn: 'cn=x', cn: '<img src=x>', isDefault: false },
      ]).markup;
      expect(markup).not.to.include('<img');
    });

    it('should say when a lockout lasts until an unlock', () => {
      expect(
        lockoutText(en, { ...policy, pwdLockoutDuration: undefined })
      ).to.equal('After 3 failures, until unlocked');
    });
  });

  describe('the form', () => {
    /** A policy form drawn in the page. */
    const drawn = (
      edited: PasswordPolicy | null,
      saved: { cn: string; values: Record<string, unknown> }[],
      onCancel: () => void = () => undefined
    ): { form: PolicyForm; container: HTMLElement } => {
      const container = document.createElement('div');
      document.body.append(container);
      const form = new PolicyForm({
        translator: en,
        policy: edited ?? undefined,
        canDelete: true,
        onSave: async (cn, values): Promise<void> => {
          saved.push({ cn, values });
        },
        onDelete: () => undefined,
        onCancel,
      });
      form.render(container);
      // happy-dom chooses the second option of every select, whatever
      // `selected` says: put each back where the markup put it, as a browser
      // would, before a test reads or changes one.
      for (const select of Array.from(
        container.querySelectorAll<HTMLSelectElement>('select')
      )) {
        const chosen =
          select.querySelector<HTMLOptionElement>('option[selected]');
        if (chosen) select.value = chosen.value;
      }
      return { form, container };
    };

    /** A control of the form drawn, by the attribute it sets. */
    const control = <
      T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    >(
      container: HTMLElement,
      name: string
    ): T => container.querySelector<T>(`#dc-policy-${name}`) as T;

    /** Press Save or Create, as the reader does, and let it answer. */
    const save = async (container: HTMLElement): Promise<void> => {
      const button = container.querySelector<HTMLElement>(
        'form button[type="submit"]'
      );
      if (!button) throw new Error('no submit');
      button.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    };

    it('should send what changed, in seconds', async () => {
      const saved: { cn: string; values: Record<string, unknown> }[] = [];
      const { container } = drawn(policy, saved);
      control<HTMLInputElement>(container, 'pwdMaxAge').value = '30';
      container.querySelector<HTMLSelectElement>(
        '[data-field="pwdMaxAge"] [data-unit]'
      )!.value = 'days';
      control<HTMLSelectElement>(container, 'pwdLockout').value = '';
      await save(container);
      expect(saved).to.deep.equal([
        { cn: 'default', values: { pwdMaxAge: 2592000, pwdLockout: null } },
      ]);
    });

    it('should send nothing while a field holds a wrong value', async () => {
      const saved: { cn: string; values: Record<string, unknown> }[] = [];
      const { container } = drawn(policy, saved);
      const length = control<HTMLInputElement>(container, 'pwdMinLength');
      length.value = '-1';
      await save(container);
      expect(saved).to.deep.equal([]);
      const error = container.querySelector<HTMLElement>(
        '[data-field="pwdMinLength"] [data-error]'
      ) as HTMLElement;
      expect(error.hidden).to.equal(false);
      expect(error.textContent).to.equal('A whole number, 0 or more');
      // A refused field says so to assistive technology, and takes the focus.
      expect(length.getAttribute('aria-invalid')).to.equal('true');
      expect(document.activeElement).to.equal(length);
    });

    it('should be changed once typed in, and saved unchanged close as saved', async () => {
      // Saved with nothing that differs, it asked "Discard what you typed?"
      let cancelled = 0;
      const saved: { cn: string; values: Record<string, unknown> }[] = [];
      const { form, container } = drawn(policy, saved, () => {
        cancelled++;
      });
      expect(form.isDirty()).to.equal(false);
      control<HTMLInputElement>(container, 'pwdMinLength').dispatchEvent(
        new Event('input', { bubbles: true })
      );
      expect(form.isDirty()).to.equal(true);
      await save(container);
      expect(cancelled).to.equal(1);
      expect(form.isDirty()).to.equal(false);
      expect(saved).to.deep.equal([]);
    });

    it('should mark the refused fields and focus the first', async () => {
      // As in the entry forms: the messages alone left the keyboard on Create.
      const saved: { cn: string; values: Record<string, unknown> }[] = [];
      const { container } = drawn(null, saved);
      const name = control<HTMLInputElement>(container, 'cn');
      const age = control<HTMLInputElement>(container, 'pwdMaxAge');
      const length = control<HTMLInputElement>(container, 'pwdMinLength');
      age.value = '-1';
      length.value = '-1';
      await save(container);
      expect(saved).to.deep.equal([]);
      expect(name.getAttribute('aria-invalid')).to.equal('true');
      expect(name.getAttribute('aria-describedby')).to.equal(
        'dc-policy-cn-error'
      );
      expect(age.getAttribute('aria-invalid')).to.equal('true');
      expect(age.getAttribute('aria-describedby')).to.equal(
        'dc-policy-pwdMaxAge-hint dc-policy-pwdMaxAge-error'
      );
      expect(document.activeElement).to.equal(name);
      // Put right, a field loses its mark and keeps its hint.
      name.value = 'software';
      age.value = '30';
      await save(container);
      expect(name.getAttribute('aria-invalid')).to.equal(null);
      expect(name.getAttribute('aria-describedby')).to.equal(null);
      expect(age.getAttribute('aria-invalid')).to.equal(null);
      expect(age.getAttribute('aria-describedby')).to.equal(
        'dc-policy-pwdMaxAge-hint'
      );
      expect(length.getAttribute('aria-invalid')).to.equal('true');
      expect(document.activeElement).to.equal(length);
      expect(saved).to.deep.equal([]);
    });

    it('should create a policy with the fields filled in', async () => {
      const saved: { cn: string; values: Record<string, unknown> }[] = [];
      const { container } = drawn(null, saved);
      control<HTMLInputElement>(container, 'cn').value = ' software ';
      control<HTMLInputElement>(container, 'pwdMaxFailure').value = '10';
      await save(container);
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
        const container = document.createElement('div');
        new PolicyForm({
          translator: en,
          policy,
          attributes,
          canDelete: true,
          onSave: async () => undefined,
          onDelete: () => undefined,
          onCancel: () => undefined,
        }).render(container);
        return container.innerHTML;
      };
      const offered = markup(defined);
      expect(offered).to.include('id="dc-policy-pwdMinLength"');
      // Each unit is named after its duration, not five times "Unit".
      expect(offered).to.include('aria-label="Password expires after — unit"');
      expect(offered).to.include('aria-describedby="dc-policy-pwdMaxAge-hint"');
      for (const name of ['pwdMaxLength', 'pwdMaxIdle', 'pwdMinDelay'])
        expect(offered).not.to.include(`id="dc-policy-${name}"`);
      // A group left with no field is not shown at all
      expect(offered).not.to.include(en.t('policy.group.changes'));
      // A server that does not say offers everything
      expect(markup()).to.include('id="dc-policy-pwdMaxLength"');
    });

    it('should not offer to delete the default policy', () => {
      const container = document.createElement('div');
      new PolicyForm({
        translator: en,
        policy,
        canDelete: true,
        onSave: async () => undefined,
        onDelete: () => undefined,
        onCancel: () => undefined,
      }).render(container);
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
    const local: Scope = {
      user: 'uid=sophie.martin,ou=users,dc=example,dc=com',
      unrestricted: false,
      described: true,
      branches: [{ dn: 'ou=sales,dc=example,dc=com', read: true, write: true }],
      entities: [],
    };

    /** The console mounted on the overview, its server serving policies. */
    const mountPolicies = (
      scope: Scope | null,
      answer?: (server: nock.Scope) => void,
      config: object = POLICY_CONFIG
    ): Promise<Mounted> =>
      mountConsole({
        hash: '',
        scope,
        answers: server => {
          server.get('/api/v1/config').reply(200, config);
          answer?.(server);
        },
      });

    /** The reference entry opening the policies, when the console offers it. */
    const navPolicies = (mounted: Mounted): Element | null =>
      mounted.root.querySelector('[data-nav="password-policies"]');

    /** What the console asked of the policies, by client method. */
    const asked = (mounted: Mounted): string[] =>
      mounted.calls.filter(call => call.startsWith('readsPasswordPolicies'));

    it('should offer the policies to whoever the server lets read them', async () => {
      // Its rule, not the scope's: a local administrator of the branch the
      // policies belong to holds them (ldap-rest --authz-global-organization)
      const allowed = await mountPolicies(local, server => {
        server.get('/api/v1/password-policies').reply(200, { policies: [] });
      });
      expect(navPolicies(allowed)).to.not.equal(null);
      expect(asked(allowed)).to.not.deep.equal([]);
      allowed.unmount();

      const refused = await mountPolicies(local, server => {
        server
          .get('/api/v1/password-policies')
          .reply(403, { error: 'Forbidden' });
      });
      expect(navPolicies(refused)).to.equal(null);
      refused.unmount();

      // Any other failure is shown on the page rather than hiding it.
      const broken = await mountPolicies(local, server => {
        server
          .get('/api/v1/password-policies')
          .reply(500, { error: 'LDAP error' });
      });
      expect(navPolicies(broken)).to.not.equal(null);
    });

    describe('read from the scope', () => {
      it('should offer the policies the scope says the caller manages, without asking for them', async () => {
        for (const scope of [
          { ...local, passwordPolicies: true },
          {
            ...local,
            unrestricted: true,
            branches: [],
            passwordPolicies: true,
          },
        ]) {
          const mounted = await mountPolicies(scope);
          expect(navPolicies(mounted)).to.not.equal(null);
          expect(asked(mounted)).to.deep.equal([]);
          mounted.unmount();
        }
      });

      it('should hide the policies the scope says the caller does not manage, without asking for them', async () => {
        // A local administrator's every page load logged a 403 on them.
        const mounted = await mountPolicies({
          ...local,
          passwordPolicies: false,
        });
        expect(navPolicies(mounted)).to.equal(null);
        expect(asked(mounted)).to.deep.equal([]);
      });

      it('should ask the server that does not say, or whose scope cannot', async () => {
        // An ldap-rest before 0.25.0, and an undescribed scope, whose
        // `false` is for want of a model.
        for (const scope of [
          local,
          {
            ...local,
            described: false,
            branches: [],
            passwordPolicies: false,
          },
        ]) {
          const mounted = await mountPolicies(scope);
          expect(navPolicies(mounted)).to.not.equal(null);
          expect(asked(mounted)).to.not.deep.equal([]);
          mounted.unmount();
        }
      });
    });

    it('should list the policies with the reference data', async () => {
      const mounted = await mountPolicies(null);
      expect(navPolicies(mounted)).to.not.equal(null);
      expect(
        mounted.root.querySelectorAll('[data-nav="password-policies"]')
      ).to.have.length(1);
    });

    it('should not ask a server that manages no policy', async () => {
      const mounted = await mountPolicies(null, undefined, {
        apiPrefix: '/api',
        features: {},
      });
      expect(navPolicies(mounted)).to.equal(null);
      expect(asked(mounted)).to.deep.equal([]);
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
        'policy.error.taken',
        ...POLICY_GROUPS.map(group => `policy.group.${group.key}`),
        ...POLICY_GROUPS.flatMap(group =>
          group.fields.map(field => `policy.attr.${field.name}`)
        ),
        'policy.attr.pwdAttribute',
        'policy.attr.pwdCheckModule',
        'policy.unitOf',
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
