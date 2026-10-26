import { expect } from 'chai';

import { availableLanguages, catalogues } from '../src/i18n';

/**
 * A sentence with a count is written in the forms its language tells apart
 * (`key.one`, `key.other`…) and as the plain key by a language whose nouns
 * do not change after a number: what the catalogues must share is the key
 * without its plural category.
 */
const PLURAL = /\.(zero|one|two|few|many|other)$/;

/**
 * The keys a catalogue must share with the others. Left out: a key that
 * refines one the catalogue also holds (`dashboard.create.users` beside
 * `dashboard.create`), which is a language's own choice — French names what
 * it creates, where English says "New {entity}" — and is read with the plain
 * key as its fallback.
 */
const bases = (code: string): Set<string> => {
  const keys = new Set(Object.keys(catalogues[code]));
  const refinement = (key: string): boolean =>
    keys.has(key.slice(0, key.lastIndexOf('.')));
  return new Set(
    [...keys]
      .map(key => key.replace(PLURAL, ''))
      .filter(key => !refinement(key))
  );
};

describe('the catalogues', () => {
  it('should each hold every key the others hold', () => {
    const [first, ...others] = availableLanguages;
    const reference = bases(first);
    expect(reference.size).to.be.greaterThan(300);
    for (const code of others) {
      const keys = bases(code);
      const missing = [...reference].filter(key => !keys.has(key));
      const extra = [...keys].filter(key => !reference.has(key));
      expect(missing, `${code} lacks keys ${first} has`).to.deep.equal([]);
      expect(extra, `${code} has keys ${first} lacks`).to.deep.equal([]);
    }
  });

  it('should hold no empty translation', () => {
    for (const code of availableLanguages)
      for (const key of Object.keys(catalogues[code]))
        expect(key, `${code}: ${key}`).to.not.equal('');
  });

  /**
   * The words of a text as axe compares a control's visible text with its
   * name (WCAG 2.5.3, label in name): lower case, accents taken apart and
   * dropped with every other sign, so that "Rattacher à…" is [rattacher, a].
   */
  const words = (text: string): string[] =>
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
  const within = (label: string[], name: string[]): boolean =>
    name.some((_, i) => label.every((word, j) => name[i + j] === word));

  it('should keep the visible text of a named action within its name', () => {
    // A button showing one text and named another, for a screen reader, must
    // keep the shown words in the name, in a row: "Rattacher à…" named
    // "Rattacher Grace Kim" failed the e2e gate the first time an entry
    // waited in transit while the overview was scanned.
    const pairs: [string, string][] = [['transit.claim', 'transit.claimTitle']];
    for (const code of availableLanguages)
      for (const [label, name] of pairs) {
        const shown = words(catalogues[code][label]);
        const named = words(
          catalogues[code][name].replace('{name}', 'Grace Kim')
        );
        expect(within(shown, named), `${code}: ${label} within ${name}`).to.be
          .true;
      }
  });
});
