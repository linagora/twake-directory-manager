/**
 * The keyboard of the group picker, mounted into the page as the reader has
 * it: the suggestions of the text typed before, and the arrows walking them
 * (#221).
 */
import { expect } from 'chai';
import { GroupPicker } from '../../src/components/GroupPicker';
import { Translator } from '../../src/i18n';
import { until } from '../support/act';

describe('GroupPicker', () => {
  const groups = [
    { dn: 'cn=sales-team,ou=groups', name: 'sales-team', label: 'sales-team' },
    { dn: 'cn=sales-fr,ou=groups', name: 'sales-fr', label: 'sales-fr' },
  ];

  /** The picker, its field and what it shows under it. */
  const open = (): {
    input: HTMLInputElement;
    results: HTMLElement;
    chosen: HTMLElement;
    type(text: string): void;
    press(key: string): boolean;
    answered(text: string): Promise<void>;
  } => {
    const container = document.createElement('div');
    document.body.append(container);
    new GroupPicker({
      translator: new Translator('en'),
      search: async query =>
        groups.filter(group => group.name.startsWith(query)),
      onAdd: async () => ({ left: [] }),
      onCancel: () => undefined,
    }).render(container);
    const input = container.querySelector<HTMLInputElement>('#dc-group-search');
    const results = container.querySelector<HTMLElement>('#dc-group-results');
    const chosen = container.querySelector<HTMLElement>('[data-chosen]');
    if (!input || !results || !chosen) throw new Error('no picker');
    const type = (text: string): void => {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const press = (key: string): boolean => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const answered = (text: string): Promise<void> =>
      until(() => results.textContent?.includes(text) ?? false);
    return { input, results, chosen, type, press, answered };
  };

  it('should offer no suggestion of the text typed before while searching the new one', async () => {
    const { input, results, chosen, type, press, answered } = open();
    type('sales-t');
    await answered('sales-team');
    expect(input.getAttribute('aria-activedescendant')).to.equal(
      'dc-group-option-0'
    );
    // Typed on: sales-team is no longer what the box names.
    type('sales-f');
    expect(results.textContent)
      .to.include('Searching…')
      .and.not.include('sales-team');
    expect(input.getAttribute('aria-activedescendant')).to.equal(null);
    // Enter waits for the search, rather than choosing an old suggestion.
    expect(press('Enter')).to.equal(true);
    expect(chosen.innerHTML).to.equal('');
    await answered('sales-fr');
    expect(press('Enter')).to.equal(true);
    expect(chosen.innerHTML)
      .to.include('sales-fr')
      .and.not.include('sales-team');
  });

  it('should walk the suggestions with the arrows, round, and bring the active one into view', async () => {
    const { input, results, type, press, answered } = open();
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element): void {
      scrolled.push((this as HTMLElement).id);
    };
    try {
      type('sales');
      await answered('sales-team');
      const active = (): string | null =>
        input.getAttribute('aria-activedescendant');
      expect(active()).to.equal('dc-group-option-0');
      press('ArrowDown');
      expect(active()).to.equal('dc-group-option-1');
      expect(results.innerHTML).to.match(
        /id="dc-group-option-1"[^>]*aria-selected="true"/
      );
      // The active option is brought into the visible part of the list.
      expect(scrolled[scrolled.length - 1]).to.equal('dc-group-option-1');
      press('ArrowDown');
      expect(active()).to.equal('dc-group-option-0');
      press('ArrowUp');
      expect(active()).to.equal('dc-group-option-1');
      expect(scrolled[scrolled.length - 1]).to.equal('dc-group-option-1');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
