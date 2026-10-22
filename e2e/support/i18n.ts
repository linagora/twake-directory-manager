import { Translator } from '../../src/i18n';

/**
 * The console's own wording in a language, read from its catalogue (src/i18n.ts), for the
 * strings the test plan does not spell out: `t('fr', 'state.enabled')` is "Actif". What the
 * plan quotes is asserted as quoted.
 */
export function t(
  language: 'en' | 'fr' | 'mn',
  key: string,
  values?: Record<string, string | number>
): string {
  return new Translator(language).t(key, values);
}
