/**
 * The mail domains one form offers: those an entry's address may use, and
 * those an organization may link, as ldap-rest judges them from the domains
 * each organization above links.
 *
 * Out of the client, which only reads what this asks for: knowing what
 * an organization hidden from the caller means for the form grew it past
 * its budget (#375).
 *
 * @module twake-directory-manager/api/mailDomains
 */

import { comparableDn, parentDn, withinDn } from '../format';

/**
 * The mail domains, as one form asks for them: read once, along with the
 * domains each organization links, however often the operator types.
 */
export interface MailDomains {
  /**
   * The domains an entry attached to an organization may hold addresses at,
   * lower-cased and sorted: those it and every organization above it link
   * (`ldap/enterpriseRules`), or every domain of the directory when they
   * link none, link `*`, or when the entry is attached to nothing. `*`
   * itself is no domain to write after an `@`, and is never one of them.
   * Every domain too when an organization above is hidden from the caller:
   * what it links, which the server allows, is unknown (#375). Rejects when
   * the domains cannot be read
   */
  names(organization?: string): Promise<string[]>;
  /**
   * DNs of the domains an organization and every one above it link, up to
   * the top of the tree, leaving out those the caller cannot read (#375):
   * each domain named is one the server lets an organization under it
   * link. Rejects when one of them could not be read for another reason
   */
  linked(organization: string): Promise<string[]>;
}

/** What the lookup reads, through the client. */
export interface MailDomainSource {
  /** The top of the organization tree; none in a directory without one */
  top?: string;
  /** Every mail domain: its DN, and its name lower-cased */
  domains: () => Promise<{ dn: string; name: string }[]>;
  /**
   * DNs of the domains one organization links itself, rejecting with the
   * answer's `status` when it cannot be read. None when organizations link
   * no domain
   */
  links?: (organization: string) => Promise<string[]>;
}

/**
 * The lookup of one form. Each domain list and organization is read when
 * first asked for and kept for as long as the form is open, so that every
 * "@" the operator types costs no request after the first.
 *
 * The organizations are read one by one from the one asked about up to the
 * top of the tree, as the server walks them when it judges an address or a
 * link. A directory without a tree, or whose organizations link no domain,
 * restricts no address, and nor does the form; a new link still needs a
 * domain linked above, so none is offered then.
 *
 * ldap-rest answers `404` to a delegated administrator reading an
 * organization above their branches, yet still counts what it links when it
 * judges them. A chain that could not be read whole made the form offer
 * every domain to link, the server then refusing most of them (#375). Such
 * an organization is now left out rather than failing the lookup: a link is
 * offered only when an organization the caller reads above holds it, which
 * the server accepts whatever the hidden ones link — at worst, one already
 * inherited from them is not offered again, and linking it again would have
 * changed nothing. An address cannot be narrowed that way, since a domain
 * the hidden ones link is likely the one the caller's own accounts use:
 * every domain is offered there, and the server judges, as before. A hidden
 * organization is skipped rather than stopped at, since the server collects
 * the links of every organization above, a readable one above a hidden one
 * included.
 *
 * @param source what to read
 * @returns the lookup
 */
export function mailDomainLookup(source: MailDomainSource): MailDomains {
  const { top, links } = source;
  let listed: Promise<{ dn: string; name: string }[]> | undefined;
  const list = (): Promise<{ dn: string; name: string }[]> =>
    (listed ??= source.domains());
  // What each organization links itself, by DN: the chains of two
  // departments of one company share every organization above them.
  // Undefined for one the caller is not let read: `404` above their
  // branches, `403` where a narrower rule refuses it (#375).
  const own = new Map<string, Promise<string[] | undefined>>();
  const read = (
    dn: string,
    linksOf: (dn: string) => Promise<string[]>
  ): Promise<string[] | undefined> => {
    const key = comparableDn(dn);
    let found = own.get(key);
    if (!found) {
      found = linksOf(dn).catch((err: unknown) => {
        const status = (err as { status?: number }).status;
        if (status === 404 || status === 403) return undefined;
        throw err;
      });
      own.set(key, found);
    }
    return found;
  };
  // What every organization from this one up to the top links, an entry
  // per organization; undefined for one hidden from the caller.
  const chainLinks = async (
    organization: string
  ): Promise<(string[] | undefined)[]> => {
    if (!links || !top || !withinDn(organization, top)) return [];
    const chain: string[] = [];
    for (let dn: string | undefined = organization; dn; dn = parentDn(dn)) {
      chain.push(dn);
      if (comparableDn(dn) === comparableDn(top)) break;
    }
    return Promise.all(chain.map(dn => read(dn, links)));
  };
  const sorted = (names: string[]): string[] =>
    [...new Set(names)].filter(name => name !== '*').sort();
  return {
    linked: async (organization: string): Promise<string[]> =>
      (await chainLinks(organization)).flatMap(held => held ?? []),
    names: async (organization?: string): Promise<string[]> => {
      const domains = await list();
      const every = sorted(domains.map(domain => domain.name));
      if (!organization) return every;
      let chain: (string[] | undefined)[];
      try {
        chain = await chainLinks(organization);
      } catch {
        // Which domains the tree allows is unknown: the server judges.
        return every;
      }
      // What a hidden organization lets addresses use is unknown, and
      // likely the very domain of the caller's own accounts (#375).
      if (chain.some(held => held === undefined)) return every;
      const byDn = new Map(
        domains.map(domain => [comparableDn(domain.dn), domain.name])
      );
      const names = chain
        .flatMap(held => held ?? [])
        .map(dn => byDn.get(comparableDn(dn)))
        .filter((name): name is string => !!name);
      return names.length === 0 || names.includes('*') ? every : sorted(names);
    },
  };
}
