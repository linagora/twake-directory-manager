import { expect } from 'chai';
import { EntityImport } from '../../src/components/EntityImport';
import { Translator } from '../../src/i18n';
import { users } from '../fixtures/entities';

describe('EntityImport', () => {
  /** An import drawn into the page, its file read as the input would. */
  const drawn = (language = 'en') => {
    const root = document.createElement('div');
    document.body.append(root);
    const importer = new EntityImport({
      entity: users,
      translator: new Translator(language),
      pointerOptions: () => Promise.resolve([]),
      create: () => Promise.resolve(),
      onDone: () => undefined,
      onClose: () => undefined,
    });
    importer.render(root);
    const read = (content: string, name = 'x.csv'): Promise<void> =>
      (importer as unknown as { readFile(file: File): Promise<void> }).readFile(
        new File([content], name, { type: 'text/csv' })
      );
    return { root, importer, read };
  };

  it('should move the focus to the lead of each step, once', async () => {
    // Each step replaced the panel's content and the focus fell to the page;
    // a screen reader heard nothing of what the step said (#213).
    const { root, read } = drawn();
    expect(root.querySelector('[data-step-lead]')).to.equal(null);
    expect(document.activeElement).to.equal(document.body);
    await read('Identifier,Name\nA1,Ann\n');
    const lead = root.querySelector<HTMLElement>('p[data-step-lead]');
    expect(lead?.textContent).to.include('x.csv');
    expect(lead?.getAttribute('tabindex')).to.equal('-1');
    expect(document.activeElement).to.equal(lead);
    // A column mapped otherwise repaints the step: the select, drawn anew,
    // keeps the focus rather than the lead or the page
    const select = root.querySelector<HTMLSelectElement>(
      '[data-import-map="0"]'
    );
    if (!select) throw new Error('no mapping select');
    select.focus();
    select.dispatchEvent(new Event('change'));
    const fresh = root.querySelector('[data-import-map="0"]');
    expect(fresh).to.not.equal(select);
    expect(document.activeElement).to.equal(fresh);
  });

  it('should give the focus to the file input when another file is asked for', async () => {
    // The file step has no lead; the button pressed is gone with the step.
    const { root, read } = drawn();
    await read('Identifier,Name\nA1,Ann\n');
    const restart = root.querySelector<HTMLElement>('[data-import-restart]');
    if (!restart) throw new Error('no restart button');
    restart.focus();
    restart.click();
    expect(document.activeElement).to.equal(
      root.querySelector('[data-import-file]')
    );
  });

  it('should not take the focus from elsewhere on the page when a step completes', async () => {
    // A file read, or the last row written, while the reader is on the
    // language select: the step is drawn, the focus stays where it is.
    const { root, read } = drawn();
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    await read('Identifier,Name\nA1,Ann\n');
    expect(root.querySelector('[data-step-lead]')).to.not.equal(null);
    expect(document.activeElement).to.equal(elsewhere);
  });

  it('should focus the error of an empty file, the second one too', async () => {
    // The second empty file in a row changed nothing the paint could see,
    // and the focus fell to the page with the input it replaced.
    const { root, read } = drawn('fr');
    await read('');
    const lead = root.querySelector<HTMLElement>('p.dc-error[data-step-lead]');
    expect(lead?.textContent).to.equal(
      'Ce fichier ne contient aucune ligne à importer.'
    );
    expect(document.activeElement).to.equal(lead);
    root.querySelector<HTMLElement>('[data-import-file]')?.focus();
    await read('');
    expect(document.activeElement).to.equal(
      root.querySelector('p.dc-error[data-step-lead]')
    );
  });
});
