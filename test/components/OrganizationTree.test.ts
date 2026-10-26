import { expect } from 'chai';
import { ConsoleApiClient } from '../../src/api/ConsoleApiClient';
import { OrganizationTree } from '../../src/components/OrganizationTree';
import { Translator } from '../../src/i18n';
import { baseUrl, treeContainer } from '../support/stubs';

describe('OrganizationTree', () => {
  describe('OrganizationTree filter', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const sales = `ou=Sales,${top}`;

    it('should keep the filter input across keystrokes', async () => {
      const container = treeContainer();
      await new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: async () => [
          { dn: sales, name: 'Sales' },
          { dn: 'ou=Lin,ou=organization,dc=example,dc=com', name: 'Lin' },
        ],
        onSelect: () => undefined,
      }).render(container);
      const input = container.filter;
      const builds = container.builds;
      expect(container.innerHTML).to.include('>Sales</button>');

      // The browser edits the value and its caret; a redraw that replaced the
      // input would drop both, and the next letter would land before them.
      for (const typed of ['l', 'li', 'lin']) {
        input.value = typed;
        input.fire();
        expect(container.filter).to.equal(input);
        expect(container.filter.value).to.equal(typed);
      }
      expect(container.builds).to.equal(builds);
      // The list was filtered all the same.
      expect(container.innerHTML)
        .to.include('>Lin</button>')
        .and.not.include('>Sales</button>');
    });

    it('should name its buttons after their organization, and expose the selected one', async () => {
      const container = treeContainer();
      const tree = new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: async () => [{ dn: sales, name: 'Sales' }],
        onSelect: () => undefined,
        onCreateChild: () => undefined,
      });
      await tree.render(container);
      tree.select(sales);
      const html = container.list.innerHTML.replace(/\s+/g, ' ');
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
      const container = treeContainer();
      await new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: async () => [{ dn: sales, name: 'Sales' }],
        onSelect: () => undefined,
      }).render(container);
      container.filter.value = 'zzz';
      container.filter.fire();
      expect(container.list.innerHTML)
        .to.include('No organization matches “zzz”')
        .and.not.include('dc-tree-list');
      // Cleared, the tree is back.
      container.filter.value = '';
      container.filter.fire();
      expect(container.list.innerHTML).to.include('>Sales</button>');
    });
  });

  describe('OrganizationTree, searching the whole tree', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const sales = `ou=Sales,${top}`;
    const france = `ou=France,${sales}`;
    const settle = (): Promise<void> =>
      new Promise(resolve => setImmediate(resolve));
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
    type Hidden = {
      choose(dn: string, label: string): Promise<void>;
      pick(dn: string): Promise<void>;
    };

    it('should find an organization under a branch never opened', async () => {
      const asked: string[] = [];
      const selected: string[] = [];
      const container = treeContainer();
      const tree = new OrganizationTree(options(asked, selected));
      await tree.render(container);
      container.filter.value = 'Fra';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML)
        .to.include(`data-found="${france}"`)
        .and.include('>Sales &#x2F; France</button>')
        .and.not.include('data-select');
      expect(asked).to.deep.equal([top]);

      // Chosen, it is shown in the tree, opened down to it, and selected.
      await (tree as unknown as Hidden).choose(france, 'Sales / France');
      expect(container.filter.value).to.equal('');
      expect(selected).to.deep.equal([france]);
      expect(container.list.innerHTML).to.match(
        /dc-selected[^]*?data-select="ou=France,ou=Sales,/
      );
    });

    it('should say when no organization of the whole tree matches', async () => {
      const container = treeContainer();
      await new OrganizationTree(options([])).render(container);
      container.filter.value = 'zzz';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML)
        .to.include('No organization matches “zzz”')
        .and.not.include('among the opened branches');
    });

    it('should read the whole tree once, and again once a branch changed', async () => {
      let reads = 0;
      const container = treeContainer();
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
        container.filter.value = typed;
        container.filter.fire();
        await settle();
      }
      expect(reads).to.equal(1);
      await tree.refresh();
      await settle();
      expect(reads).to.equal(2);
    });

    it('should filter the opened branches when the whole tree cannot be read', async () => {
      const container = treeContainer();
      await new OrganizationTree({
        ...options([]),
        everywhere: async () => {
          throw new Error('refused');
        },
      }).render(container);
      container.filter.value = 'Sal';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML).to.include('>Sales</button>');
    });

    it('should open a node when it is selected', async () => {
      const asked: string[] = [];
      const selected: string[] = [];
      const container = treeContainer();
      const tree = new OrganizationTree(options(asked, selected));
      await tree.render(container);
      await (tree as unknown as Hidden).pick(sales);
      expect(selected).to.deep.equal([sales]);
      expect(asked).to.deep.equal([top, sales]);
      expect(container.list.innerHTML)
        .to.include('aria-label="Collapse Sales"')
        .and.include('>France</button>');
      // Selected again, it stays open.
      await (tree as unknown as Hidden).pick(sales);
      expect(container.list.innerHTML).to.include('>France</button>');
    });

    it('should not say a selected leaf is expanded', async () => {
      const container = treeContainer();
      const tree = new OrganizationTree(options([]));
      await tree.render(container);
      await (tree as unknown as Hidden).pick(sales);
      await (tree as unknown as Hidden).pick(france);
      const html = container.list.innerHTML.replace(/\s+/g, ' ');
      expect(html).to.match(
        /data-toggle="ou=France,[^"]*" disabled aria-label="France has no sub-organization"/
      );
      expect(html).to.include(
        'aria-expanded="true" aria-label="Collapse Sales"'
      );
    });

    it('should leave a branch whose children could not be read to be opened again', async () => {
      let refuse = true;
      const asked: string[] = [];
      const container = treeContainer();
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
      await (tree as unknown as Hidden).pick(sales);
      // Not taken for a leaf: closed, and still offered to open.
      expect(container.list.innerHTML.replace(/\s+/g, ' ')).to.include(
        'aria-expanded="false" aria-label="Expand Sales"'
      );
      refuse = false;
      await (tree as unknown as Hidden).pick(sales);
      expect(asked).to.deep.equal([top, sales, sales]);
      expect(container.list.innerHTML).to.include('>France</button>');
    });

    it('should merge the opened branches into a walk cut short, and hedge its "no match"', async () => {
      const container = treeContainer();
      const tree = new OrganizationTree({
        ...options([]),
        // The walk stopped before France, which an opened branch holds.
        everywhere: async () => ({
          organizations: [{ dn: top, label: 'organization' }],
          partial: true,
        }),
      });
      await tree.render(container);
      await (tree as unknown as Hidden).pick(sales);
      container.filter.value = 'Fra';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML).to.include(`data-found="${france}"`);
      container.filter.value = 'zzz';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML).to.include(
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
      const container = treeContainer();
      const tree = new OrganizationTree({
        ...options([]),
        everywhere: () => client.organizationWalk(),
      });
      await tree.render(container);
      await (tree as unknown as Hidden).pick(sales);
      container.filter.value = 'Fra';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML).to.include(`data-found="${france}"`);
      container.filter.value = 'zzz';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML).to.include(
        'No organization matches “zzz” among the opened branches'
      );
    });

    it('should read the whole tree again in the next view after a failure, hedging meanwhile', async () => {
      let reads = 0;
      const container = treeContainer();
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
      container.filter.value = 'zzz';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML).to.include(
        'No organization matches “zzz” among the opened branches'
      );
      const again = treeContainer();
      const second = new OrganizationTree(
        { ...options([]), everywhere },
        first
      );
      await second.render(again);
      await settle();
      again.filter.value = 'Fra';
      again.filter.fire();
      await settle();
      expect(reads).to.equal(2);
      expect(again.list.innerHTML).to.include(`data-found="${france}"`);
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
      const container = treeContainer();
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
      for (const typed of ['Sa', 'Sal']) {
        container.filter.value = typed;
        container.filter.fire();
      }
      await pause();
      expect(searched).to.deep.equal([['Sal', top]]);
      expect(container.list.innerHTML).to.include('Loading');
      // Typed on while it is under way: its answer, late, is dropped.
      container.filter.value = 'Fra';
      container.filter.fire();
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
      expect(container.list.innerHTML)
        .to.include(`data-found="${france}"`)
        .and.not.include(`data-found="${sales}"`)
        // A whole answer is not said to be cut.
        .and.not.include('dc-tree-cut');
      expect(walks).to.equal(0);

      // Its "no match" is the whole tree's; a failure leaves the opened
      // branches, hedged.
      container.filter.value = 'zzz';
      container.filter.fire();
      await pause();
      answers.get('zzz')?.({ organizations: [], truncated: false });
      await settle();
      expect(container.list.innerHTML)
        .to.include('No organization matches “zzz”')
        .and.not.include('among the opened branches');
      container.filter.value = 'yyy';
      container.filter.fire();
      await pause();
      expect(searched.map(([query]) => query)).to.deep.equal([
        'Sal',
        'Fra',
        'zzz',
        'yyy',
      ]);
    });

    it('should say when the server kept only the first matches', async () => {
      const container = treeContainer();
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
      container.filter.value = 'Sa';
      container.filter.fire();
      await new Promise(resolve => setTimeout(resolve, 300));
      await settle();
      expect(container.list.innerHTML)
        .to.include(`data-found="${france}"`)
        .and.include(`data-found="${sales}"`)
        .and.include(
          '<p class="dc-tree-cut">First 2 matches — type more to narrow</p>'
        )
        .and.not.include('No organization matches');
    });

    it('should show the opened branches, hedged, when the server search fails', async () => {
      const container = treeContainer();
      await new OrganizationTree({
        ...options([]),
        search: async () => {
          throw new Error('Service Unavailable');
        },
      }).render(container);
      container.filter.value = 'Sal';
      container.filter.fire();
      await new Promise(resolve => setTimeout(resolve, 300));
      await settle();
      expect(container.list.innerHTML).to.include('>Sales</button>');
      container.filter.value = 'zzz';
      container.filter.fire();
      await new Promise(resolve => setTimeout(resolve, 300));
      await settle();
      expect(container.list.innerHTML).to.include(
        'No organization matches “zzz” among the opened branches'
      );
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
      const container = treeContainer();
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
      await tree.render(treeContainer());
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
      const container = treeContainer();
      await tree.render(container);
      late = true;
      expect(await tree.reveal(`ou=Legal,${top}`)).to.be.true;
      expect(asked).to.deep.equal([top, top]);
      expect(container.innerHTML).to.include('>Legal</button>');
    });

    it('should carry the open branches over to the tree drawn in its place', async () => {
      const asked: string[] = [];
      const first = new OrganizationTree(options(asked));
      await first.render(treeContainer());
      await first.reveal(backend);
      const container = treeContainer();
      await new OrganizationTree(options(asked), first).render(container);
      // Nothing read again, and Backend still drawn under an open Engineering.
      expect(asked).to.deep.equal([top, engineering]);
      expect(container.innerHTML).to.include('>Backend</button>');
    });
  });
});
