import { expect } from 'chai';
import {
  highContrast,
  referenceOpen,
  rememberContrast,
  rememberLanguage,
  rememberReference,
  storedLanguage,
} from '../../src/console/settings';

describe('the settings the browser remembers', () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage'
  ) as PropertyDescriptor;
  const originalMatch = (globalThis as { matchMedia?: unknown }).matchMedia;
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', original);
    (globalThis as { matchMedia?: unknown }).matchMedia = originalMatch;
  });
  const systemWants = (more: boolean): void => {
    (globalThis as { matchMedia?: unknown }).matchMedia = (query: string) => ({
      matches: more && query === '(prefers-contrast: more)',
      addEventListener: () => undefined,
    });
  };

  it('should follow the system until the reader chooses, and the reader after', () => {
    systemWants(false);
    expect(highContrast()).to.equal(false);
    systemWants(true);
    expect(highContrast()).to.equal(true);
    rememberContrast(false);
    expect(highContrast()).to.equal(false);
    rememberContrast(true);
    systemWants(false);
    expect(highContrast()).to.equal(true);
  });

  it('should go by its defaults when storage is denied', () => {
    rememberLanguage('fr');
    rememberReference(true);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('denied');
      },
    });
    expect(storedLanguage()).to.equal(undefined);
    expect(referenceOpen()).to.equal(false);
    systemWants(true);
    expect(highContrast()).to.equal(true);
    expect(() => rememberContrast(true)).to.not.throw();
  });
});
