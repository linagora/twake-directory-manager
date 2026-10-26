/**
 * The question the console asks before an action it cannot take back, drawn
 * in the side panel as an alert dialog while it asks: its markup, the role's
 * switch, and `DialogService`, which asks it and gives back the panel it
 * covered (#220).
 *
 * @module twake-directory-manager/console/dialog
 */

import { html, render, type SafeHtml } from '../shared/html';
import type { Confirmation } from '../types';
import type { PanelService } from './panel';

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

/**
 * Asks before an action that cannot be taken back, in the centred panel.
 * The browser's own confirm() named an entry by its identifier alone, said
 * nothing of what went with it, and spoke the browser's language with
 * buttons in the browser's order.
 */
export class DialogService {
  /**
   * @param panel the side panel the question is asked in
   * @param t the translator's `t` as it is when asked
   */
  constructor(
    private readonly panel: PanelService,
    private readonly t: (key: string) => string
  ) {}

  /**
   * Ask a question. The focus starts on Cancel, so an Enter pressed out of
   * habit deletes nothing, and Escape cancels. Asked over an open panel, a
   * policy's form, the dialog gives that panel back as it was once
   * answered.
   *
   * @param question what to ask
   * @returns whether the action was confirmed
   */
  confirm(question: Confirmation): Promise<boolean> {
    const { panel, heading, body, dialog } = this.panel.parts();
    if (!panel || !heading || !body || !dialog) return Promise.resolve(false);
    const covered = this.panel.hold();
    return new Promise(resolve => {
      let answered = false;
      let boxes: HTMLInputElement[] = [];
      const answer = (confirmed: boolean): void => {
        if (answered) return;
        answered = true;
        // Read before the panel gives its body back or is emptied.
        question.choices?.options.forEach((option, index) => {
          if (boxes[index]) option.checked = boxes[index].checked;
        });
        this.panel.setGuard(null);
        // An alert dialog only while it asks.
        markAlert(dialog, false);
        if (covered) this.panel.restore(covered);
        else this.panel.close(true);
        resolve(confirmed);
      };
      this.panel.open(
        question.title,
        inner => {
          render(inner, confirmMarkup(question, this.t('app.cancel')));
          boxes = Array.from(
            inner.querySelectorAll<HTMLInputElement>('[data-confirm-choice]')
          );
          inner
            .querySelector('[data-cancel]')
            ?.addEventListener('click', () => answer(false));
          inner
            .querySelector('[data-confirm]')
            ?.addEventListener('click', () => answer(true));
          inner
            .querySelector('[data-confirm-alternative]')
            ?.addEventListener('click', () => {
              answer(false);
              question.alternative?.run();
            });
        },
        true
      );
      // The form it covers still holds what a reload would lose.
      this.panel.setDirty(covered?.dirty ?? null);
      markAlert(dialog, true);
      // Escape, the close button and a page left all cancel.
      this.panel.setGuard((): boolean => {
        answer(false);
        return false;
      });
      body.querySelector<HTMLElement>('[data-cancel]')?.focus();
    });
  }
}
