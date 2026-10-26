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
import { beforeReset } from './dom';

const FIXTURES = join(__dirname, '..', 'fixtures');
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as T;

/** The address a mounted console talks to, one per mount; `nock` answers it. */
const mountUrl = (n: number): string => `http://mounted-${n}.test`;

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
  /** Whether the server serves the password policies to this account: `false` is a 403, `true` (the default) none; `answers` sets some */
  policies?: boolean;
  /**
   * Answers of the server a test needs, set before the mount's own: `nock`
   * answers with the first interceptor matching, and the mount answers every
   * organization read with none
   */
  answers?(server: nock.Scope): void;
}

export interface Mounted {
  /** The container the console drew into */
  root: HTMLElement;
  app: DirectoryConsole;
  /** The methods the console asked of its API client, in order: `name(arg, …)` */
  calls: string[];
  /** The `nock` scope of the server, for a test to add answers to */
  server: nock.Scope;
  /** The address the console talks to */
  url: string;
  /** The signals of the listeners the console put on the window and the document */
  signals: AbortSignal[];
  /**
   * Resolves once every call the console made of its client has been
   * answered and the console has had a turn to read the answers: what it does
   * with one that shows nothing on the page, a password kept for later, is
   * done by then
   */
  idle(): Promise<void>;
  /** Take the console off the page, its container with it: mount another rather than `init()` again */
  unmount(): void;
}

const mounted: Mounted[] = [];
let mounts = 0;

/**
 * Take every console a test left mounted off the page, and the answers its
 * server held: a console's listeners first, before the page is reset under
 * them, then nothing left to answer a late request.
 */
export function unmountAll(): void {
  while (mounted.length) {
    const one = mounted.pop();
    one?.unmount();
    // Its answers only: a suite's own interceptors, set in a `before`, stay
    one?.server.persist(false);
    if (one) nock.removeInterceptor({ hostname: new URL(one.url).hostname });
  }
}
// Before the harness resets the page, which would wake a console still there.
beforeReset.push(unmountAll);

/** An argument, for `calls`: identifiers and keys, not whole objects. */
function shown(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `[${value.map(shown).join(', ')}]`;
  if (value && typeof value === 'object' && 'key' in value)
    return String((value as { key: unknown }).key);
  return JSON.stringify(value);
}

/**
 * The signals a console's listeners are put under, caught as `init()` adds
 * them to the window and the document: a test checks that `unmount()` aborts
 * them, which nothing in the page shows.
 */
async function catching<T>(
  signals: AbortSignal[],
  run: () => Promise<T>
): Promise<T> {
  const targets: EventTarget[] = [window, document];
  const originals = targets.map(target => target.addEventListener);
  for (const target of targets) {
    const original = target.addEventListener;
    target.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions
    ): void {
      if (typeof options === 'object' && options.signal)
        signals.push(options.signal);
      original.call(this, type, listener, options);
    } as typeof target.addEventListener;
  }
  try {
    return await run();
  } finally {
    targets.forEach((target, i) => {
      target.addEventListener = originals[i];
    });
  }
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
  // An address of its own: the answers of an earlier mount in the same test
  // would otherwise be this one's.
  const url = mountUrl(++mounts);
  const server = nock(url).persist();
  options.answers?.(server);
  server.get('/api/v1/config').reply(200, read('config.json'));
  const granted: Scope | null =
    typeof scope === 'string' ? read<Scope>(`scopes/${scope}.json`) : scope;
  if (granted) server.get('/api/v1/authz/scope').reply(200, granted);
  else server.get('/api/v1/authz/scope').reply(404, { error: 'not found' });
  server
    .get('/api/v1/password-policies')
    .reply(
      options.policies === false ? 403 : 200,
      options.policies === false ? { error: 'Forbidden' } : { policies: [] }
    );
  server
    .get(/\/api\/v1\/ldap\/users\/[^/?]+$/)
    .reply(options.account ? 200 : 404, options.account ?? { error: 'none' });
  // The transit branch and the organizations' top, read by the overview
  server.get(/\/api\/v1\/ldap\/organizations(\/.*)?$/).reply(200, []);

  const calls: string[] = [];
  // The calls not answered yet, and who waits for them all to be.
  let pending = 0;
  let waiting: (() => void)[] = [];
  const answered = (): void => {
    pending -= 1;
    if (pending > 0) return;
    const woken = waiting;
    waiting = [];
    woken.forEach(wake => wake());
  };
  const client = new ConsoleApiClient(url);
  const api = new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function' || typeof property !== 'string')
        return value;
      return (...args: unknown[]): unknown => {
        calls.push(
          `${property}(${args.map(shown).filter(Boolean).join(', ')})`
        );
        const result = (value as (...a: unknown[]) => unknown).apply(
          target,
          args
        );
        if (result instanceof Promise) {
          pending += 1;
          // Registered before the console awaits the same promise: told
          // first, so that the console's turn comes before `idle` resolves.
          result.then(answered, answered);
        }
        return result;
      };
    },
  });
  const idle = async (): Promise<void> => {
    for (let i = 0; i < 200; i++) {
      if (pending > 0)
        await new Promise<void>(resolve => waiting.push(resolve));
      // A turn for the console to read the answers, and ask more.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (pending === 0) return;
    }
    throw new Error('the console kept asking for a second');
  };

  const root = document.createElement('div');
  root.id = `console-${mounted.length + 1}`;
  document.body.append(root);
  window.location.hash = hash ? `#/${hash}` : '';
  const app = new DirectoryConsole(
    { containerId: root.id, apiBaseUrl: url, language },
    { api }
  );
  // A 401 in a test is a test's business, not a reload of the page.
  client.onSessionEnded = (): void => undefined;
  const signals: AbortSignal[] = [];
  const result: Mounted = {
    root,
    app,
    calls,
    server,
    url,
    signals,
    idle,
    unmount: (): void => {
      app.unmount();
      root.remove();
    },
  };
  mounted.push(result);
  await catching(signals, () => app.init());
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
  // A tick first: a hash just written reaches the console on happy-dom's
  // own timer.
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 200; i++) {
    const busy =
      root.querySelector('[aria-busy="true"]') ||
      Array.from(root.querySelectorAll('.dc-empty')).some(p =>
        /^(Loading|Chargement|Ачаалж)/.test(p.textContent ?? '')
      );
    if (!busy) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('the console did not settle within a second');
}
