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
import { comparableDn } from '../format';
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
}

export class OrganizationTree {
  private readonly options: TreeOptions;
  private container: HTMLElement | null = null;
  private tree: OrganizationNode | null = null;
  private expanded = new Set<string>();
  private selectedDn: string | null = null;
  private filter = '';
  private error: string | null = null;

  constructor(options: TreeOptions) {
    this.options = options;
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

  /** Forget what was loaded, so the next render fetches the tree again. */
  invalidate(): void {
    this.tree = null;
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
    list.innerHTML = this.error
      ? `<p class="dc-empty dc-error-block">${escapeHtml(this.error)}</p>`
      : this.tree
        ? `<ul class="dc-tree-list">${this.nodeMarkup(this.tree, 0)}</ul>`
        : `<p class="dc-empty">${escapeHtml(translator.t('app.loading'))}</p>`;
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
            this.options.onCreateChild
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

  /** Find a node by DN in the loaded tree. */
  private find(
    dn: string,
    node: OrganizationNode | null = this.tree
  ): OrganizationNode | null {
    if (!node) return null;
    if (node.dn === dn) return node;
    for (const child of node.children || []) {
      const found = this.find(dn, child);
      if (found) return found;
    }
    return null;
  }
}
