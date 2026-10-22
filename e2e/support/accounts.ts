import { env } from './env';

/** An account that signs in on Dex: a seeded one or one a test created */
export interface Account {
  /** LDAP uid, what Dex asks for as "Username" */
  uid: string;
  dn: string;
  password: string;
  /** displayName */
  displayName: string;
  mail: string;
}

const USERS = 'ou=users,dc=example,dc=com';

function seeded(uid: string, displayName: string): Account {
  return {
    uid,
    dn: `uid=${uid},${USERS}`,
    password: env.password,
    displayName,
    mail: `${uid}@example.com`,
  };
}

/**
 * The accounts of scripts/qa-environment/ldap/seed.ldif. Never changed by a test: a test that
 * writes works on entries of its own (support/directory.ts), so that every test may read these
 * as the seed left them, in parallel and in any order.
 */
export const ADMIN = seeded('admin', 'Ada Admin');
/** Local administrator of Sales */
export const SOPHIE = seeded('sophie.martin', 'Sophie Martin');
/** Local administrator of Engineering */
export const ERIC = seeded('eric.dubois', 'Eric Dubois');
/** Sales / France, administers nothing */
export const ALICE = seeded('alice', 'Alice Moreau');
/** Sales / Germany */
export const BOB = seeded('bob', 'Bob Schneider');
/** Engineering / Backend */
export const CAROL = seeded('carol', 'Carol Nguyen');
/** Engineering / Frontend */
export const DAVE = seeded('dave', 'Dave Okafor');
/** Engineering / Backend, disabled */
export const FRANK = seeded('frank', 'Frank Leroy');
/** Human Resources */
export const ERIN = seeded('erin', 'Erin Walsh');
/** In transit */
export const GRACE = seeded('grace', 'Grace Kim');

/** The identifiers every seeded account has, sorted as the users list sorts them */
export const SEEDED_UIDS = [
  'admin',
  'alice',
  'bob',
  'carol',
  'dave',
  'eric.dubois',
  'erin',
  'frank',
  'grace',
  'sophie.martin',
];

/** DNs of the seeded organizations */
export const ORG = {
  root: 'ou=organization,dc=example,dc=com',
  sales: 'ou=Sales,ou=organization,dc=example,dc=com',
  france: 'ou=France,ou=Sales,ou=organization,dc=example,dc=com',
  germany: 'ou=Germany,ou=Sales,ou=organization,dc=example,dc=com',
  engineering: 'ou=Engineering,ou=organization,dc=example,dc=com',
  backend: 'ou=Backend,ou=Engineering,ou=organization,dc=example,dc=com',
  frontend: 'ou=Frontend,ou=Engineering,ou=organization,dc=example,dc=com',
  humanResources: 'ou=Human Resources,ou=organization,dc=example,dc=com',
  transit: 'ou=Transit,ou=organization,dc=example,dc=com',
} as const;
