import { expect } from 'chai';
import {
  forgetDraft,
  saveDraft,
  signInAgain,
  takeDraft,
  type Draft,
} from '../src/session';

describe('session', () => {
  describe('signInAgain', () => {
    // The DOM's own storage and location, which the console reads.
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'sessionStorage'
    ) as PropertyDescriptor;
    let reloads: number;

    beforeEach(() => {
      reloads = 0;
      sessionStorage.clear();
      // An own property over the prototype's method, taken away after.
      window.location.reload = (): void => {
        reloads++;
      };
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'sessionStorage', original);
      delete (window.location as { reload?: unknown }).reload;
    });

    it('should reload once a minute at most', () => {
      expect(signInAgain(1_000_000)).to.equal(true);
      // The page answered 401 again right after: no sign-in behind it
      expect(signInAgain(1_030_000)).to.equal(false);
      expect(signInAgain(1_061_000)).to.equal(true);
      expect(reloads).to.equal(2);
    });

    it('should not reload without storage to stop a loop', () => {
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        get: () => ({
          getItem: () => {
            throw new Error('denied');
          },
        }),
      });
      expect(signInAgain()).to.equal(false);
      expect(reloads).to.equal(0);
    });
  });

  describe('a draft kept across a sign-in again', () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'sessionStorage'
    ) as PropertyDescriptor;
    const user = 'uid=admin,ou=users,dc=example,dc=com';
    const now = 1_000_000;

    /** What a form held when the session ended. */
    const draft = (over: Partial<Draft> = {}): Draft => ({
      at: now,
      user,
      page: 'users',
      entity: 'users',
      values: { cn: ['Hélène Lefèvre'] },
      cleared: ['telephoneNumber'],
      ...over,
    });

    beforeEach(() => sessionStorage.clear());

    afterEach(() => {
      Object.defineProperty(globalThis, 'sessionStorage', original);
    });

    it('should offer a recent draft back once, to the account that kept it', () => {
      saveDraft(draft());
      expect(takeDraft(user, now + 1_000)).to.deep.equal(draft());
      // Taken: the next load has nothing to offer.
      expect(takeDraft(user, now + 2_000)).to.equal(null);
    });

    it('should drop a draft kept for another account', () => {
      saveDraft(draft());
      expect(takeDraft('uid=other,ou=users,dc=example,dc=com', now)).to.equal(
        null
      );
      // Dropped, not kept for the one it was for.
      saveDraft(draft());
      takeDraft('uid=other,ou=users,dc=example,dc=com', now);
      expect(takeDraft(user, now)).to.equal(null);
    });

    it('should drop a draft older than a quarter of an hour', () => {
      saveDraft(draft());
      expect(takeDraft(user, now + 15 * 60_000 + 1)).to.equal(null);
      saveDraft(draft());
      expect(takeDraft(user, now + 15 * 60_000)?.entity).to.equal('users');
    });

    it('should read nothing that is not a draft', () => {
      sessionStorage.setItem('ldap-rest.console.draft', 'not json');
      expect(takeDraft(user, now)).to.equal(null);
      sessionStorage.setItem(
        'ldap-rest.console.draft',
        JSON.stringify({ at: now, values: {} })
      );
      expect(takeDraft(user, now)).to.equal(null);
    });

    it('should drop the draft once its form is saved or closed', () => {
      saveDraft(draft());
      forgetDraft();
      expect(takeDraft(user, now)).to.equal(null);
    });

    it('should keep and read nothing without storage', () => {
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        get: () => ({
          getItem: () => {
            throw new Error('denied');
          },
          setItem: () => {
            throw new Error('denied');
          },
          removeItem: () => {
            throw new Error('denied');
          },
        }),
      });
      expect(() => saveDraft(draft())).to.not.throw();
      expect(takeDraft(user, now)).to.equal(null);
      expect(() => forgetDraft()).to.not.throw();
    });
  });
});
