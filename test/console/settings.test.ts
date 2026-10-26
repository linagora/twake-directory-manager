import { expect } from 'chai';
import {
  highContrast,
  onContrastChange,
  referenceOpen,
  rememberContrast,
  rememberLanguage,
  rememberPageSize,
  rememberReference,
  storedLanguage,
  storedPageSize,
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

  it('should tell when the system changes its wish, and read the choice over it', () => {
    let fire: (() => void) | undefined;
    (globalThis as { matchMedia?: unknown }).matchMedia = () => ({
      matches: true,
      addEventListener: (_type: string, listener: () => void) => {
        fire = listener;
      },
    });
    let told = 0;
    onContrastChange(() => told++);
    fire?.();
    expect(told).to.equal(1);
    rememberContrast(false);
    expect(highContrast()).to.equal(false);
  });

  it('should remember a page size among those offered', () => {
    expect(storedPageSize([25, 50])).to.equal(undefined);
    rememberPageSize(50);
    expect(storedPageSize([25, 50])).to.equal(50);
    rememberPageSize(7);
    expect(storedPageSize([25, 50])).to.equal(undefined);
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
