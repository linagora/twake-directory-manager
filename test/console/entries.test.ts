/**
 * What is left of the stub tests of the entries: the keyboard of the group
 * picker. An entry's card is tested mounted in test/views/entry.test.ts,
 * the list and the actions it offers on a selection in
 * test/views/list.test.ts, the memberships of groups in
 * test/actions/groups.test.ts (#221).
 */
import { expect } from 'chai';
import nock from 'nock';
import { GroupPicker } from '../../src/components/GroupPicker';
import { Translator } from '../../src/i18n';

describe('Directory console: entries and their groups', () => {
  afterEach(() => nock.cleanAll());

  describe('an account’s groups', () => {
    describe('the panel Add to a group… opens', () => {
      /** An element enough for the picker: attributes, listeners, children. */
      const element = () => {
        const listeners: Record<string, ((event: unknown) => void)[]> = {};
        const attributes: Record<string, string> = {};
        return {
          innerHTML: '',
          hidden: false,
          value: '',
          disabled: false,
          textContent: '',
          children: {} as Record<string, unknown>,
          setAttribute(name: string, value: string) {
            attributes[name] = value;
          },
          getAttribute: (name: string) => attributes[name] ?? null,
          removeAttribute(name: string) {
            delete attributes[name];
          },
          addEventListener(type: string, listener: (event: unknown) => void) {
            (listeners[type] ??= []).push(listener);
          },
          fire(type: string, event: Record<string, unknown> = {}) {
            let prevented = false;
            for (const listener of listeners[type] ?? [])
              listener({
                ...event,
                preventDefault: () => {
                  prevented = true;
                },
              });
            return prevented;
          },
          focus: () => undefined,
          querySelector(selector: string): unknown {
            return this.children[selector] ?? null;
          },
        };
      };
      const groups = [
        {
          dn: 'cn=sales-team,ou=groups',
          name: 'sales-team',
          label: 'sales-team',
        },
        { dn: 'cn=sales-fr,ou=groups', name: 'sales-fr', label: 'sales-fr' },
      ];
      const open = () => {
        const parts = {
          form: element(),
          '#dc-group-search': element(),
          '#dc-group-results': element(),
          '[data-chosen]': element(),
          '[data-error]': element(),
          '[data-add]': element(),
          '[data-cancel]': element(),
        };
        const scrolled: string[] = [];
        // What the list shows of the active option, once drawn.
        parts['#dc-group-results'].querySelector = (selector: string) => ({
          scrollIntoView: () => scrolled.push(selector),
        });
        const container = element();
        container.children = parts;
        new GroupPicker({
          translator: new Translator('en'),
          search: async query =>
            groups.filter(group => group.name.startsWith(query)),
          onAdd: async () => ({ left: [] }),
          onCancel: () => undefined,
        }).render(container as unknown as HTMLElement);
        const input = parts['#dc-group-search'];
        const type = async (text: string): Promise<void> => {
          input.value = text;
          input.fire('input');
        };
        const answered = (): Promise<void> =>
          new Promise(resolve => setTimeout(resolve, 300));
        return {
          input,
          results: parts['#dc-group-results'],
          parts,
          type,
          answered,
          scrolled,
        };
      };

      it('should offer no suggestion of the text typed before while searching the new one', async () => {
        const { input, results, parts, type, answered } = open();
        await type('sales-t');
        await answered();
        expect(results.innerHTML).to.include('sales-team');
        expect(input.getAttribute('aria-activedescendant')).to.equal(
          'dc-group-option-0'
        );
        // Typed on: sales-team is no longer what the box names.
        await type('sales-f');
        expect(results.innerHTML)
          .to.include('Searching…')
          .and.not.include('sales-team');
        expect(input.getAttribute('aria-activedescendant')).to.equal(null);
        expect(input.fire('keydown', { key: 'Enter' })).to.equal(true);
        expect(parts['[data-chosen]'].innerHTML).to.equal('');
        await answered();
        input.fire('keydown', { key: 'Enter' });
        expect(parts['[data-chosen]'].innerHTML)
          .to.include('sales-fr')
          .and.not.include('sales-team');
      });

      it('should walk the suggestions with the arrows, round, and bring the active one into view', async () => {
        const { input, results, type, answered, scrolled } = open();
        await type('sales');
        await answered();
        const active = (): string | null =>
          input.getAttribute('aria-activedescendant');
        expect(active()).to.equal('dc-group-option-0');
        input.fire('keydown', { key: 'ArrowDown' });
        expect(active()).to.equal('dc-group-option-1');
        expect(results.innerHTML).to.match(
          /id="dc-group-option-1"[^>]*aria-selected="true"/
        );
        input.fire('keydown', { key: 'ArrowDown' });
        expect(active()).to.equal('dc-group-option-0');
        input.fire('keydown', { key: 'ArrowUp' });
        expect(active()).to.equal('dc-group-option-1');
        expect(scrolled[scrolled.length - 1]).to.equal('#dc-group-option-1');
      });
    });
  });
});
