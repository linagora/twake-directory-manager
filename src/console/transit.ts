/**
 * The transit branch: its count on the banner, what waits there, the entries
 * a save or a deletion moves in or out of it, and Claim… on the rows listing
 * them (#220).
 *
 * A read of the branch counts wherever it comes from — the banner, the
 * Overview, the branch's own card — and the last read out is the one that
 * counts.
 *
 * @module twake-directory-manager/console/transit
 */

import type { Translator } from '../i18n';
import type { Rights } from '../rights';
import { background, type Reporter } from '../shared/background';
import type { Route } from './route';
import { comparableDn, rdnValue } from '../format';
import type {
  AttachedEntries,
  AttachedEntry,
  EntityDescriptor,
  Entry,
} from '../types';
import type { AttachedOptions } from '../components/AttachedTables';

/** What transit asks of the console. */
export interface TransitDeps {
  /** What the caller may do, read from the scope as it is now */
  rights(): Rights;
  /** The translator of the interface's language now */
  translator(): Translator;
  /** The page the address names now */
  route(): Route;
  /** The banner's link to the branch, when it is drawn */
  link(): HTMLElement | null;
  /** What an organization holds, read as the console reads it */
  readMembers(dn: string): Promise<AttachedEntries>;
  /** Claim an entry into one of the caller's organizations */
  claim(entity: EntityDescriptor, id: string, name?: string): Promise<void>;
  /** Where work nobody waits for ends when it fails */
  readonly report: Reporter;
}

export class TransitService {
  /** What waits in the branch, as last read */
  private waiting: AttachedEntries | null = null;
  /** How many times it was asked for, so that only the last answer counts */
  private reads = 0;

  /** @param deps the console, as transit sees it */
  constructor(private readonly deps: TransitDeps) {}

  /**
   * The banner's Transit link: the branch's name, and how many entries wait
   * there when some do — "Transit (2)" — so that an administrator is told
   * of a hand-over without thinking of looking.
   */
  label(): string {
    const transit = this.deps.rights().transit;
    if (!transit) return '';
    const name = rdnValue(transit);
    const waiting = this.waiting;
    if (!waiting?.entries.length) return name;
    return `${name} (${waiting.entries.length}${waiting.truncated ? '+' : ''})`;
  }

  /**
   * Read what waits in transit, and count it on the banner.
   *
   * Only for an administrator whose scope names a transit branch: the
   * console speaks of transit only then (see `transitState`). A read that
   * fails counts nothing rather than an error: the branch is still a link
   * away.
   *
   * @returns what waits there, or null when there is nothing to read
   */
  async read(): Promise<AttachedEntries | null> {
    const rights = this.deps.rights();
    const transit = rights.transit;
    if (!transit || rights.administersNothing()) return null;
    try {
      // The read counts on the banner itself (see `ticket` and `settle`).
      return await this.deps.readMembers(transit);
    } catch {
      return null;
    }
  }

  /**
   * Count what waits in transit on the banner, as the last answer to a read
   * of the branch said, and leave the link's name alone meanwhile.
   *
   * @param waiting what the branch holds, or null when it could not be read
   */
  count(waiting: AttachedEntries | null): void {
    this.waiting = waiting;
    const link = this.deps.link();
    if (link) link.textContent = this.label();
  }

  /**
   * Whether the console counts the entry in transit, as the server judges it
   * (see `transitState`): what a save or a deletion changes.
   *
   * @param entity entity the entry belongs to
   * @param entry the entry as read, or as a change would leave it
   */
  inTransit(entity: EntityDescriptor, entry: Entry): boolean {
    return this.deps.rights().transitOf(entity, entry).inTransit;
  }

  /**
   * Whether the first page reads the transit branch itself: the Overview
   * lists it, and its own card lists its members, which counts it on the
   * banner as well. Read once the shell is drawn, before the page is.
   */
  readsOnPage(): boolean {
    const route = this.deps.route();
    if (route.view === 'dashboard') return true;
    const transit = this.deps.rights().transit;
    return (
      route.view === 'organizations' &&
      !!transit &&
      !!route.id &&
      comparableDn(route.id) === comparableDn(transit)
    );
  }

  /**
   * Count what waits in transit again, on the banner, after a change that may
   * have moved an entry into or out of the branch: a save, a deletion. The
   * Overview reads the branch itself when it is drawn, and a caller with no
   * transit branch reads nothing.
   */
  refresh(): void {
    if (this.deps.route().view === 'dashboard') return;
    background(() => this.read(), 'readTransit', this.deps.report);
  }

  /** Claim…, at the end of each row listing what waits in transit. */
  claimAction(): NonNullable<AttachedOptions['rowAction']> {
    const deps = this.deps;
    return {
      label: deps.translator().t('transit.claim'),
      named: name => deps.translator().t('transit.claimTitle', { name }),
      offered: (entry: AttachedEntry, entity: EntityDescriptor): boolean =>
        deps.rights().claimable(entry, entity),
      run: (entry: AttachedEntry, entity: EntityDescriptor): void =>
        background(
          () =>
            deps.claim(
              entity,
              entry.label,
              entry.values?.displayName || entry.label
            ),
          'claim',
          deps.report
        ),
    };
  }

  /**
   * The ticket of a read of an organization: non-zero only for the transit
   * branch, whose answer then counts on the banner (see `settle`).
   *
   * @param dn the organization read
   * @returns the ticket, 0 for another organization
   */
  ticket(dn: string): number {
    const transit = this.deps.rights().transit;
    if (!transit || comparableDn(dn) !== comparableDn(transit)) return 0;
    return ++this.reads;
  }

  /**
   * Count the answer of a read taken under a ticket, unless a later read of
   * the branch is out: an answer arriving after a later one's is older, and
   * must not count over it.
   *
   * @param ticket what `ticket` returned for the read
   * @param waiting what it answered, or null when it failed
   */
  settle(ticket: number, waiting: AttachedEntries | null): void {
    if (!ticket || ticket !== this.reads) return;
    this.count(waiting);
  }
}
