import { expect } from 'chai';
import { ConsoleApiClient } from '../../src/api/ConsoleApiClient';
import { OrganizationTree } from '../../src/components/OrganizationTree';
import { Translator } from '../../src/i18n';
import { until } from '../support/act';
import { baseUrl } from '../support/stubs';

describe('OrganizationTree', () => {
  /** A container the tree draws into, in the page. */
  const treeOnPage = (): HTMLElement => {
    const container = document.createElement('div');
    document.body.append(container);
    return container;
  };
  /** The filter the tree drew. */
  const filterOf = (container: HTMLElement): HTMLInputElement =>
    container.querySelector<HTMLInputElement>(
      '[data-filter]'
    ) as HTMLInputElement;
  /** What the tree drew below its filter. */
  const listOf = (container: HTMLElement): HTMLElement =>
    container.querySelector<HTMLElement>('[data-tree-list]') as HTMLElement;
  /** Type in the filter, as the reader does. */
  const type = (container: HTMLElement, text: string): void => {
    const input = filterOf(container);
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  /** Click the tree's control this selector names. */
  const click = (container: HTMLElement, selector: string): void => {
    const control = container.querySelector<HTMLElement>(selector);
    if (!control) throw new Error(`no ${selector}`);
    control.click();
  };
  /** Let the work a click or a keystroke started answer. */
  const settle = (): Promise<void> =>
    new Promise(resolve => setImmediate(resolve));

  describe('OrganizationTree filter', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const sales = `ou=Sales,${top}`;

    it('should keep the filter input across keystrokes', async () => {
      const container = treeOnPage();
      await new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: async () => [
          { dn: sales, name: 'Sales' },
          { dn: 'ou=Lin,ou=organization,dc=example,dc=com', name: 'Lin' },
        ],
        onSelect: () => undefined,
      }).render(container);
      expect(container.innerHTML).to.include('>Sales</button>');

      // A redraw that replaced the input would take its value and its caret
      // with it: the input the reader types in stays the one drawn.
      const input = filterOf(container);
      for (const typed of ['l', 'li', 'lin']) {
        type(container, typed);
        expect(filterOf(container)).to.equal(input);
        expect(filterOf(container).value).to.equal(typed);
      }
      // The list was filtered all the same.
      expect(container.innerHTML)
        .to.include('>Lin</button>')
        .and.not.include('>Sales</button>');
    });

    it('should name its buttons after their organization, and expose the selected one', async () => {
      const container = treeOnPage();
      const tree = new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: async () => [{ dn: sales, name: 'Sales' }],
        onSelect: () => undefined,
        onCreateChild: () => undefined,
      });
      await tree.render(container);
      tree.select(sales);
      const html = listOf(container).innerHTML.replace(/\s+/g, ' ');
      expect(html)
        .to.include('aria-expanded="true" aria-label="Collapse organization"')
        .and.include('aria-expanded="false" aria-label="Expand Sales"')
        .and.include('aria-label="New organization under Sales"');
      expect(html).to.match(
        /data-select="ou=Sales,[^"]*" aria-current="true" title="[^"]*">Sales</
      );
      expect(html).to.not.match(
        /data-select="ou=organization,[^"]*" aria-current/
      );
    });

    it('should say when the filter hides every opened organization', async () => {
      const container = treeOnPage();
      await new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: async () => [{ dn: sales, name: 'Sales' }],
        onSelect: () => undefined,
      }).render(container);
      type(container, 'zzz');
      expect(listOf(container).innerHTML)
        .to.include('No organization matches “zzz”')
        .and.not.include('dc-tree-list');
      // Cleared, the tree is back.
      type(container, '');
      expect(listOf(container).innerHTML).to.include('>Sales</button>');
    });
  });

  describe('OrganizationTree, searching the whole tree', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const sales = `ou=Sales,${top}`;
    const france = `ou=France,${sales}`;
    const options = (asked: string[], selected: string[] = []) => ({
      translator: new Translator('en'),
      root: async () => ({ dn: top, name: 'organization' }),
      children: async (dn: string) => {
        asked.push(dn);
        if (dn === top) return [{ dn: sales, name: 'Sales' }];
        if (dn === sales) return [{ dn: france, name: 'France' }];
        return [];
      },
      onSelect: (node: { dn: string }) => {
        selected.push(node.dn);
      },
      everywhere: async () => ({
        organizations: [
          { dn: top, label: 'organization' },
          { dn: sales, label: 'Sales' },
          { dn: france, label: 'Sales / France' },
        ],
        partial: false,
      }),
    });
    /** Open a node as the reader does, the label of the tree clicked. */
    const pick = (container: HTMLElement, dn: string): void =>
      click(container, `[data-select="${dn}"]`);

    it('should find an organization under a branch never opened', async () => {
      const asked: string[] = [];
      const selected: string[] = [];
      const container = treeOnPage();
      const tree = new OrganizationTree(options(asked, selected));
      await tree.render(container);
      type(container, 'Fra');
      await settle();
      expect(listOf(container).innerHTML)
        .to.include(`data-found="${france}"`)
        .and.include('>Sales / France</button>')
        .and.not.include('data-select');
      expect(asked).to.deep.equal([top]);

      // Chosen, it is shown in the tree, opened down to it, and selected.
      click(container, `[data-found="${france}"]`);
      await until(() => selected.length === 1);
      await settle();
      expect(filterOf(container).value).to.equal('');
      expect(selected).to.deep.equal([france]);
      expect(listOf(container).innerHTML).to.match(
        /dc-selected[^]*?data-select="ou=France,ou=Sales,/
      );
    });

    it('should read the top again when it is refreshed, for its new name', async () => {
      // The top hangs from nothing: refreshing its children kept the name it
      // was first read with, and the filter went on finding the old one.
      let topName = 'Old organization';
      const container = treeOnPage();
      const tree = new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: topName }),
        children: async () => [{ dn: sales, name: 'Sales' }],
        onSelect: () => undefined,
      });
      await tree.render(container);
      type(container, 'Old');
      expect(listOf(container).innerHTML).to.include(
        '>Old organization</button>'
      );

      topName = 'New organization';
      await tree.refresh();
      type(container, 'New');
      expect(listOf(container).innerHTML).to.include(
        '>New organization</button>'
      );
      type(container, 'Old');
      expect(listOf(container).innerHTML).to.not.include('>Old organization<');
    });

    it('should say when no organization of the whole tree matches', async () => {
      const container = treeOnPage();
      await new OrganizationTree(options([])).render(container);
      type(container, 'zzz');
      await settle();
      expect(listOf(container).innerHTML)
        .to.include('No organization matches “zzz”')
        .and.not.include('among the opened branches');
    });

    it('should read the whole tree once, and again once a branch changed', async () => {
      let reads = 0;
      const container = treeOnPage();
      const tree = new OrganizationTree({
        ...options([]),
        everywhere: async () => {
          reads++;
          return {
            organizations: [{ dn: sales, label: 'Sales' }],
            partial: false,
          };
        },
      });
      await tree.render(container);
      for (const typed of ['Sa', 'Sal', 'S', 'Sa']) {
        type(container, typed);
        await settle();
      }
      expect(reads).to.equal(1);
      await tree.refresh();
      await settle();
      expect(reads).to.equal(2);
    });

    it('should filter the opened branches when the whole tree cannot be read', async () => {
      const container = treeOnPage();
      await new OrganizationTree({
        ...options([]),
        everywhere: async () => {
          throw new Error('refused');
        },
      }).render(container);
      type(container, 'Sal');
      await settle();
      expect(listOf(container).innerHTML).to.include('>Sales</button>');
    });

    it('should open a node when it is selected', async () => {
      const asked: string[] = [];
      const selected: string[] = [];
      const container = treeOnPage();
      const tree = new OrganizationTree(options(asked, selected));
      await tree.render(container);
      pick(container, sales);
      await until(() =>
        listOf(container).innerHTML.includes('>France</button>')
      );
      expect(selected).to.deep.equal([sales]);
      expect(asked).to.deep.equal([top, sales]);
      expect(listOf(container).innerHTML)
        .to.include('aria-label="Collapse Sales"')
        .and.include('>France</button>');
      // Selected again, it stays open.
      pick(container, sales);
      await settle();
      expect(listOf(container).innerHTML).to.include('>France</button>');
    });

    it('should not say a selected leaf is expanded', async () => {
      const container = treeOnPage();
      const tree = new OrganizationTree(options([]));
      await tree.render(container);
      pick(container, sales);
      await until(() =>
        listOf(container).innerHTML.includes('>France</button>')
      );
      pick(container, france);
      await until(
        () =>
          container
            .querySelector(`[data-select="${france}"]`)
            ?.getAttribute('aria-current') === 'true'
      );
      const html = listOf(container).innerHTML.replace(/\s+/g, ' ');
      expect(html).to.match(
        /data-toggle="ou=France,[^"]*" disabled(?:="")? aria-label="France has no sub-organization"/
      );
      expect(html).to.include(
        'aria-expanded="true" aria-label="Collapse Sales"'
      );
    });

    it('should leave a branch whose children could not be read to be opened again', async () => {
      let refuse = true;
      const asked: string[] = [];
      const container = treeOnPage();
      const tree = new OrganizationTree({
        ...options(asked),
        children: async (dn: string) => {
          asked.push(dn);
          if (dn === top) return [{ dn: sales, name: 'Sales' }];
          if (refuse) throw new Error('Service Unavailable');
          return [{ dn: france, name: 'France' }];
        },
      });
      await tree.render(container);
      pick(container, sales);
      const note = (): string => listOf(container).innerHTML;
      await until(() => note().includes('dc-tree-note'));
      // Not taken for a leaf: closed, and still offered to open.
      expect(note().replace(/\s+/g, ' ')).to.include(
        'aria-expanded="false" aria-label="Expand Sales"'
      );
      // And said, under the tree, so the arrow does not seem to do nothing.
      expect(note()).to.include(
        'Could not read what Sales holds (Service Unavailable). Open it again to retry.'
      );
      refuse = false;
      pick(container, sales);
      await until(() => note().includes('>France</button>'));
      expect(asked).to.deep.equal([top, sales, sales]);
      // Read, the note goes.
      expect(note()).to.not.include('dc-tree-note');
    });

    it('should merge the opened branches into a walk cut short, and hedge its "no match"', async () => {
      const container = treeOnPage();
      const tree = new OrganizationTree({
        ...options([]),
        // The walk stopped before France, which an opened branch holds.
        everywhere: async () => ({
          organizations: [{ dn: top, label: 'organization' }],
          partial: true,
        }),
      });
      await tree.render(container);
      pick(container, sales);
      await until(() =>
        listOf(container).innerHTML.includes('>France</button>')
      );
      type(container, 'Fra');
      await settle();
      expect(listOf(container).innerHTML).to.include(`data-found="${france}"`);
      type(container, 'zzz');
      await settle();
      expect(listOf(container).innerHTML).to.include(
        'No organization matches “zzz” among the opened branches'
      );
    });

    it('should not deny a match an opened branch holds when the walk could not read that branch', async () => {
      const client = new ConsoleApiClient(baseUrl);
      // The walk fails on Sales, which the tree read when it was opened.
      Object.assign(client, {
        organizationTop: async () => ({ dn: top, name: 'organization' }),
        subnodes: async (dn: string) => {
          if (dn === top) return [{ dn: sales, ou: 'Sales' }];
          throw Object.assign(new Error('Service Unavailable'), {
            status: 503,
          });
        },
      });
      const container = treeOnPage();
      const tree = new OrganizationTree({
        ...options([]),
        everywhere: () => client.organizationWalk(),
      });
      await tree.render(container);
      pick(container, sales);
      await until(() =>
        listOf(container).innerHTML.includes('>France</button>')
      );
      type(container, 'Fra');
      await settle();
      expect(listOf(container).innerHTML).to.include(`data-found="${france}"`);
      type(container, 'zzz');
      await settle();
      expect(listOf(container).innerHTML).to.include(
        'No organization matches “zzz” among the opened branches'
      );
    });

    it('should read the whole tree again in the next view after a failure, hedging meanwhile', async () => {
      let reads = 0;
      const container = treeOnPage();
      const everywhere = async () => {
        reads++;
        if (reads === 1) throw new Error('refused');
        return {
          organizations: [{ dn: france, label: 'Sales / France' }],
          partial: false,
        };
      };
      const first = new OrganizationTree({ ...options([]), everywhere });
      await first.render(container);
      type(container, 'zzz');
      await settle();
      expect(listOf(container).innerHTML).to.include(
        'No organization matches “zzz” among the opened branches'
      );
      const again = treeOnPage();
      const second = new OrganizationTree(
        { ...options([]), everywhere },
        first
      );
      await second.render(again);
      await settle();
      type(again, 'Fra');
      await settle();
      expect(reads).to.equal(2);
      expect(listOf(again).innerHTML).to.include(`data-found="${france}"`);
    });

    it('should ask the server once the typing pauses, keeping only the answer to the last text', async () => {
      const pause = (): Promise<void> =>
        new Promise(resolve => setTimeout(resolve, 300));
      const searched: [string, string][] = [];
      const answers = new Map<
        string,
        (found: {
          organizations: { dn: string; label: string }[];
          truncated: boolean;
        }) => void
      >();
      let walks = 0;
      const container = treeOnPage();
      await new OrganizationTree({
        ...options([]),
        everywhere: async () => {
          walks++;
          return { organizations: [], partial: false };
        },
        search: (query: string, root: string) => {
          searched.push([query, root]);
          return new Promise(resolve => answers.set(query, resolve));
        },
      }).render(container);
      // Typed in one go: one request.
      for (const typed of ['Sa', 'Sal']) type(container, typed);
      await pause();
      expect(searched).to.deep.equal([['Sal', top]]);
      expect(listOf(container).innerHTML).to.include('Loading');
      // Typed on while it is under way: its answer, late, is dropped.
      type(container, 'Fra');
      await pause();
      answers.get('Fra')?.({
        organizations: [{ dn: france, label: 'Sales / France' }],
        truncated: false,
      });
      await settle();
      answers.get('Sal')?.({
        organizations: [{ dn: sales, label: 'Sales' }],
        truncated: false,
      });
      await settle();
      expect(listOf(container).innerHTML)
        .to.include(`data-found="${france}"`)
        .and.not.include(`data-found="${sales}"`)
        // A whole answer is not said to be cut.
        .and.not.include('dc-tree-cut');
      expect(walks).to.equal(0);

      // Its "no match" is the whole tree's; a failure leaves the opened
      // branches, hedged.
      type(container, 'zzz');
      await pause();
      answers.get('zzz')?.({ organizations: [], truncated: false });
      await settle();
      expect(listOf(container).innerHTML)
        .to.include('No organization matches “zzz”')
        .and.not.include('among the opened branches');
      type(container, 'yyy');
      await pause();
      expect(searched.map(([query]) => query)).to.deep.equal([
        'Sal',
        'Fra',
        'zzz',
        'yyy',
      ]);
    });

    it('should say when the server kept only the first matches', async () => {
      const container = treeOnPage();
      await new OrganizationTree({
        ...options([]),
        search: async () => ({
          organizations: [
            { dn: france, label: 'Sales / France' },
            { dn: sales, label: 'Sales' },
          ],
          truncated: true,
        }),
      }).render(container);
      type(container, 'Sa');
      await new Promise(resolve => setTimeout(resolve, 300));
      await settle();
      expect(listOf(container).innerHTML)
        .to.include(`data-found="${france}"`)
        .and.include(`data-found="${sales}"`)
        .and.include(
          '<p class="dc-tree-cut">First 2 matches — type more to narrow</p>'
        )
        .and.not.include('No organization matches');
    });

    it('should show the opened branches, hedged, when the server search fails', async () => {
      const container = treeOnPage();
      await new OrganizationTree({
        ...options([]),
        search: async () => {
          throw new Error('Service Unavailable');
        },
      }).render(container);
      type(container, 'Sal');
      await new Promise(resolve => setTimeout(resolve, 300));
      await settle();
      expect(listOf(container).innerHTML).to.include('>Sales</button>');
      type(container, 'zzz');
      await new Promise(resolve => setTimeout(resolve, 300));
      await settle();
      expect(listOf(container).innerHTML).to.include(
        'No organization matches “zzz” among the opened branches'
      );
    });
  });

  describe('OrganizationTree, the focus across a redraw', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const sales = `ou=Sales,${top}`;
    const tick = (): Promise<void> =>
      new Promise(resolve => setTimeout(resolve, 0));

    it('should keep the focus on the arrow pressed, which then says the other state', async () => {
      // The arrow was drawn anew with the list, and the focus fell to the
      // page (#208).
      const container = document.createElement('div');
      document.body.append(container);
      await new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: async dn =>
          dn === top
            ? [{ dn: sales, name: 'Sales' }]
            : [{ dn: `ou=France,${sales}`, name: 'France' }],
        onSelect: () => undefined,
      }).render(container);
      const toggle = (): HTMLElement | null =>
        container.querySelector<HTMLElement>(`[data-toggle="${sales}"]`);
      const arrow = toggle();
      if (!arrow) throw new Error('no arrow');
      expect(arrow.getAttribute('aria-label')).to.equal('Expand Sales');
      arrow.focus();
      arrow.click();
      await tick();
      await tick();
      expect(toggle()).to.not.equal(arrow);
      expect(document.activeElement).to.equal(toggle());
      expect(toggle()?.getAttribute('aria-label')).to.equal('Collapse Sales');
      // Pressed again, closed, the focus stays
      toggle()?.click();
      await tick();
      expect(document.activeElement).to.equal(toggle());
      expect(toggle()?.getAttribute('aria-label')).to.equal('Expand Sales');
    });

    it('should leave the focus where the reader moved it while the children loaded', async () => {
      const container = document.createElement('div');
      document.body.append(container);
      let release: (() => void) | undefined;
      await new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: dn =>
          dn === top
            ? Promise.resolve([{ dn: sales, name: 'Sales' }])
            : new Promise(resolve => {
                release = (): void =>
                  resolve([{ dn: `ou=France,${sales}`, name: 'France' }]);
              }),
        onSelect: () => undefined,
      }).render(container);
      const arrow = container.querySelector<HTMLElement>(
        `[data-toggle="${sales}"]`
      );
      if (!arrow) throw new Error('no arrow');
      arrow.focus();
      arrow.click();
      const elsewhere = document.createElement('button');
      document.body.append(elsewhere);
      elsewhere.focus();
      release?.();
      await tick();
      await tick();
      expect(
        container
          .querySelector(`[data-toggle="${sales}"]`)
          ?.getAttribute('aria-expanded')
      ).to.equal('true');
      expect(document.activeElement).to.equal(elsewhere);
    });

    it('should follow the reader to another node of the tree moved to while the children loaded', async () => {
      // That node is drawn anew with the list too, and the arrow pressed
      // would have taken the focus from it.
      const container = document.createElement('div');
      document.body.append(container);
      let release: (() => void) | undefined;
      await new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: dn =>
          dn === top
            ? Promise.resolve([{ dn: sales, name: 'Sales' }])
            : new Promise(resolve => {
                release = (): void =>
                  resolve([{ dn: `ou=France,${sales}`, name: 'France' }]);
              }),
        onSelect: () => undefined,
      }).render(container);
      container.querySelector<HTMLElement>(`[data-toggle="${sales}"]`)?.click();
      const label = container.querySelector<HTMLElement>(
        `.dc-tree-label[data-select="${sales}"]`
      );
      if (!label) throw new Error('no label');
      label.focus();
      release?.();
      await tick();
      await tick();
      const drawn = container.querySelector(
        `.dc-tree-label[data-select="${sales}"]`
      );
      expect(drawn).to.not.equal(label);
      expect(document.activeElement).to.equal(drawn);
    });
  });

  describe('OrganizationTree, revealing a node', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const engineering = `ou=Engineering,${top}`;
    const backend = `ou=Backend,${engineering}`;
    const options = (asked: string[]) => ({
      translator: new Translator('en'),
      root: async () => ({ dn: top, name: 'organization' }),
      children: async (dn: string) => {
        asked.push(dn);
        if (dn === top) return [{ dn: engineering, name: 'Engineering' }];
        if (dn === engineering) return [{ dn: backend, name: 'Backend' }];
        return [];
      },
      onSelect: () => undefined,
    });

    it('should find a node however its DN is spelled', async () => {
      const asked: string[] = [];
      const container = treeOnPage();
      const tree = new OrganizationTree(options(asked));
      await tree.render(container);
      expect(
        await tree.reveal(
          'OU=backend, ou=Engineering,ou=organization,dc=example,dc=com'
        )
      ).to.be.true;
      expect(container.innerHTML).to.match(
        /dc-selected[^]*?data-select="ou=Backend,ou=Engineering,/
      );
    });

    it('should select nothing for a node it does not hold', async () => {
      const tree = new OrganizationTree(options([]));
      await tree.render(treeOnPage());
      expect(await tree.reveal('ou=Elsewhere,dc=example,dc=org')).to.be.false;
      expect(await tree.reveal(`ou=Gone,${engineering}`)).to.be.false;
    });

    it('should read a branch again when it no longer leads to the node', async () => {
      // Created since the branch was read, by another administrator.
      const asked: string[] = [];
      let late = false;
      const tree = new OrganizationTree({
        ...options(asked),
        children: async (dn: string) => {
          asked.push(dn);
          if (dn === top)
            return late
              ? [
                  { dn: engineering, name: 'Engineering' },
                  { dn: `ou=Legal,${top}`, name: 'Legal' },
                ]
              : [{ dn: engineering, name: 'Engineering' }];
          return [];
        },
      });
      const container = treeOnPage();
      await tree.render(container);
      late = true;
      expect(await tree.reveal(`ou=Legal,${top}`)).to.be.true;
      expect(asked).to.deep.equal([top, top]);
      expect(container.innerHTML).to.include('>Legal</button>');
    });

    it('should carry the open branches over to the tree drawn in its place', async () => {
      const asked: string[] = [];
      const first = new OrganizationTree(options(asked));
      await first.render(treeOnPage());
      await first.reveal(backend);
      const container = treeOnPage();
      await new OrganizationTree(options(asked), first).render(container);
      // Nothing read again, and Backend still drawn under an open Engineering.
      expect(asked).to.deep.equal([top, engineering]);
      expect(container.innerHTML).to.include('>Backend</button>');
    });
  });
});
