/**
 * The side panel: the frame's one overlay for every form, what Tab reaches
 * in it, and `PanelService`, which opens and closes it and holds what the
 * form open in it asks of the console — not to be closed, the reader warned
 * before a reload, a late password waiting its turn (#220).
 *
 * @module twake-directory-manager/console/panel
 */

import { html, render, type SafeHtml } from '../shared/html';
import { announcerMarkup } from '../ui/announce';

/** What Tab can reach in the side panel. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * What Tab reaches in an element: its enabled controls not hidden.
 *
 * @param root the element
 * @returns the controls, in the page's order
 */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    element => !element.closest('[hidden]')
  );
}

/**
 * Where a panel's focus starts: its first control, but not a field's help
 * button, which stands before the field and is not where a form starts.
 *
 * @param body the panel's body
 * @returns the control, or null for a panel with none
 */
export function firstFocus(body: HTMLElement): HTMLElement | null {
  return focusables(body).find(item => !item.matches?.('.dc-help')) ?? null;
}

/**
 * Where a Tab pressed in an open panel takes the focus, or null to leave it
 * to the browser. The focus stays in the dialog: past its last control it
 * comes back to the first, and the other way with Shift. From a place the
 * dialog focused for the screen reader — the lead of an import step, no
 * control itself — it goes on to the next control in the page's order, or
 * back to the one before, rather than to the ends.
 *
 * @param dialog the panel's dialog
 * @param active what has the focus
 * @param back whether Shift is held
 * @returns what to focus, or null when the browser's own Tab is right
 */
export function tabTarget(
  dialog: HTMLElement,
  active: HTMLElement | null,
  back: boolean
): HTMLElement | null {
  const items = focusables(dialog);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first) return dialog;
  if (active && items.includes(active))
    return active === (back ? first : last) ? (back ? last : first) : null;
  if (active && dialog.contains?.(active)) {
    const after = (item: HTMLElement): boolean =>
      !!(
        active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    const following = items.filter(after);
    const preceding = items.filter(item => !after(item));
    return back
      ? (preceding[preceding.length - 1] ?? last)
      : (following[0] ?? first);
  }
  return back ? last : first;
}

/**
 * What the frame lays over the page: the side panel, a dialog the keyboard
 * stays in while it is open; the toast region, a live region that says each
 * message as it shows; and the hidden region of `announce`. Drawn once with
 * the frame; the console fills the panel and binds its close.
 *
 * @param close what the close button is called
 * @returns the markup
 */
export function overlayMarkup(close: string): SafeHtml {
  return html`<div class="dc-panel" data-panel hidden>
      <div class="dc-panel-inner" data-panel-dialog role="dialog"
        aria-modal="true" aria-labelledby="dc-panel-title" tabindex="-1">
        <header class="dc-panel-header">
          <h2 id="dc-panel-title" data-panel-title></h2>
          <button type="button" class="dc-icon-button" data-panel-close
            aria-label="${close}">×</button>
        </header>
        <div class="dc-panel-body" data-panel-body></div>
      </div>
    </div>
    <div data-toast-region role="status" aria-live="polite" aria-atomic="true">
      <div class="dc-toast" data-toast hidden></div>
    </div>
    ${announcerMarkup()}`;
}

/** The frame's elements the panel is made of, found in the console's container. */
export interface PanelParts {
  panel: HTMLElement | null;
  heading: HTMLElement | null;
  body: HTMLElement | null;
  dialog: HTMLElement | null;
}

/**
 * What a question laid over an open panel took from it, to give it back as
 * it was once answered (`PanelService.hold`, `restore`).
 */
export interface HeldPanel {
  readonly title: string;
  readonly nodes: Node[];
  readonly modal: boolean;
  readonly wide: boolean;
  readonly guard: (() => boolean) | null;
  /** Whether the form taken aside holds what a reload would lose */
  readonly dirty: (() => boolean) | null;
  readonly closed: (() => void) | null;
  readonly focus: HTMLElement | null;
  /** The elements taken aside, given back as they are: those the question was asked in */
  readonly parts: PanelParts;
}

/**
 * The side panel the console opens every form in: one body for them all,
 * filled by the form, emptied on close.
 *
 * It holds what the panel open now asks of the console, and nothing else
 * reads it: a guard that may refuse the close (the discard question, a
 * generated password not copied, work under way), whether the form holds
 * what a reload would lose, a hook told when this panel goes, what waits for
 * the panel to close before it opens, and where the focus goes back to.
 *
 * Like the toast, it finds its elements each time it is asked, in the
 * container a function gives: the frame is drawn anew on a language switch,
 * and a panel kept open over it is the element put back in.
 */
export class PanelService {
  /**
   * What had the focus when the side panel opened, given it back on close:
   * a keyboard user is otherwise left at the top of the page.
   */
  private opener: HTMLElement | null = null;
  /**
   * Asked before the side panel closes, when it holds what cannot be shown
   * again: `false` keeps it open. Each panel opens without one.
   */
  private guard: (() => boolean) | null = null;
  /** Whether the form in the panel holds what closing it would lose */
  private dirty: (() => boolean) | null = null;
  /** The address changed: the page the panel belongs to is gone */
  private navigating = false;
  /** What waits for the panel to close before it opens: a late password */
  private readonly after: (() => void)[] = [];
  /**
   * Told when the panel open now closes, or another replaces it: an action
   * that waits on its panel, as the list's bulk actions do
   */
  private closed: (() => void) | null = null;

  /**
   * @param root finds the console's container, which holds the frame
   * @param t the translator's `t` as it is when asked, for the discard
   *   question's words
   */
  constructor(
    private readonly root: () => HTMLElement | null | undefined,
    private readonly t: (key: string) => string
  ) {}

  /** The panel's elements, as the frame drew them; null for one missing. */
  parts(): PanelParts {
    const find = (selector: string): HTMLElement | null =>
      this.root()?.querySelector<HTMLElement>(selector) ?? null;
    return {
      panel: find('[data-panel]'),
      heading: find('[data-panel-title]'),
      body: find('[data-panel-body]'),
      dialog: find('[data-panel-dialog]'),
    };
  }

  /** Whether the panel is on screen. */
  isOpen(): boolean {
    return this.parts().panel?.hidden === false;
  }

  /** Whether the panel is open on a form holding what closing it would lose. */
  isDirty(): boolean {
    return this.isOpen() && !!this.dirty?.();
  }

  /**
   * Show the overlay.
   *
   * A long form docks to the side, so its Save button stays put instead of
   * scrolling off the bottom of a modal — that was the complaint the brief
   * makes. A form of three fields does not need half the screen, and reads
   * better centred, which is what `modal` asks for.
   *
   * @param title heading of the overlay
   * @param build fills the body
   * @param modal centre it rather than docking it to the side
   * @param wide give it the room of a table
   */
  open(
    title: string,
    build: (body: HTMLElement) => void,
    modal = false,
    wide = false
  ): void {
    const { panel, heading, body, dialog } = this.parts();
    if (!panel || !heading || !body) return;
    // A panel opened over another keeps the first one's opener: that is
    // where the reader was before any panel.
    if (panel.hidden && typeof document !== 'undefined')
      this.opener = document.activeElement as HTMLElement | null;
    const replaced = this.closed;
    this.closed = null;
    replaced?.();
    heading.textContent = title;
    this.guard = null;
    this.dirty = null;
    panel.classList.toggle('dc-panel-modal', modal);
    panel.classList.toggle('dc-panel-wide', wide);
    render(body, html``);
    build(body);
    panel.hidden = false;
    // One body serves every form, and a hidden one keeps the offset the last
    // form was left at: the next would open scrolled past its first fields.
    // Reset once shown, since an element with no box ignores the write.
    body.scrollTop = 0;
    // Into the panel, on its first field: left on the button that opened
    // it, the keyboard went on through the page behind it. A panel with no
    // field holds the focus itself.
    (firstFocus(body) ?? dialog)?.focus();
  }

  /**
   * Close the side panel, unless what it holds asks to stay.
   *
   * What it held goes with it: hidden, a password typed or generated in it
   * stayed in the page, for any script or open developer tools to read, until
   * the next panel replaced it.
   *
   * @param force close it whatever it holds
   */
  close(force = false): void {
    const { panel, body } = this.parts();
    if (!panel || panel.hidden) return;
    if (!force && this.guard && !this.guard()) return;
    this.guard = null;
    this.dirty = null;
    panel.hidden = true;
    if (body) render(body, html``);
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) opener.focus();
    const closed = this.closed;
    this.closed = null;
    closed?.();
    this.after.shift()?.();
  }

  /**
   * Close the panel because the address changed: the page it belongs to is
   * gone, and a changed form is not asked about — kept over the new page, it
   * would save into an entry no longer on screen. A guard of another kind
   * (work under way, a password not copied) still holds it.
   */
  closeOnNavigation(): void {
    this.navigating = true;
    try {
      this.close();
    } finally {
      this.navigating = false;
    }
  }

  /**
   * Keep the keyboard in the side panel while it is open, and close it on
   * Escape. Listened to on the document, so that Tab is caught even once
   * the focus has strayed onto the backdrop.
   *
   * @param event the key pressed
   */
  key(event: KeyboardEvent): void {
    const { panel, dialog } = this.parts();
    if (!panel || panel.hidden || !dialog) return;
    if (event.key === 'Escape') {
      // A control that answers Escape itself, such as a picker closing its
      // suggestions, prevents its default: that press is spent.
      if (event.defaultPrevented) return;
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const target = tabTarget(
      dialog,
      document.activeElement as HTMLElement | null,
      event.shiftKey
    );
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  /**
   * Ask, before the panel closes, whether it may: `false` keeps it open.
   * Each panel opens without one; null takes the one set away.
   */
  setGuard(guard: (() => boolean) | null): void {
    this.guard = guard;
  }

  /**
   * Say whether the form in the panel holds what closing it would lose: a
   * reload then asks first. Each panel opens without one.
   */
  setDirty(dirty: (() => boolean) | null): void {
    this.dirty = dirty;
  }

  /**
   * Be told when the panel open now closes, or another replaces it: an
   * action that waits on its panel. Set once that panel is open.
   */
  whenClosed(closed: () => void): void {
    this.closed = closed;
  }

  /** Run something once the panel open now is closed: one at each close. */
  afterClose(next: () => void): void {
    this.after.push(next);
  }

  /** Run something now, or once the panel open now is closed. */
  whenFree(next: () => void): void {
    if (this.isOpen()) this.afterClose(next);
    else next();
  }

  /**
   * Give the focus back, on close, to this element rather than to the one
   * that had it when the panel opened: that one was drawn anew meanwhile.
   */
  returnFocusTo(element: HTMLElement | null): void {
    this.opener = element;
  }

  /**
   * Take the open panel aside for a question laid over it: what it shows
   * and what it asks of the console, to give back with `restore`. Its close
   * hook is not told, now or when the question goes: a question over a
   * panel does not close it.
   *
   * @returns what was taken, or nothing when the panel was closed
   */
  hold(): HeldPanel | undefined {
    const parts = this.parts();
    const { panel, heading, body } = parts;
    const held =
      !panel || panel.hidden || !heading || !body
        ? undefined
        : {
            parts,
            title: heading.textContent ?? '',
            nodes: Array.from(body.childNodes),
            modal: panel.classList.contains('dc-panel-modal'),
            wide: panel.classList.contains('dc-panel-wide'),
            guard: this.guard,
            dirty: this.dirty,
            closed: this.closed,
            focus: document.activeElement as HTMLElement | null,
          };
    this.closed = null;
    return held;
  }

  /**
   * Give the panel back as `hold` took it: its title, its size, its
   * content, what it asked of the console, and the focus where it was, or
   * on the panel itself.
   *
   * @param held what `hold` returned
   */
  restore(held: HeldPanel): void {
    const { panel, heading, body, dialog } = held.parts;
    if (heading) heading.textContent = held.title;
    panel?.classList.toggle('dc-panel-modal', held.modal);
    panel?.classList.toggle('dc-panel-wide', held.wide);
    body?.replaceChildren(...held.nodes);
    this.guard = held.guard;
    this.dirty = held.dirty;
    this.closed = held.closed;
    (held.focus?.isConnected ? held.focus : dialog)?.focus();
  }

  /**
   * Ask before a form loses what was typed in it: Escape, the panel's × and
   * Cancel closed a long form at once, and the Escape that closes a list of
   * suggestions is a press away from the one that closed the panel. The
   * question takes the place of the form's actions, as the generated
   * password's does; a second Escape, or Discard, closes.
   *
   * @param body the panel's body, holding the form
   * @param dirty whether the form holds what closing it would lose
   */
  guardDiscard(body: HTMLElement, dirty: () => boolean): void {
    const t = this.t;
    let asking: HTMLElement | null = null;
    let before: HTMLElement | null = null;
    const actions = (): HTMLElement | null =>
      body.querySelector<HTMLElement>('.dc-form-actions');
    const keep = (): void => {
      asking?.remove();
      asking = null;
      const row = actions();
      if (row) row.hidden = false;
      (before?.isConnected
        ? before
        : row?.querySelector<HTMLElement>('button')
      )?.focus();
    };
    this.dirty = dirty;
    this.guard = (): boolean => {
      if (asking || this.navigating || !dirty()) return true;
      const row = actions();
      if (!row || typeof document === 'undefined') return true;
      before = document.activeElement as HTMLElement | null;
      row.hidden = true;
      asking = document.createElement('div');
      asking.className = 'dc-form-leave';
      asking.setAttribute('data-discard', '');
      // The question is read with the button it moves the focus to: "Keep
      // editing" alone said nothing of why the form did not close (#217).
      asking.setAttribute('role', 'group');
      asking.setAttribute('aria-labelledby', 'dc-discard-question');
      render(
        asking,
        html`
        <p id="dc-discard-question">${t('form.discardQuestion')}</p>
        <button type="button" class="dc-button" data-discard-keep
          aria-describedby="dc-discard-question">${t(
            'form.keepEditing'
          )}</button>
        <button type="button" class="dc-button dc-button-danger" data-discard-confirm>${t(
          'form.discard'
        )}</button>`
      );
      row.after(asking);
      asking
        .querySelector('[data-discard-keep]')
        ?.addEventListener('click', keep);
      asking
        .querySelector('[data-discard-confirm]')
        ?.addEventListener('click', () => this.close(true));
      asking.querySelector<HTMLElement>('[data-discard-keep]')?.focus();
      return false;
    };
  }
}
