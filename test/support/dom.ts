/**
 * A DOM for the unit tests, registered as globals before any test runs
 * (`.mocharc.json` requires this file): `window`, `document`, the element
 * classes, events. The console's code checks `typeof document` in a few
 * places and reads `window.location`; with a DOM implementation it runs as
 * in a browser, and a test can mount it into `document.body` and act through
 * clicks, keys and form submissions rather than through stub methods.
 *
 * The hand-made stubs the older tests build keep working: a stub is a plain
 * object, whatever the globals say.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import nock from 'nock';

// Node's own timers and fetch. The registrator copies every property of the
// window over the global, these included. happy-dom's `setTimeout` catches
// what a callback throws and prints it, so a test that let a timer throw
// would pass; Node's rethrow, and mocha fails the test. happy-dom's `fetch`
// sends a CORS preflight through its own HTTP client, which `nock` does not
// answer; Node's is what `nock` mocks, as it did before the DOM came.
// `FormData`, `Blob` and `File` stay happy-dom's (`new FormData(form)` needs
// them), and Node's fetch does not read them: a body made of one is sent as
// "[object FormData]". The console sends JSON only; a test that posts a form
// through fetch will need a guard here first.
const node = {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  fetch,
  Headers,
  Request,
  Response,
  AbortController,
  AbortSignal,
};

GlobalRegistrator.register({
  url: 'http://localhost/static/console/',
  width: 1280,
  height: 800,
});

Object.assign(globalThis, node);

// No test reaches the network: a request nothing mocked is refused at once,
// in nock's words, rather than sent to whatever listens on the port — or
// to nothing, and failing late as a connection refused.
nock.disableNetConnect();

/**
 * What a test mounted and must go before the page is reset: the builder of
 * a mounted console (test/support/mount.ts) registers its unmounting here, so
 * that the hash reset below wakes no console still listening.
 */
export const beforeReset: (() => void)[] = [];

/**
 * Root hooks, which mocha reads from a required file: a test leaves the DOM
 * as it found it. The storages, the document and the hash are shared by the
 * whole run, and a test that mounts the console must not meet what another
 * left.
 */
export const mochaHooks = {
  afterEach(): void {
    for (const cleanup of beforeReset) cleanup();
    localStorage.clear();
    sessionStorage.clear();
    document.body.replaceChildren();
    document.head.replaceChildren();
    document.title = '';
    document.documentElement.lang = '';
    window.location.hash = '';
  },
};
