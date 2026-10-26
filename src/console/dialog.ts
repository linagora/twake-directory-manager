/**
 * The question the console asks before an action it cannot take back, drawn
 * in the side panel as an alert dialog while it asks. Markup and the role's
 * switch only; the console owns the panel and the answer.
 *
 * @module twake-directory-manager/console/dialog
 */

import { html, type SafeHtml } from '../shared/html';
import type { Confirmation } from '../types';

/**
 * The body of the question: its paragraphs, the names it lists, the choices
 * that go with the action, a safer alternative, and the two buttons.
 *
 * @param question what is asked
 * @param cancel what the cancel button is called
 * @returns the markup
 */
export function confirmMarkup(
  question: Confirmation,
  cancel: string
): SafeHtml {
  return html`
    <div class="dc-confirm" id="dc-confirm-body" data-confirm-body>
      ${question.lines.map(line => html`<p>${line}</p>`)}
      ${
        question.items?.length
          ? html`<ul class="dc-confirm-items">${question.items.map(
              item => html`<li>${item}</li>`
            )}</ul>`
          : ''
      }
    </div>
    ${
      question.choices?.options.length
        ? html`<fieldset class="dc-confirm-choices">
            <legend>${question.choices.title}</legend>
            ${question.choices.options.map(
              (option, index) => html`<label class="dc-field-inline">
                  <input type="checkbox" data-confirm-choice="${index}"${
                    option.checked ? ' checked' : ''
                  } />
                  <span>${option.label}</span>
                </label>`
            )}
          </fieldset>`
        : ''
    }
    ${
      question.alternative
        ? html`<p class="dc-confirm-alternative"><button type="button" class="dc-link" data-confirm-alternative>${
            question.alternative.label
          }</button></p>`
        : ''
    }
    <div class="dc-form-actions">
      <button type="button" class="dc-button" data-cancel>${cancel}</button>
      <button type="button" class="dc-button ${
        question.reversible ? 'dc-button-primary' : 'dc-button-destructive'
      }" data-confirm>${question.action}</button>
    </div>`;
}

/**
 * Make the panel's dialog an alert dialog described by the question, or a
 * plain dialog again once it is answered.
 *
 * @param dialog the panel's dialog
 * @param asking whether the question is on screen
 */
export function markAlert(dialog: Element, asking: boolean): void {
  if (asking) {
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-describedby', 'dc-confirm-body');
  } else {
    dialog.setAttribute('role', 'dialog');
    dialog.removeAttribute('aria-describedby');
  }
}
