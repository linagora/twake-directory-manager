import { expect } from 'chai';

import { DirectoryConsole } from '../src/DirectoryConsole';
import { background, fromConsole, logReporter } from '../src/shared/background';

describe('background', () => {
  const reported = (): {
    log: [unknown, string][];
    report: (error: unknown, context: string) => void;
  } => {
    const log: [unknown, string][] = [];
    return { log, report: (error, context) => log.push([error, context]) };
  };
  const tick = (): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, 0));

  it('should start the task at once and report nothing when it succeeds', async () => {
    const { log, report } = reported();
    let started = false;
    background(
      async () => {
        started = true;
        await tick();
      },
      'work',
      report
    );
    // Started on the caller's tick, as a bare promise would be: what the
    // task sets before its first await is set already.
    expect(started).to.equal(true);
    await tick();
    expect(log).to.deep.equal([]);
  });

  it('should report a rejection with the context it was started in', async () => {
    const { log, report } = reported();
    const failure = new Error('boom');
    background(() => Promise.reject(failure), 'render:list', report);
    await tick();
    expect(log).to.deep.equal([[failure, 'render:list']]);
  });

  it('should report what the task throws before its first await', () => {
    const { log, report } = reported();
    const failure = new Error('sync');
    background(
      () => {
        throw failure;
      },
      'wire',
      report
    );
    expect(log).to.deep.equal([[failure, 'wire']]);
  });

  it('should accept a task that returns no promise', async () => {
    const { log, report } = reported();
    background(() => undefined, 'nothing', report);
    background(() => 42, 'value', report);
    await tick();
    expect(log).to.deep.equal([]);
  });

  it('should fall back on the log when no reporter is given', async () => {
    const original = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]): void => {
      logged.push(args);
    };
    try {
      const failure = new Error('unreported');
      background(() => Promise.reject(failure), 'alone');
      await tick();
      expect(logged).to.deep.equal([
        ['[twake-directory-manager]', 'alone', failure],
      ]);
      logReporter(failure, 'direct');
      expect(logged).to.have.length(2);
    } finally {
      console.error = original;
    }
  });

  it('should tell the console’s own errors from the page’s by their stack', () => {
    const ours = new Error('ours');
    ours.stack =
      'Error: ours\n    at render (https://directory.example.org/static/console/twake-directory-manager.esm.js:12:3)';
    const theirs = new Error('theirs');
    theirs.stack =
      'Error: theirs\n    at main (https://directory.example.org/app.js:1:1)';
    expect(fromConsole(ours)).to.equal(true);
    expect(fromConsole(theirs)).to.equal(false);
    // A rejection with no error, or an error with no stack, is left alone.
    expect(fromConsole('a string')).to.equal(false);
    expect(fromConsole(null)).to.equal(false);
    expect(fromConsole(undefined)).to.equal(false);
    expect(fromConsole({ stack: 42 })).to.equal(false);
  });
});

describe('DirectoryConsole.report', () => {
  it('should tell the administrator, log, and hand the failure to the page', () => {
    const toast = {
      textContent: '',
      hidden: true,
      classList: { toggle: (_name: string, _on: boolean) => undefined },
    };
    const given: [unknown, string][] = [];
    const app = new DirectoryConsole({
      containerId: 'console',
      apiBaseUrl: 'http://localhost',
      language: 'fr',
      onError: (error, context) => given.push([error, context]),
    });
    (app as unknown as { container: unknown }).container = {
      querySelector: (selector: string) =>
        selector === '[data-toast]' ? toast : null,
      querySelectorAll: () => [],
    };
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => {
      logged.push(args);
    };
    try {
      const failure = new Error('Directory unreachable');
      (
        app as unknown as { report(error: unknown, context: string): void }
      ).report(failure, 'renderMain');
      expect(toast.hidden).to.equal(false);
      expect(toast.textContent).to.equal(
        'Une erreur est survenue : Directory unreachable'
      );
      expect(logged).to.deep.equal([
        ['[twake-directory-manager]', 'renderMain', failure],
      ]);
      expect(given).to.deep.equal([[failure, 'renderMain']]);
    } finally {
      console.error = original;
    }
  });

  it('should say what a refused or missing entry means, and survive a hook that throws', () => {
    const toast = {
      textContent: '',
      hidden: true,
      classList: { toggle: (_name: string, _on: boolean) => undefined },
    };
    const app = new DirectoryConsole({
      containerId: 'console',
      apiBaseUrl: 'http://localhost',
      language: 'en',
      onError: () => {
        throw new Error('the hook is broken');
      },
    });
    (app as unknown as { container: unknown }).container = {
      querySelector: (selector: string) =>
        selector === '[data-toast]' ? toast : null,
      querySelectorAll: () => [],
    };
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => {
      logged.push(args);
    };
    try {
      const report = (
        app as unknown as { report(error: unknown, context: string): void }
      ).report;
      report(Object.assign(new Error('Forbidden'), { status: 403 }), 'x');
      expect(toast.textContent).to.equal(
        'Something went wrong: You may not see this entry'
      );
      // The hook's failure is logged, not thrown back into the boundary.
      expect(logged.map(args => args[0])).to.deep.equal([
        '[twake-directory-manager]',
        '[twake-directory-manager] onError',
      ]);
      // A rejection that is no Error has no message to add.
      report('a string', 'y');
      expect(toast.textContent).to.equal('Something went wrong');
    } finally {
      console.error = original;
    }
  });
});
