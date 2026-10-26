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

GlobalRegistrator.register({
  url: 'http://localhost/static/console/',
  width: 1280,
  height: 800,
});
