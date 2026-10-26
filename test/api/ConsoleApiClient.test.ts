import { expect } from 'chai';
import nock from 'nock';
import { listLoader } from '../../src/DirectoryConsole';
import {
  ConsoleApiClient,
  isDomainBranch,
  isLarge,
} from '../../src/api/ConsoleApiClient';
import { LIST_LIMIT, listFailure } from '../../src/components/EntityList';
import {
  beforeToday,
  escapeDnValue,
  explainRefusal,
  formatByteSize,
  isDnShaped,
  nameAttributes,
  parseByteSize,
  rdnValue,
  resolveText,
} from '../../src/format';
import { Translator } from '../../src/i18n';
import type {
  EntityDescriptor,
  EntitySchema,
  Entry,
  Scope,
} from '../../src/types';
import { baseUrl, consoleIn } from '../support/stubs';
import {
  usersSchema,
  users,
  groups,
  twakeGroups,
  mailboxTypes,
  staff,
} from '../fixtures/entities';

describe('ConsoleApiClient', () => {
  afterEach(() => nock.cleanAll());

  describe('ConsoleApiClient', () => {
    it('should turn the server configuration into entities', async () => {
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          ldapBase: 'dc=example,dc=com',
          features: {
            ldapFlatGeneric: {
              flatResources: [
                {
                  name: 'twakeUser',
                  singularName: 'user',
                  pluralName: 'users',
                  mainAttribute: 'uid',
                  base: 'ou=users,dc=example,dc=com',
                  schema: usersSchema,
                },
              ],
            },
            ldapGroups: {
              enabled: true,
              base: 'ou=groups,dc=example,dc=com',
              mainAttribute: 'cn',
              schema: { attributes: { cn: { type: 'string' } } },
            },
            ldapOrganizations: {
              enabled: true,
              topOrganization: 'ou=organization,dc=example,dc=com',
              pathSeparator: ' / ',
              schema: {
                attributes: {
                  ou: { type: 'string', role: 'identifier' },
                  twakeDepartmentPath: {
                    type: 'string',
                    role: 'organizationPath',
                  },
                },
              },
            },
          },
        });

      const client = new ConsoleApiClient(baseUrl);
      const entities = await client.discover();

      expect(entities.map(entity => entity.key)).to.deep.equal([
        'users',
        'groups',
        'organizations',
      ]);
      const user = entities[0];
      // The console never learns an attribute name: it asks for the role.
      expect(user.organizationLink).to.equal('twakeDepartmentLink');
      expect(user.accountStatus).to.equal('twakeAccountStatus');
      expect(user.password).to.equal('userPassword');
      expect(client.organizationPathSeparator).to.equal(' / ');
      expect(client.organizationRoot).to.equal(
        'ou=organization,dc=example,dc=com'
      );
    });

    it('should learn where groups take members outside the directory', async () => {
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          features: {
            externalUsersInGroups: {
              enabled: true,
              branch: 'ou=external,dc=example,dc=com',
              rdnAttribute: 'mail',
              managedDomains: ['Example.com'],
            },
          },
        });
      const client = new ConsoleApiClient(baseUrl);
      expect(client.externalMembers).to.equal(undefined);
      await client.discover();
      expect(client.externalMembers).to.deep.equal({
        branch: 'ou=external,dc=example,dc=com',
        rdnAttribute: 'mail',
        managedDomains: ['example.com'],
      });

      // An ldap-rest that predates it publishes nothing.
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, { apiPrefix: '/api', features: {} });
      await client.discover();
      expect(client.externalMembers).to.equal(undefined);
    });

    it('should learn whether team mailboxes keep their members to their domain', async () => {
      const client = new ConsoleApiClient(baseUrl);
      const learn = async (features: object): Promise<boolean> => {
        nock(baseUrl)
          .get('/api/v1/config')
          .reply(200, { apiPrefix: '/api', features });
        await client.discover();
        return client.teamMailboxesKeepDomain;
      };
      expect(client.teamMailboxesKeepDomain).to.equal(false);
      expect(await learn({ james: { teamMailboxAnyDomain: false } })).to.equal(
        true
      );
      expect(await learn({ james: { teamMailboxAnyDomain: true } })).to.equal(
        false
      );
      // An ldap-rest that predates the rule, or no Twake Mail: nothing kept.
      expect(await learn({})).to.equal(false);
    });

    it('should learn how the deployment writes a full name', async () => {
      const learn = async (console?: object): Promise<string | undefined> => {
        const client = new ConsoleApiClient(baseUrl);
        nock(baseUrl)
          .get('/api/v1/config')
          .reply(200, { apiPrefix: '/api', features: { console } });
        await client.discover();
        return client.fullNameFormat;
      };
      expect(await learn({ fullNameFormat: '{surname} {givenName}' })).to.equal(
        '{surname} {givenName}'
      );
      // Unset, empty or an image that predates it: the console's default.
      expect(await learn({ fullNameFormat: '' })).to.equal(undefined);
      expect(await learn({ hiddenAttributes: [] })).to.equal(undefined);
    });

    it('should leave out the attributes the deployment hides', async () => {
      // Under "Mailbox settings" with no effect in a Twake deployment, they
      // were filled in by administrators expecting one (#62, #63).
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          features: {
            console: { hiddenAttributes: ['twakeOtherMailbox', 'MAIL'] },
            ldapFlatGeneric: {
              flatResources: [
                {
                  name: 'twakeUser',
                  singularName: 'user',
                  pluralName: 'users',
                  mainAttribute: 'uid',
                  base: 'ou=users,dc=example,dc=com',
                  schema: {
                    attributes: {
                      ...usersSchema.attributes,
                      twakeOtherMailbox: { type: 'array' },
                    },
                  },
                },
              ],
            },
          },
        });
      const [user] = await new ConsoleApiClient(baseUrl).discover();
      expect(user.schema.attributes).to.not.have.property('twakeOtherMailbox');
      // Named whatever the case, as LDAP names attributes.
      expect(user.schema.attributes).to.not.have.property('mail');
      expect(user.schema.attributes).to.have.property('uid');
      // The server's own schema is left as it came.
      expect(usersSchema.attributes).to.have.property('mail');
    });

    describe('the groups an account belongs to', () => {
      const john = 'uid=john.doe,ou=users,dc=example,dc=com';

      it('should search the groups holding the DN as a member', async () => {
        // Without the memberof overlay, `memberOf` is empty and the card
        // listed no mailing list (#70). The Twake groups are large, being
        // attached to the organization tree: the exact search is bounded
        // by itself, and asked all the same.
        expect(isLarge(twakeGroups)).to.equal(true);
        nock(baseUrl)
          .get('/api/v1/ldap/groups')
          .query({ match: `(member=${john})`, attributes: 'cn' })
          .reply(200, {
            staff: { dn: staff.dn, cn: 'staff' },
          });
        const found = await new ConsoleApiClient(baseUrl).memberships(john, [
          users,
          twakeGroups,
        ]);
        expect(found).to.deep.equal([staff.dn]);
      });

      it('should find no group where ldap-rest refuses the filter', async () => {
        // ldap-rest before 0.20.1 refused a dot in it.
        nock(baseUrl)
          .get('/api/v1/ldap/groups')
          .query(true)
          .reply(400, { error: 'Invalid match query' });
        const found = await new ConsoleApiClient(baseUrl).memberships(john, [
          twakeGroups,
        ]);
        expect(found).to.deep.equal([]);
      });

      it('should ask nothing for a DN no filter can hold', async () => {
        const groupList = nock(baseUrl)
          .get('/api/v1/ldap/groups')
          .query(true)
          .reply(200, { staff });
        const client = new ConsoleApiClient(baseUrl);
        // An escaped comma, and a `+` joining a second attribute to the RDN,
        // which ldap-rest refuses in a filter.
        for (const dn of [
          'cn=Smith\\, John,ou=users,dc=example,dc=com',
          'cn=John+uid=jdoe,ou=users,dc=example,dc=com',
        ])
          expect(await client.memberships(dn, [twakeGroups])).to.deep.equal([]);
        expect(groupList.isDone()).to.equal(false);
      });

      it('should fail, when asked to, where the groups cannot be searched', async () => {
        // The deletion dialog tells groups it could not list from none (#157).
        const client = new ConsoleApiClient(baseUrl);
        const refusedDn = 'cn=Smith\\, John,ou=users,dc=example,dc=com';
        const failure = async (search: Promise<unknown>): Promise<unknown> =>
          search.then(
            () => undefined,
            (err: unknown) => err
          );
        expect(
          await failure(client.memberships(refusedDn, [twakeGroups], true))
        ).to.be.instanceOf(Error);
        for (const status of [403, 500]) {
          nock(baseUrl)
            .get('/api/v1/ldap/groups')
            .query(true)
            .reply(status, { error: 'No' });
          const err = await failure(
            client.memberships(john, [users, twakeGroups], true)
          );
          expect(err).to.have.property('status', status);
        }
        // Found none is not a failure
        nock(baseUrl).get('/api/v1/ldap/groups').query(true).reply(200, {});
        expect(
          await client.memberships(john, [twakeGroups], true)
        ).to.deep.equal([]);
      });

      it('should search a DN holding an apostrophe', async () => {
        const dn = "uid=o'brien,ou=users,dc=example,dc=com";
        nock(baseUrl)
          .get('/api/v1/ldap/groups')
          .query({ match: `(member=${dn})`, attributes: 'cn' })
          .reply(200, { staff: { dn: staff.dn, cn: 'staff' } });
        const found = await new ConsoleApiClient(baseUrl).memberships(dn, [
          twakeGroups,
        ]);
        expect(found).to.deep.equal([staff.dn]);
      });
    });

    describe('searching the organization tree', () => {
      const orgTop = 'ou=organization,dc=example,dc=com';
      const discover = async (search?: string): Promise<ConsoleApiClient> => {
        nock(baseUrl)
          .get('/api/v1/config')
          .reply(200, {
            apiPrefix: '/api',
            ldapBase: 'dc=example,dc=com',
            features: {
              ldapOrganizations: {
                enabled: true,
                topOrganization: orgTop,
                endpoints: search ? { search } : {},
                schema: {
                  attributes: {
                    ou: { type: 'string', role: 'identifier' },
                    twakeDepartmentPath: {
                      type: 'string',
                      role: 'organizationPath',
                    },
                  },
                },
              },
            },
          });
        const client = new ConsoleApiClient(baseUrl);
        await client.discover();
        return client;
      };

      it('should search the tree when the server advertises it, and only then', async () => {
        const searching = await discover(
          '/api/v1/ldap/organizations/:dn/search'
        );
        // The branch of the department pointer is above the top, and no
        // entity owns it; listing it never failed.
        expect(searching.pointerSearch('dc=example,dc=com', [])).to.be.a(
          'function'
        );
        expect(searching.pointerSearch(orgTop, [], true)).to.be.a('function');

        const older = await discover();
        expect(older.pointerSearch('dc=example,dc=com', [])).to.equal(
          undefined
        );
      });

      it('should drop the sentinel row and label by path', async () => {
        const client = await discover('/api/v1/ldap/organizations/:dn/search');
        nock(baseUrl)
          .get(
            `/api/v1/ldap/organizations/${encodeURIComponent(orgTop)}/search`
          )
          .query({ q: 'lin' })
          .reply(200, [
            {
              dn: `ou=b,${orgTop}`,
              ou: 'b',
              objectClass: ['organizationalUnit'],
              twakeDepartmentPath: 'Government / Beta',
            },
            {
              dn: `ou=a,${orgTop}`,
              ou: 'a',
              objectClass: ['organizationalUnit'],
              twakeDepartmentPath: 'Government / Alpha',
            },
            // No path: the name.
            { dn: `ou=c,${orgTop}`, ou: 'Gamma', objectClass: ['top'] },
            {
              dn: `more-organizations-${orgTop}`,
              objectClass: ['moreIndicator'],
              _isMoreIndicator: 'true',
              _displayedCount: 3,
            },
          ]);
        expect(await client.organizationSearchRead('lin')).to.deep.equal({
          organizations: [
            { dn: `ou=c,${orgTop}`, label: 'Gamma' },
            { dn: `ou=a,${orgTop}`, label: 'Government / Alpha' },
            { dn: `ou=b,${orgTop}`, label: 'Government / Beta' },
          ],
          // The sentinel says the server kept only these.
          truncated: true,
        });
      });

      it('should say a search is cut only when it was', async () => {
        const client = await discover('/api/v1/ldap/organizations/:dn/search');
        const matches = ['a', 'b', 'c'].map(ou => ({
          dn: `ou=${ou},${orgTop}`,
          ou,
          objectClass: ['organizationalUnit'],
        }));
        nock(baseUrl)
          .get(
            `/api/v1/ldap/organizations/${encodeURIComponent(orgTop)}/search`
          )
          .query(true)
          .times(3)
          .reply(200, matches);
        // Whole.
        expect(
          (await client.organizationSearchRead('x', orgTop, Infinity)).truncated
        ).to.equal(false);
        // Cut here, to the suggestions' length.
        const cut = await client.organizationSearchRead('x', orgTop, 2);
        expect(cut.organizations.map(option => option.label)).to.deep.equal([
          'a',
          'b',
        ]);
        expect(cut.truncated).to.equal(true);
        // The form's suggestions keep their plain list.
        expect(await client.organizationSearch('x', orgTop, 3)).to.have.length(
          3
        );
      });

      it('should search from the caller’s own top, not the directory’s', async () => {
        const client = await discover('/api/v1/ldap/organizations/:dn/search');
        const sales = `ou=Sales,${orgTop}`;
        // A local administrator of Sales: the server narrows the top to it.
        nock(baseUrl)
          .get('/api/v1/ldap/organizations/top')
          .once()
          .reply(200, { dn: sales, ou: 'Sales' });
        const searched: string[] = [];
        nock(baseUrl)
          .get(/\/api\/v1\/ldap\/organizations\/[^/]+\/search/)
          .query(true)
          .times(2)
          .reply(function (uri) {
            searched.push(decodeURIComponent(uri.split('/')[5]));
            return [200, [{ dn: `ou=France,${sales}`, ou: 'France' }]];
          });
        const search = client.pointerSearch('dc=example,dc=com', []);
        expect(await search?.('Fra')).to.deep.equal([
          { dn: `ou=France,${sales}`, label: 'France' },
        ]);
        // The top is asked once for the field, not at every keystroke.
        await search?.('Fran');
        expect(searched).to.deep.equal([sales, sales]);
        expect(nock.isDone()).to.be.true;
      });
    });

    it('should take an entity’s own names from its schema metadata', async () => {
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          ldapBase: 'dc=example,dc=com',
          features: {
            ldapGroups: {
              enabled: true,
              base: 'ou=groups,dc=example,dc=com',
              mainAttribute: 'cn',
              schema: {
                entity: {
                  label: { en: 'Groups', fr: 'Groupes' },
                  singularLabel: { en: 'group', fr: 'groupe' },
                },
                attributes: { cn: { type: 'string' } },
              },
            },
          },
        });
      const [groups] = await new ConsoleApiClient(baseUrl).discover();
      expect(resolveText(groups.label, 'fr')).to.equal('Groupes');
      expect(resolveText(groups.singularLabel, 'fr')).to.equal('groupe');
    });

    it('should offer to sign out only when the server says how', async () => {
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          ldapBase: 'dc=example,dc=com',
          features: {
            openidconnect: { enabled: true, endpoints: { logout: '/logout' } },
          },
        });
      const oidc = new ConsoleApiClient(baseUrl);
      await oidc.discover();
      // The server's route, not the API's: no prefix.
      expect(oidc.logoutUrl).to.equal(`${baseUrl}/logout`);

      // A server naming the plugin without a logout route: nothing to link
      // to. (An ldap-rest older than the logout support names no
      // `openidconnect` at all, which the last case covers.)
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          ldapBase: '',
          features: { openidconnect: { enabled: true } },
        });
      const older = new ConsoleApiClient(baseUrl);
      await older.discover();
      expect(older.logoutUrl).to.equal(undefined);

      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, { apiPrefix: '/api', ldapBase: '', features: {} });
      const other = new ConsoleApiClient(baseUrl);
      await other.discover();
      expect(other.logoutUrl).to.equal(undefined);
    });

    it('should say the session ended on its own origin only', async () => {
      const g = globalThis as Record<string, unknown>;
      const original = g.window;
      g.window = { location: { origin: baseUrl } };
      const other = 'http://api.example.test';
      try {
        nock(baseUrl).get('/api/v1/authz/scope').reply(401, {
          error: 'Unauthorized',
        });
        nock(other).get('/api/v1/authz/scope').reply(401, {
          error: 'Unauthorized',
        });
        let ended = 0;
        const own = new ConsoleApiClient();
        const across = new ConsoleApiClient(other);
        own.onSessionEnded = () => ended++;
        across.onSessionEnded = () => ended++;
        // The failure still reaches the caller, in case nothing reloads
        let error: unknown;
        await own.scope().catch(err => (error = err));
        expect(error).to.have.property('status', 401);
        expect(ended).to.equal(1);
        await across.scope().catch(() => undefined);
        expect(ended, 'a session at another host').to.equal(1);
      } finally {
        g.window = original;
      }
    });

    it('should ignore an entity whose schema the server did not serve', async () => {
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          ldapBase: 'dc=example,dc=com',
          features: { ldapGroups: { enabled: true, base: 'ou=groups' } },
        });
      expect(await new ConsoleApiClient(baseUrl).discover()).to.deep.equal([]);
    });

    it('should report the server’s own refusal, not a generic failure', async () => {
      nock(baseUrl)
        .post('/api/v1/ldap/users')
        .reply(409, { error: 'This email address is already used' });

      const client = new ConsoleApiClient(baseUrl);
      try {
        await client.create(users, { mail: 'taken@example.com' });
        expect.fail('the creation should have been refused');
      } catch (err) {
        expect((err as Error).message).to.equal(
          'This email address is already used'
        );
        expect((err as Error & { status: number }).status).to.equal(409);
      }
    });

    it('should hand on what ldap-rest says of a refusal besides its sentence', async () => {
      nock(baseUrl).post('/api/v1/ldap/users').reply(409, {
        error:
          'user: "alice@example.com" is already used (mail must be unique)',
        code: 'unique',
        attribute: 'mail',
        value: 'alice@example.com',
      });
      nock(baseUrl)
        .post('/api/v1/ldap/users')
        .reply(409, { error: 'Conflict' });

      const client = new ConsoleApiClient(baseUrl);
      const refusal = (err: unknown) => (err as { refusal?: unknown }).refusal;
      const first = await client
        .create(users, { mail: 'alice@example.com' })
        .catch((err: unknown) => err);
      expect(refusal(first)).to.deep.equal({
        code: 'unique',
        attribute: 'mail',
        value: 'alice@example.com',
      });
      // An older server, or another refusal: nothing besides the sentence.
      const second = await client
        .create(users, { mail: 'alice@example.com' })
        .catch((err: unknown) => err);
      expect((second as Error).message).to.equal('Conflict');
      expect(refusal(second)).to.equal(undefined);
    });

    it('should search on the chosen attribute', async () => {
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ match: 'smith', attribute: 'cn' })
        .reply(200, { jsmith: { dn: 'uid=jsmith', uid: 'jsmith' } });

      const result = await new ConsoleApiClient(baseUrl).list(
        users,
        'smith',
        'cn'
      );
      expect(result).to.have.property('jsmith');
    });

    it('should send only what changed, and what was cleared', async () => {
      let body: unknown;
      nock(baseUrl)
        .put('/api/v1/ldap/users/jsmith', received => {
          body = received;
          return true;
        })
        .reply(200, { success: true });

      await new ConsoleApiClient(baseUrl).update(
        users,
        'jsmith',
        { cn: 'John Smith' },
        ['telephoneNumber']
      );
      expect(body).to.deep.equal({
        replace: { cn: 'John Smith' },
        delete: ['telephoneNumber'],
      });
    });

    it('should not issue an empty update', async () => {
      // No interceptor: a request here would fail the test.
      await new ConsoleApiClient(baseUrl).update(users, 'jsmith', {}, []);
    });

    it('should ask an organization for its child organizations only', async () => {
      // `subnodes` answers with the child OUs *and* the entries linked to the
      // node — up to fifty accounts, plus a `moreIndicator` row counting the
      // rest. Unfiltered, all of that was drawn as organizations: a member
      // clicked in the tree answered "no longer exists", and the department
      // select of every form offered user DNs as candidate organizations.
      const dn = 'ou=Sales,ou=organization,dc=example,dc=com';
      nock(baseUrl)
        .get(`/api/v1/ldap/organizations/${encodeURIComponent(dn)}/subnodes`)
        .query({ objectClass: 'organizationalUnit' })
        .reply(200, [
          {
            dn: `ou=EU,${dn}`,
            ou: ['EU'],
            twakeDepartmentPath: ['Sales / EU'],
          },
        ]);

      const children = await new ConsoleApiClient(baseUrl).organizationChildren(
        dn
      );
      expect(children.map(node => node.name)).to.deep.equal(['EU']);
    });

    it('should not draw the truncation row as a branch of the tree', async () => {
      // A branch the directory will not list in one answer ends with that
      // row too, now that ldap-rest answers a refusal with what it can get
      // rather than with an empty list. Mapped like an entry it drew a node
      // whose DN answers nothing, right where the missing organizations are.
      const dn = 'ou=Sales,ou=organization,dc=example,dc=com';
      nock(baseUrl)
        .get(`/api/v1/ldap/organizations/${encodeURIComponent(dn)}/subnodes`)
        .query({ objectClass: 'organizationalUnit' })
        .reply(200, [
          {
            dn: `ou=EU,${dn}`,
            ou: ['EU'],
            twakeDepartmentPath: ['Sales / EU'],
          },
          {
            dn: `more-organizations-${dn}`,
            cn: ['... more organizations than the directory will list'],
            objectClass: ['moreIndicator'],
            _isMoreIndicator: 'true',
            _displayedCount: '50',
          },
        ]);

      const children = await new ConsoleApiClient(baseUrl).organizationChildren(
        dn
      );
      expect(children.map(node => node.name)).to.deep.equal(['EU']);
    });

    it('should not offer the truncation row as a member', async () => {
      // Past `ldap_organization_max_subnodes` the endpoint appends a row that
      // is not an entry: its DN is `more-` plus the organization's own, and
      // nothing answers there. Listed among the members it read as a colleague
      // named after the department, and opening it went nowhere.
      const dn = 'ou=Sales,ou=organization,dc=example,dc=com';
      nock(baseUrl)
        .get(`/api/v1/ldap/organizations/${encodeURIComponent(dn)}/subnodes`)
        .reply(200, [
          {
            dn: `ou=EU,${dn}`,
            ou: ['EU'],
            objectClass: ['organizationalUnit'],
          },
          {
            dn: `uid=jsmith,ou=users,dc=example,dc=com`,
            objectClass: ['inetOrgPerson'],
          },
          {
            dn: `more-${dn}`,
            objectClass: ['moreIndicator'],
            _isMoreIndicator: 'true',
            _totalCount: '312',
          },
        ]);

      const members = await new ConsoleApiClient(baseUrl).organizationMembers(
        dn
      );
      expect(members.entries.map(member => member.label)).to.deep.equal([
        'jsmith',
      ]);
    });

    it('should keep the count of the attached entries the server left out', async () => {
      // The card listed the fifty names the server sent and stopped there,
      // reading as a department of fifty: the count went with the row.
      const dn = 'ou=Sales,ou=organization,dc=example,dc=com';
      const subnodes = (rows: object[]) =>
        nock(baseUrl)
          .get(`/api/v1/ldap/organizations/${encodeURIComponent(dn)}/subnodes`)
          .reply(200, [
            {
              dn: 'uid=jsmith,ou=users,dc=example,dc=com',
              objectClass: ['inetOrgPerson'],
            },
            ...rows,
          ]);
      const client = new ConsoleApiClient(baseUrl);

      subnodes([
        {
          dn: `more-${dn}`,
          objectClass: ['moreIndicator'],
          _isMoreIndicator: 'true',
          _totalCount: '98',
          _displayedCount: '50',
        },
      ]);
      expect(await client.organizationMembers(dn)).to.deep.include({
        truncated: true,
        more: 48,
      });

      // A directory refusing to list them all lets nothing count the rest.
      subnodes([
        {
          dn: `more-${dn}`,
          objectClass: ['moreIndicator'],
          _isMoreIndicator: 'true',
          _displayedCount: '50',
        },
      ]);
      const uncounted = await client.organizationMembers(dn);
      expect(uncounted.truncated).to.equal(true);
      expect(uncounted.more).to.equal(undefined);

      // The child organizations' own row says nothing of the entries.
      subnodes([
        {
          dn: `more-organizations-${dn}`,
          objectClass: ['moreIndicator'],
          _isMoreIndicator: 'true',
          _displayedCount: '50',
        },
      ]);
      expect(await client.organizationMembers(dn)).to.deep.equal({
        entries: [
          { dn: 'uid=jsmith,ou=users,dc=example,dc=com', label: 'jsmith' },
        ],
        truncated: false,
      });
    });

    it('should read the configuration at the prefix it was given', async () => {
      // Every other call uses the prefix the configuration advertises. The
      // call that reads the configuration has nothing to read it from, so a
      // server behind `--api-prefix /ldap` has to be told once.
      nock(baseUrl).get('/ldap/v1/config').reply(200, {
        apiPrefix: '/ldap',
        ldapBase: 'dc=example,dc=com',
        features: {},
      });
      expect(
        await new ConsoleApiClient(baseUrl, '/ldap').discover()
      ).to.deep.equal([]);
    });

    it('should not turn a membership edit into a request the server refuses', async () => {
      // `modifyGroup` answers `Use dedicated API to replace members` to
      // `replace.member`, and the same to `delete: ['member']`: every
      // membership edit made from the form came back as a 500. The form edits
      // the list, as it should; what the server takes is who joined and who
      // left, through the endpoints it keeps for them.
      let modified: unknown;
      let joined: unknown;
      // The interceptors are the assertion: the DELETE names the member that
      // left, and a request nobody declared reaches nothing and fails.
      const scope = nock(baseUrl)
        .put('/api/v1/ldap/groups/staff', received => {
          modified = received;
          return true;
        })
        .reply(200, { success: true })
        .post('/api/v1/ldap/groups/staff/members', received => {
          joined = received;
          return true;
        })
        .reply(200, { success: true })
        .delete(
          '/api/v1/ldap/groups/staff/members/' +
            encodeURIComponent('uid=bob,ou=users,dc=example,dc=com')
        )
        .reply(200, { success: true });

      await new ConsoleApiClient(baseUrl).update(
        groups,
        'staff',
        {
          description: 'All staff',
          member: [
            'uid=alice,ou=users,dc=example,dc=com',
            'uid=carol,ou=users,dc=example,dc=com',
          ],
        },
        [],
        staff
      );

      expect(modified).to.deep.equal({ replace: { description: 'All staff' } });
      expect(joined).to.deep.equal({
        member: ['uid=carol,ou=users,dc=example,dc=com'],
      });
      expect(scope.isDone()).to.be.true;
    });

    it('should empty a membership through the endpoint that takes it', async () => {
      // Clearing the field is `delete: ['member']`, refused just the same.
      // Nothing else was edited, so there is no modify request left to make:
      // an interceptor is declared for the two departures only, and a PUT
      // here would fail the test.
      const scope = nock(baseUrl)
        .delete(
          '/api/v1/ldap/groups/staff/members/' +
            encodeURIComponent('uid=alice,ou=users,dc=example,dc=com')
        )
        .reply(200, { success: true })
        .delete(
          '/api/v1/ldap/groups/staff/members/' +
            encodeURIComponent('uid=bob,ou=users,dc=example,dc=com')
        )
        .reply(200, { success: true });

      await new ConsoleApiClient(baseUrl).update(
        groups,
        'staff',
        {},
        ['member'],
        staff
      );
      expect(scope.isDone()).to.be.true;
    });

    it('should leave an entity that is not a group alone', async () => {
      // The dedicated endpoints are the group plugin's; an attribute named
      // `member` on a flat entity is an attribute like any other.
      let body: unknown;
      nock(baseUrl)
        .put('/api/v1/ldap/users/jsmith', received => {
          body = received;
          return true;
        })
        .reply(200, { success: true });
      await new ConsoleApiClient(baseUrl).update(users, 'jsmith', {
        mailAlternateAddress: ['j@example.com'],
      });
      expect(body).to.deep.equal({
        replace: { mailAlternateAddress: ['j@example.com'] },
      });
    });

    it('should read the escaped RDN of an organization as its name', async () => {
      // A DN escapes the comma inside a value: splitting on the first one cut
      // `ou=Sales\, EU` down to `Sales\`.
      const dn = 'ou=organization,dc=example,dc=com';
      nock(baseUrl)
        .get(`/api/v1/ldap/organizations/${encodeURIComponent(dn)}/subnodes`)
        .query({ objectClass: 'organizationalUnit' })
        .reply(200, [{ dn: `ou=Sales\\, EU,${dn}` }]);

      const children = await new ConsoleApiClient(baseUrl).organizationChildren(
        dn
      );
      expect(children.map(node => node.name)).to.deep.equal(['Sales, EU']);
    });

    it('should label a raw branch by the value of its RDN', async () => {
      const branch = 'ou=positions,ou=nomenclature,dc=example,dc=com';
      nock(baseUrl)
        .get(`/api/v1/ldap/raw/children/${encodeURIComponent(branch)}`)
        .reply(200, {
          children: [
            {
              dn: `cn=Smith\\, John,${branch}`,
              rdn: 'cn=Smith\\, John',
            },
          ],
        });

      const options = await new ConsoleApiClient(baseUrl).pointerOptions(
        branch,
        []
      );
      expect(options.map(option => option.label)).to.deep.equal([
        'Smith, John',
      ]);
    });

    it('should take a collection the schema marks large for a large one', () => {
      // A directory without an organization tree: nothing to tell the
      // accounts by, but the mark.
      const accounts: EntityDescriptor = {
        ...users,
        organizationLink: undefined,
        schema: { ...usersSchema, entity: { large: true } },
      };
      expect(isLarge(users)).to.equal(true);
      expect(isLarge(mailboxTypes)).to.equal(false);
      expect(isLarge(accounts)).to.equal(true);
      expect(isLarge({ ...accounts, schema: usersSchema })).to.equal(false);
      // The mark wins over the organization link, both ways.
      expect(
        isLarge({
          ...users,
          schema: { ...usersSchema, entity: { large: false } },
        })
      ).to.equal(false);

      expect(
        new ConsoleApiClient(baseUrl).pointerSearch(accounts.base, [accounts])
      ).to.be.a('function');
    });

    it('should search a branch too large to list, and name what it finds', async () => {
      // Accounts are attached to the organization tree: a pointer to them is
      // searched, never listed whole.
      expect(
        new ConsoleApiClient(baseUrl).pointerSearch(
          mailboxTypes.base as string,
          [mailboxTypes]
        )
      ).to.equal(undefined);
      // Unless listing it failed: any branch an entity owns can be searched.
      expect(
        new ConsoleApiClient(baseUrl).pointerSearch(
          mailboxTypes.base as string,
          [mailboxTypes],
          true
        )
      ).to.be.a('function');
      // Not a branch no entity owns, which has no search to offer.
      expect(
        new ConsoleApiClient(baseUrl).pointerSearch(
          'ou=elsewhere,dc=example,dc=com',
          [mailboxTypes],
          true
        )
      ).to.equal(undefined);
      const search = new ConsoleApiClient(baseUrl).pointerSearch(
        'OU=users,dc=example,dc=com',
        [users]
      );
      expect(search).to.be.a('function');

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(query => query.match === 'jane' && Boolean(query.attribute))
        .reply(200, {
          'jane.doe': {
            dn: 'uid=jane.doe,ou=users,dc=example,dc=com',
            cn: 'Jane Doe',
          },
          jdoe: { dn: 'uid=jdoe,ou=users,dc=example,dc=com' },
        });
      const found = await (search as (q: string) => Promise<unknown>)('jane');
      expect(found).to.deep.equal([
        {
          dn: 'uid=jane.doe,ou=users,dc=example,dc=com',
          label: 'Jane Doe (jane.doe)',
          // Once chosen, named by its identifier, as a value loaded is.
          token: 'jane.doe',
        },
        // No display name: the identifier alone.
        {
          dn: 'uid=jdoe,ou=users,dc=example,dc=com',
          label: 'jdoe',
          token: 'jdoe',
        },
      ]);
    });

    it('should search members by email among accounts and groups', async () => {
      const lists: EntityDescriptor = {
        ...groups,
        schema: {
          attributes: {
            ...groups.schema.attributes,
            mail: { type: 'string', role: 'primaryEmail', searchable: true },
          },
        },
      };
      const client = new ConsoleApiClient(baseUrl);
      // Neither a nomenclature nor anything else without an address.
      expect(client.memberSearch('members', [mailboxTypes])).to.equal(
        undefined
      );
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(query => query.match === 'jane' && Boolean(query.attribute))
        .twice()
        .reply(200, {
          jane: {
            dn: 'uid=jane,ou=users,dc=example,dc=com',
            cn: 'Jane Doe',
            mail: 'jane@example.com',
          },
        });
      nock(baseUrl)
        .get('/api/v1/ldap/groups')
        .query(query => query.match === 'jane')
        .reply(200, {
          'jane-team': {
            dn: 'cn=jane-team,ou=groups,dc=example,dc=com',
            mail: 'jane-team@example.com',
          },
        });
      const members = client.memberSearch('members', [users, lists]);
      expect(await members!('jane')).to.deep.equal([
        {
          dn: 'uid=jane,ou=users,dc=example,dc=com',
          label: 'Jane Doe <jane@example.com>',
          token: 'jane',
          mail: 'jane@example.com',
        },
        {
          dn: 'cn=jane-team,ou=groups,dc=example,dc=com',
          label: 'jane-team <jane-team@example.com>',
          token: 'jane-team',
          mail: 'jane-team@example.com',
        },
      ]);
      // An owner is an account: the groups are not asked.
      const owners = client.memberSearch('owners', [users, lists]);
      expect(await owners!('jane')).to.have.length(1);
    });

    it('should search the members a caller can read when a branch refuses', async () => {
      const lists: EntityDescriptor = {
        ...groups,
        schema: {
          attributes: {
            ...groups.schema.attributes,
            mail: { type: 'string', role: 'primaryEmail' },
          },
        },
      };
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(true)
        .reply(200, {
          jane: { dn: 'uid=jane,ou=users,dc=example,dc=com', cn: 'Jane' },
        });
      nock(baseUrl).get('/api/v1/ldap/groups').query(true).reply(403, {});
      const search = new ConsoleApiClient(baseUrl).memberSearch('members', [
        users,
        lists,
      ]);
      expect(await search!('jane')).to.deep.equal([
        {
          dn: 'uid=jane,ou=users,dc=example,dc=com',
          label: 'Jane',
          token: 'jane',
        },
      ]);
    });

    it('should leave room for the groups when many accounts match', async () => {
      const lists: EntityDescriptor = {
        ...groups,
        schema: {
          attributes: {
            ...groups.schema.attributes,
            mail: { type: 'string', role: 'primaryEmail' },
          },
        },
      };
      const accounts: Record<string, Entry> = {};
      for (let i = 0; i < 30; i++)
        accounts[`jane${i}`] = {
          dn: `uid=jane${i},ou=users,dc=example,dc=com`,
          cn: `Jane ${i}`,
        };
      // Answered without its DN: no member can be written from it.
      accounts.nodn = { cn: 'No DN' };
      nock(baseUrl).get('/api/v1/ldap/users').query(true).reply(200, accounts);
      nock(baseUrl)
        .get('/api/v1/ldap/groups')
        .query(true)
        .reply(200, {
          'jane-team': { dn: 'cn=jane-team,ou=groups,dc=example,dc=com' },
        });
      const found = await new ConsoleApiClient(baseUrl).memberSearch(
        'members',
        [users, lists]
      )!('jane');
      expect(found.map(option => option.dn)).to.include(
        'cn=jane-team,ou=groups,dc=example,dc=com'
      );
      expect(found.map(option => option.label)).not.to.include('No DN');
    });

    it('should name a nomenclature value the way its schema does', async () => {
      nock(baseUrl)
        .get('/api/v1/ldap/mailboxTypes')
        .reply(200, {
          teamMailbox: {
            dn: `cn=teamMailbox,${mailboxTypes.base}`,
            cn: 'teamMailbox',
          },
          custom: { dn: `cn=custom,${mailboxTypes.base}`, cn: 'custom' },
        });

      const options = await new ConsoleApiClient(baseUrl).pointerOptions(
        mailboxTypes.base as string,
        [mailboxTypes],
        'fr'
      );
      // A value the directory added itself keeps the name it is stored as.
      expect(options.map(option => option.label)).to.deep.equal([
        'Boîte partagée',
        'custom',
      ]);
    });

    it('should offer only the entries of a branch that the schema describes', async () => {
      // A tree of mail domains keeps DNS levels to hang them from: `dc=com`
      // has no `associatedDomain`, and is no mail domain to link to (#58).
      const domains: EntityDescriptor = {
        key: 'domains',
        pluralName: 'domains',
        singularName: 'domain',
        mainAttribute: 'dc',
        base: 'ou=domains,ou=nomenclature,dc=example,dc=com',
        schema: {
          attributes: {
            dc: { type: 'string', required: true, role: 'identifier' },
            associatedDomain: {
              type: 'string',
              required: true,
              role: ['domainName', 'displayName'],
            },
            userPassword: { type: 'string', required: true, neverReturn: true },
          },
        },
        endpoint: '/api/v1/ldap/domains',
        kind: 'flat',
      };
      const tree = {
        org: { dn: `dc=org,${domains.base}`, dc: 'org' },
        example: {
          dn: `dc=example,dc=org,${domains.base}`,
          dc: 'example',
        },
        sales: {
          dn: `dc=sales,dc=example,dc=org,${domains.base}`,
          dc: 'sales',
          associatedDomain: 'sales.example.org',
        },
      };
      const client = new ConsoleApiClient(baseUrl);

      nock(baseUrl).get('/api/v1/ldap/domains').reply(200, tree);
      const options = await client.pointerOptions(domains.base as string, [
        domains,
      ]);
      expect(options).to.deep.equal([
        {
          dn: `dc=sales,dc=example,dc=org,${domains.base}`,
          label: 'sales.example.org',
        },
      ]);

      // A CSV import finds them the same way.
      const lookup = client.pointerLookup(domains.base as string, [domains])!;
      nock(baseUrl).get('/api/v1/ldap/domains').query(true).reply(200, tree);
      const found = await lookup.search('o');
      expect(found.options.map(option => option.label)).to.deep.equal([
        'sales.example.org',
      ]);
      nock(baseUrl).get('/api/v1/ldap/domains/org').reply(200, tree.org);
      expect(await lookup.read('org')).to.equal(undefined);

      // A search refused as too broad says as little as an answer cut short;
      // a failure of the server's own is no answer at all, and is thrown.
      nock(baseUrl)
        .get('/api/v1/ldap/domains')
        .query(true)
        .reply(422, { error: 'Size limit exceeded' });
      expect(await lookup.search('o')).to.deep.equal({
        options: [],
        truncated: true,
      });
      nock(baseUrl)
        .get('/api/v1/ldap/domains')
        .query(true)
        .reply(500, { error: 'Internal Server Error' });
      const thrown = await lookup.search('o').then(
        () => undefined,
        (err: unknown) => err
      );
      expect(thrown).to.be.instanceOf(Error).with.property('status', 500);
    });

    it('should name an entry by the attribute its schema calls its display name', async () => {
      // A mail domain is stored as `dc=example` and read as `example.org`.
      const domains: EntityDescriptor = {
        key: 'domains',
        pluralName: 'domains',
        singularName: 'domain',
        mainAttribute: 'dc',
        base: 'ou=domains,ou=nomenclature,dc=example,dc=com',
        schema: {
          attributes: {
            dc: { type: 'string', role: 'identifier' },
            associatedDomain: {
              type: 'string',
              role: ['domainName', 'displayName'],
            },
          },
        },
        endpoint: '/api/v1/ldap/domains',
        kind: 'flat',
      };
      nock(baseUrl)
        .get('/api/v1/ldap/domains')
        .reply(200, {
          example: {
            dn: `dc=example,${domains.base}`,
            associatedDomain: 'example.org',
          },
          bare: { dn: `dc=bare,${domains.base}` },
          one: { dn: `dc=one,${domains.base}`, associatedDomain: 'twin.org' },
          two: { dn: `dc=two,${domains.base}`, associatedDomain: 'twin.org' },
        });

      const options = await new ConsoleApiClient(baseUrl).pointerOptions(
        domains.base as string,
        [domains]
      );
      // Two entries going by one name are told apart by their identifiers.
      expect(options.map(option => option.label)).to.deep.equal([
        'example.org',
        'bare',
        'twin.org (one)',
        'twin.org (two)',
      ]);
    });

    it('should give a failure its status whatever the body it came with', async () => {
      // Not every answer comes from the API: Express's own 404 page and a
      // proxy's 502 are HTML, and reading the body as JSON first threw a
      // `SyntaxError` carrying no status at all. `scope()` then read a server
      // without `auth/authzScope` as a refusal and hid every write button.
      nock(baseUrl)
        .get('/api/v1/authz/scope')
        .reply(404, '<!DOCTYPE html><title>Error</title>', {
          'Content-Type': 'text/html',
        });
      expect(await new ConsoleApiClient(baseUrl).scope()).to.equal(null);

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .reply(502, '<html><body>Bad gateway</body></html>', {
          'Content-Type': 'text/html',
        });
      try {
        await new ConsoleApiClient(baseUrl).list(users);
        expect.fail('the failure should have been raised');
      } catch (err) {
        expect((err as Error & { status: number }).status).to.equal(502);
        expect((err as Error).message).to.contain('502');
      }
    });

    it('should tell an absent organization tree from one it could not read', async () => {
      // A 404 is a server with no top organization: there is no tree to draw.
      nock(baseUrl)
        .get('/api/v1/ldap/organizations/top')
        .reply(404, { error: 'Not found' });
      expect(await new ConsoleApiClient(baseUrl).organizationTop()).to.equal(
        null
      );

      // Anything else is a failure, and reading it as "no tree" left the tree
      // on its loading message and every department select empty.
      nock(baseUrl)
        .get('/api/v1/ldap/organizations/top')
        .reply(403, { error: 'Out of your scope' });
      try {
        await new ConsoleApiClient(baseUrl).organizationTop();
        expect.fail('the refusal should have been raised');
      } catch (err) {
        expect((err as Error).message).to.equal('Out of your scope');
        expect((err as Error & { status: number }).status).to.equal(403);
      }
    });

    it('should tell a scope the server does not serve from one it refused', async () => {
      // No `auth/authzScope` is a 404 and means the server restricts nothing.
      nock(baseUrl)
        .get('/api/v1/authz/scope')
        .reply(404, { error: 'Not found' });
      expect(await new ConsoleApiClient(baseUrl).scope()).to.equal(null);

      // Anything else is a failure, and reading it as "unrestricted" would
      // show every button to a caller who was just refused.
      nock(baseUrl)
        .get('/api/v1/authz/scope')
        .reply(401, { error: 'No authenticated user' });
      try {
        await new ConsoleApiClient(baseUrl).scope();
        expect.fail('the refusal should have been raised');
      } catch (err) {
        expect((err as Error).message).to.equal('No authenticated user');
      }
    });

    it('should ask a list for a bounded number of entries, searched or not', async () => {
      // "List everything" on the accounts of a large directory ran an
      // unbounded search the directory refused, and so did a search as loose
      // as "demo": the list showed "Internal Server Error" and nothing else.
      const load = listLoader(new ConsoleApiClient(baseUrl), users);

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ limit: String(LIST_LIMIT) })
        .reply(200, { jsmith: { dn: 'uid=jsmith', uid: 'jsmith' } });
      const all = await load('', 'uid,cn');
      expect(all.entries).to.have.property('jsmith');

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ match: 'demo', attribute: 'uid,cn', limit: '1000' })
        .reply(200, { demo1: { dn: 'uid=demo1', uid: 'demo1' } });
      const found = await load('demo', 'uid,cn');
      expect(found.entries).to.have.property('demo1');

      // Too short to be a search: the branch, still bounded.
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ limit: '1000' })
        .reply(200, {});
      expect((await load('de', 'uid,cn')).entries).to.deep.equal({});
      expect(nock.isDone()).to.equal(true);
    });

    it('should say a list is truncated only when the server says so', async () => {
      const client = new ConsoleApiClient(baseUrl);
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ limit: '2' })
        .reply(
          200,
          { a: { dn: 'uid=a', uid: 'a' }, b: { dn: 'uid=b', uid: 'b' } },
          { 'X-Result-Truncated': 'true' }
        );
      const cut = await client.listBounded(users, undefined, undefined, 2);
      expect(cut.truncated).to.equal(true);
      expect(Object.keys(cut.entries)).to.deep.equal(['a', 'b']);

      // A server predating `limit` ignores it and sends no header: what it
      // answered is the whole branch.
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ limit: '2' })
        .reply(200, { a: { dn: 'uid=a', uid: 'a' } });
      expect(
        (await client.listBounded(users, undefined, undefined, 2)).truncated
      ).to.equal(false);
    });

    it('should ask a group list for the attributes its schema declares', async () => {
      // ldap-rest answers a group list with `cn` and `member` alone otherwise:
      // the email column stayed empty.
      const client = new ConsoleApiClient(baseUrl);
      const withSecret: EntityDescriptor = {
        ...groups,
        schema: {
          attributes: {
            ...groups.schema.attributes,
            mail: { type: 'string', role: 'primaryEmail' },
            secret: { type: 'string', neverReturn: true },
          },
        },
      };
      nock(baseUrl)
        .get('/api/v1/ldap/groups')
        .query({ limit: '1000', attributes: 'cn,description,member,mail' })
        .reply(200, {
          staff: { dn: staff.dn, cn: 'staff', mail: 'staff@example.com' },
        });
      const { entries } = await client.listBounded(
        withSecret,
        undefined,
        undefined,
        1000
      );
      expect(entries.staff.mail).to.equal('staff@example.com');

      // A flat list answers every attribute already: nothing to ask for.
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ limit: '1000' })
        .reply(200, {});
      await client.listBounded(users, undefined, undefined, 1000);
      expect(nock.isDone()).to.equal(true);
    });

    it('should keep answering the plain map from `list()`, bounded or not', async () => {
      // `list()` is exported, and embedders read what it answers as the map
      // it always was: the flag comes from `listBounded()` instead.
      const client = new ConsoleApiClient(baseUrl);
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .reply(200, { a: { dn: 'uid=a', uid: 'a' } });
      expect(await client.list(users)).to.deep.equal({
        a: { dn: 'uid=a', uid: 'a' },
      });
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ limit: '1' })
        .reply(
          200,
          { a: { dn: 'uid=a', uid: 'a' } },
          { 'X-Result-Truncated': 'true' }
        );
      expect(await client.list(users, undefined, undefined, 1)).to.deep.equal({
        a: { dn: 'uid=a', uid: 'a' },
      });
    });

    it('should bound a pointer search, and explain the searches too broad', async () => {
      const search = new ConsoleApiClient(baseUrl).pointerSearch(
        'ou=users,dc=example,dc=com',
        [users]
      ) as (q: string) => Promise<unknown>;
      const translator = new Translator('en');
      const failure = async (): Promise<string> => {
        try {
          await search('demo');
        } catch (err) {
          return listFailure(err, translator);
        }
        throw new Error('the search should have failed');
      };

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(query => query.match === 'demo' && query.limit === '20')
        .reply(200, { demo1: { dn: 'uid=demo1,ou=users,dc=example,dc=com' } });
      expect(await search('demo')).to.have.length(1);

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(true)
        .reply(422, { error: 'Size limit exceeded' });
      expect(await failure()).to.equal(
        'Too many entries to show them all: narrow the search.'
      );

      // A failure of the server's own is no search too broad, and the
      // server's generic words tell the administrator nothing.
      nock(baseUrl).get('/api/v1/ldap/users').query(true).reply(500, {
        error: 'Internal Server Error',
        message: 'An error occurred',
      });
      expect(await failure()).to.equal('The list could not be loaded');
    });

    it('should hedge a failure a broad search may explain', () => {
      const translator = new Translator('en');
      const failed = (status: number, message: string): string =>
        listFailure(Object.assign(new Error(message), { status }), translator);
      const hedged = translator.t('list.failed');
      // A proxy giving up on a slow unbounded search says nothing useful.
      expect(failed(502, '502 Bad Gateway')).to.equal(hedged);
      expect(failed(504, '504 Gateway Timeout')).to.equal(hedged);
      // A 500 is the server's own failure, not a search too broad: said as
      // such, in the interface language, and not as advice to narrow the
      // search; a cause the server names is kept, so that it stays
      // diagnosable.
      const broken = translator.t('list.error');
      expect(failed(500, '500 Internal Server Error')).to.equal(broken);
      expect(failed(500, '500 ')).to.equal(broken);
      expect(failed(500, 'Invalid DN syntax')).to.equal(
        `${broken} (Invalid DN syntax)`
      );
      // Any other failure keeps its own words; a refusal is said plainly.
      expect(failed(400, 'Unbalanced filter')).to.equal('Unbalanced filter');
      expect(
        failed(403, 'Token does not have permission on this branch')
      ).to.equal('You may not see these entries');
    });

    describe('the mail domains of a form', () => {
      const top = 'ou=organization,dc=example,dc=com';
      const sales = `ou=Sales,${top}`;
      const europe = `ou=Europe,${sales}`;
      const support = `ou=Support,${top}`;
      const domainsBase = 'ou=domains,ou=nomenclature,dc=example,dc=com';
      const domains: EntityDescriptor = {
        key: 'domains',
        pluralName: 'domains',
        singularName: 'domain',
        mainAttribute: 'dc',
        base: domainsBase,
        schema: {
          attributes: {
            dc: { type: 'string', required: true, role: 'identifier' },
            associatedDomain: {
              type: 'string',
              required: true,
              role: ['domainName', 'displayName'],
            },
          },
        },
        endpoint: '/api/v1/ldap/domains',
        kind: 'flat',
      };
      const organizations: EntityDescriptor = {
        key: 'organizations',
        pluralName: 'organizations',
        singularName: 'organization',
        mainAttribute: 'ou',
        base: top,
        schema: {
          attributes: {
            ou: { type: 'string', role: 'identifier' },
            twakeDomainLink: {
              type: 'array',
              role: 'domainLink',
              items: { type: 'pointer', branch: [domainsBase] },
            },
          },
        },
        endpoint: '/api/v1/ldap/organizations',
        kind: 'organization',
      };
      const dn = (name: string): string => `dc=${name},${domainsBase}`;
      const tree = {
        com: { dn: `dc=com,${domainsBase}`, dc: 'com' },
        example: {
          dn: dn('example'),
          dc: 'example',
          associatedDomain: 'Example.com',
        },
        lists: {
          dn: dn('lists'),
          dc: 'lists',
          associatedDomain: 'lists.example.com',
        },
        other: { dn: dn('other'), dc: 'other', associatedDomain: 'other.org' },
        any: { dn: dn('any'), dc: 'any', associatedDomain: '*' },
      };
      const client = (): ConsoleApiClient => {
        const made = new ConsoleApiClient(baseUrl);
        Object.assign(made as unknown as object, { topOrganization: top });
        return made;
      };
      const organization = (at: string, links: string[]): nock.Scope =>
        nock(baseUrl)
          .get(`/api/v1/ldap/organizations/${encodeURIComponent(at)}`)
          .reply(200, { dn: at, twakeDomainLink: links });

      it('should know the domains’ branch by the role of their name', () => {
        const entities = [users, organizations, domains];
        expect(isDomainBranch(entities, domainsBase)).to.equal(true);
        expect(isDomainBranch(entities, domainsBase.toUpperCase())).to.equal(
          true
        );
        expect(isDomainBranch(entities, users.base)).to.equal(false);
        expect(client().mailDomains([users, organizations])).to.equal(
          undefined
        );
      });

      it('should offer what the organization and those above it link, read once', async () => {
        const lookup = client().mailDomains([organizations, domains])!;
        nock(baseUrl).get('/api/v1/ldap/domains').reply(200, tree);
        organization(europe, [dn('lists')]);
        organization(sales, [dn('example')]);
        organization(top, []);
        expect(await lookup.names(europe)).to.deep.equal([
          'example.com',
          'lists.example.com',
        ]);
        // A sibling department shares the organizations above it: only its
        // own is read, and the domains are not listed again.
        organization(`ou=Asia,${sales}`, []);
        expect(await lookup.names(`ou=Asia,${sales}`)).to.deep.equal([
          'example.com',
        ]);
        expect(await lookup.linked(europe)).to.deep.equal([
          dn('lists'),
          dn('example'),
        ]);
        expect(nock.isDone()).to.equal(true);
      });

      it('should offer every domain but "*" where nothing narrows them', async () => {
        const lookup = client().mailDomains([organizations, domains])!;
        nock(baseUrl).get('/api/v1/ldap/domains').reply(200, tree);
        const every = ['example.com', 'lists.example.com', 'other.org'];
        // Attached to nothing.
        expect(await lookup.names()).to.deep.equal(every);
        // Linking nothing, which the server reads as no restriction.
        organization(support, []);
        organization(top, []);
        expect(await lookup.names(support)).to.deep.equal(every);
        // Linking "*", which allows every domain.
        organization(sales, [dn('any')]);
        expect(await lookup.names(sales)).to.deep.equal(every);
        // An organization above that cannot be read: the server judges.
        nock(baseUrl)
          .get(
            `/api/v1/ldap/organizations/${encodeURIComponent(`ou=Lost,${top}`)}`
          )
          .reply(403, { error: 'Forbidden' });
        expect(await lookup.names(`ou=Lost,${top}`)).to.deep.equal(every);
      });

      it('should refuse to name any when the domains cannot be read', async () => {
        const lookup = client().mailDomains([organizations, domains])!;
        nock(baseUrl)
          .get('/api/v1/ldap/domains')
          .reply(403, { error: 'Forbidden' });
        let failed: unknown;
        await lookup.names().catch((err: unknown) => {
          failed = err;
        });
        expect((failed as { status?: number }).status).to.equal(403);
      });
    });
  });

  describe('server rules', () => {
    it('should read a size as the server does', () => {
      expect(parseByteSize('4GB')).to.equal(4e9);
      expect(parseByteSize('500 mb')).to.equal(5e8);
      expect(parseByteSize('1.5 MB')).to.equal(1500000);
      expect(parseByteSize('2048')).to.equal(2048);
      expect(parseByteSize('2048B')).to.equal(2048);
      expect(parseByteSize('lots')).to.equal(undefined);
      expect(parseByteSize('4 GiB')).to.equal(undefined);
      // What the form shows a stored size as is a size the server reads back.
      expect(parseByteSize(formatByteSize('2000000000'))).to.equal(2e9);
    });

    it('should judge a date by the day in UTC, today passing', () => {
      const now = new Date(Date.UTC(2026, 9, 12, 23, 30));
      expect(beforeToday('20261011000000Z', now)).to.equal(true);
      expect(beforeToday('20261012000000Z', now)).to.equal(false);
      expect(beforeToday('2026-10-13', now)).to.equal(false);
      expect(beforeToday('soon', now)).to.equal(false);
    });

    it('should name a refused attribute by its label', () => {
      // The server's refusal named `twakeDeletionDate`, which the operator
      // had only ever seen as "Deletion date".
      const schema: EntitySchema = {
        attributes: {
          twakeDeletionDate: {
            type: 'date',
            label: { en: 'Deletion date', fr: 'Date de suppression' },
          },
          mailQuotaSize: { type: 'number', label: { en: 'Mailbox size' } },
          owner: { type: 'array', label: { en: 'Owners' } },
        },
      };
      expect(
        nameAttributes(
          'Attribute "twakeDeletionDate" must not be earlier than today',
          schema,
          'fr'
        )
      ).to.equal(
        'Attribute "Date de suppression" must not be earlier than today'
      );
      expect(
        nameAttributes(
          'Invalid value for attribute "mailquotasize": Expected pattern xGB',
          schema,
          'en'
        )
      ).to.equal(
        'Invalid value for attribute "Mailbox size": Expected pattern xGB'
      );
      expect(
        nameAttributes('Invalid value for field owner', schema, 'en')
      ).to.equal('Invalid value for field "Owners"');
      // What the schema does not know is the server's own word.
      expect(
        nameAttributes('Entry "jsmith" already exists', schema, 'en')
      ).to.equal('Entry "jsmith" already exists');
    });

    describe('a refusal ldap-rest describes', () => {
      const schema: EntitySchema = {
        attributes: {
          mail: {
            type: 'string',
            label: {
              en: 'Email',
              fr: 'Adresse électronique',
              mn: 'Цахим шуудан',
            },
          },
          cn: { type: 'string', label: { en: 'Name', fr: 'Nom' } },
        },
      };
      /** What the API client throws for an answer. */
      const refused = (
        status: number,
        message: string,
        refusal?: Record<string, unknown>
      ) => Object.assign(new Error(message), { status, refusal });
      const taken = refused(
        409,
        'user: "alice@example.com" is already used (mail must be unique)',
        { code: 'unique', attribute: 'mail', value: 'alice@example.com' }
      );
      const outside = refused(
        409,
        'The mail domain of "x@other.org" is not one of the authorised domains (example.com, lists.example.com)',
        {
          code: 'mailDomain',
          attribute: 'mail',
          value: 'x@other.org',
          domains: ['example.com', 'lists.example.com'],
        }
      );
      const forbidden = refused(
        403,
        'Token does not have permission on this branch',
        { code: 'forbidden' }
      );

      it('should say an address already used in the interface language, naming the field', () => {
        expect(
          explainRefusal(taken, schema, new Translator('fr'))
        ).to.deep.equal({
          message:
            'Adresse électronique « alice@example.com » : déjà utilisé par une autre entrée.',
          attribute: 'mail',
        });
        expect(
          explainRefusal(taken, schema, new Translator('en')).message
        ).to.equal(
          'Email “alice@example.com” is already used by another entry.'
        );
        expect(
          explainRefusal(taken, schema, new Translator('mn')).message
        ).to.equal(
          'Цахим шуудан «alice@example.com» өөр бичлэгт ашиглагдаж байна.'
        );
      });

      it('should say a mail domain the organization may not use, and those it may', () => {
        expect(
          explainRefusal(outside, schema, new Translator('en'))
        ).to.deep.equal({
          message:
            'Email: other.org is not a mail domain of this organization. Allowed: example.com, lists.example.com.',
          attribute: 'mail',
        });
        expect(
          explainRefusal(outside, schema, new Translator('fr')).message
        ).to.equal(
          'Adresse électronique : other.org n’est pas un domaine de messagerie de cette organisation. Autorisés : example.com, lists.example.com.'
        );
      });

      it('should name an attribute the schema does not know as the console names it', () => {
        const other = refused(409, 'already used', {
          code: 'unique',
          attribute: 'employeeNumber',
          value: 'E0010',
        });
        expect(
          explainRefusal(other, schema, new Translator('en'))
        ).to.deep.equal({
          message: 'Employee Number “E0010” is already used by another entry.',
          attribute: 'employeeNumber',
        });
      });

      it('should say a refusal of the caller’s rights naming the entry, not the token', () => {
        expect(
          explainRefusal(forbidden, schema, new Translator('en'), 'Transit')
        ).to.deep.equal({
          message:
            'You do not administer Transit: this change is not yours to make.',
        });
        expect(
          explainRefusal(forbidden, schema, new Translator('fr'), 'Transit')
            .message
        ).to.equal(
          'Vous n’administrez pas Transit : cette modification ne vous revient pas.'
        );
      });

      it('should keep the server’s words for another refusal, saying they are its own', () => {
        expect(
          explainRefusal(
            refused(400, 'Attribute "cn" must not be empty'),
            schema,
            new Translator('en')
          )
        ).to.deep.equal({
          message: 'The server refused: Attribute "Name" must not be empty',
        });
        expect(
          explainRefusal(
            refused(409, 'Something else', { code: 'somethingNew' }),
            schema,
            new Translator('fr')
          ).message
        ).to.equal('Le serveur a refusé : Something else');
        // Without the entry it is about, a refusal of rights stays the
        // server's.
        expect(
          explainRefusal(forbidden, schema, new Translator('en')).message
        ).to.equal(
          'The server refused: Token does not have permission on this branch'
        );
        // A failure no server answered is not one of its refusals.
        expect(
          explainRefusal(
            new TypeError('Failed to fetch'),
            schema,
            new Translator('en')
          ).message
        ).to.equal('Failed to fetch');
      });

      it('should say what is no refusal went wrong, not that the server refused', () => {
        const said = (status: number, message: string, language = 'en') =>
          explainRefusal(
            refused(status, message),
            schema,
            new Translator(language)
          ).message;
        expect(said(404, 'Not found')).to.equal(
          'The server refused: Not found'
        );
        // A server failing, a session ended, an answer nobody could read.
        expect(said(500, 'Internal Server Error')).to.equal(
          'Something went wrong'
        );
        expect(said(500, 'check logs', 'fr')).to.equal(
          'Une erreur est survenue (check logs)'
        );
        expect(said(502, '502 Bad Gateway')).to.equal(
          'Something went wrong (502 Bad Gateway)'
        );
        expect(said(401, 'Unauthorized')).to.equal(
          'Something went wrong (Unauthorized)'
        );
        expect(said(200, '200 OK')).to.equal('Something went wrong (200 OK)');
      });

      it('should name the organization a refusal of rights is about, under its field', () => {
        expect(
          explainRefusal(
            forbidden,
            schema,
            new Translator('en'),
            'Acme / Sales',
            'twakeDepartmentLink'
          )
        ).to.deep.equal({
          message:
            'You do not administer Acme / Sales: this change is not yours to make.',
          attribute: 'twakeDepartmentLink',
        });
        // The field is for that refusal only.
        expect(
          explainRefusal(
            refused(400, 'Bad'),
            schema,
            new Translator('en'),
            'Acme / Sales',
            'twakeDepartmentLink'
          )
        ).to.deep.equal({ message: 'The server refused: Bad' });
      });

      it('should blame the organization a new or moved entry goes to, not the entry', () => {
        const top = 'ou=organization,dc=example,dc=com';
        const sales = `ou=Sales,${top}`;
        const engineering = `ou=Engineering,${top}`;
        const app = consoleIn({}) as unknown as {
          scope: Scope | null;
          toast(message: string, isError?: boolean): void;
          organizationRefused(
            entity: EntityDescriptor,
            values: Record<string, string | string[]>,
            entry?: Entry,
            form?: { pointerName(dn: string): string | undefined }
          ): { name: string; attribute: string } | undefined;
          refuseSave(
            err: unknown,
            entity: EntityDescriptor,
            form: { refuse(attribute: string, message: string): boolean },
            name: string,
            field?: string
          ): void;
        };
        const form = {
          pointerName: (dn: string) =>
            dn === sales ? 'Acme / Sales' : undefined,
        };
        const link = 'twakeDepartmentLink';
        // Created: the organization it is attached to, as the form named it.
        expect(
          app.organizationRefused(
            users,
            { cn: 'Va Val', [link]: sales },
            undefined,
            form
          )
        ).to.deep.equal({ name: 'Acme / Sales', attribute: link });
        // Edited without a move: the entry itself.
        const stored: Entry = {
          dn: `uid=va,${users.base}`,
          uid: 'va',
          cn: 'Va Val',
          [link]: engineering,
          twakeDepartmentPath: 'Acme / Engineering',
        };
        expect(
          app.organizationRefused(users, { cn: 'Va Vale' }, stored, form)
        ).to.equal(undefined);
        // Moved, the scope saying nothing: where it goes.
        expect(
          app.organizationRefused(users, { [link]: sales }, stored, form)
        ).to.deep.equal({ name: 'Acme / Sales', attribute: link });
        // Moved where the caller writes: where it was, by its path.
        app.scope = {
          branches: [{ dn: sales, write: true }],
          entities: [],
        } as unknown as Scope;
        expect(
          app.organizationRefused(users, { [link]: sales }, stored, form)
        ).to.deep.equal({ name: 'Acme / Engineering', attribute: link });
        // Moved where the caller does not write, unnamed by the form.
        app.scope = {
          branches: [{ dn: engineering, write: true }],
          entities: [],
        } as unknown as Scope;
        expect(
          app.organizationRefused(users, { [link]: sales }, stored)
        ).to.deep.equal({ name: 'Sales', attribute: link });

        // Said under the organization field.
        const toasts: string[] = [];
        app.toast = message => toasts.push(message);
        const shown: [string, string][] = [];
        app.refuseSave(
          forbidden,
          users,
          {
            refuse: (attribute, message) => {
              shown.push([attribute, message]);
              return true;
            },
          },
          'Acme / Sales',
          link
        );
        expect(shown).to.deep.equal([
          [
            link,
            'You do not administer Acme / Sales: this change is not yours to make.',
          ],
        ]);
        expect(toasts).to.deep.equal(['Not saved: see the highlighted field']);
      });

      it('should show a refusal under the field at fault, the toast pointing there', () => {
        const app = consoleIn({}) as unknown as {
          toast(message: string, isError?: boolean): void;
          refuseSave(
            err: unknown,
            entity: EntityDescriptor,
            form: { refuse(attribute: string, message: string): boolean },
            name: string
          ): void;
        };
        const toasts: [string, boolean | undefined][] = [];
        app.toast = (message, isError) => toasts.push([message, isError]);
        const shown: [string, string][] = [];
        const form = {
          refuse: (attribute: string, message: string) => {
            shown.push([attribute, message]);
            return attribute === 'mail';
          },
        };
        app.refuseSave(taken, users, form, 'Alice');
        expect(shown).to.deep.equal([
          [
            'mail',
            'Mail “alice@example.com” is already used by another entry.',
          ],
        ]);
        expect(toasts).to.deep.equal([
          ['Not saved: see the highlighted field', true],
        ]);

        // A field the form does not show: the toast says it all.
        toasts.length = 0;
        app.refuseSave(
          refused(409, 'already used', {
            code: 'unique',
            attribute: 'employeeNumber',
            value: 'E0010',
          }),
          users,
          form,
          'Alice'
        );
        expect(toasts).to.deep.equal([
          ['Employee Number “E0010” is already used by another entry.', true],
        ]);

        toasts.length = 0;
        app.refuseSave(forbidden, users, form, 'Transit');
        expect(toasts).to.deep.equal([
          [
            'You do not administer Transit: this change is not yours to make.',
            true,
          ],
        ]);
      });
    });
  });

  describe('escapeDnValue', () => {
    it('should escape what RFC 4514 asks, and read back through rdnValue', () => {
      for (const value of [
        'a+b@example.com',
        'x,y=z',
        '"quoted" <a;b>',
        'back\\slash',
        ' lead and trail ',
        '#hash',
      ]) {
        const escaped = escapeDnValue(value);
        expect(
          rdnValue(`mail=${escaped},ou=external,dc=example,dc=com`)
        ).to.equal(value);
        expect(isDnShaped(`mail=${escaped},ou=external`)).to.equal(true);
      }
      expect(escapeDnValue('a+b@example.com')).to.equal('a\\+b@example.com');
      expect(escapeDnValue('#x ')).to.equal('\\#x\\ ');
    });
  });
});
