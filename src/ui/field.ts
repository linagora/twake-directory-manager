/**
 * What a form field shares, whichever form draws it (#226): its help, and
 * the hint that says the format it expects. The help is a button, so that
 * the keyboard reaches it (#216): shown while it has the focus or the
 * pointer, or once pressed, and dismissed with Escape until it is left. The
 * field's control is described by both texts, which is how a screen reader
 * hears them without the button or the grey line.
 *
 * @module twake-directory-manager/ui/field
 */

import { html, type SafeHtml } from '../shared/html';

/**
 * The grey line under a field saying the format it expects.
 *
 * @param id the text's id, which the control is described by
 * @param hint the text
 * @returns the markup
 */
export function hintMarkup(id: string, hint: string): SafeHtml {
  return html`<p class="dc-hint" id="${id}" data-hint>${hint}</p>`;
}

/**
 * Add an id to a control's accessible description, keeping what already
 * describes it.
 *
 * @param control the box, select or picker input
 * @param id the element describing it
 */
export function describeControl(control: HTMLElement, id: string): void {
  const described = control.getAttribute?.('aria-describedby') || '';
  control.setAttribute('aria-describedby', `${described} ${id}`.trim());
}

/**
 * Describe a field's control by its hint, then its help when it has one.
 * The identifier preview adds itself later, as the field changes.
 *
 * @param wrapper the field's element
 * @param name the attribute name, for the help's id
 * @param help whether the form drew a help for the field
 * @returns its control, if it has one
 */
export function describeField(
  wrapper: HTMLElement,
  name: string,
  help: boolean
): HTMLInputElement | HTMLSelectElement | null {
  const control = wrapper.querySelector<HTMLInputElement | HTMLSelectElement>(
    '.dc-input'
  );
  if (!control) return null;
  const hint = wrapper.querySelector<HTMLElement>('[data-hint]');
  if (hint) describeControl(control, hint.id);
  if (help) describeControl(control, `dc-help-${name}`);
  return control;
}

/**
 * The help of a field: the button, and the text it shows.
 *
 * @param id the text's id, which the field's control is described by
 * @param name what the button is called, "Help on Employee ID"
 * @param help the text
 * @returns the markup, placed after the field's label
 */
export function helpMarkup(id: string, name: string, help: string): SafeHtml {
  return html`<button type="button" class="dc-help" aria-label="${name}"
      aria-describedby="${id}" aria-expanded="false">?</button>
    <span class="dc-tooltip" role="tooltip" id="${id}">${help}</span>`;
}

/**
 * Wire a field's help: pressed, it stays shown; Escape hides it and leaves
 * the form open (the panel ignores an Escape spent here); leaving it, by the
 * keyboard or the pointer, puts it back as it was.
 *
 * @param wrapper the field's element, holding the button and the text
 */
export function bindHelp(wrapper: HTMLElement): void {
  const help = wrapper.querySelector<HTMLElement>('.dc-help');
  const tip = wrapper.querySelector<HTMLElement>('.dc-tooltip');
  if (!help || !tip) return;
  const focused = (): boolean => document.activeElement === help;
  /** Whether the text is on screen: pressed open, or under the keyboard's focus or the pointer and not dismissed. */
  const shown = (): boolean => {
    if (help.getAttribute('aria-expanded') === 'true') return true;
    if (tip.classList.contains('dc-dismissed')) return false;
    try {
      return help.matches(':focus-visible, :hover');
    } catch {
      return false;
    }
  };
  const hide = (): void => {
    tip.classList.add('dc-dismissed');
    help.setAttribute('aria-expanded', 'false');
  };
  const reset = (): void => {
    tip.classList.remove('dc-dismissed');
    help.setAttribute('aria-expanded', 'false');
  };
  help.addEventListener('click', () => {
    // Pressed again, the text goes although the focus still shows it.
    if (help.getAttribute('aria-expanded') === 'true') hide();
    else {
      tip.classList.remove('dc-dismissed');
      help.setAttribute('aria-expanded', 'true');
    }
  });
  help.addEventListener('keydown', event => {
    // An Escape with nothing to hide is the panel's, which it closes.
    if (event.key !== 'Escape' || !shown()) return;
    event.preventDefault();
    hide();
  });
  help.addEventListener('blur', reset);
  help.parentElement?.addEventListener('mouseleave', () => {
    // The pointer leaving changes nothing for a help the keyboard holds.
    if (!focused()) reset();
  });
}
