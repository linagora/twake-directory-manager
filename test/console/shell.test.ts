import { expect } from 'chai';
import nock from 'nock';
import {
  DirectoryConsole,
  type Confirmation,
} from '../../src/DirectoryConsole';
import { Translator, availableLanguages, languageName } from '../../src/i18n';
import type { SafeHtml } from '../../src/shared/html';
import type { EntityDescriptor, Entry, Scope } from '../../src/types';
import {
  baseUrl,
  stubContainer,
  treeContainer,
  consoleIn,
  toastElement,
} from '../support/stubs';
import { usersSchema, users, groups, mailboxTypes } from '../fixtures/entities';

describe('Directory console: the shell and the overview', () => {
  afterEach(() => nock.cleanAll());

  describe('the shell and its actions', () => {
    describe('the change of state', () => {
      /**
       * A console on an account's card, its panel body holding the radios the
       * panel draws, and nothing written before its button is pressed.
       */
      const setup = (
        language = 'en',
        stored: string | undefined = 'cn=active',
        entity: EntityDescriptor = users
      ) => {
        const toast = toastElement();
        const states =
          entity.schema.attributes.twakeAccountStatus?.states ?? {};
        const radios = Object.keys(states).map(value => {
          const radio = {
            value,
            checked: false,
            listener: undefined as (() => void) | undefined,
            addEventListener: (_type: string, callback: () => void) => {
              radio.listener = callback;
            },
          };
          return radio;
        });
        const submit = { disabled: true, textContent: '' };
        let send: ((event: unknown) => void) | undefined;
        const form = {
          addEventListener: (
            _type: string,
            callback: (event: unknown) => void
          ) => {
            send = callback;
          },
        };
        const body = {
          innerHTML: '',
          querySelector: (selector: string) =>
            selector === 'button[type="submit"]'
              ? submit
              : selector === 'form'
                ? form
                : selector === 'input[name="dc-state"]:checked'
                  ? (radios.find(radio => radio.checked) ?? null)
                  : null,
          querySelectorAll: (selector: string) =>
            selector === 'input[name="dc-state"]'
              ? radios.filter(radio =>
                  body.innerHTML.includes(`value="${radio.value}"`)
                )
              : [],
        };
        const panel = { hidden: true, classList: { toggle: () => undefined } };
        const app = consoleIn(
          {
            '[data-panel]': panel,
            '[data-panel-title]': { textContent: '' },
            '[data-panel-body]': body,
            '[data-toast]': toast,
          },
          language
        );
        Object.assign(app, {
          entities: [entity],
          renderMain: async () => undefined,
        });
        const open = (): Promise<void> =>
          (
            app as unknown as {
              changeState(
                entity: EntityDescriptor,
                id: string,
                entry: Entry
              ): Promise<void>;
            }
          ).changeState(entity, 'frank', {
            uid: 'frank',
            cn: 'Frank Martin',
            ...(stored === undefined ? {} : { twakeAccountStatus: stored }),
          });
        const pick = (value: string): void => {
          for (const radio of radios) radio.checked = radio.value === value;
          radios.find(radio => radio.value === value)?.listener?.();
        };
        const press = (): void => send?.({ preventDefault: () => undefined });
        return { app, toast, body, submit, panel, open, pick, press };
      };

      it('should show the current state and offer the others, explained', async () => {
        const { body, open } = setup();
        await open();
        expect(body.innerHTML).to.include('Current state: Active');
        expect(body.innerHTML).to.include('value="disabled"');
        expect(body.innerHTML).to.not.include('value="enabled"');
        expect(body.innerHTML).to.include(
          'Suspended, during a long absence for instance.'
        );
      });

      it('should translate the states it knows and keep the ones it does not', async () => {
        const entity: EntityDescriptor = {
          ...users,
          schema: {
            attributes: {
              ...usersSchema.attributes,
              twakeAccountStatus: {
                type: 'pointer',
                role: 'accountStatus',
                states: { disabled: 'cn=disabled', seconded: 'cn=seconded' },
              },
            },
          },
        };
        const { body, submit, open, pick } = setup('fr', undefined, entity);
        await open();
        expect(body.innerHTML).to.include('>Désactivé</label>');
        expect(body.innerHTML).to.include(
          'Suspendu, pendant une longue absence par exemple.'
        );
        // A state the deployment invented keeps the name the deployment gave
        // it, with no explanation the catalogue would have to invent, and a
        // button that says what it does in general terms.
        expect(body.innerHTML).to.include('>seconded</label>');
        expect(body.innerHTML).to.not.include('dc-state-seconded-help');
        pick('seconded');
        expect(submit.textContent).to.equal('Changer l’état');
        pick('disabled');
        expect(submit.textContent).to.equal('Désactiver');
      });

      it('should write nothing until the button naming the choice is pressed', async () => {
        const { toast, submit, open, pick, press } = setup();
        // Any request now would fail the test: nock lets none through.
        await open();
        expect(submit.disabled).to.equal(true);
        expect(submit.textContent).to.equal('');
        pick('disabled');
        expect(submit.disabled).to.equal(false);
        expect(submit.textContent).to.equal('Disable');
        expect(toast.textContent).to.equal('');

        const written = nock(baseUrl)
          .post('/api/v1/ldap/users/frank/status', { state: 'disabled' })
          .reply(200, {});
        press();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(written.isDone()).to.equal(true);
        expect(toast.textContent).to.equal('Frank Martin is now Disabled');
      });

      it('should name the account and the state in the interface language', async () => {
        const { toast, open, pick, press } = setup('fr', 'cn=disabled');
        await open();
        pick('enabled');
        nock(baseUrl)
          .post('/api/v1/ldap/users/frank/status', { state: 'enabled' })
          .reply(200, {});
        press();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(toast.textContent).to.equal('Frank Martin est désormais Actif');
      });
    });

    it('should name the states the same way in the panel, the card and the reference list', () => {
      // English said "Enabled" and "To be deleted" in the select, "Active"
      // and "To delete" on the card and in the Account states list.
      const en = new Translator('en');
      expect(en.t('state.enabled')).to.equal('Active');
      expect(en.t('state.toDelete')).to.equal('To delete');
    });

    it('should ask before deleting an organization by its name, not its DN', async () => {
      const organizations: EntityDescriptor = {
        key: 'organizations',
        pluralName: 'organizations',
        singularName: 'organization',
        mainAttribute: 'ou',
        base: 'ou=organization,dc=example,dc=com',
        schema: {
          attributes: {
            ou: { type: 'string', role: 'identifier' },
            twakeDepartmentPath: { type: 'string', role: 'organizationPath' },
          },
        },
        endpoint: '/api/v1/ldap/organizations',
        kind: 'organization',
        organizationPath: 'twakeDepartmentPath',
      };
      const dn = 'ou=QA Lab,ou=Engineering,ou=organization,dc=example,dc=com';
      const asked: Confirmation[] = [];
      const app = consoleIn({}) as unknown as {
        confirmAction(question: Confirmation): Promise<boolean>;
        confirmDeleteOrganization(
          entity: EntityDescriptor,
          entry: Entry,
          dn: string
        ): Promise<void>;
      };
      // Declined: nothing is deleted, and no request is made.
      app.confirmAction = async question => {
        asked.push(question);
        return false;
      };
      await app.confirmDeleteOrganization(
        organizations,
        { dn, ou: 'QA Lab', twakeDepartmentPath: 'Engineering / QA Lab' },
        dn
      );
      // An organization with no path is named by its own name.
      await app.confirmDeleteOrganization(organizations, { dn }, dn);
      expect(asked).to.deep.equal([
        {
          title: 'Delete Engineering / QA Lab?',
          lines: ['This cannot be undone.'],
          action: 'Delete organization',
        },
        {
          title: 'Delete QA Lab?',
          lines: ['This cannot be undone.'],
          action: 'Delete organization',
        },
      ]);
    });

    it('should name a nomenclature entry as its card does, to edit or delete it', async () => {
      const app = consoleIn({}, 'fr') as unknown as {
        openPanel(title: string): void;
        openForm(entity: EntityDescriptor, entry?: Entry): void;
        confirmAction(question: Confirmation): Promise<boolean>;
        confirmDelete(entity: EntityDescriptor, id: string): Promise<void>;
      };
      const titles: string[] = [];
      app.openPanel = (title: string): void => {
        titles.push(title);
      };
      await app.openForm(mailboxTypes, {
        dn: 'cn=teamMailbox,ou=twakeMailboxType,ou=nomenclature,dc=example,dc=com',
        cn: 'teamMailbox',
      });
      expect(titles).to.deep.equal(['Modifier — Boîte partagée']);

      const asked: string[] = [];
      app.confirmAction = async question => {
        asked.push(`${question.title} ${question.action}`);
        return false;
      };
      await app.confirmDelete(mailboxTypes, 'teamMailbox');
      // A value the schema does not name keeps its own.
      await app.confirmDelete(mailboxTypes, 'archive');
      expect(asked).to.deep.equal([
        'Supprimer Boîte partagée ? Supprimer Boîte partagée',
        'Supprimer archive ? Supprimer archive',
      ]);
    });

    it('should name the person, the consequences and the way out before deleting an account', async () => {
      const staff: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            givenName: { type: 'string', role: 'givenName' },
            memberOf: {
              type: 'array',
              role: 'groupMemberships',
              items: { type: 'string' },
            },
          },
        },
      };
      const entry: Entry = {
        dn: 'uid=jmartin,ou=users,dc=example,dc=com',
        uid: 'jmartin',
        cn: 'Jeanne Martin',
        givenName: 'Jeanne',
        mail: 'jmartin@example.com',
        twakeDepartmentPath: 'Sales / France',
        twakeAccountStatus: 'cn=active',
        memberOf: [
          'cn=all-staff,ou=groups,dc=example,dc=com',
          'cn=sales-team,ou=groups,dc=example,dc=com',
        ],
      };
      const asked: Confirmation[] = [];
      const app = consoleIn({}) as unknown as {
        confirmAction(question: Confirmation): Promise<boolean>;
        changeState(
          entity: EntityDescriptor,
          id: string,
          entry: Entry,
          preselect?: string
        ): Promise<void>;
        confirmDelete(
          entity: EntityDescriptor,
          id: string,
          entry?: Entry,
          canChangeState?: boolean
        ): Promise<void>;
      };
      app.confirmAction = async question => {
        asked.push(question);
        return false;
      };
      const changed: unknown[][] = [];
      app.changeState = async (...args) => {
        changed.push(args);
      };

      await app.confirmDelete(staff, 'jmartin', entry, true);
      const [question] = asked;
      expect(question.title).to.equal('Delete Jeanne Martin?');
      expect(question.lines).to.deep.equal([
        'Jeanne Martin · jmartin@example.com · Sales / France',
        'This cannot be undone. Jeanne Martin will be removed from: all-staff, sales-team.',
      ]);
      expect(question.action).to.equal('Delete Jeanne');
      expect(question.reversible).to.equal(undefined);
      expect(question.alternative?.label).to.equal(
        'To stop access without deleting, set the state to Disabled instead.'
      );
      // The way out opens the state change, Disabled picked, and deletes nothing.
      question.alternative?.run();
      expect(changed).to.deep.equal([[staff, 'jmartin', entry, 'disabled']]);

      // Not offered to whom may not change it, nor to an account already disabled.
      await app.confirmDelete(staff, 'jmartin', entry, false);
      await app.confirmDelete(
        staff,
        'jmartin',
        { ...entry, twakeAccountStatus: 'cn=disabled', memberOf: [] },
        true
      );
      expect(asked[1].alternative).to.equal(undefined);
      expect(asked[2].alternative).to.equal(undefined);
      expect(asked[2].lines[1]).to.equal('This cannot be undone.');
    });

    it('should say when an account’s groups could not be listed, and still delete it', async () => {
      // Without `memberOf`, they are searched among the groups: a refusal
      // read as none said nothing about groups (#157).
      const staff: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            memberOf: {
              type: 'array',
              role: 'groupMemberships',
              items: { type: 'string' },
            },
          },
        },
      };
      const entry: Entry = {
        dn: 'uid=jmartin,ou=users,dc=example,dc=com',
        uid: 'jmartin',
        cn: 'Jeanne Martin',
        memberOf: [],
      };
      const setup = (
        found: () => Promise<string[]>,
        language = 'en'
      ): {
        asked: Confirmation[];
        strict: unknown[];
        removed: string[];
        confirmDelete(
          entity: EntityDescriptor,
          id: string,
          entry?: Entry
        ): Promise<void>;
      } => {
        const asked: Confirmation[] = [];
        const strict: unknown[] = [];
        const removed: string[] = [];
        const app = consoleIn({}, language) as unknown as {
          api: object;
          confirmAction(question: Confirmation): Promise<boolean>;
          toast(message: string): void;
          go(key: string): void;
          confirmDelete(
            entity: EntityDescriptor,
            id: string,
            entry?: Entry
          ): Promise<void>;
        };
        Object.assign(app.api, {
          memberships: async (_dn: string, _e: unknown, s?: boolean) => {
            strict.push(s);
            return found();
          },
          remove: async (_entity: EntityDescriptor, id: string) => {
            removed.push(id);
          },
        });
        app.confirmAction = async question => {
          asked.push(question);
          return true;
        };
        app.toast = (): void => undefined;
        app.go = (): void => undefined;
        return {
          asked,
          strict,
          removed,
          confirmDelete: app.confirmDelete.bind(app),
        };
      };

      for (const status of [403, 500]) {
        const refused = setup(async () => {
          throw Object.assign(new Error('Refused'), { status });
        });
        await refused.confirmDelete(staff, 'jmartin', entry);
        expect(refused.strict).to.deep.equal([true]);
        expect(refused.asked[0].lines[1]).to.equal(
          'This cannot be undone. The groups Jeanne Martin belongs to could not be listed.'
        );
        expect(refused.asked[0].action).to.equal('Delete Jeanne Martin');
        expect(refused.removed).to.deep.equal(['jmartin']);
      }
      const fr = setup(async () => {
        throw new Error('No filter can hold it');
      }, 'fr');
      await fr.confirmDelete(staff, 'jmartin', entry);
      expect(fr.asked[0].lines[1]).to.include(
        'Les groupes de Jeanne Martin n’ont pas pu être listés.'
      );

      // None found is none: nothing said about groups
      const none = setup(async () => []);
      await none.confirmDelete(staff, 'jmartin', entry);
      expect(none.asked[0].lines[1]).to.equal('This cannot be undone.');
      expect(none.removed).to.deep.equal(['jmartin']);
    });

    it('should say a deleted group leaves its members, and name a selection', async () => {
      const asked: Confirmation[] = [];
      const app = consoleIn({}, 'fr') as unknown as {
        confirmAction(question: Confirmation): Promise<boolean>;
        confirmDelete(
          entity: EntityDescriptor,
          id: string,
          entry?: Entry
        ): Promise<void>;
        deleteMany(entity: EntityDescriptor, ids: string[]): Promise<boolean>;
      };
      app.confirmAction = async question => {
        asked.push(question);
        return false;
      };
      await app.confirmDelete(groups, 'sales-team', {
        dn: 'cn=sales-team,ou=groups,dc=example,dc=com',
        cn: 'sales-team',
        member: ['uid=a', 'uid=b', 'uid=c'],
      });
      // Cancelled, nothing went: the list is not read again.
      expect(
        await app.deleteMany(users, ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
      ).to.equal(false);
      await app.deleteMany(users, ['a']);
      expect(asked).to.deep.equal([
        {
          title: 'Supprimer sales-team ?',
          lines: [
            'Ses 3 membres restent dans l’annuaire ; seul le groupe disparaît.',
            'Cette action est irréversible.',
          ],
          action: 'Supprimer le groupe',
        },
        {
          title: 'Supprimer 7 entrées ?',
          lines: ['Cette action est irréversible.'],
          items: ['a', 'b', 'c', 'd', 'e', 'et 2 de plus'],
          action: 'Supprimer 7 entrées',
        },
        {
          title: 'Supprimer 1 entrée ?',
          lines: ['Cette action est irréversible.'],
          items: ['a'],
          action: 'Supprimer 1 entrée',
        },
      ]);
    });

    it('should name the person and the organization they leave before handing them over', async () => {
      const asked: Confirmation[] = [];
      const app = consoleIn({}) as unknown as {
        scope: Scope;
        confirmAction(question: Confirmation): Promise<boolean>;
        handOver(
          entity: EntityDescriptor,
          id: string,
          entry: Entry
        ): Promise<void>;
      };
      app.scope = {
        transit: 'ou=transit,dc=example,dc=com',
      } as unknown as Scope;
      app.confirmAction = async question => {
        asked.push(question);
        return false;
      };
      await app.handOver(users, 'bob', {
        dn: 'uid=bob,ou=users,dc=example,dc=com',
        uid: 'bob',
        cn: 'Bob Durand',
        twakeDepartmentPath: 'Sales',
      });
      expect(asked).to.deep.equal([
        {
          title: 'Hand Bob Durand over?',
          lines: [
            'Bob Durand leaves Sales for Transit.',
            'Every administrator will see this entry and may claim it; you will no longer manage it.',
          ],
          action: 'Hand over',
          reversible: true,
        },
      ]);
    });

    it('should offer to take the account out of the groups one writes', async () => {
      // Moved out of Sales, bob still read its shared mailbox, and nobody
      // could take him out of it once handed over (#165).
      const sales = 'cn=sales-team,ou=groups,dc=example,dc=com';
      const staff = 'cn=all-staff,ou=groups,dc=example,dc=com';
      const run = async (
        keep: boolean,
        refuse = false,
        stuck = false,
        unknown: boolean | 'thrown' = false
      ) => {
        const toast = toastElement();
        const calls: string[] = [];
        const strict: unknown[] = [];
        let question: Confirmation | undefined;
        const app = consoleIn({ '[data-toast]': toast }) as unknown as {
          scope: Scope;
          entities: EntityDescriptor[];
          api: object;
          relations(
            entity: unknown,
            entry: unknown,
            strict?: boolean
          ): Promise<unknown>;
          confirmAction(question: Confirmation): Promise<boolean>;
          afterTransitMove(): Promise<void>;
          handOver(
            entity: EntityDescriptor,
            id: string,
            entry: Entry
          ): Promise<void>;
        };
        app.scope = {
          transit: 'ou=transit,dc=example,dc=com',
        } as unknown as Scope;
        app.entities = [users, groups];
        app.relations = async (_entity, _entry, asked) => {
          strict.push(asked);
          if (unknown === 'thrown') throw new Error('Bad Gateway');
          return {
            title: 'Groups',
            attribute: 'memberOf',
            groups: true,
            ...(unknown ? { unknown: true } : {}),
            items: [
              {
                id: sales,
                label: 'sales-team',
                note: 'Shared mailbox',
                removable: true,
              },
              { id: staff, label: 'all-staff', note: 'Distribution list' },
            ],
          };
        };
        app.confirmAction = async asked => {
          question = asked;
          if (keep && asked.choices) asked.choices.options[0].checked = false;
          return true;
        };
        app.afterTransitMove = async () => undefined;
        Object.assign(app.api, {
          removeMember: async (_entity: unknown, id: string) => {
            calls.push(`remove ${id}`);
            if (refuse) throw new Error('Forbidden');
          },
          move: async () => {
            calls.push('move');
            if (stuck) throw new Error('Service Unavailable');
          },
        });
        await app.handOver(users, 'bob', {
          dn: 'uid=bob,ou=users,dc=example,dc=com',
          uid: 'bob',
          cn: 'Bob Schneider',
          twakeDepartmentPath: 'Sales',
        });
        return { question, calls, toast, strict };
      };
      const { question, calls, toast, strict } = await run(false);
      // Every group is to be gone through: one entity unsearched fails all.
      expect(strict).to.deep.equal([true]);
      expect(question?.choices).to.deep.equal({
        title: 'Also remove Bob Schneider from:',
        options: [{ label: 'sales-team · Shared mailbox', checked: true }],
      });
      expect(question?.lines).to.include(
        'Bob Schneider stays in all-staff, which you do not manage.'
      );
      // Moved first: a removal is judged on the group, wherever he is, and
      // a move refused leaves him in his groups as well.
      expect(calls).to.deep.equal(['move', 'remove sales-team']);
      expect((await run(false, false, true)).calls).to.deep.equal(['move']);
      // Groups that could not be listed are said to be.
      expect((await run(false, false, false, true)).question?.lines).to.include(
        'The groups Bob Schneider belongs to could not be listed.'
      );
      expect(
        (await run(false, false, false, 'thrown')).question?.lines
      ).to.include('The groups Bob Schneider belongs to could not be listed.');
      expect(toast.textContent).to.equal('bob (Sales) is in transit');
      expect((await run(true)).calls).to.deep.equal(['move']);
      expect((await run(false, true)).toast.textContent).to.equal(
        'bob (Sales) is in transit; still in sales-team'
      );
    });

    it('should name the person to claim, not their identifier', async () => {
      const titles: string[] = [];
      const app = consoleIn({}) as unknown as {
        scope: Scope;
        api: object;
        openPanel(title: string): void;
        claim(
          entity: EntityDescriptor,
          id: string,
          name?: string
        ): Promise<void>;
      };
      app.scope = {
        user: 'eric',
        unrestricted: false,
        described: true,
        transit: 'ou=transit,dc=example,dc=com',
        branches: [
          { dn: 'ou=Backend,dc=example,dc=com', read: true, write: true },
        ],
        entities: [],
      };
      Object.assign(app.api, {
        organizationOptions: async () => [
          {
            dn: 'ou=Backend,dc=example,dc=com',
            label: 'Engineering / Backend',
          },
        ],
      });
      app.openPanel = (title: string) => {
        titles.push(title);
      };
      await app.claim(users, 'bob', 'Bob Schneider');
      expect(titles).to.deep.equal(['Claim Bob Schneider']);
    });

    it('should name the organization alone on the claim button, a slash in its name kept', async () => {
      // The select shows the whole path; the button says the leaf. The path
      // is split on the separator as the directory writes it, ` / `: a name
      // holding a bare slash is one segment.
      const body = { innerHTML: '', querySelector: () => null };
      const app = consoleIn({}) as unknown as {
        scope: Scope;
        api: object;
        openPanel(title: string, build: (body: unknown) => void): void;
        claim(
          entity: EntityDescriptor,
          id: string,
          name?: string
        ): Promise<void>;
      };
      app.scope = {
        user: 'eric',
        unrestricted: false,
        described: true,
        transit: 'ou=transit,dc=example,dc=com',
        branches: [
          { dn: 'ou=R&D/IT,dc=example,dc=com', read: true, write: true },
        ],
        entities: [],
      };
      Object.assign(app.api, {
        organizationOptions: async () => [
          {
            dn: 'ou=R&D/IT,ou=Engineering,dc=example,dc=com',
            label: 'Engineering / R&D/IT',
          },
        ],
      });
      app.openPanel = (_title: string, build: (body: unknown) => void) => {
        build(body);
      };
      await app.claim(users, 'bob', 'Bob Schneider');
      expect(body.innerHTML).to.include('Claim into R&amp;D&#x2F;IT</button>');
      expect(body.innerHTML).to.include(
        '>Engineering &#x2F; R&amp;D&#x2F;IT</option>'
      );
    });

    it('should say where a handed-over entry comes from', async () => {
      // In transit the entry no longer names its organization: the toast is
      // the last place that says where it came from.
      const toast = toastElement();
      const moved: string[] = [];
      const app = consoleIn({ '[data-toast]': toast }) as unknown as {
        scope: Scope;
        api: object;
        confirmAction(): Promise<boolean>;
        renderMain(): Promise<void>;
        readTransit(): Promise<null>;
        handOver(
          entity: EntityDescriptor,
          id: string,
          entry: Entry
        ): Promise<void>;
      };
      app.scope = {
        transit: 'ou=transit,dc=example,dc=com',
      } as unknown as Scope;
      app.confirmAction = async () => true;
      app.renderMain = async () => undefined;
      app.readTransit = async () => null;
      Object.assign(app.api, {
        move: async (_entity: EntityDescriptor, id: string) => {
          moved.push(id);
        },
      });
      await app.handOver(users, 'bob', {
        dn: 'uid=bob,ou=users,dc=example,dc=com',
        uid: 'bob',
        twakeDepartmentPath: 'Sales / Germany',
      });
      expect(moved).to.deep.equal(['bob']);
      expect(toast.textContent).to.equal('bob (Sales / Germany) is in transit');

      await app.handOver(users, 'bob', {
        dn: 'uid=bob,ou=users,dc=example,dc=com',
        uid: 'bob',
      });
      expect(toast.textContent).to.equal('bob is in transit');
    });

    it('should explain a refused deletion of an entry still pointed at', async () => {
      const positions: EntityDescriptor = {
        key: 'positions',
        pluralName: 'positions',
        singularName: 'position',
        mainAttribute: 'cn',
        base: 'ou=positions,dc=example,dc=com',
        schema: { attributes: { cn: { type: 'string', role: 'identifier' } } },
        endpoint: '/api/v1/ldap/positions',
        kind: 'flat',
      };
      const staff: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            title: {
              type: 'pointer',
              branch: ['ou=positions,dc=example,dc=com'],
              label: { en: 'Position', fr: 'Poste' },
            },
          },
        },
      };
      const toast = toastElement();
      const app = consoleIn({ '[data-toast]': toast }, 'fr') as unknown as {
        entities: EntityDescriptor[];
        confirmDelete(entity: EntityDescriptor, id: string): Promise<void>;
        deleteMany(entity: EntityDescriptor, ids: string[]): Promise<boolean>;
      };
      app.entities = [staff, positions];
      Object.assign(app, { confirmAction: async () => true });
      const refusal = {
        error:
          'Cannot delete cn=Sales Manager,ou=positions,dc=example,dc=com: still referenced by another entry (title)',
      };
      nock(baseUrl)
        .delete('/api/v1/ldap/positions/Sales%20Manager')
        .reply(409, refusal);
      await app.confirmDelete(positions, 'Sales Manager');
      expect(toast.textContent).to.equal(
        'Sales Manager est encore utilisé par des entrées (Poste) : modifiez-les d’abord'
      );

      nock(baseUrl)
        .delete('/api/v1/ldap/positions/Sales%20Manager')
        .reply(409, refusal);
      nock(baseUrl).delete('/api/v1/ldap/positions/Intern').reply(403, {
        error: 'Token does not have permission on this branch',
        code: 'forbidden',
      });
      nock(baseUrl)
        .delete('/api/v1/ldap/positions/Trainee')
        .reply(400, { error: 'Not allowed' });
      nock(baseUrl).delete('/api/v1/ldap/positions/Clerk').reply(200, {});
      // Each refusal in the console's words, the entry named once.
      expect(
        await app.deleteMany(positions, [
          'Sales Manager',
          'Intern',
          'Trainee',
          'Clerk',
        ])
      ).to.equal(true);
      expect(toast.textContent).to.equal(
        'Sales Manager est encore utilisé par des entrées (Poste) : modifiez-les d’abord · ' +
          'Vous n’administrez pas Intern : cette modification ne vous revient pas. · ' +
          'Trainee : Le serveur a refusé : Not allowed'
      );
    });

    it('should explain a refused deletion of a non-empty organization', async () => {
      const toast = toastElement();
      const app = consoleIn({ '[data-toast]': toast }, 'fr');
      const dn = 'ou=QA Lab,ou=organization,dc=example,dc=com';
      const organizations = { key: 'organizations' } as EntityDescriptor;
      const call = app as unknown as {
        confirmDeleteOrganization(
          entity: EntityDescriptor,
          entry: Entry,
          dn: string
        ): Promise<void>;
      };
      Object.assign(app, { confirmAction: async () => true });
      nock(baseUrl)
        .delete(`/api/v1/ldap/organizations/${encodeURIComponent(dn)}`)
        .reply(409, { error: `Entry ${dn} is not empty` });
      await call.confirmDeleteOrganization(organizations, { dn }, dn);
      expect(toast.textContent).to.equal(
        'QA Lab n’est pas vide : déplacez ou supprimez d’abord ses entrées'
      );
    });

    it('should keep an open panel, and what was typed, across a change of language', () => {
      const typed = { hidden: false, value: 'E9901' };
      let drawn = false;
      const replaced: unknown[] = [];
      const fresh = {
        hidden: true,
        replaceWith: (element: unknown) => replaced.push(element),
      };
      const app = new DirectoryConsole({
        containerId: 'console',
        apiBaseUrl: baseUrl,
        language: 'en',
      }) as unknown as {
        container: unknown;
        translator: Translator;
        renderMain(): Promise<void>;
        changeLanguage(code: string): void;
      };
      app.container = {
        set innerHTML(_html: string) {
          drawn = true;
        },
        querySelector: (selector: string) =>
          selector === '[data-panel]' ? (drawn ? fresh : typed) : null,
        querySelectorAll: () => [],
      };
      app.renderMain = () => Promise.resolve();
      app.changeLanguage('fr');
      expect(app.translator.language).to.equal('fr');
      expect(replaced).to.deep.equal([typed]);

      // A closed one is drawn afresh, in the new language.
      typed.hidden = true;
      drawn = false;
      app.changeLanguage('en');
      expect(replaced).to.have.length(1);
    });

    it('should name the transit branch in the scope banner, tooltip included', () => {
      const app = consoleIn({}) as unknown as {
        scope: Scope;
        scopeMarkup(): SafeHtml;
      };
      app.scope = {
        user: 'sophie.martin',
        unrestricted: false,
        branches: [
          {
            dn: 'ou=Sales,ou=organization,dc=example,dc=com',
            name: 'Sales',
            path: 'Sales',
            read: true,
            write: true,
          },
        ],
        entities: [],
        transit: 'ou=Transit,ou=organization,dc=example,dc=com',
      };
      const markup = app.scopeMarkup().markup;
      expect(markup).to.contain('title="Transit">Transit</a>');
      expect(markup).to.not.contain('title="ou=Transit');
      // "Transit Transit (1)" said it twice: the label goes (#171), and
      // stays before a branch named otherwise.
      expect(markup).to.not.contain(
        '<span class="dc-scope-label">Transit</span>'
      );
      app.scope.transit = 'ou=Mobility,ou=organization,dc=example,dc=com';
      expect(app.scopeMarkup().markup)
        .to.contain('<span class="dc-scope-label">Transit</span>')
        .and.contain('title="Mobility">Mobility</a>');
    });
  });

  describe('the list, between visits', () => {
    /**
     * The controls of one drawing of a list. Each repaint binds them again,
     * so only the listener bound last is live, as in a browser.
     */
    const controls = () => {
      const control = (dataset: Record<string, string> = {}) => {
        let handler: ((event: unknown) => void) | undefined;
        const made = {
          value: '',
          dataset,
          fire: () => handler?.({ target: made }),
          addEventListener: (
            _type: string,
            callback: (event: unknown) => void
          ) => {
            handler = callback;
          },
        };
        return made;
      };
      const search = control();
      const field = control();
      const next = control({ page: '1' });
      const holder = stubContainer();
      Object.assign(holder, {
        querySelector: (selector: string) =>
          selector === '[data-search]'
            ? search
            : selector === '[data-search-attribute]'
              ? field
              : null,
        querySelectorAll: (selector: string) =>
          selector === '[data-page]' ? [next] : [],
      });
      return { holder, search, field, next };
    };

    it('should come back to the search, the field and the page it was left on', async () => {
      // Back from a card drew the list anew: an empty box, "Every field",
      // the prompt to type, and no rows.
      const app = consoleIn({});
      const loads: [string | undefined, string | undefined][] = [];
      const entries: Record<string, Entry> = {};
      for (let i = 10; i < 40; i++)
        entries[`alice${i}`] = {
          dn: `uid=alice${i},ou=users,dc=example,dc=com`,
          uid: `alice${i}`,
        };
      Object.assign((app as unknown as { api: object }).api, {
        listBounded: async (
          _entity: EntityDescriptor,
          search?: string,
          attribute?: string
        ) => {
          loads.push([search, attribute]);
          return { entries, truncated: false };
        },
      });
      const visit = async () => {
        const list = controls();
        const main = {
          innerHTML: '',
          querySelector: (selector: string) =>
            selector === '[data-list]' ? list.holder : null,
        };
        await (
          app as unknown as {
            renderList(main: unknown, entity: EntityDescriptor): Promise<void>;
          }
        ).renderList(main, users);
        return list;
      };

      const first = await visit();
      first.field.value = 'mail';
      first.field.fire();
      first.search.value = 'alice';
      first.search.fire();
      await new Promise(resolve => setTimeout(resolve, 300));
      first.next.fire();
      expect(first.holder.innerHTML).to.contain('26–30 of 30');
      expect(loads).to.deep.equal([['alice', 'mail']]);

      const back = await visit();
      expect(loads).to.deep.equal([
        ['alice', 'mail'],
        ['alice', 'mail'],
      ]);
      expect(back.holder.innerHTML)
        .to.contain('value="alice"')
        .and.match(/<option value="mail" selected>/)
        .and.contain('26–30 of 30');
    });
  });

  describe('an address naming no page', () => {
    const organizations: EntityDescriptor = {
      key: 'organizations',
      pluralName: 'organizations',
      singularName: 'organization',
      mainAttribute: 'ou',
      base: 'ou=organization,dc=example,dc=com',
      schema: { attributes: { ou: { type: 'string', role: 'identifier' } } },
      endpoint: '/api/v1/ldap/organizations',
      kind: 'organization',
    };

    /**
     * A console on the page this hash names, its views recording which one
     * was drawn and its navigation which entry was highlighted.
     */
    const visit = async (hash: string, language = 'en') => {
      const main = { innerHTML: '', querySelectorAll: () => [] };
      const nav = ['', 'users', 'organizations', 'mailboxTypes'].map(key => {
        const item = {
          dataset: { nav: key },
          active: false,
          classList: {
            contains: () => false,
            toggle: (_name: string, on: boolean) => {
              item.active = on;
            },
          },
          setAttribute: () => undefined,
          removeAttribute: () => undefined,
        };
        return item;
      });
      const app = new DirectoryConsole({
        containerId: 'console',
        apiBaseUrl: baseUrl,
        language,
      });
      const drawn: string[] = [];
      Object.assign(app as unknown as object, {
        container: {
          querySelector: (selector: string) =>
            selector === '[data-main]' ? main : null,
          querySelectorAll: (selector: string) =>
            selector === '[data-nav]' ? nav : [],
        },
        entities: [users, organizations, mailboxTypes],
        policiesReadable: true,
        renderList: async (_main: unknown, entity: EntityDescriptor) => {
          drawn.push(`list ${entity.key}`);
        },
        renderDetail: async (
          _main: unknown,
          entity: EntityDescriptor,
          id: string
        ) => {
          drawn.push(`detail ${entity.key} ${id}`);
        },
        renderOrganizations: async () => {
          drawn.push('organizations');
        },
        renderPolicies: async () => {
          drawn.push('policies');
        },
      });
      const g = globalThis as Record<string, unknown>;
      const original = g.window;
      g.window = { location: { hash } };
      try {
        await (app as unknown as { followHash(): Promise<void> }).followHash();
      } finally {
        g.window = original;
      }
      return {
        main,
        drawn,
        highlighted: nav
          .filter(item => item.active)
          .map(item => item.dataset.nav),
      };
    };

    it('should say there is no page, with a way to the overview', async () => {
      // A mistyped or outdated link drew the overview, as if it had worked.
      for (const [language, text, link] of [
        ['en', 'There is no page at this address.', 'Go to the Overview'],
        ['fr', 'Il n’y a pas de page à cette adresse.', 'Aller à l’accueil'],
        ['mn', 'Энэ хаягт хуудас алга.', 'Нүүр хуудас руу очих'],
      ]) {
        for (const hash of ['#/passwordPolicies', '#/accountStates/active']) {
          const { main, drawn, highlighted } = await visit(hash, language);
          expect(main.innerHTML)
            .to.include(text)
            .and.include(`href="#/">${link}</a>`)
            .and.not.include('dc-dashboard');
          expect(drawn).to.deep.equal([]);
          expect(highlighted).to.deep.equal([]);
        }
      }
    });

    it('should still open the overview and every page that exists', async () => {
      for (const hash of ['', '#', '#/']) {
        const { main, highlighted } = await visit(hash);
        expect(main.innerHTML).to.include('dc-dashboard');
        expect(highlighted).to.deep.equal(['']);
      }
      const pages: [string, string][] = [
        ['#/users', 'list users'],
        ['#/users/alice', 'detail users alice'],
        ['#/mailboxTypes', 'list mailboxTypes'],
        ['#/organizations', 'organizations'],
        ['#/organizations/ou=Sales', 'organizations'],
        ['#/password-policies', 'policies'],
      ];
      for (const [hash, page] of pages) {
        const { main, drawn } = await visit(hash);
        expect(drawn, hash).to.deep.equal([page]);
        expect(main.innerHTML, hash).to.not.include('There is no page');
      }
    });
  });

  describe('an account administering nothing', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const organizations: EntityDescriptor = {
      key: 'organizations',
      pluralName: 'organizations',
      singularName: 'organization',
      mainAttribute: 'ou',
      base: top,
      schema: { attributes: { ou: { type: 'string', role: 'identifier' } } },
      endpoint: '/api/v1/ldap/organizations',
      kind: 'organization',
    };
    const notice =
      'You administer no branch: there is nothing here for you to manage.';

    /** A console with this scope, which records what it asks the server. */
    const setup = (scope: Scope) => {
      const asked: string[] = [];
      const holder = stubContainer();
      const main = {
        innerHTML: '',
        querySelector: (selector: string): unknown =>
          ({
            '[data-list]': holder,
            '[data-detail]': stubContainer(),
            '[data-tree]': treeContainer(),
          })[selector] ?? null,
      };
      const app = consoleIn({ '[data-main]': main });
      Object.assign(app as unknown as object, {
        scope,
        entities: [users, organizations],
      });
      Object.assign((app as unknown as { api: object }).api, {
        listBounded: async () => {
          asked.push('list');
          return { entries: {}, truncated: false };
        },
        get: async () => {
          asked.push('get');
          return { dn: 'uid=bob,ou=users,dc=example,dc=com', uid: 'bob' };
        },
        organizationTop: async () => {
          asked.push('top');
          return null;
        },
      });
      const views = app as unknown as {
        renderList(main: unknown, entity: EntityDescriptor): Promise<void>;
        renderDetail(
          main: unknown,
          entity: EntityDescriptor,
          id: string,
          generation: number
        ): Promise<void>;
        renderOrganizations(main: unknown, generation: number): Promise<void>;
      };
      return { views, main, holder, asked };
    };
    const nobody: Scope = {
      user: 'alice',
      unrestricted: false,
      described: true,
      branches: [],
      entities: [],
    };

    it('should say there is nothing to manage, and ask nothing the server would refuse', async () => {
      // Each page answered in red with the server's "Token does not have
      // permission on this branch".
      const { views, main, holder, asked } = setup(nobody);
      await views.renderList(main, users);
      expect(holder.innerHTML).to.contain(notice).and.not.contain('error');
      await views.renderDetail(main, users, 'bob', 0);
      expect(main.innerHTML).to.contain(notice);
      await views.renderOrganizations(main, 0);
      expect(main.innerHTML).to.contain(notice);
      expect(asked).to.deep.equal([]);
    });

    it('should still read for an unrestricted or undescribed scope, which names no branch either', async () => {
      for (const scope of [
        { ...nobody, unrestricted: true },
        { ...nobody, described: false },
      ]) {
        const { views, main, holder, asked } = setup(scope);
        await views.renderList(main, users);
        expect(holder.innerHTML).to.not.contain(notice);
        await views.renderDetail(main, users, 'bob', 0);
        await views.renderOrganizations(main, 0);
        expect(asked).to.include.members(['get', 'top']);
      }
    });
  });

  describe('the overview, in names', () => {
    const admin = 'uid=admin,ou=users,dc=example,dc=com';
    const alice = 'uid=alice,ou=users,dc=example,dc=com';
    const global: Scope = {
      user: admin,
      unrestricted: false,
      described: true,
      branches: [
        { dn: 'dc=example,dc=com', read: true, write: true, delete: true },
      ],
      entities: [{ name: 'users', base: users.base, create: true }],
    };
    const nobody: Scope = { ...global, user: alice, branches: [] };

    /**
     * A console for this scope, the account read as `read` answers, and its
     * server offering to sign out.
     */
    const setup = (
      scope: Scope,
      read: () => Promise<Entry> = async () => ({
        dn: admin,
        uid: 'admin',
        cn: 'Ada Admin',
        mail: 'admin@example.com',
      }),
      language = 'en'
    ) => {
      const main = { innerHTML: '', querySelectorAll: () => [] };
      const app = consoleIn({ '[data-main]': main }, language);
      const asked: string[] = [];
      Object.assign(app as unknown as object, {
        scope,
        entities: [users, groups, mailboxTypes],
      });
      Object.assign((app as unknown as { api: object }).api, {
        logoutPath: '/logout',
        get: async (entity: EntityDescriptor, id: string) => {
          asked.push(`${entity.key} ${id}`);
          return read();
        },
      });
      const inner = app as unknown as {
        account: unknown;
        container: { innerHTML: string };
        readAccount(): Promise<unknown>;
        renderDashboard(main: unknown): void;
        drawShell(): void;
        scopeMarkup(): SafeHtml;
      };
      const overview = async (): Promise<string> => {
        inner.account = await inner.readAccount();
        inner.renderDashboard(main);
        return main.innerHTML;
      };
      const shell = (): string => {
        inner.drawShell();
        return inner.container.innerHTML;
      };
      return { app: inner, asked, overview, shell };
    };

    it('should greet the account by its name and address, read as its card is', async () => {
      // "Signed in as uid=admin,ou=users,dc=example,dc=com"
      const { asked, overview } = setup(global);
      const html = await overview();
      expect(html)
        .to.include('Signed in as Ada Admin (admin@example.com)')
        .and.include('What you can manage')
        .and.include('data-open="users"')
        .and.not.include(admin);
      expect(asked).to.deep.equal(['users admin']);

      const fr = setup(global, undefined, 'fr');
      expect(await fr.overview()).to.include(
        'Connecté en tant que Ada Admin (admin@example.com)'
      );
    });

    it('should fall back to the identifier when the account cannot be read', async () => {
      // A department head's own account, attached to the organization above
      // the one they administer: authz-linid1 hides it from them (#157).
      const local: Scope = {
        ...global,
        branches: [
          {
            dn: 'ou=sales,ou=organization,dc=example,dc=com',
            read: true,
            write: true,
            delete: true,
          },
        ],
      };
      const { asked, overview } = setup(local, async () => {
        throw Object.assign(new Error('Not found'), { status: 404 });
      });
      expect(await overview())
        .to.include('Signed in as admin<')
        .and.not.include(admin);
      // Its link decides, which the scope does not give: it is still asked
      expect(asked).to.deep.equal(['users admin']);
      // Nor is a DN no entity holds greeted whole
      const outside = setup({ ...global, user: 'cn=root,dc=example,dc=com' });
      expect(await outside.overview())
        .to.include('Signed in as root<')
        .and.not.include('cn=root');
      expect(outside.asked).to.deep.equal([]);
      // A user the scope names otherwise than by a DN is shown as it comes
      const plain = setup({ ...global, user: 'admin@example.com' });
      expect(await plain.overview()).to.include(
        'Signed in as admin@example.com<'
      );
      // An account with no address is still named
      const nameless = setup(global, async () => ({ dn: admin, cn: 'Ada' }));
      expect(await nameless.overview()).to.include('Signed in as Ada<');
    });

    it('should tell an account administering nothing once, and where to turn', async () => {
      // Three cards, each opening on "nothing to manage", and a green dot
      const { app, asked, overview, shell } = setup(nobody);
      const html = await overview();
      expect(html)
        .to.include('There is nothing for you to manage here')
        .and.include(
          'Your account (alice) does not administer any part of the directory.'
        )
        .and.match(
          /<a class="dc-button dc-button-primary" href="[^"]+logout">Sign out<\/a>/
        )
        .and.include('Signed in as alice')
        .and.not.include('What you can manage')
        .and.not.include('dc-card')
        .and.not.include('data-open');
      // The server refuses such an account every read: none is asked
      expect(asked).to.deep.equal([]);
      expect(app.scopeMarkup().markup).to.include(
        'dc-scope-empty dc-scope-none'
      );
      expect(shell())
        .to.include('data-nav=""')
        .and.not.include('data-nav="users"')
        .and.not.include('data-nav-toggle');

      const local = setup({
        ...nobody,
        branches: [
          { dn: 'ou=Sales,dc=example,dc=com', read: true, write: true },
        ],
      });
      expect(local.app.scopeMarkup().markup).to.not.include('dc-scope-none');
      expect(local.shell())
        .to.include('data-nav="users"')
        .and.include('data-nav="mailboxTypes"');
      expect(await local.overview())
        .to.include('What you can manage')
        .and.not.include('There is nothing for you to manage here');
    });

    it('should name each language in itself', () => {
      const { shell } = setup(global, undefined, 'fr');
      const options = [
        ...shell().matchAll(
          /<option value="(\w+)" lang="(\w+)"[^>]*>([^<]*)</g
        ),
      ].map(([, value, lang, text]) => [value, lang, text]);
      expect(options).to.deep.equal([
        ['en', 'en', 'English'],
        ['fr', 'fr', 'Français'],
        ['mn', 'mn', 'Монгол'],
      ]);
      for (const code of availableLanguages)
        expect(languageName(code), code).to.not.equal(code);
    });
  });
});
