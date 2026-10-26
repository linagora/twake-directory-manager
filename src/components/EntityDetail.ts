/**
 * Read-only view of one entry.
 *
 * It shows **every** attribute the entry carries, not the two the list already
 * showed: having to open an edit dialog to find out an organization's phone
 * number is the defect this replaces. Lifecycle actions sit next to the data
 * they change, and related entries are listed underneath.
 *
 * Every attribute is there, not every attribute in the reader's way: the card
 * is headed by the person's name, not by the identifier; the values are
 * grouped the way the form groups them; the empty ones, which were most of a
 * new account's card, are folded away; and the DN, which few administrators
 * need, waits under _Technical details_.
 *
 * @module twake-directory-manager/components/EntityDetail
 */

import {
  accountState,
  attributeLabel,
  displayValue,
  entryValue,
  isDnShaped,
  ownValueLabel,
  rdnValue,
  readableByteSize,
  resolveText,
  stateMarkup,
} from '../format';
import { hasRole, roleAttribute } from '../api/ConsoleApiClient';
import type { AttachedTables } from './AttachedTables';
import type { Translator } from '../i18n';
import type { EntityDescriptor, Entry, SchemaAttribute } from '../types';
import { background, type Reporter } from '../shared/background';
import { html, render, type SafeHtml } from '../shared/html';

/**
 * The headings a field the schema puts in no group is shown under, in the
 * order the card shows them. A group the schema names goes between Contact
 * and Mailbox.
 */
const HEAD_GROUPS = ['identity', 'organization', 'contact'];
const TAIL_GROUPS = ['mailbox', 'lifecycle'];

/** Where a field without a group of its own goes, by the role it carries. */
const ROLE_GROUPS: Record<string, string> = {
  identifier: 'identity',
  displayName: 'identity',
  givenName: 'identity',
  surname: 'identity',
  employeeId: 'identity',
  position: 'identity',
  accountStatus: 'identity',
  organizationLink: 'organization',
  organizationPath: 'organization',
  owners: 'organization',
  members: 'organization',
  managers: 'organization',
  localAdmins: 'organization',
  domainLink: 'organization',
  primaryEmail: 'contact',
  emailAliases: 'contact',
  emailQuota: 'mailbox',
  emailQuotaSize: 'mailbox',
  mailboxType: 'mailbox',
  writePolicy: 'mailbox',
  accountExpiry: 'lifecycle',
};

/**
 * Where a field carrying no role goes, for the standard LDAP attributes
 * (RFC 4519) that say how to reach someone, in lower case. Anything else
 * without a role or a group of its own is shown under Identity.
 */
const ATTRIBUTE_GROUPS: Record<string, string> = {
  telephonenumber: 'contact',
  mobile: 'contact',
  homephone: 'contact',
  pager: 'contact',
  facsimiletelephonenumber: 'contact',
  postaladdress: 'contact',
  postalcode: 'contact',
  postofficebox: 'contact',
  street: 'contact',
  l: 'contact',
  st: 'contact',
};

export interface DetailOptions {
  entity: EntityDescriptor;
  entry: Entry;
  translator: Translator;
  /**
   * Told of a failure in work the component starts without waiting for it
   * (see `background`); the console's own reporter, or the log when absent
   */
  report?: Reporter;
  canWrite: boolean;
  canDelete: boolean;
  onEdit(): void;
  onDelete(): void;
  /** Open the change of state, which asks before writing anything */
  onStatus(): void;
  onResetPassword(): void;
  /**
   * Why Edit is not offered, said under the heading where it would be: an
   * organization the caller administers is changed from above, reference
   * data is kept outside the console
   */
  notice?: string;
  /** The entry waits in the transit branch, or is attached to nothing */
  inTransit?: boolean;
  /** Move it into an organization of the caller's, when they may */
  onClaim?: () => void;
  /** Let it go into the transit branch, when they may */
  onHandOver?: () => void;
  /** Create an organization under this one, when they may */
  onCreateChild?: () => void;
  /** Readable name of the entry a pointer lands on, when its schema has one */
  pointerLabel?: (dn: string) => string | undefined;
  /** Entries pointing at this one, or pointed at by it */
  relations?: {
    title: string;
    /** Attribute the list came from, so the card does not repeat it */
    attribute?: string;
    items: {
      id: string;
      label: string;
      /** Said after the name, muted: a group's type */
      note?: string;
      /** The caller may take the entry out of it: a group they write */
      removable?: boolean;
    }[];
    /** The server listed only some of them */
    truncated?: boolean;
    /** How many it left out, when it counted them */
    more?: number;
    /** An account's groups, rather than a group's members */
    groups?: boolean;
  };
  /**
   * The address of a related entry's card, from its DN: none for an entry
   * no page shows, which is then named without a link
   */
  relationHref?(dn: string): string | undefined;
  /** Add the account to groups, when the caller may write it */
  onAddToGroups?: () => void;
  /** Add members to the group, when the caller may write it */
  onAddMembers?: () => void;
  /**
   * Take the account out of one of its groups, or a member out of the
   * group, offered where `removable`; settled once the server has answered
   */
  onLeaveGroup?: (id: string) => Promise<void> | void;
  /**
   * The people and the groups attached to an organization, shown as tables
   * in place of the related entries
   */
  attached?: AttachedTables;
}

/** Read an entry value as a list of display strings. */
function values(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/**
 * Name of a lifecycle state. A state the catalogue knows is translated; one
 * the deployment invented keeps the name the deployment gave it.
 *
 * @param translator interface language
 * @param state state key, as the schema declares it
 * @returns the name to show
 */
export function stateLabel(translator: Translator, state: string): string {
  const shown = translator.t(`state.${state}`);
  return shown === `state.${state}` ? state : shown;
}

/** Attributes naming the accounts or entries an entry is related to */
const RELATION_ROLES = ['members', 'owners', 'managers', 'localAdmins'];

export class EntityDetail {
  private readonly options: DetailOptions;

  constructor(options: DetailOptions) {
    this.options = options;
  }

  /**
   * Render into a container.
   *
   * @param container element to fill
   */
  render(container: HTMLElement): void {
    const { translator, inTransit } = this.options;
    const { title, subtitle } = this.naming();

    render(
      container,
      html`
      <article class="dc-detail">
        <header class="dc-detail-header">
          <div class="dc-detail-title">
            <h2>${title}${
              inTransit
                ? html` <span class="dc-tag dc-tag-transit">${translator.t(
                    'transit.badge'
                  )}</span>`
                : ''
            }</h2>
            ${
              subtitle.length
                ? html`<p class="dc-detail-subtitle" data-subtitle>${subtitle
                    .map(part => part)
                    .join(' · ')}</p>`
                : ''
            }
          </div>
          <div class="dc-detail-actions">${this.actionsMarkup()}</div>
        </header>
        ${
          this.options.notice
            ? html`<p class="dc-muted dc-detail-notice" data-notice>${
                this.options.notice
              }</p>`
            : ''
        }

        <section class="dc-card">
          <h3>${translator.t('detail.attributes')}</h3>
          ${this.fieldsMarkup()}
          ${this.dnMarkup()}
        </section>

        ${this.options.attached?.markup() ?? this.relationsMarkup()}
      </article>`
    );

    this.bind(container);
  }

  /**
   * What the card is headed with — and the page titled with, by the caller.
   *
   * @returns the entry's name
   */
  heading(): string {
    return this.naming().title;
  }

  /**
   * The name the card is headed with, and what is written under it.
   *
   * A person is called by their name, not by the identifier their account
   * signs in with: the full name heads the card, the identifier and the
   * address stand under it. An entry with no full name — a group, an
   * organization, an account created without one — is headed with its own
   * name, as it always was.
   */
  private naming(): { title: string; byName: boolean; subtitle: string[] } {
    const { entity, entry, translator } = this.options;
    const first = (name: string | undefined): string =>
      name ? values(entryValue(entry, name))[0] || '' : '';
    const id = first(entity.mainAttribute);
    const name = first(roleAttribute(entity.schema, 'displayName'));
    const title =
      name ||
      ownValueLabel(entity, entity.mainAttribute, id, translator.language) ||
      id;
    const mail = first(roleAttribute(entity.schema, 'primaryEmail'));
    return {
      title,
      byName: Boolean(name),
      subtitle: [title === id ? '' : id, mail].filter(Boolean),
    };
  }

  /**
   * The actions, by how often they are used and how much they risk: Edit
   * first, then Reset password and Change state…, then a More menu holding
   * Hand over, rarely used, and Delete, last and red, away from the
   * everyday buttons. Claim… stays first: an entry in transit is opened to be
   * claimed.
   */
  private actionsMarkup(): SafeHtml {
    const { entity, translator, canWrite, canDelete } = this.options;
    const { onClaim, onHandOver, onCreateChild } = this.options;
    const button = (data: string, key: string, primary = false): SafeHtml =>
      html`<button type="button" class="dc-button${
        primary ? ' dc-button-primary' : ''
      }" ${data}>${translator.t(key)}</button>`;
    const item = (data: string, key: string, danger = false): SafeHtml =>
      html`<button type="button" role="menuitem" class="dc-menu-item${
        danger ? ' dc-menu-item-danger' : ''
      }" ${data}>${translator.t(key)}</button>`;
    const more = [
      onHandOver ? item('data-hand-over', 'transit.handOver') : '',
      canDelete ? item('data-delete', 'app.delete', true) : '',
    ].filter(Boolean);
    return html`${[
      onClaim ? button('data-claim', 'transit.claim', true) : '',
      canWrite ? button('data-edit', 'app.edit', true) : '',
      // An everyday action of an organization's card, not a rare one: it
      // stays in the row, after Edit.
      onCreateChild ? button('data-create-child', 'tree.addChild') : '',
      canWrite && entity.password
        ? button('data-password', 'password.title')
        : '',
      this.statusMarkup(),
      more.length
        ? html`<div class="dc-menu">
              <button type="button" class="dc-button" data-more aria-haspopup="menu"
                aria-expanded="false" aria-controls="dc-more-actions">${translator.t(
                  'detail.moreActions'
                )}</button>
              <div class="dc-menu-list" role="menu" id="dc-more-actions" data-more-menu hidden>${more}</div>
            </div>`
        : '',
    ].filter(Boolean)}`;
  }

  /**
   * The entry's DN, which no attribute carries: the name a group's members
   * and owners are written with, and the one an administrator is asked for
   * elsewhere. Copied in one click rather than read off the address bar.
   *
   * Few administrators need it, and it stood first on the card, where the
   * name should: it waits, folded, under _Technical details_.
   */
  private dnMarkup(): SafeHtml {
    const { entry, translator } = this.options;
    const dn = entry.dn ? String(entry.dn) : '';
    if (!dn) return html``;
    return html`
          <details class="dc-detail-fold" data-technical>
            <summary>${translator.t('detail.technical')}</summary>
            <dl class="dc-attributes">
              <div class="dc-attribute dc-attribute-dn">
                <dt>${translator.t('detail.dn')}</dt>
                <dd><code class="dc-dn">${dn}</code>
                  <button type="button" class="dc-button" data-copy-dn>${translator.t(
                    'detail.copy'
                  )}</button></dd>
              </div>
            </dl>
          </details>`;
  }

  /**
   * Every attribute the schema knows, grouped under headings: those holding
   * a value first, the empty ones folded under _Show empty fields_ — on a
   * new account they were most of the card.
   *
   * A value said twice is said once: the name and the identifier the heading
   * already shows, the department beside its path (the path names it, and
   * leads to it), a common name that is the full name again.
   */
  private fieldsMarkup(): SafeHtml {
    const { entity, entry, translator } = this.options;
    const { title, byName } = this.naming();
    const display = roleAttribute(entity.schema, 'displayName');
    const hasPath =
      !!entity.organizationPath &&
      values(entryValue(entry, entity.organizationPath)).length > 0;
    const shown = this.groups();
    const empty = this.groups();
    let count = 0;
    for (const [name, attr] of Object.entries(entity.schema.attributes)) {
      // The same on every entry of the entity: it says nothing about this one
      if (name === 'objectClass' || attr.fixed) continue;
      // A write-only attribute has nothing to show: the API never returns it.
      if (attr.neverReturn) continue;
      // The related-entries section below shows this one in full.
      if (name === this.options.relations?.attribute) continue;
      if (byName && (name === display || name === entity.mainAttribute))
        continue;
      if (name === entity.organizationLink && hasPath) continue;
      const list = values(entryValue(entry, name));
      if (
        byName &&
        name.toLowerCase() === 'cn' &&
        list.length === 1 &&
        list[0] === title
      )
        continue;
      const row = html`
              <div class="dc-attribute">
                <dt>${this.label(name, attr)}</dt>
                <dd>${
                  list.length === 0
                    ? html`<span class="dc-muted">${translator.t('form.none')}</span>`
                    : list.map(value => this.valueMarkup(name, value))
                }</dd>
              </div>`;
      const heading = this.groupOf(name, attr);
      if (list.length) shown.get(heading)?.push(row);
      else {
        empty.get(heading)?.push(row);
        count++;
      }
    }
    return html`${this.groupsMarkup(shown)}${
      count
        ? html`
          <details class="dc-detail-fold" data-empty>
            <summary>${translator.t('detail.showEmpty', { count })}</summary>
            ${this.groupsMarkup(empty)}
          </details>`
        : ''
    }`;
  }

  /**
   * The headings of the card, each with no field yet, in the order they are
   * shown: those of the form's groups between Contact and Mailbox.
   */
  private groups(): Map<string, SafeHtml[]> {
    const { entity, translator } = this.options;
    const named = (keys: string[]): string[] =>
      keys.map(key => translator.t(`detail.group.${key}`));
    const own = Object.values(entity.schema.attributes)
      .map(attr => resolveText(attr.group, translator.language))
      .filter((group): group is string => !!group);
    return new Map(
      [...named(HEAD_GROUPS), ...own, ...named(TAIL_GROUPS)].map(heading => [
        heading,
        [],
      ])
    );
  }

  /**
   * The heading a field is shown under: the group the form puts it in, or
   * the one its role or its LDAP name points to.
   */
  private groupOf(name: string, attr: SchemaAttribute): string {
    const { translator } = this.options;
    const own = resolveText(attr.group, translator.language);
    if (own) return own;
    const roles = Array.isArray(attr.role)
      ? attr.role
      : attr.role
        ? [attr.role]
        : [];
    const key =
      roles.map(role => ROLE_GROUPS[role]).find(Boolean) ||
      ATTRIBUTE_GROUPS[name.toLowerCase()] ||
      'identity';
    return translator.t(`detail.group.${key}`);
  }

  private groupsMarkup(groups: Map<string, SafeHtml[]>): SafeHtml {
    return html`${[...groups]
      .filter(([, rows]) => rows.length)
      .map(
        ([heading, rows]) => html`
            <div class="dc-detail-group">
              <h4>${heading}</h4>
              <dl class="dc-attributes">${rows}</dl>
            </div>`
      )}`;
  }

  private label(name: string, attr: SchemaAttribute): string {
    return attributeLabel(name, attr, this.options.translator.language);
  }

  /**
   * One value. An organization path is clickable — it is both the answer to
   * "where is this entry?" and the way to get there.
   *
   * "The way to get there" was a link to the tree and nothing more: it opened
   * on the root, leaving the reader to find the department again by hand. The
   * route already takes an organization (`#/organizations/<dn>`) and selects
   * it, and the entry names its own one through the `organizationLink` role,
   * so the link goes to the department it is naming.
   *
   * An organization carries a path and no link — the path *is* its own place
   * in the tree, not a way to somewhere else — so on its own card it stays
   * text. A link from an entry to itself is one more thing to click for
   * nothing.
   *
   * A group's members and owners are DNs the schema types as strings, not as
   * pointers. They are named and followed the way the related entries are,
   * so the owners of a group read as the accounts they are rather than as
   * DNs, and lead to them.
   */
  private valueMarkup(name: string, value: string): SafeHtml {
    const { entity, entry } = this.options;
    const attr = entity.schema.attributes[name];
    const link =
      name === entity.organizationPath && entity.organizationLink
        ? values(entryValue(entry, entity.organizationLink))[0]
        : undefined;
    if (link)
      return html`<a href="#/organizations/${encodeURIComponent(
        link
      )}" class="dc-path-link" title="${value}">${value}</a>`;
    // An organization's managers and local administrators are accounts as
    // well, and lead to them: who administers a branch was only a name.
    if (RELATION_ROLES.some(role => hasRole(attr, role)) && isDnShaped(value))
      return this.relationLink(
        value,
        this.options.pointerLabel?.(value) || rdnValue(value),
        value
      );
    const { language } = this.options.translator;
    // 1073741824 is 1 GiB, which no decimal unit says exactly: the card
    // rounds it, and leaves the exact count in the tooltip.
    if (attr?.normalize === 'byteSize' && /^\d+$/.test(value.trim()))
      return html`<span class="dc-value" title="${this.options.translator.t(
        'detail.bytes',
        { count: value.trim() }
      )}">${readableByteSize(value, language).text}</span>`;
    const shown =
      ownValueLabel(entity, name, value, language) ||
      displayValue(attr, value, this.options.pointerLabel, language);
    return html`<span class="dc-value" title="${value}">${stateMarkup(
      accountState(entity, name, value),
      shown
    )}</span>`;
  }

  /**
   * Change state…, for an account its schema gives states. A button, not a
   * select: a select wrote the state as soon as its value changed, and an
   * arrow key on it was enough to lock a colleague out.
   */
  private statusMarkup(): SafeHtml {
    const { entity, translator, canWrite } = this.options;
    if (!canWrite || !entity.accountStatus) return html``;
    const states = entity.schema.attributes[entity.accountStatus]?.states;
    if (!states || Object.keys(states).length === 0) return html``;
    return html`<button type="button" class="dc-button" data-status>${translator.t(
      'status.change'
    )}</button>`;
  }

  /**
   * The related entries. An account's groups are managed from here too: Add
   * to a group… beside the heading, and a × on each group the caller may
   * take the account out of, where it took a trip to each group's form.
   */
  private relationsMarkup(): SafeHtml {
    const { relations, translator, onAddToGroups, onAddMembers } = this.options;
    if (!relations) return html``;
    // A group's members are counted, as its card is opened to manage them.
    const counted =
      relations.more !== undefined
        ? String(relations.items.length + relations.more)
        : `${relations.items.length}${relations.truncated ? '+' : ''}`;
    const title = relations.groups
      ? relations.title
      : `${relations.title} (${counted})`;
    return html`
      <section class="dc-card">
        <div class="dc-card-heading">
          <h3>${title}</h3>
          ${
            relations.groups && onAddToGroups
              ? html`<button type="button" class="dc-button" data-add-groups>${translator.t(
                  'groups.add'
                )}</button>`
              : !relations.groups && onAddMembers
                ? html`<button type="button" class="dc-button" data-add-members>${translator.t(
                    'members.add'
                  )}</button>`
                : ''
          }
        </div>
        ${
          relations.items.length === 0
            ? html`<p class="dc-muted">${translator.t('detail.emptyRelations')}</p>`
            : html`<ul class="dc-relations">${relations.items.map(item =>
                this.relationMarkup(item)
              )}</ul>`
        }
        ${this.moreMarkup()}
      </section>`;
  }

  /** One related entry: a link to it, its type, and its × when it has one. */
  private relationMarkup(item: {
    id: string;
    label: string;
    note?: string;
    removable?: boolean;
  }): SafeHtml {
    const { translator, onLeaveGroup } = this.options;
    const link = this.relationLink(item.id, item.label);
    const removable = item.removable && onLeaveGroup;
    if (!item.note && !removable) return html`<li>${link}</li>`;
    return html`<li class="dc-relation">${link}${
      item.note
        ? html`<span class="dc-relation-note">· ${item.note}</span>`
        : ''
    }${
      removable
        ? html`<button type="button" class="dc-relation-remove" data-leave="${
            item.id
          }" aria-label="${
            this.options.relations?.groups
              ? translator.t('groups.remove', { group: item.label })
              : translator.t('members.remove', {
                  member: item.label,
                  group: this.naming().title,
                })
          }">×</button>`
        : ''
    }</li>`;
  }

  /**
   * A related entry, named: a link to its card, which a middle click opens
   * in a new tab and whose address can be copied, as the Department's is.
   * They were buttons, which only ever opened in place.
   *
   * @param dn the entry
   * @param label its name
   * @param title its tooltip, the DN where the name hides it
   */
  private relationLink(dn: string, label: string, title?: string): SafeHtml {
    const href = this.options.relationHref?.(dn);
    const tip = title ? html` title="${title}"` : '';
    return href
      ? html`<a href="${href}" class="dc-link" data-relation="${
          dn
        }"${tip}>${label}</a>`
      : html`<span class="dc-value" data-relation="${dn}"${tip}>${
          label
        }</span>`;
  }

  /**
   * What the list leaves out, said where it stops: a department whose card
   * lists fifty names otherwise reads as a department of fifty.
   */
  private moreMarkup(): SafeHtml {
    const { relations, translator } = this.options;
    if (!relations?.truncated) return html``;
    return html`<p class="dc-muted" role="status">${
      relations.more === undefined
        ? translator.t('detail.moreUncounted')
        : translator.t('detail.more', { count: relations.more })
    }</p>`;
  }

  private bind(container: HTMLElement): void {
    const closeMenu = this.bindMenu(container);
    this.options.attached?.bind(container);
    container
      .querySelector('[data-edit]')
      ?.addEventListener('click', () => this.options.onEdit());
    container.querySelector('[data-delete]')?.addEventListener('click', () => {
      closeMenu();
      this.options.onDelete();
    });
    container
      .querySelector('[data-password]')
      ?.addEventListener('click', () => this.options.onResetPassword());
    container
      .querySelector('[data-claim]')
      ?.addEventListener('click', () => this.options.onClaim?.());
    container
      .querySelector('[data-hand-over]')
      ?.addEventListener('click', () => {
        closeMenu();
        this.options.onHandOver?.();
      });
    container
      .querySelector('[data-create-child]')
      ?.addEventListener('click', () => this.options.onCreateChild?.());

    const copy = container.querySelector<HTMLElement>('[data-copy-dn]');
    copy?.addEventListener('click', () => {
      const { entry, translator } = this.options;
      // Absent outside a secure context, or refused: the DN stays
      // selectable by hand, and the button says it was not copied.
      const said = (key: string): void => {
        copy.textContent = translator.t(key);
        setTimeout(() => {
          copy.textContent = translator.t('detail.copy');
        }, 2000);
      };
      if (!navigator.clipboard) return said('detail.copyFailed');
      navigator.clipboard.writeText(String(entry.dn)).then(
        () => said('detail.copied'),
        () => said('detail.copyFailed')
      );
    });

    container
      .querySelector('[data-status]')
      ?.addEventListener('click', () => this.options.onStatus());

    container
      .querySelector('[data-add-groups]')
      ?.addEventListener('click', () => this.options.onAddToGroups?.());
    container
      .querySelector('[data-add-members]')
      ?.addEventListener('click', () => this.options.onAddMembers?.());
    for (const button of Array.from(
      container.querySelectorAll<HTMLElement>('[data-leave]')
    )) {
      // Inert while the server answers: a second click asked it again, and
      // was refused for a member already gone. `aria-disabled` rather than
      // `disabled`, which would throw the keyboard's focus off the button.
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true') return;
        button.setAttribute('aria-disabled', 'true');
        background(
          () =>
            Promise.resolve(
              this.options.onLeaveGroup?.(button.dataset.leave as string)
            ).finally(() => button.removeAttribute('aria-disabled')),
          'options.onLeaveGroup',
          this.options.report
        );
      });
    }
  }

  /**
   * The More menu, worked from the keyboard as well as the mouse: the button
   * says whether it is open; the arrows, Home and End walk its items, which
   * Tab reaches too; Escape closes it and gives the focus back to the button,
   * and so does leaving it.
   *
   * @param container element the card is drawn in
   * @returns what closes the menu, giving the focus back to its button
   */
  private bindMenu(container: HTMLElement): () => void {
    const toggle = container.querySelector<HTMLElement>('[data-more]');
    const menu = container.querySelector<HTMLElement>('[data-more-menu]');
    const holder = toggle?.parentElement;
    if (!toggle || !menu || !holder) return () => undefined;
    const items = (): HTMLElement[] =>
      Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    // A click elsewhere closes it. Not on the focus leaving it: a browser
    // that does not focus a button it clicks (Safari) would close the menu
    // under the pointer before the click reached the item.
    const outside = (event: Event): void => {
      if (!holder.contains(event.target as Node)) close(false);
    };
    const open = (last = false): void => {
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside);
      const list = items();
      list[last ? list.length - 1 : 0]?.focus();
    };
    const close = (refocus: boolean): void => {
      document.removeEventListener('pointerdown', outside);
      if (menu.hidden) return;
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      if (refocus) toggle.focus();
    };
    toggle.addEventListener('click', () =>
      menu.hidden ? open() : close(false)
    );
    toggle.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open(event.key === 'ArrowUp');
      }
    });
    menu.addEventListener('keydown', event => {
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next: Record<string, number> = {
        ArrowDown: (at + 1) % list.length,
        ArrowUp: (at - 1 + list.length) % list.length,
        Home: 0,
        End: list.length - 1,
      };
      if (event.key === 'Escape') {
        // The menu closes, not the page or the panel behind it.
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key in next) {
        event.preventDefault();
        list[next[event.key]]?.focus();
      }
    });
    // Tab past its last item, or back before the button, closes it too.
    holder.addEventListener('focusout', event => {
      const target = event.relatedTarget as Node | null;
      if (target && !holder.contains(target)) close(false);
    });
    return () => close(true);
  }
}
