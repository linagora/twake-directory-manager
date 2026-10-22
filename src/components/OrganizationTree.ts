/**
 * Persistent tree of organizations.
 *
 * The tree stays on screen while a node is being read or edited: navigating
 * into an organization must not cost the reader the map of where they are.
 * Children are fetched the first time a node is opened, so a wide tree costs
 * one request per branch actually visited.
 *
 * @module browser/directory-console/components/OrganizationTree
 */

import { escapeHtml } from '../shared/dom';
import { comparableDn, withinDn } from '../format';
import type { Translator } from '../i18n';
import type { OrganizationNode } from '../types';

export interface TreeOptions {
  translator: Translator;
  /** Root of the tree */
  root(): Promise<OrganizationNode | null>;
  /** Direct children of a node */
  children(dn: string): Promise<OrganizationNode[]>;
  /** The transit branch, marked where it stands in the tree */
  transit?: string;
  onSelect(node: OrganizationNode): void;
  onCreateChild?(parent: OrganizationNode): void;
  /**
   * Whether a node takes a new child, its "+" drawn only then; every node
   * does when omitted. The server judges a creation on its parent, and a
   * "+" it would refuse is one the reader should not be offered
   */
  canCreateChild?(node: OrganizationNode): boolean;
}

export class OrganizationTree {
  private readonly options: TreeOptions;
  private container: HTMLElement | null = null;
  private tree: OrganizationNode | null = null;
  private expanded = new Set<string>();
  private selectedDn: string | null = null;
  private filter = '';
  private error: string | null = null;

  /**
   * @param options what the tree reads, and whom it tells
   * @param previous the tree this one is drawn in place of. Its nodes, the
   *   branches left open and the filter carry over, so a view drawn again —
   *   after a save, Back, a change of language — finds the tree the way the
   *   reader left it rather than folded back to its first level
   */
  constructor(options: TreeOptions, previous?: OrganizationTree | null) {
    this.options = options;
    if (previous) {
      this.tree = previous.tree;
      this.expanded = previous.expanded;
      this.filter = previous.filter;
    }
  }

  /**
   * Render into a container and load the root.
   *
   * @param container element to fill
   */
  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    if (!this.tree) {
      try {
        this.tree = await this.options.root();
        if (this.tree) {
          this.tree.children = await this.options.children(this.tree.dn);
          this.tree.loaded = true;
          this.expanded.add(this.tree.dn);
        }
      } catch (err) {
        this.error = (err as Error).message;
      }
    }
    this.draw();
  }

  /** Mark a node as the current one and repaint. */
  select(dn: string | null): void {
    this.selectedDn = dn;
    this.draw();
  }

  /**
   * Open the way down to a node, select it and bring it into view.
   *
   * A node named from elsewhere — a department link, an address — may sit
   * under branches never opened, whose children were never read: each is
   * read and opened on the way down from the root. A branch whose known
   * children lead nowhere is read again once, as the node may have been
   * created since.
   *
   * @param dn node to show, in any spelling of its DN
   * @returns whether the tree holds it
   */
  async reveal(dn: string): Promise<boolean> {
    const root = this.tree;
    if (!root || !withinDn(dn, root.dn)) {
      this.select(null);
      return false;
    }
    const toward = (parent: OrganizationNode): OrganizationNode | undefined =>
      parent.children?.find(child => withinDn(dn, child.dn));
    let node = root;
    while (comparableDn(node.dn) !== comparableDn(dn)) {
      let next = node.loaded ? toward(node) : undefined;
      if (!next) {
        try {
          await this.load(node);
        } catch {
          // A branch that cannot be read is not opened: the node is not
          // drawn, and the card beside the tree still says what it is.
        }
        next = toward(node);
      }
      if (!next) {
        this.select(null);
        return false;
      }
      this.expanded.add(node.dn);
      node = next;
    }
    this.select(node.dn);
    // A deep or long tree can hold the node below the fold of its pane.
    this.container
      ?.querySelector<HTMLElement>('.dc-selected > .dc-tree-row')
      ?.scrollIntoView?.({ block: 'nearest' });
    return true;
  }

  /**
   * Read the children of a node again, after an organization was created or
   * deleted under it or renamed, and repaint. Only that branch is read: the
   * rest of the tree, and the branches open below it, stay as they were.
   *
   * @param dn node to read again, the root when omitted
   * @returns its children as now read; none when the tree does not hold it
   */
  async refresh(dn?: string): Promise<OrganizationNode[]> {
    const node = dn === undefined ? this.tree : this.find(dn);
    if (!node) return [];
    await this.load(node);
    this.draw();
    return node.children || [];
  }

  /**
   * The node a node hangs from.
   *
   * @param dn node to look up
   * @returns the DN of its parent, or null when the tree does not hold both
   */
  parentOf(
    dn: string,
    node: OrganizationNode | null = this.tree
  ): string | null {
    if (!node) return null;
    for (const child of node.children || []) {
      if (comparableDn(child.dn) === comparableDn(dn)) return node.dn;
      const found = this.parentOf(dn, child);
      if (found) return found;
    }
    return null;
  }

  /**
   * Read a node's children, keeping what is known of those still there: a
   * branch read again keeps the sub-branches that were open under it.
   */
  private async load(node: OrganizationNode): Promise<void> {
    const known = new Map(
      (node.children || []).map(child => [comparableDn(child.dn), child])
    );
    node.children = (await this.options.children(node.dn)).map(child => {
      const before = known.get(comparableDn(child.dn));
      return before?.loaded
        ? { ...child, children: before.children, loaded: true }
        : child;
    });
    node.loaded = true;
  }

  /**
   * Paint the tree, building the header only once.
   *
   * The filter input lives in the header, and a redraw that replaced it would
   * replace the element the operator is typing in: the new one holds the value
   * but not the caret, which lands at the start, so a word typed on would come
   * out backwards. Only the list below it is rewritten; the input keeps its
   * caret, its selection and any composition in progress.
   */
  private draw(): void {
    const container = this.container;
    if (!container) return;
    const { translator } = this.options;

    // A container rendered into again (or by another view in between) no
    // longer holds the header this tree built: build it afresh.
    if (!container.querySelector('[data-tree-list]')) {
      container.innerHTML = `
        <div class="dc-tree">
          <div class="dc-tree-header">
            <h2>${escapeHtml(translator.t('tree.title'))}</h2>
            <input type="search" class="dc-input" data-filter
              value="${escapeHtml(this.filter)}"
              placeholder="${escapeHtml(translator.t('tree.filter'))}" />
          </div>
          <div data-tree-list></div>
        </div>`;
      const filter = container.querySelector<HTMLInputElement>('[data-filter]');
      filter?.addEventListener('input', () => {
        this.filter = filter.value.trim();
        this.drawList();
      });
    }
    this.drawList();
  }

  /** Rewrite what sits below the filter: the list, or why there is none. */
  private drawList(): void {
    const list = this.container?.querySelector<HTMLElement>('[data-tree-list]');
    if (!list) return;
    const { translator } = this.options;
    // A filter matching none of the branches opened says so, rather than
    // leave a blank where the tree was: the others are not searched.
    const nodes = this.tree ? this.nodeMarkup(this.tree, 0) : '';
    list.innerHTML = this.error
      ? `<p class="dc-empty dc-error-block">${escapeHtml(this.error)}</p>`
      : !this.tree
        ? `<p class="dc-empty">${escapeHtml(translator.t('app.loading'))}</p>`
        : nodes
          ? `<ul class="dc-tree-list">${nodes}</ul>`
          : `<p class="dc-empty">${escapeHtml(
              translator.t('tree.noMatch', { filter: this.filter })
            )}</p>`;
    this.bind(list);
  }

  /** One node and, when it is open, its children. */
  private nodeMarkup(node: OrganizationNode, depth: number): string {
    const open = this.expanded.has(node.dn);
    const matches = this.matches(node);
    if (!matches) return '';
    const hasChildren = !node.loaded || (node.children?.length ?? 0) > 0;
    const transit =
      !!this.options.transit &&
      comparableDn(node.dn) === comparableDn(this.options.transit);
    return `
      <li class="dc-tree-node${node.dn === this.selectedDn ? ' dc-selected' : ''}"
          style="--depth:${depth}">
        <div class="dc-tree-row">
          <button type="button" class="dc-tree-toggle" data-toggle="${escapeHtml(node.dn)}"
            ${hasChildren ? '' : 'disabled'} aria-expanded="${open ? 'true' : 'false'}">
            ${hasChildren ? (open ? '▾' : '▸') : '·'}
          </button>
          <button type="button" class="dc-tree-label" data-select="${escapeHtml(node.dn)}"
            title="${escapeHtml(node.path || node.dn)}">${escapeHtml(node.name)}</button>
          ${
            transit
              ? `<span class="dc-tag dc-tag-transit">${escapeHtml(
                  this.options.translator.t('transit.branch')
                )}</span>`
              : ''
          }
          ${
            this.options.onCreateChild &&
            (this.options.canCreateChild?.(node) ?? true)
              ? `<button type="button" class="dc-tree-add" data-add="${escapeHtml(node.dn)}"
                   title="${escapeHtml(this.options.translator.t('tree.addChild'))}">+</button>`
              : ''
          }
        </div>
        ${
          open && node.children?.length
            ? `<ul class="dc-tree-list">${node.children
                .map(child => this.nodeMarkup(child, depth + 1))
                .join('')}</ul>`
            : ''
        }
      </li>`;
  }

  /**
   * A filter hides the nodes that do not match, but never a node whose subtree
   * still holds a match — otherwise filtering would prune the path to the very
   * entry it found.
   */
  private matches(node: OrganizationNode): boolean {
    if (!this.filter) return true;
    const needle = this.filter.toLowerCase();
    if (node.name.toLowerCase().includes(needle)) return true;
    return (node.children || []).some(child => this.matches(child));
  }

  /** Bind the buttons of a freshly written list; the filter binds itself. */
  private bind(container: HTMLElement): void {
    for (const button of Array.from(
      container.querySelectorAll<HTMLElement>('[data-toggle]')
    )) {
      button.addEventListener('click', () => {
        void this.toggle(button.dataset.toggle as string);
      });
    }

    for (const button of Array.from(
      container.querySelectorAll<HTMLElement>('[data-select]')
    )) {
      button.addEventListener('click', () => {
        const dn = button.dataset.select as string;
        const node = this.find(dn);
        if (!node) return;
        this.selectedDn = dn;
        this.draw();
        this.options.onSelect(node);
      });
    }

    for (const button of Array.from(
      container.querySelectorAll<HTMLElement>('[data-add]')
    )) {
      button.addEventListener('click', () => {
        const node = this.find(button.dataset.add as string);
        if (node) this.options.onCreateChild?.(node);
      });
    }
  }

  /** Open or close a node, loading its children the first time. */
  private async toggle(dn: string): Promise<void> {
    const node = this.find(dn);
    if (!node) return;
    if (this.expanded.has(dn)) {
      this.expanded.delete(dn);
      this.draw();
      return;
    }
    this.expanded.add(dn);
    if (!node.loaded) {
      try {
        node.children = await this.options.children(dn);
      } catch {
        node.children = [];
      }
      node.loaded = true;
    }
    this.draw();
  }

  /** Find a node by DN, in any spelling of it, in the loaded tree. */
  private find(
    dn: string,
    node: OrganizationNode | null = this.tree
  ): OrganizationNode | null {
    if (!node) return null;
    if (comparableDn(node.dn) === comparableDn(dn)) return node;
    for (const child of node.children || []) {
      const found = this.find(dn, child);
      if (found) return found;
    }
    return null;
  }
}
