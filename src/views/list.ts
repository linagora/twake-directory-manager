/**
 * The list of an entity: its search and its pages, what may be done to a
 * selection, New… and the CSV import it starts (#220, step 6).
 *
 * @module twake-directory-manager/views/list
 */

import { type ConsoleApiClient, isLarge } from '../api/ConsoleApiClient';
import { attachedEntity } from '../components/AttachedTables';
import { EntityImport } from '../components/EntityImport';
import {
  EntityList,
  LIST_LIMIT,
  SEARCH_MINIMUM,
  type ListView,
} from '../components/EntityList';
import type { ConsoleContext } from '../console/context';
import { createdEntryId } from '../format';
import type { PointerLookup } from '../importer';
import { splitEntities } from '../rights';
import { background } from '../shared/background';
import { html, render } from '../shared/html';
import type { EntityDescriptor, Entry, EntryList } from '../types';

/**
 * How the list of an entity fetches its entries: a search once the operator
 * typed enough of one, the whole branch otherwise.
 *
 * Asks for `LIST_LIMIT` entries at most either way (a server predating
 * `limit` ignores it): the whole branch is what "List without searching"
 * asks for, and a search as loose as three letters can match more
 * of a large directory than it lets one search return. The list says so when
 * the server left entries out.
 *
 * @param api client to ask
 * @param entity entity listed
 * @returns the loader `EntityList` calls
 */
export function listLoader(
  api: ConsoleApiClient,
  entity: EntityDescriptor
): (search: string, attribute: string, cut?: boolean) => Promise<EntryList> {
  // A department's path is searched whatever its length: "IT" listed the
  // whole directory, bounded, and cut it in the browser.
  return (search, attribute, cut) =>
    search.length >= SEARCH_MINIMUM || (cut && search)
      ? api.listBounded(entity, search, attribute, LIST_LIMIT)
      : api.listBounded(entity, undefined, undefined, LIST_LIMIT);
}

/**
 * The pages of `#/<entity>`, one for each entity listed. Kept by the console
 * from one drawing to the next, for where the reader left each list: a list
 * is drawn anew each time its page is shown, and without it Back from a card
 * found it empty, the search typed and the page reached gone.
 */
export class ListsView {
  /** Where the reader left the list of each entity, by key */
  private readonly left: Map<string, ListView>;

  /**
   * @param ctx the console, as a view sees it
   * @param left where the lists of a view this one takes the place of were
   *   left
   */
  constructor(
    private readonly ctx: ConsoleContext,
    left: Map<string, ListView> = new Map()
  ) {
    this.left = left;
  }

  /** Where the reader left each list, for a view taking this one's place. */
  lists(): Map<string, ListView> {
    return this.left;
  }

  /**
   * Open an entity's list on a search of its own, kept as where the reader
   * left that list: the hash's change draws it.
   *
   * @param entity the entity listed
   * @param view the search, the cut and the page to open the list on
   */
  open(entity: EntityDescriptor, view: ListView): void {
    this.left.set(entity.key, view);
    this.ctx.go(entity.key);
  }

  /**
   * The table of an entity.
   *
   * @param main the console's main area
   * @param entity the entity listed
   */
  async render(main: HTMLElement, entity: EntityDescriptor): Promise<void> {
    const { ctx } = this;
    const t = ctx.t;
    const readOnly = ctx.rights().readsReferenceOnly(entity);
    ctx.titlePage(ctx.plural(entity));
    render(
      main,
      html`
      <section class="dc-view">
        <header class="dc-view-header">
          <h1>${ctx.plural(entity)}</h1>
          ${
            ctx.rights().canCreate(entity)
              ? html`<div class="dc-view-actions">
                  ${
                    entity.kind === 'flat'
                      ? html`<button type="button" class="dc-button" data-import>${t(
                          'import.open'
                        )}</button>`
                      : ''
                  }
                  <button type="button" class="dc-button dc-button-primary" data-new>${ctx.createLabel(
                    entity
                  )}</button>
                </div>`
              : ''
          }
        </header>
        ${
          // Said on reference data only: a directory with no tree puts
          // every collection forward, and its accounts are no reference
          // data.
          readOnly &&
          splitEntities(ctx.entities()).reference.includes(entity) &&
          !ctx.rights().administersNothing()
            ? html`<p class="dc-muted dc-view-notice" data-read-only>${t(
                'reference.readOnly'
              )}</p>`
            : ''
        }
        <div data-list></div>
      </section>`
    );

    main
      .querySelector('[data-new]')
      ?.addEventListener('click', () =>
        background(() => ctx.openForm(entity), 'openForm', ctx.report)
      );
    main
      .querySelector('[data-import]')
      ?.addEventListener('click', () => this.openImport(entity));

    const holder = main.querySelector<HTMLElement>(
      '[data-list]'
    ) as HTMLElement;
    if (ctx.rights().administersNothing()) {
      render(holder, html`<p class="dc-empty">${t('scope.nothing')}</p>`);
      return;
    }
    const named = await ctx.pointerNames(entity);
    const view = this.left.get(entity.key) ?? {};
    this.left.set(entity.key, view);
    const list = new EntityList({
      report: ctx.report,
      announce: ctx.announce,
      entity,
      title: ctx.plural(entity),
      view,
      translator: ctx.translator(),
      listable: !isLarge(entity),
      load: listLoader(ctx.api, entity),
      bulkActions: this.bulkActions(entity),
      pathSeparator: ctx.api.organizationPathSeparator,
      canDelete: ctx.rights().canDelete() && !readOnly,
      pointerLabel: named,
      read: (id: string): Promise<Entry> => ctx.api.get(entity, id),
      onOpen: (id: string): void =>
        ctx.go(`${entity.key}/${encodeURIComponent(id)}`),
      onDelete: (ids: string[]): Promise<boolean> =>
        ctx.deleteSelection(entity, ids),
    });
    await list.render(holder);
  }

  /**
   * What a list of accounts may give its selection at once: Add to a
   * group… and Change state…, one action where it took a visit to each
   * card — forty after an import of forty.
   *
   * @param entity the entity listed
   * @returns the actions, none for another entity or a caller who writes
   *   nothing
   */
  private bulkActions(entity: EntityDescriptor): {
    label: string;
    run(selected: [string, Entry][]): Promise<boolean>;
  }[] {
    const { ctx } = this;
    if (
      !ctx.rights().canWrite() ||
      attachedEntity(ctx.entities(), 'people')?.key !== entity.key
    )
      return [];
    const t = ctx.t;
    const actions: {
      label: string;
      run(selected: [string, Entry][]): Promise<boolean>;
    }[] = [];
    if (ctx.api.groupSearch(ctx.entities()))
      actions.push({
        label: t('bulk.addToGroups'),
        run: selected => ctx.addSelectionToGroups(entity, selected),
      });
    const status = entity.accountStatus;
    if (status && entity.schema.attributes[status]?.states)
      actions.push({
        label: t('bulk.changeState'),
        run: selected => ctx.changeSelectionState(entity, selected),
      });
    return actions;
  }

  /**
   * Create entries of a flat entity from a CSV file. Each row goes through
   * the create endpoint the form uses, so the server holds an imported entry
   * to the same rules as one typed in.
   *
   * @param entity the entity the entries are created in
   */
  private openImport(entity: EntityDescriptor): void {
    const { ctx } = this;
    const t = ctx.t;
    ctx.panel.open(
      t('import.title', {
        entities: ctx.plural(entity),
        lowerEntities: ctx
          .plural(entity)
          .toLocaleLowerCase(ctx.translator().language),
      }),
      body => {
        new EntityImport({
          report: ctx.report,
          entity,
          translator: ctx.translator(),
          pointerOptions: (
            branch: string
          ): Promise<{ dn: string; label: string }[]> =>
            ctx.api.pointerOptions(
              branch,
              ctx.entities(),
              ctx.translator().language
            ),
          pointerLookup: (branch: string): PointerLookup | undefined =>
            ctx.api.pointerLookup(
              branch,
              ctx.entities(),
              ctx.translator().language
            ),
          create: async (
            values: Record<string, string | string[]>
          ): Promise<string> =>
            createdEntryId(
              entity,
              await ctx.api.create(entity, values),
              values
            ),
          onDone: (created: string[]): void => {
            // The list shows what was just created, rather than its search:
            // checking each new entry took a search of its own. An import
            // that created nothing puts the search back, rather than leave
            // the last one's entries looking like its own.
            const view = this.left.get(entity.key) ?? {};
            this.left.set(entity.key, view);
            const shown = !!view.imported;
            if (created.length) view.imported = { ids: created };
            else delete view.imported;
            if ((created.length || shown) && ctx.route().entity === entity.key)
              background(() => ctx.refresh(), 'renderMain', ctx.report);
          },
          onClose: (): void => ctx.panel.close(),
        }).render(body);
      },
      false,
      true
    );
  }
}
