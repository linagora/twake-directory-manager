/**
 * What the signed-in administrator may do, as the console reads it from the
 * scope the server described.
 *
 * `GET /v1/authz/scope` lists the branches the caller reads, writes and
 * deletes, the entities they create, the transit branch and a few flags; it
 * does not say, for a given entry, what the caller may do with it. The console
 * derives that here, mirroring ldap-rest's own rules: an organization is
 * judged by its parent, an entry in transit by the transit branch, reference
 * data through the global branches. The server remains the authority — every
 * write is sent and may be refused, and a refusal is shown in its words — and
 * these rules decide only what is offered.
 *
 * Every reading of a `Scope` lives in this module (ESLint refuses one
 * elsewhere): one file to review when the authorization model changes, one
 * table of tests to pin it (`test/rights.test.ts`). The way out of the
 * duplication is the server answering these questions itself, which #222
 * asks of ldap-rest; this module would then relay its answers.
 *
 * @module twake-directory-manager/rights
 */

import {
  comparableDn,
  entryValue,
  parentDn as parentOf,
  rdnValue,
  withinDn,
} from './format';
import type {
  AttachedEntry,
  EntityDescriptor,
  Entry,
  OrganizationNode,
  Scope,
} from './types';

/**
 * Whether a collection is one an administrator works in every day.
 *
 * What an administrator manages lives in the organization tree: the tree
 * itself, and the entries attached to a node of it — accounts, groups. What is
 * attached to no node is what those entries point at — positions, titles,
 * account states, mail domains — reference data, set up once and rarely
 * touched. The schema already says which is which, through the
 * `organizationLink` role, so the console needs no list of names to tell them
 * apart.
 *
 * @param entity collection to classify
 * @returns true for the tree and the entries attached to it
 */
export function isPrimaryEntity(entity: EntityDescriptor): boolean {
  return entity.kind === 'organization' || !!entity.organizationLink;
}

/**
 * The collections to put forward and the ones to tuck away. A directory with
 * no organization tree has nothing to tell apart: every collection is then
 * put forward rather than all of them hidden.
 *
 * @param entities every collection the server serves
 * @returns both lists, in the order the server gave them
 */
export function splitEntities(entities: EntityDescriptor[]): {
  primary: EntityDescriptor[];
  reference: EntityDescriptor[];
} {
  const primary = entities.filter(isPrimaryEntity);
  if (primary.length === 0) return { primary: entities, reference: [] };
  return {
    primary,
    reference: entities.filter(entity => !isPrimaryEntity(entity)),
  };
}

/**
 * Whether the scope decides which actions the console offers.
 *
 * It does not when there is none — a server without `authzScope` — when it is
 * unrestricted, or when the server could not describe it. Each action is then
 * offered and the server answers it. An undescribed scope carries no branch
 * and no entity, and reading that as "no right" left a deployment gating its
 * routes with `authzPerRoute` a read-only console.
 *
 * @param scope what `GET /v1/authz/scope` answered
 * @returns true when the scope's branches and entities are the rights
 */
export function scopeRestricts(scope: Scope | null): scope is Scope {
  return !!scope && !scope.unrestricted && scope.described !== false;
}

/** Where an entry stands with the transit branch, and what the caller may do. */
export interface TransitState {
  /** Waiting for an administrator to claim it */
  inTransit: boolean;
  /** The caller may move it into an organization of theirs */
  claim: boolean;
  /** The caller may let it go into the transit branch */
  handOver: boolean;
  /**
   * What the caller may do to an entry in transit besides moving it. The
   * server judges those changes on the transit branch, or on the entry's
   * parent when it is attached to nothing, so an entry is usually claimed
   * first. Absent when the entry is not in transit
   */
  rights?: { write: boolean; delete: boolean };
}

/**
 * The transit moves offered on an entry.
 *
 * ldap-rest also counts an entry attached to no organization as in transit,
 * but `transit: null` does not tell a server judging by attachment without a
 * transit branch from one not judging by attachment at all, where nobody may
 * claim such an entry. The console therefore speaks of transit only when the
 * server names a transit branch.
 *
 * `POST /groups/:cn/move` refuses a group attached to no organization, so
 * such a group is in transit but cannot be claimed.
 *
 * @param scope what `GET /v1/authz/scope` answered
 * @param entity entity the entry belongs to
 * @param entry the entry as read
 * @returns whether it is in transit, and the moves offered
 */
export function transitState(
  scope: Scope | null,
  entity: EntityDescriptor,
  entry: Entry
): TransitState {
  const none = { inTransit: false, claim: false, handOver: false };
  if (!scopeRestricts(scope) || !scope.transit || !entity.organizationLink)
    return none;
  const raw = entryValue(entry, entity.organizationLink);
  const link = String((Array.isArray(raw) ? raw[0] : raw) ?? '');
  if (!link || comparableDn(link) === comparableDn(scope.transit)) {
    // The parent: everything up to the first comma the DN does not escape.
    const judged =
      link || String(entry.dn ?? '').replace(/^(?:\\.|[^,\\])*,/, '');
    const grants = (right: 'write' | 'delete'): boolean =>
      !!judged &&
      scope.branches.some(
        branch => branch[right] && withinDn(judged, branch.dn)
      );
    return {
      inTransit: true,
      claim:
        (!!link || entity.kind !== 'group') &&
        scope.branches.some(branch => branch.write),
      handOver: false,
      rights: { write: grants('write'), delete: grants('delete') },
    };
  }

  return {
    inTransit: false,
    claim: false,
    handOver: scope.branches.some(
      branch => branch.write && withinDn(link, branch.dn)
    ),
  };
}

/**
 * Whether the caller may change one entry, as the server judges it.
 *
 * ldap-rest judges a change on the organization the entry is attached to
 * only when it filters entries by attachment — always under `authzLinid1`,
 * under the other plugins only with `--authz-filter-attached-entries`, off
 * by default — and on the entry's parent otherwise: `ou=groups` for every
 * group. The scope does not say which, but a transit branch is named only
 * where entries are judged by attachment. Without one, either is taken, so
 * that nothing the server allows is hidden: what it refuses after all is
 * said in the console's words.
 *
 * An entry in transit is judged as {@link transitState} judges it: a local
 * administrator changes nothing in it before claiming it.
 *
 * @param scope what `GET /v1/authz/scope` answered
 * @param entity entity the entry belongs to
 * @param entry the entry as read
 * @returns false only when the scope says the server would refuse
 */
export function writesEntry(
  scope: Scope | null,
  entity: EntityDescriptor,
  entry: Entry
): boolean {
  if (!scopeRestricts(scope)) return true;
  const transit = transitState(scope, entity, entry);
  if (transit.rights) return transit.rights.write;
  const writes = (dn: string | undefined): boolean =>
    !!dn &&
    scope.branches.some(branch => branch.write && withinDn(dn, branch.dn));
  const raw = entity.organizationLink
    ? entryValue(entry, entity.organizationLink)
    : undefined;
  const link = String((Array.isArray(raw) ? raw[0] : raw) ?? '').trim();
  const parent = parentOf(String(entry.dn ?? ''));
  if (scope.transit) return writes(link || parent);
  return writes(link) || writes(parent);
}

/**
 * The branches an entry in transit can be claimed into: those the caller
 * writes, each standing for its subtree.
 *
 * @param scope what `GET /v1/authz/scope` answered
 * @returns the roots to offer the organizations of
 */
export function claimRoots(scope: Scope): OrganizationNode[] {
  return scope.branches
    .filter(branch => branch.write)
    .map(branch => ({
      dn: branch.dn,
      name: branch.name || rdnValue(branch.dn),
      path: branch.path,
    }));
}

/**
 * The branches a new organization can go under: the organizations the caller
 * writes, each standing for its subtree. The server judges a creation on the
 * parent it is given, so these are the parents it would accept.
 *
 * The transit branch is left out: every administrator writes it to hand
 * entries over, which makes it no organization of theirs to grow. One a
 * written branch above it holds is still covered by that branch.
 *
 * @param scope what `GET /v1/authz/scope` answered
 * @param top the root of the organization tree
 * @returns the branches, as the scope names them
 */
export function organizationParents(
  scope: Scope,
  top: string
): Scope['branches'] {
  const transit = scope.transit;
  return scope.branches.filter(
    branch =>
      branch.write &&
      !!top &&
      withinDn(branch.dn, top) &&
      !(transit && withinDn(branch.dn, transit))
  );
}

/**
 * The rights of the signed-in administrator, as the console offers actions
 * by them. Built from what the scope read answered; a scope that could not
 * be read (`scopeError`) withholds every write, a scope the server does not
 * serve or cannot describe restricts nothing.
 */
export class Rights {
  /**
   * @param scope what `GET /v1/authz/scope` answered, or null without one
   * @param scopeError why it could not be read, when it could not
   * @param policiesReadable whether the password policies can be read
   */
  constructor(
    readonly scope: Scope | null,
    readonly scopeError: string | null,
    readonly policiesReadable: boolean
  ) {}

  /** Whether the scope decides what is offered (see {@link scopeRestricts}). */
  get restricted(): boolean {
    return scopeRestricts(this.scope);
  }

  /** The transit branch the server names, if any. */
  get transit(): string | undefined {
    return scopeRestricts(this.scope)
      ? this.scope.transit || undefined
      : undefined;
  }

  /** Who is signed in, as the scope names them. */
  get user(): string | undefined {
    return this.scope?.user || undefined;
  }

  /** Where an entry stands with the transit branch (see {@link transitState}). */
  transitOf(entity: EntityDescriptor, entry: Entry): TransitState {
    return transitState(this.scope, entity, entry);
  }

  /** The branches an entry in transit can be claimed into. */
  claimRoots(): OrganizationNode[] {
    return scopeRestricts(this.scope) ? claimRoots(this.scope) : [];
  }

  /**
   * What the scope says of the password policies: whether the caller manages
   * them, when a server recent enough to say so described the scope;
   * undefined when the console has to ask for the policies to find out.
   */
  get policiesTold(): boolean | undefined {
    const told = this.scope?.passwordPolicies;
    return typeof told === 'boolean' && this.scope?.described !== false
      ? told
      : undefined;
  }

  /**
   * The scope as the banner shows it: the failure that withholds every
   * write, why nothing is restricted, or the branches administered and the
   * transit branch.
   */
  get summary():
    | { kind: 'error'; error: string }
    | { kind: 'unrestricted' }
    | { kind: 'undescribed' }
    | { kind: 'nothing' }
    | { kind: 'branches'; branches: Scope['branches']; transit?: string } {
    if (this.scopeError) return { kind: 'error', error: this.scopeError };
    if (!this.scope || this.scope.unrestricted) return { kind: 'unrestricted' };
    if (this.scope.described === false) return { kind: 'undescribed' };
    if (this.scope.branches.length === 0) return { kind: 'nothing' };
    return {
      kind: 'branches',
      branches: this.scope.branches,
      transit: this.scope.transit || undefined,
    };
  }

  /**
   * Whether the caller reads everything under a branch: the transit branch
   * is every administrator's to read, the others are read as the scope says.
   *
   * @param dn the branch
   */
  readsWhole(dn: string): boolean {
    const scope = this.scope;
    if (this.scopeError) return false;
    if (!scopeRestricts(scope)) return true;
    if (scope.transit && withinDn(dn, scope.transit)) return true;
    return scope.branches.some(branch => withinDn(dn, branch.dn));
  }

  /**
   * Whether a branch the caller writes holds this DN. True when the scope
   * restricts nothing.
   *
   * @param dn an entry or a branch
   */
  writesWithin(dn: string): boolean {
    if (this.scopeError) return false;
    if (!scopeRestricts(this.scope)) return true;
    return this.scope.branches.some(
      branch => branch.write && withinDn(dn, branch.dn)
    );
  }

  /**
   * Whether the caller writes a branch that is this organization itself: the
   * one the banner names as theirs, which the server judges by its parent.
   *
   * @param dn the organization
   */
  administersExactly(dn: string): boolean {
    return (
      scopeRestricts(this.scope) &&
      this.scope.branches.some(
        branch => branch.write && comparableDn(branch.dn) === comparableDn(dn)
      )
    );
  }

  /**
   * Whether the caller administers no branch at all. The server then refuses
   * every read, so the views say so calmly rather than ask and show each
   * refusal as an error. An unrestricted or undescribed scope names no
   * branch either, but restricts nothing.
   */
  administersNothing(): boolean {
    return scopeRestricts(this.scope) && this.scope.branches.length === 0;
  }

  /** Whether the caller may write anywhere at all. */
  canWrite(): boolean {
    if (this.scopeError) return false;
    if (!scopeRestricts(this.scope)) return true;
    return this.scope.branches.some(branch => branch.write);
  }
  /** Whether the caller may delete anywhere at all. */
  canDelete(): boolean {
    if (this.scopeError) return false;
    if (!scopeRestricts(this.scope)) return true;
    return this.scope.branches.some(branch => branch.delete);
  }
  /**
   * Whether the caller manages the password policies: what the scope said
   * (`policiesTold`), or what asking for them answered.
   */
  managesPolicies(): boolean {
    return this.policiesReadable;
  }

  /** Whether the caller may create an entry of this entity. */
  canCreate(entity: EntityDescriptor): boolean {
    if (this.scopeError) return false;
    if (!scopeRestricts(this.scope)) return true;
    const declared = this.scope.entities.find(
      item => item.name === entity.pluralName
    );
    // The server enumerates every entity it serves, so an entity it did not
    // name is one it does not know: its add hook is what would answer, and it
    // would answer 403.
    if (!declared) return false;
    return declared.create || this.creationParents(entity).length > 0;
  }

  /**
   * Where a new organization goes when the caller may not create one at the
   * root of the tree.
   *
   * `organizations.create` answers for a creation without a parent, which
   * lands at the root: a global administrator appointed one level below it
   * read "Creation not allowed here", though the server accepts the
   * organization under any branch they write. Those branches are offered
   * instead, by the name the banner gives them.
   *
   * @param entity the entity about to be created
   * @returns the parents to offer, sorted; none when the root is allowed,
   *   when the scope restricts nothing, or for any other entity
   */
  creationParents(entity: EntityDescriptor): { dn: string; label: string }[] {
    if (entity.kind !== 'organization' || !scopeRestricts(this.scope))
      return [];
    const declared = this.scope.entities.find(
      item => item.name === entity.pluralName
    );
    if (!declared || declared.create) return [];
    return organizationParents(this.scope, entity.base)
      .map(branch => ({
        dn: branch.dn,
        label: branch.path || branch.name || branch.dn,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Whether the caller links an organization only to the mail domains one
   * above it links already. ldap-rest's authorization holds every caller to
   * that (`authzLinid1`, "Mail domains") but the one who writes the top
   * organization, who hands each organization its domains; a scope that
   * restricts nothing leaves it to the server to say.
   *
   * The server says so itself in `linksAnyDomain`: the administrators of
   * `--authz-global-organization`, the functional root right under a bare
   * top, link any domain too, and read from the branches they were offered
   * none. Only a server that predates it is read the old way.
   *
   * @param entity the organizations
   * @returns true when the domains offered are to be narrowed
   */
  inheritsDomains(entity: EntityDescriptor): boolean {
    if (this.scopeError || !scopeRestricts(this.scope) || !entity.base)
      return false;
    const any = (this.scope as { linksAnyDomain?: unknown }).linksAnyDomain;
    if (typeof any === 'boolean') return !any;
    const top = entity.base;
    return !this.scope.branches.some(
      branch => branch.write && withinDn(top, branch.dn)
    );
  }

  /**
   * Whether the caller may create an organization under this one.
   *
   * Every written branch counts here, not only the organizations among
   * them: a branch written above the root of the tree, as an administrator
   * of the whole directory has, covers every node. The transit branch is
   * still no organization of theirs to grow.
   *
   * @param dn the organization a new one would hang from
   */
  createsUnder(dn: string): boolean {
    if (!this.canWrite()) return false;
    if (!scopeRestricts(this.scope)) return true;
    const transit = this.scope.transit;
    return this.scope.branches.some(
      branch =>
        branch.write &&
        !(transit && withinDn(branch.dn, transit)) &&
        withinDn(dn, branch.dn)
    );
  }

  /**
   * Whether the caller may change an entry, judged on the entry itself
   * rather than on the scope as a whole (see {@link writesEntry}).
   */
  writes(entity: EntityDescriptor, entry: Entry): boolean {
    return this.canWrite() && writesEntry(this.scope, entity, entry);
  }

  /**
   * What the caller may do to an organization itself, judged as the server
   * judges it: by its parent, on the most specific branch holding it, a
   * branch naming the organization itself granting the right as well, and
   * for Delete every branch at or below it. The administrator of Sales
   * changes what Sales holds, not Sales itself.
   *
   * Writing anywhere was enough to be offered Edit and Delete on any card,
   * the transit branch's included. Every administrator writes the transit
   * branch, to hand entries over, and that gives them no right to change it:
   * Save was refused at the end. On it and below it, only a branch written
   * above it counts — the global administrator's — as the rights on an
   * entry in transit are read from the scope (see {@link transitState}).
   *
   * @param dn the organization
   * @returns whether Edit and Delete are offered
   */
  organizationRights(dn: string): { write: boolean; delete: boolean } {
    const scope = this.scope;
    if (!scopeRestricts(scope))
      return { write: this.canWrite(), delete: this.canDelete() };
    const transit = scope.transit;
    if (transit && withinDn(dn, transit)) {
      const above = (right: 'write' | 'delete'): boolean =>
        !this.scopeError &&
        scope.branches.some(
          branch =>
            branch[right] &&
            withinDn(dn, branch.dn) &&
            !withinDn(branch.dn, transit)
        );
      return { write: above('write'), delete: above('delete') };
    }
    // Offered on Sales to its administrator, Edit ended in "You do not
    // administer Sales" once the form was typed in.
    const parent = parentOf(dn);
    // RDNs, by the commas no backslash escapes.
    const depth = (branch: string): number =>
      (comparableDn(branch).match(/(?:^|[^\\]),/g) ?? []).length + 1;
    const holding = parent
      ? scope.branches
          .filter(branch => withinDn(parent, branch.dn))
          .sort((a, b) => depth(b.dn) - depth(a.dn))[0]
      : undefined;
    const judged = (right: 'write' | 'delete'): boolean =>
      !this.scopeError &&
      !!holding?.[right] &&
      !scope.branches.some(
        branch =>
          !branch[right] &&
          (comparableDn(branch.dn) === comparableDn(dn) ||
            (right === 'delete' && withinDn(branch.dn, dn)))
      );
    return { write: judged('write'), delete: judged('delete') };
  }

  /**
   * Whether the caller only reads the entries of a reference entity:
   * positions, states, mail domains. They lie outside every department, and
   * the server judges them on their branch, which a local administrator does
   * not administer; the scope says so of each entity in `create`. A scope
   * that restricts nothing leaves it to the server.
   */
  readsReferenceOnly(entity: EntityDescriptor): boolean {
    // A scope the console could not read withholds every action already,
    // and the banner says why: this is no reason to give.
    if (this.scopeError) return false;
    return !isPrimaryEntity(entity) && !this.changesReference(entity);
  }

  /**
   * Whether the scope lets the caller write a reference entity. It says
   * so in `create`, the right to write its branch; it names no right to
   * delete there, and the same answer stands for Delete.
   */
  changesReference(entity: EntityDescriptor): boolean {
    if (this.scopeError) return false;
    if (!scopeRestricts(this.scope)) return true;
    return !!this.scope.entities.find(item => item.name === entity.pluralName)
      ?.create;
  }

  /**
   * Whether the caller may claim an entry listed in transit: as its card
   * would say, from the entity holding it, attached to the transit branch.
   */
  claimable(entry: AttachedEntry, entity: EntityDescriptor): boolean {
    const transit = this.transit;
    if (!transit || !entity.organizationLink) return false;
    return transitState(this.scope, entity, {
      dn: entry.dn,
      [entity.organizationLink]: transit,
    }).claim;
  }
}
