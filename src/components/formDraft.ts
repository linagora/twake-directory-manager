/**
 * What an open form holds that must outlive a sign-in again: the fields
 * changed, and those emptied. A password is never part of it.
 *
 * Kept apart from the form so that the rule — an untouched field is not
 * written back over what someone else may have changed meanwhile — reads in
 * one place.
 *
 * @module twake-directory-manager/components/formDraft
 */

import { hasRole } from '../api/ConsoleApiClient';
import { entryValue } from '../format';
import { html, type SafeHtml } from '../shared/html';
import type { Entry, SchemaAttribute } from '../types';

/** A form's values, by attribute, always as a list. */
export type Values = Record<string, string[]>;

/** What a form holds that its entry does not, and the fields it emptied. */
export interface FormDraft {
  /** What was typed, by attribute */
  values: Record<string, string[]>;
  /** Attributes the form emptied */
  cleared: string[];
}

/** Whether a field holds a password, which no draft ever keeps. */
function isPassword(attr: SchemaAttribute): boolean {
  return hasRole(attr, 'password') || !!attr.neverReturn;
}

/** A value of an entry, as a list, for the comparison. */
function list(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/**
 * What a form holds that its entry does not: the fields changed, and those
 * emptied. An untouched field is left out, so that putting the draft back
 * writes nothing of what someone else may have changed meanwhile.
 *
 * A password is never kept, whatever was typed: it is typed again.
 *
 * @param fields the form's editable fields, by attribute
 * @param values what the form holds now
 * @param entry the entry edited; absent for a creation
 * @returns the values, by attribute, and the attributes emptied
 */
export function changed(
  fields: [string, SchemaAttribute][],
  values: Values,
  entry?: Entry
): FormDraft {
  const kept: Record<string, string[]> = {};
  const cleared: string[] = [];
  for (const [name, attr] of fields) {
    if (isPassword(attr)) continue;
    const current = values[name] ?? [];
    const before = list(entryValue(entry, name));
    if (current.length === 0) {
      if (before.length > 0) cleared.push(name);
      continue;
    }
    if (
      current.length === before.length &&
      current.every((value, index) => value === before[index])
    )
      continue;
    kept[name] = [...current];
  }
  return { values: kept, cleared };
}

/**
 * The notice above a form put back from a draft, or nothing.
 *
 * @param notice what to say, when a draft was put back
 */
export function noticeMarkup(notice?: string): SafeHtml {
  return notice
    ? html`<p class="dc-form-notice" role="status">${notice}</p>`
    : html``;
}

/**
 * Put back what a draft held: the values typed, and the fields emptied. A
 * password is left as the entry has it, a draft never holding one; a field
 * the form does not show is left out.
 *
 * @param fields the form's editable fields, by attribute
 * @param values what the form holds, which the draft fills
 * @param draft what the form held before the page was reloaded
 */
export function putBack(
  fields: [string, SchemaAttribute][],
  values: Values,
  draft: FormDraft
): void {
  const byName = new Map(fields);
  const put = (name: string, list: string[]): void => {
    const attr = byName.get(name);
    if (attr && !isPassword(attr)) values[name] = list;
  };
  for (const [name, list] of Object.entries(draft.values))
    if (Array.isArray(list)) put(name, list.map(String));
  for (const name of draft.cleared) put(name, []);
}
