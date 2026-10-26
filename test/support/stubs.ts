/**
 * Hand-made stand-ins for what the console renders into, and a console built
 * with them: the unit suite has a DOM (test/support/dom.ts) but most of its
 * tests predate it and drive the code through these stubs, which record what
 * was written and answer the few DOM calls the code makes. New tests mount
 * into `document.body` instead (#221).
 */
import { DirectoryConsole } from '../../src/DirectoryConsole';

export const baseUrl = 'http://localhost:8099';

/** Minimal stand-in for the element a component renders into. */

/** Minimal stand-in for the element a component renders into. */
export function stubContainer(): HTMLElement & { innerHTML: string } {
  return {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLElement & { innerHTML: string };
}

/**
 * A container that keeps what a component writes into it apart, the way a
 * browser does: writing its `innerHTML` replaces the whole subtree (a new
 * filter input, a new list), while writing the list's own replaces only the
 * list. `builds` counts how many times the shell was written, which is how
 * many times the filter input was replaced.
 */

/**
 * A container that keeps what a component writes into it apart, the way a
 * browser does: writing its `innerHTML` replaces the whole subtree (a new
 * filter input, a new list), while writing the list's own replaces only the
 * list. `builds` counts how many times the shell was written, which is how
 * many times the filter input was replaced.
 */
export interface TreeContainer {
  innerHTML: string;
  builds: number;
  filter: { value: string; fire(): void };
  list: { innerHTML: string };
}

export function treeContainer(): HTMLElement & TreeContainer {
  const fresh = (): Pick<TreeContainer, 'filter' | 'list'> => {
    let listener: (() => void) | undefined;
    return {
      filter: Object.assign(
        {
          value: '',
          fire: () => listener?.(),
        },
        {
          addEventListener: (_type: string, callback: () => void) => {
            listener = callback;
          },
        }
      ),
      list: {
        innerHTML: '',
        querySelectorAll: () => [],
      } as TreeContainer['list'],
    };
  };
  let shell = '';
  const container = {
    builds: 0,
    ...fresh(),
    get innerHTML(): string {
      return shell.replace(
        '<div data-tree-list></div>',
        `<div data-tree-list>${container.list.innerHTML}</div>`
      );
    },
    set innerHTML(html: string) {
      shell = html;
      container.builds++;
      Object.assign(container, fresh());
    },
    querySelector(selector: string): unknown {
      if (!shell) return null;
      if (selector === '[data-tree-list]') return container.list;
      if (selector === '[data-filter]') return container.filter;
      return null;
    },
  };
  return container as unknown as HTMLElement & TreeContainer;
}

/**
 * A console drawn into a container that answers each selector with the
 * element given for it: enough for an action that writes into the shell.
 */

/**
 * A console drawn into a container that answers each selector with the
 * element given for it: enough for an action that writes into the shell.
 */
export function consoleIn(
  elements: Record<string, unknown>,
  language = 'en'
): DirectoryConsole {
  const app = new DirectoryConsole({
    containerId: 'console',
    apiBaseUrl: baseUrl,
    language,
  });
  (app as unknown as { container: unknown }).container = {
    querySelector: (selector: string) => elements[selector] ?? null,
    querySelectorAll: () => [],
  };
  return app;
}

/** A toast element, which records the last message it was given. */

/** A toast element, which records the last message it was given. */
export function toastElement(): { textContent: string } {
  return {
    textContent: '',
    hidden: true,
    onclick: null,
    classList: { toggle: () => undefined },
  } as unknown as { textContent: string };
}
