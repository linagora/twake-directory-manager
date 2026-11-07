/**
 * What the console calls a collection and the button creating one of its
 * entries. A deployment names its own entities, so both follow the schema's
 * labels in the interface's language; the catalogue names the creations it
 * knows, with the article the language needs.
 *
 * @module twake-directory-manager/console/labels
 */

import { resolveText } from '../format';
import type { Translator } from '../i18n';
import type { EntityDescriptor } from '../types';

/**
 * What to call one entry of a collection.
 *
 * @param translator the interface's translator
 * @param entity entity to name
 * @returns the singular name to show
 */
export function singularName(
  translator: Translator,
  entity: EntityDescriptor
): string {
  return (
    resolveText(entity.singularLabel, translator.language) ||
    entity.singularName
  );
}

/**
 * What the button and the panel creating an entry of an entity read. The
 * catalogue may name it for an entity it knows: French puts an article that
 * agrees with the noun, _Créer une organisation_, which a template around
 * the schema's name cannot.
 *
 * @param translator the interface's translator
 * @param entity entity an entry is created in
 * @returns the label
 */
export function createLabel(
  translator: Translator,
  entity: EntityDescriptor
): string {
  const own = `dashboard.create.${entity.key}`;
  const label = translator.t(own);
  return label !== own
    ? label
    : translator.t('dashboard.create', {
        entity: singularName(translator, entity),
      });
}
