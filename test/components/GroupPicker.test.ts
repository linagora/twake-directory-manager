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
  const open = (
    options: Partial<ConstructorParameters<typeof GroupPicker>[0]> = {}
  ): {
    input: HTMLInputElement;
    results: HTMLElement;
    chosen: HTMLElement;
    add: HTMLButtonElement;
    announced: string[];
    type(text: string): void;
    press(key: string): boolean;
    answered(text: string): Promise<void>;
  } => {
    const container = document.createElement('div');
    document.body.append(container);
    const announced: string[] = [];
    new GroupPicker({
      translator: new Translator('en'),
      announce: text => announced.push(text),
      search: async query =>
        groups.filter(group => group.name.startsWith(query)),
      onAdd: async () => ({ left: [] }),
      onCancel: () => undefined,
      ...options,
    }).render(container);
    const input = container.querySelector<HTMLInputElement>('#dc-group-search');
    const results = container.querySelector<HTMLElement>('#dc-group-results');
    const chosen = container.querySelector<HTMLElement>('[data-chosen]');
    const add = container.querySelector<HTMLButtonElement>('[data-add]');
    if (!input || !results || !chosen || !add) throw new Error('no picker');
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
    return { input, results, chosen, add, announced, type, press, answered };
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

  it('should keep the search after a choice, and take the next one from it', async () => {
    const { input, results, chosen, announced, type, press, answered } = open();
    type('sales');
    await answered('sales-team');
    expect(press('Enter')).to.equal(true);
    expect(chosen.textContent).to.include('sales-team');
    // The search it was picked from stays while it has more to offer: the
    // box keeps its text, the list the other match, and nothing was typed
    // again.
    expect(input.value).to.equal('sales');
    expect(results.textContent)
      .to.include('sales-fr')
      .and.not.include('sales-team');
    expect(press('Enter')).to.equal(true);
    expect(chosen.textContent).to.include('sales-team').and.include('sales-fr');
    expect(announced).to.deep.equal([
      'sales-team added to those chosen',
      'sales-fr added to those chosen',
    ]);
    // That search had nothing left: the box is given back, ready for the
    // next one, and Enter adds the groups chosen.
    expect(input.value).to.equal('');
    expect(results.hidden).to.equal(true);
  });

  it('should offer a removed group again by the query still typed', async () => {
    const { chosen, results, type, press, answered } = open();
    type('sales');
    await answered('sales-team');
    // One of the two matches is picked: the search stays, with the other.
    press('Enter');
    expect(chosen.textContent).to.include('sales-team');
    expect(results.textContent).to.include('sales-fr');

    // Out goes sales-team; the box still reads "sales", so the search is
    // asked again and offers it once more.
    chosen.querySelector<HTMLElement>('[data-remove="0"]')?.click();
    await answered('sales-team');
    expect(results.textContent)
      .to.include('sales-team')
      .and.include('sales-fr');
    expect(chosen.textContent).to.equal('');
  });

  describe('one choice, the organization a claim goes into', () => {
    const single = {
      single: true,
      confirm: (held: { name: string }[]): string =>
        held[0] ? `Claim into ${held[0].name}` : 'Claim',
    };

    it('should replace the choice held, give the box back, and name it on the button', async () => {
      const { input, results, chosen, add, announced, type, press, answered } =
        open(single);
      expect(add.textContent).to.equal('Claim');
      type('sales-t');
      await answered('sales-team');
      press('Enter');
      expect(chosen.textContent).to.include('sales-team');
      expect(add.textContent).to.equal('Claim into sales-team');
      expect(add.disabled).to.equal(false);
      // One place to go: the search is done once it is picked.
      expect(input.value).to.equal('');
      expect(results.hidden).to.equal(true);
      type('sales-f');
      await answered('sales-fr');
      press('Enter');
      expect(chosen.textContent)
        .to.include('sales-fr')
        .and.not.include('sales-team');
      expect(add.textContent).to.equal('Claim into sales-fr');
      expect(announced).to.deep.equal([
        'Chosen: sales-team',
        'Chosen: sales-fr',
      ]);
      chosen.querySelector<HTMLElement>('[data-remove="0"]')?.click();
      expect(add.textContent).to.equal('Claim');
      expect(add.disabled).to.equal(true);
    });

    it('should say that the answer was cut, under the suggestions or instead of none', async () => {
      const cut = 'More matched: type more';
      const { results, announced, type, answered } = open({
        ...single,
        search: async query => ({
          choices: groups.filter(group => group.name.startsWith(query)),
          note: cut,
        }),
      });
      type('sales-t');
      await answered('sales-team');
      expect(results.querySelector('[data-picker-cut]')?.textContent).to.equal(
        cut
      );
      expect(announced).to.deep.equal([cut]);
      // Nothing offered from a cut answer: the note, not "no match".
      type('nothing');
      await answered(cut);
      expect(results.textContent)
        .to.equal(cut)
        .and.not.include('No entry matches');
    });
  });
});
