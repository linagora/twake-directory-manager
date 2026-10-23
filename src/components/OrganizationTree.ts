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
  /**
   * Every organization the filter may find, labelled by its path. The tree
   * reads only the branches opened, and a filter limited to them found
   * nothing of a department under a closed one: this is what a filter of
   * {@link FILTER_EVERYWHERE} characters or more searches instead. Asked
   * the first time a filter needs it, then kept until the tree is read again
   */
  everywhere?(): Promise<{ dn: string; label: string }[]>;
}

/**
 * Length from which the filter searches the whole tree rather than the
 * branches opened: one letter is in most names, and lists most of the tree.
 */
export const FILTER_EVERYWHERE = 2;

export class OrganizationTree {
  private readonly options: TreeOptions;
  private container: HTMLElement | null = null;
  private tree: OrganizationNode | null = null;
  private expanded = new Set<string>();
  private selectedDn: string | null = null;
  private filter = '';
  private error: string | null = null;
  /**
   * What {@link TreeOptions.everywhere} answered: undefined until asked, null
   * when it failed, the filter then searching the opened branches as before
   */
  private index: { dn: string; label: string }[] | null | undefined;
  private indexing: Promise<void> | null = null;

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
      this.index = previous.index;
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
    // An organization created, renamed or deleted is one the filter finds,
    // under its new name, or no longer: it is searched afresh next time.
    this.index = undefined;
    this.indexing = null;
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
    const loading = `<p class="dc-empty">${escapeHtml(
      translator.t('app.loading')
    )}</p>`;
    const none = `<p class="dc-empty">${escapeHtml(
      translator.t('tree.noMatch', { filter: this.filter })
    )}</p>`;
    if (this.error)
      list.innerHTML = `<p class="dc-empty dc-error-block">${escapeHtml(
        this.error
      )}</p>`;
    else if (!this.tree) list.innerHTML = loading;
    else if (this.searchesEverywhere()) {
      // The whole tree, read once: until it is, saying "no match" would be
      // saying it of the branches opened only.
      if (this.index === undefined) {
        void this.loadIndex();
        list.innerHTML = loading;
      } else {
        const found = this.found();
        list.innerHTML = found.length
          ? `<ul class="dc-tree-list dc-tree-found">${found
              .map(
                option => `
            <li class="dc-tree-result" style="--depth:0">
              <div class="dc-tree-row">
                <button type="button" class="dc-tree-label" data-found="${escapeHtml(
                  option.dn
                )}" title="${escapeHtml(option.label)}">${escapeHtml(
                  option.label
                )}</button>
              </div>
            </li>`
              )
              .join('')}</ul>`
          : none;
      }
    } else {
      // A short filter, or a tree that could not be searched whole, matches
      // the branches opened; matching none of them, it says so rather than
      // leave a blank where the tree was.
      const nodes = this.nodeMarkup(this.tree, 0);
      list.innerHTML = nodes ? `<ul class="dc-tree-list">${nodes}</ul>` : none;
    }
    this.bind(list);
  }

  /** Whether the filter searches the whole tree rather than the opened branches. */
  private searchesEverywhere(): boolean {
    return (
      !!this.options.everywhere &&
      this.filter.length >= FILTER_EVERYWHERE &&
      this.index !== null
    );
  }

  /**
   * Read every organization the filter may find, once, and draw the list
   * again. A failure leaves the filter to the opened branches.
   */
  private loadIndex(): Promise<void> {
    if (this.indexing) return this.indexing;
    const indexing = this.readIndex().then(index => {
      // Read again meanwhile: what this read found may be out of date.
      if (this.indexing !== indexing) return;
      this.indexing = null;
      this.index = index;
      this.drawList();
    });
    this.indexing = indexing;
    return indexing;
  }

  private async readIndex(): Promise<{ dn: string; label: string }[] | null> {
    try {
      return (await this.options.everywhere?.()) ?? null;
    } catch {
      return null;
    }
  }

  /** The organizations whose path holds the filter, in reading order. */
  private found(): { dn: string; label: string }[] {
    const needle = this.filter.toLowerCase();
    return (this.index || [])
      .filter(option => option.label.toLowerCase().includes(needle))
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, {
          sensitivity: 'base',
          numeric: true,
        })
      );
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
    const { translator } = this.options;
    const selected = node.dn === this.selectedDn;
    // Named after what they do and on which organization: their glyphs, and
    // a row of identical "+", told a screen reader nothing.
    const toggleName = translator.t(
      hasChildren ? (open ? 'tree.collapse' : 'tree.expand') : 'tree.leaf',
      { name: node.name }
    );
    return `
      <li class="dc-tree-node${selected ? ' dc-selected' : ''}"
          style="--depth:${depth}">
        <div class="dc-tree-row">
          <button type="button" class="dc-tree-toggle" data-toggle="${escapeHtml(node.dn)}"
            ${hasChildren ? '' : 'disabled'} aria-expanded="${open ? 'true' : 'false'}"
            aria-label="${escapeHtml(toggleName)}">
            ${hasChildren ? (open ? '▾' : '▸') : '·'}
          </button>
          <button type="button" class="dc-tree-label" data-select="${escapeHtml(node.dn)}"
            ${selected ? 'aria-current="true" ' : ''}title="${escapeHtml(
              node.path || node.dn
            )}">${escapeHtml(node.name)}</button>
          ${
            transit
              ? `<span class="dc-tag dc-tag-transit">${escapeHtml(
                  translator.t('transit.branch')
                )}</span>`
              : ''
          }
          ${
            this.options.onCreateChild &&
            (this.options.canCreateChild?.(node) ?? true)
              ? `<button type="button" class="dc-tree-add" data-add="${escapeHtml(node.dn)}"
                   title="${escapeHtml(translator.t('tree.addChild'))}"
                   aria-label="${escapeHtml(
                     translator.t('tree.addUnder', { name: node.name })
                   )}">+</button>`
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
        void this.pick(button.dataset.select as string);
      });
    }

    for (const button of Array.from(
      container.querySelectorAll<HTMLElement>('[data-found]')
    )) {
      button.addEventListener('click', () => {
        void this.choose(
          button.dataset.found as string,
          button.textContent?.trim() || ''
        );
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

  /**
   * Select a node the reader clicked, and open it: its card is on screen,
   * and what hangs under it is what the reader looks for next. Only the
   * toggle closes it again.
   */
  private async pick(dn: string): Promise<void> {
    const node = this.find(dn);
    if (!node) return;
    this.selectedDn = dn;
    this.draw();
    this.options.onSelect(node);
    if (!this.expanded.has(node.dn)) await this.toggle(node.dn);
    this.focusSelected();
  }

  /**
   * Show an organization the filter found: the filter is cleared, so the
   * tree is back, opened down to it, and it is selected and shown.
   *
   * @param dn organization chosen
   * @param label its path, naming it should the tree not hold it
   */
  private async choose(dn: string, label: string): Promise<void> {
    this.filter = '';
    const input =
      this.container?.querySelector<HTMLInputElement>('[data-filter]');
    if (input) input.value = '';
    await this.reveal(dn);
    const node = this.find(dn);
    this.options.onSelect(node ?? { dn, name: label });
    if (node && !this.expanded.has(node.dn)) await this.toggle(node.dn);
    this.focusSelected();
  }

  /**
   * Give the focus back to the selected node. The button pressed was
   * replaced when the list was drawn again, and the focus went with it to
   * the top of the page, where a keyboard had to find the tree again. Left
   * alone when the reader has moved it elsewhere meanwhile.
   */
  private focusSelected(): void {
    if (typeof document === 'undefined') return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    this.container
      ?.querySelector<HTMLElement>('.dc-selected > .dc-tree-row .dc-tree-label')
      ?.focus();
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
