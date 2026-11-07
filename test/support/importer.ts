/**
 * An import drawn in the page and driven as the reader drives it (#221): a
 * file chosen in its input, its columns mapped in the selects it draws, the
 * check pressed, then the import run.
 *
 * @module twake-directory-manager/test/support/importer
 */

import {
  EntityImport,
  type ImportOptions,
} from '../../src/components/EntityImport';
import { until } from './act';

/** An import on the page, with the gestures that take it through its steps. */
export interface DrivenImport {
  /** What the import drew. */
  root: HTMLElement;
  /** Choose a file in the input, and wait for the mapping step. */
  choose(content: string, name?: string): Promise<void>;
  /** Map each column to the attribute it fills, '' to ignore it. */
  map(columns: string[]): Promise<void>;
  /** Press Check, and wait for the review, or for what the check failed on. */
  check(): Promise<void>;
  /** Press Import, and wait for the last step. */
  run(): Promise<void>;
}

/**
 * Draw an import at the top of the page.
 *
 * @param options what the console gives it
 * @returns the import, and the gestures that take it through its steps
 */
export function drivenImport(options: ImportOptions): DrivenImport {
  const root = document.createElement('div');
  document.body.append(root);
  new EntityImport(options).render(root);
  const find = <T extends Element>(selector: string): T => {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`no ${selector}`);
    return found;
  };
  return {
    root,
    async choose(content: string, name = 'x.csv'): Promise<void> {
      const input = find<HTMLInputElement>('[data-import-file]');
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [new File([content], name, { type: 'text/csv' })],
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => Boolean(root.querySelector('[data-import-map]')));
    },
    async map(columns: string[]): Promise<void> {
      for (const [index, name] of columns.entries()) {
        const select = find<HTMLSelectElement>(`[data-import-map="${index}"]`);
        select.value = name;
        select.dispatchEvent(new Event('change'));
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    },
    async check(): Promise<void> {
      find<HTMLElement>('[data-import-check]').click();
      await until(
        () =>
          Boolean(root.querySelector('[data-import-run]')) ||
          Boolean(root.querySelector('.dc-import .dc-error[data-step-lead]'))
      );
    },
    async run(): Promise<void> {
      find<HTMLElement>('[data-import-run]').click();
      await until(() => Boolean(root.querySelector('[data-import-close]')));
    },
  };
}
