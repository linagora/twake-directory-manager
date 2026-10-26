import { expect } from 'chai';
import { signInAgain } from '../src/session';

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
      window.location.reload = (): void => {
        reloads++;
      };
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'sessionStorage', original);
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
});
