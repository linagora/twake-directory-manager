/**
 * The toast: what everyone sees for a moment, said as it shows (#226). Its
 * region is drawn with the frame; the hidden one of `announce` says what the
 * eye reads at once without a toast.
 *
 * @module twake-directory-manager/ui/toast
 */

/**
 * The console's one toast element: a message, then hidden after a while.
 *
 * Every message replaces the previous one, and so must its timer. A timer left
 * running from an earlier message hid the next one early. Nothing that cannot
 * be shown again goes here: a generated password stays in its panel.
 *
 * It sits in a live region drawn with the shell, so that a screen reader
 * says each message as it shows: a region that is hidden, or new, when its
 * text changes is not announced. A refusal interrupts; the others wait.
 */
export class ToastController {
  private timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * @param element finds the toast element, which survives re-renders
   * @param delay how long a message stays, in milliseconds
   */
  constructor(
    private readonly element: () => HTMLElement | null | undefined,
    private readonly delay = 5000
  ) {}

  /** Show a message. */
  show(message: string, isError = false): void {
    const toast = this.element();
    if (!toast) return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    toast
      .closest?.('[data-toast-region]')
      ?.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    toast.classList.toggle('dc-toast-error', isError);
    // Shown before it is written, for the region to announce the text.
    toast.hidden = false;
    toast.textContent = message;
    this.timer = setTimeout((): void => {
      this.timer = undefined;
      toast.hidden = true;
    }, this.delay);
  }
}
