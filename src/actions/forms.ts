/**
 * The forms: an entry of a flat or group entity created or edited, and an
 * organization created or edited through its own endpoints, a refusal said
 * under the field at fault (#220).
 *
 * @module twake-directory-manager/actions/forms
 */

import { isDomainBranch } from '../api/ConsoleApiClient';
import { EntityForm } from '../components/EntityForm';
import type { ConsoleContext } from '../console/context';
import {
  comparableDn,
  createdEntryId,
  entryValue,
  explainRefusal,
  parentDn as parentOf,
  pointerLabel,
  rdnValue,
} from '../format';
import { background } from '../shared/background';
import { html, render } from '../shared/html';
import type { EntityDescriptor, Entry } from '../types';

/**
 * The create and edit forms, in the side panel. A class given the context,
 * as the other actions are: it holds nothing between two forms — what one
 * waits for is the panel's (`ctx.panel`) and the form's own — and the
 * console makes one.
 */
export class FormActions {
  /** @param ctx the console, as an action sees it */
  constructor(private readonly ctx: ConsoleContext) {}

  /**
   * Create or edit an entry of a flat or group entity.
   *
   * @param entity the entity
   * @param entry the entry to edit; none to create one
   * @param here where a creation was asked for: what the new entry starts
   *   with, and what to do once it exists instead of opening its card
   */
  open(
    entity: EntityDescriptor,
    entry?: Entry,
    here?: { preset: Entry; created(): void }
  ): void {
    const { ctx } = this;
    // Organizations are written through their own endpoints, whatever offered
    // the form. The dashboard's "New organization" button came through here,
    // and this path reads the new entry's id from the create response, which
    // the organizations endpoint does not return: the organization was
    // created and the console then navigated to no entry at all.
    if (entity.kind === 'organization')
      return this.openOrganization(entity, entry);
    const t = ctx.t;
    // Read once for the form, however many addresses it completes.
    const domains = ctx.api.mailDomains(ctx.entities());
    const form = new EntityForm({
      report: ctx.report,
      entity,
      entry,
      preset: here?.preset,
      translator: ctx.translator(),
      typeAhead: (branch: string): boolean =>
        isDomainBranch(ctx.entities(), branch),
      mailDomains: domains
        ? (organization?: string): Promise<string[]> =>
            domains.names(organization)
        : undefined,
      pointerOptions: (
        branch: string
      ): Promise<{ dn: string; label: string }[]> =>
        ctx.api.pointerOptions(
          branch,
          ctx.entities(),
          ctx.translator().language
        ),
      pointerSearch: (
        branch: string,
        failed?: boolean
      ):
        | ((
            query: string
          ) => Promise<{ dn: string; label: string; token?: string }[]>)
        | undefined => ctx.api.pointerSearch(branch, ctx.entities(), failed),
      memberSearch: (
        role: 'members' | 'owners'
      ):
        | ((query: string) => Promise<{ dn: string; label: string }[]>)
        | undefined => ctx.api.memberSearch(role, ctx.entities()),
      externalMembers: ctx.api.externalMembers,
      teamMailboxesKeepDomain: ctx.api.teamMailboxesKeepDomain,
      fullNameFormat: ctx.api.fullNameFormat,
      onCancel: (): void => ctx.panel.close(),
      onSubmit: async (
        values: Record<string, string | string[]>,
        cleared: string[]
      ): Promise<void> => {
        const id = entry
          ? String(entryValue(entry, entity.mainAttribute) ?? '')
          : createdEntryId(entity, undefined, values);
        try {
          if (entry) {
            // The entry as stored: what a membership change is diffed against.
            await ctx.api.update(entity, id, values, cleared, entry);
            ctx.toast(t('save.done'));
            ctx.panel.close(true);
            await ctx.refresh();
          } else {
            const created = await ctx.api.create(entity, values);
            const createdId = createdEntryId(entity, created, values);
            ctx.toast(this.createdToast(entity, values, createdId));
            // Created from an organization's card, the entry joins its table
            // there: the next one is often created right after it.
            const next = (): void => {
              if (here) here.created();
              else
                ctx.go(
                  createdId
                    ? `${entity.key}/${encodeURIComponent(createdId)}`
                    : entity.key
                );
            };
            if (
              await ctx.givePassword(entity, values, createdId, next, () =>
                form.isShown()
              )
            )
              return;
            // Gone elsewhere while the server answered, the creation or a
            // failed reset: neither the panel now open nor the card are its
            // own to take.
            if (!form.isShown()) return;
            ctx.panel.close(true);
            next();
          }
        } catch (err) {
          // Refused the rights to the organization it goes to, that is the
          // one named; refused them to the entry itself, the entry.
          const organization = this.organizationRefused(
            entity,
            values,
            entry,
            form
          );
          this.refuseSave(
            err,
            entity,
            form,
            organization?.name ??
              (entry
                ? ctx.personName(entity, entry, id)
                : ctx.submittedName(entity, values, id)),
            organization?.attribute
          );
        }
      },
    });

    ctx.panel.open(
      entry
        ? `${t('app.edit')} — ${ctx.entryName(entity, String(entryValue(entry, entity.mainAttribute) ?? ''))}`
        : ctx.createLabel(entity),
      (body: HTMLElement): void => {
        background(() => form.render(body), 'form.render', ctx.report);
        ctx.panel.guardDiscard(body, () => form.isDirty());
      },
      !form.wantsPanel
    );
  }

  /**
   * Organizations live in the tree, so their form writes through the
   * organization endpoints rather than the flat ones.
   *
   * A new one given no parent goes where the caller may create it: at the
   * root when the scope allows it there, otherwise under their one written
   * branch, or under the one they pick when they write several.
   *
   * @param entity the organizations' entity
   * @param entry the organization to edit; none to create one
   * @param parentDn where a new one goes, when the page that offered it says
   */
  openOrganization(
    entity: EntityDescriptor,
    entry?: Entry,
    parentDn?: string
  ): void {
    const { ctx } = this;
    const t = ctx.t;
    const rights = ctx.rights();
    const parents = entry || parentDn ? [] : rights.creationParents(entity);
    if (parents.length === 1) parentDn = parents[0].dn;
    let picker: HTMLSelectElement | null = null;
    const parent = (): string | undefined =>
      parents.length > 1
        ? (parents.find(item => item.dn === picker?.value) ?? parents[0]).dn
        : parentDn;
    // Read once for the form, whichever parent is picked meanwhile.
    const domains = rights.inheritsDomains(entity)
      ? ctx.api.mailDomains(ctx.entities())
      : undefined;
    const form = new EntityForm({
      report: ctx.report,
      entity,
      entry,
      translator: ctx.translator(),
      typeAhead: (branch: string): boolean =>
        isDomainBranch(ctx.entities(), branch),
      // The organization the new one goes under, or the one an edited one
      // hangs from: the server walks up from there.
      linkableDomains: domains
        ? (): Promise<string[]> =>
            domains.linked(
              (entry?.dn ? parentOf(entry.dn) : parent()) ?? entity.base
            )
        : undefined,
      pointerOptions: (
        branch: string
      ): Promise<{ dn: string; label: string }[]> =>
        ctx.api.pointerOptions(
          branch,
          ctx.entities(),
          ctx.translator().language
        ),
      pointerSearch: (
        branch: string,
        failed?: boolean
      ):
        | ((
            query: string
          ) => Promise<{ dn: string; label: string; token?: string }[]>)
        | undefined => ctx.api.pointerSearch(branch, ctx.entities(), failed),
      onCancel: (): void => ctx.panel.close(),
      onSubmit: (
        values: Record<string, string | string[]>,
        cleared: string[]
      ): Promise<void> =>
        this.submitOrganization(entity, values, cleared, entry, parent(), form),
    });

    ctx.panel.open(
      entry
        ? `${t('app.edit')} — ${ctx.entryName(entity, String(entryValue(entry, entity.mainAttribute) ?? ''))}`
        : ctx.createLabel(entity),
      (body: HTMLElement): void => {
        // The parent picked is outside the form, and as much typed in it.
        let moved = false;
        ctx.panel.guardDiscard(body, () => moved || form.isDirty());
        if (parents.length < 2) {
          background(() => form.render(body), 'form.render', ctx.report);
          return;
        }
        render(
          body,
          html`
          <div class="dc-field">
            <label for="dc-organization-parent">${t('tree.parent')}</label>
            <select id="dc-organization-parent" class="dc-input">
              ${parents.map(
                item => html`<option value="${item.dn}">${item.label}</option>`
              )}
            </select>
          </div>
          <div data-organization-form></div>`
        );
        picker = body.querySelector<HTMLSelectElement>(
          '#dc-organization-parent'
        );
        picker?.addEventListener('change', () => {
          moved = true;
        });
        background(
          () =>
            form.render(
              body.querySelector<HTMLElement>(
                '[data-organization-form]'
              ) as HTMLElement
            ),
          'form.render',
          ctx.report
        );
      },
      !form.wantsPanel
    );
  }

  /**
   * Write what the organization form submitted, then draw the view again
   * with the organization on screen.
   *
   * Only the branch the change happened in is read again: the rest of the
   * tree, and the branches the administrator had opened, stay as they were.
   *
   * @param entity the organization entity
   * @param values what the form submitted
   * @param cleared attributes the form emptied
   * @param entry the organization edited; none for a new one
   * @param parentDn where a new one goes; the server's default when omitted
   * @param form the form submitted, to show a refusal under its field
   */
  private async submitOrganization(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    cleared: string[],
    entry?: Entry,
    parentDn?: string,
    form?: EntityForm
  ): Promise<void> {
    const { ctx } = this;
    const t = ctx.t;
    try {
      if (entry?.dn) {
        const dn = String(entry.dn);
        await ctx.api.updateOrganization(dn, values, cleared);
        ctx.toast(t('save.done'));
        ctx.panel.close(true);
        // Its parent's children are read again, for a changed name. The
        // address already names it, so the view drawn again shows its card,
        // the tree open down to it.
        const tree = ctx.tree();
        const parent = tree?.parentOf(dn);
        if (parent) await tree?.refresh(parent).catch(() => []);
      } else {
        await ctx.api.createOrganization(values, parentDn);
        ctx.toast(
          this.createdToast(
            entity,
            values,
            createdEntryId(entity, undefined, values)
          )
        );
        ctx.panel.close(true);
        // The new organization is found among its parent's children by the
        // name it was given, since the server answers no DN. From the tree,
        // it is then shown and selected where it was created; from the
        // overview, the overview stays.
        const children =
          (await ctx
            .tree()
            ?.refresh(parentDn)
            .catch(() => [])) ?? [];
        const raw = values[entity.mainAttribute];
        const name = String(
          (Array.isArray(raw) ? raw[0] : raw) ?? ''
        ).toLowerCase();
        const created = children.find(
          child =>
            rdnValue(child.dn).toLowerCase() === name ||
            child.name.toLowerCase() === name
        );
        if (created && ctx.route().view !== 'dashboard')
          ctx.record(`organizations/${encodeURIComponent(created.dn)}`);
      }
      await ctx.refresh();
    } catch (err) {
      // Named as the panel's title names it. A new one is judged on the
      // organization it goes under, which is the one named then.
      const id = entry
        ? String(entryValue(entry, entity.mainAttribute) ?? '')
        : createdEntryId(entity, undefined, values);
      const parent = parentDn ?? ctx.api.organizationRoot;
      this.refuseSave(
        err,
        entity,
        form,
        entry
          ? ctx.entryName(entity, id)
          : parent
            ? this.organizationName(entity, parent)
            : ctx.submittedName(entity, values, id)
      );
    }
  }

  /**
   * The organization a refusal of the caller's rights is about, when the
   * write puts an entry in one.
   *
   * ldap-rest judges a new entry on the organization it is attached to, not
   * on the entry: "You do not administer Alice Martin" said of an account
   * that does not exist yet. A change of organization is judged on both
   * ends — reading where the entry is, writing where it goes — and the scope
   * says which the caller lacks; where it says nothing, the destination is
   * the one asked more of. Any other change is judged on the entry, and
   * none is returned.
   *
   * @param entity the entity of the entry written
   * @param values what the form sent
   * @param entry the entry as stored; none for a new one
   * @param form the form, which names the organizations it offered
   * @returns the organization by its path, and the field naming it
   */
  private organizationRefused(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    entry?: Entry,
    form?: EntityForm
  ): { name: string; attribute: string } | undefined {
    const { ctx } = this;
    const link = entity.organizationLink;
    const sent = link ? [values[link] ?? []].flat()[0]?.trim() : undefined;
    if (!link || !sent) return undefined;
    const named = (dn: string): string =>
      form?.pointerName(dn) ??
      pointerLabel(ctx.entities(), dn, ctx.translator().language) ??
      rdnValue(dn);
    const stored = entry
      ? String([entryValue(entry, link) ?? []].flat()[0] ?? '').trim()
      : '';
    const rights = ctx.rights();
    if (!stored || !rights.restricted)
      return { name: named(sent), attribute: link };
    const writes = rights.writesWithin(sent);
    return {
      name: writes
        ? (ctx.roleValue(entity, entry as Entry, 'organizationPath') ??
          named(stored))
        : named(sent),
      attribute: link,
    };
  }

  /**
   * Say why a save was refused: under the field at fault when the form shows
   * it, the toast then only pointing there — it disappears while the form
   * stays open — and in the toast otherwise. Said in the interface's
   * language, naming the fields the way the form does (see
   * {@link explainRefusal}).
   *
   * @param err what the request threw
   * @param entity the entity of the entry refused
   * @param form the form that was saved
   * @param name what a refusal of rights is about: the entry, or the
   *   organization it goes to
   * @param field the attribute naming that organization
   */
  private refuseSave(
    err: unknown,
    entity: EntityDescriptor,
    form: EntityForm | undefined,
    name: string,
    field?: string
  ): void {
    const { ctx } = this;
    const { message, attribute } = explainRefusal(
      err,
      entity.schema,
      ctx.translator(),
      name || undefined,
      field
    );
    if (attribute && form?.refuse(attribute, message))
      ctx.toast(ctx.t('refusal.seeField'), true);
    else ctx.toast(message, true);
  }

  /**
   * An organization by the name the console gives it elsewhere: its path,
   * as the parent picker and the banner say it, else its name in the tree.
   *
   * @param entity the organizations
   * @param dn the organization
   */
  private organizationName(entity: EntityDescriptor, dn: string): string {
    return (
      this.ctx
        .rights()
        .creationParents(entity)
        .find(item => comparableDn(item.dn) === comparableDn(dn))?.label ??
      this.ctx.tree()?.nameOf(dn) ??
      rdnValue(dn)
    );
  }

  /**
   * What says an entry was created: named by its full name, else as its
   * card names it. "Created" alone did not say what.
   *
   * @param entity the entity the entry belongs to
   * @param values what the form sent
   * @param id the entry's main attribute value; empty when unknown
   */
  private createdToast(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    id: string
  ): string {
    const name = this.ctx.submittedName(entity, values, id);
    return name
      ? this.ctx.t('create.doneNamed', { name })
      : this.ctx.t('create.done');
  }
}
