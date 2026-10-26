/**
 * A console mounted into the page, as the browser would have it: a container
 * in `document.body`, the API answered from the fixtures recorded against the
 * ldap-rest tested (`test/fixtures/`), the frame drawn by `init()`. A test
 * then acts through the DOM — clicks, keys, submissions — and reads the DOM
 * and the calls the API received; it reaches no private member (#221).
 *
 * The client is the real one, over `nock`; `calls` records every method the
 * console asked of it, with its arguments.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import nock from 'nock';

import { ConsoleApiClient } from '../../src/api/ConsoleApiClient';
import { DirectoryConsole } from '../../src/DirectoryConsole';
import type { Entry, Scope } from '../../src/types';

const FIXTURES = join(__dirname, '..', 'fixtures');
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as T;

/** The address every mounted console talks to; `nock` answers it. */
export const MOUNT_URL = 'http://mounted.test';

/** The scopes recorded from the QA stack, by the account's name. */
export type RecordedScope =
  'admin' | 'sophie.martin' | 'alice' | 'grace' | 'eric.dubois';

export interface MountOptions {
  /** Who is signed in: a recorded scope by its name, a scope, or none (a server without the plugin) */
  scope?: RecordedScope | Scope | null;
  /** The signed-in account's entry, read for the greeting; none by default */
  account?: Entry;
  /** The address to open, as after `#/` */
  hash?: string;
  language?: string;
  /** Whether the server serves the password policies to this account */
  policies?: boolean;
}

export interface Mounted {
  /** The container the console drew into */
  root: HTMLElement;
  app: DirectoryConsole;
  /** The methods the console asked of its API client, in order: `name(arg, …)` */
  calls: string[];
  /** The `nock` scope of the server, for a test to add answers to */
  server: nock.Scope;
  /** Take the console off the page */
  unmount(): void;
}

const mounted: Mounted[] = [];

/** Every console left mounted by a test goes after it. */
afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
});

/** An argument, for `calls`: identifiers and keys, not whole objects. */
function shown(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'key' in value)
    return String((value as { key: unknown }).key);
  return JSON.stringify(value);
}

/**
 * Mount a console and wait for its first page.
 *
 * @param options who is signed in, where the console opens
 * @returns the console, its container and what it asked
 */
export async function mountConsole(
  options: MountOptions = {}
): Promise<Mounted> {
  const { scope = 'admin', hash = '', language = 'en' } = options;
  const server = nock(MOUNT_URL).persist();
  server.get('/api/v1/config').reply(200, read('config.json'));
  const granted: Scope | null =
    typeof scope === 'string' ? read<Scope>(`scopes/${scope}.json`) : scope;
  if (granted) server.get('/api/v1/authz/scope').reply(200, granted);
  else server.get('/api/v1/authz/scope').reply(404, { error: 'not found' });
  server
    .get('/api/v1/password-policies')
    .reply(options.policies === false ? 403 : 200, { policies: [] });
  server
    .get(/\/api\/v1\/ldap\/users\/[^/?]+$/)
    .reply(options.account ? 200 : 404, options.account ?? { error: 'none' });
  // The transit branch and the organizations' top, read by the overview
  server.get(/\/api\/v1\/ldap\/organizations(\/.*)?$/).reply(200, []);

  const calls: string[] = [];
  const client = new ConsoleApiClient(MOUNT_URL);
  const api = new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function' || typeof property !== 'string')
        return value;
      return (...args: unknown[]): unknown => {
        calls.push(
          `${property}(${args.map(shown).filter(Boolean).join(', ')})`
        );
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });

  const root = document.createElement('div');
  root.id = `console-${mounted.length + 1}`;
  document.body.append(root);
  window.location.hash = hash ? `#/${hash}` : '';
  const app = new DirectoryConsole(
    { containerId: root.id, apiBaseUrl: MOUNT_URL, language },
    { api }
  );
  const result: Mounted = {
    root,
    app,
    calls,
    server,
    unmount: (): void => {
      app.unmount();
      root.remove();
    },
  };
  mounted.push(result);
  await app.init();
  await settled(root);
  return result;
}

/**
 * Wait for what the console started without waiting for it: a page drawn, a
 * section filled. Resolves once nothing is loading or busy.
 *
 * @param root the console's container
 */
export async function settled(root: HTMLElement): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const busy =
      root.querySelector('[aria-busy="true"]') ||
      Array.from(root.querySelectorAll('.dc-empty')).some(p =>
        /^(Loading|Chargement|Ачаалж)/.test(p.textContent ?? '')
      );
    if (!busy) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
