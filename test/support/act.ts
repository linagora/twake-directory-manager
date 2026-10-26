/**
 * What a test does to a mounted console, as the reader would: a click, a key
 * pressed where the focus is, a value typed; and the waits for what the
 * console does once the server answers (#221).
 */

/** Click what the selector finds in the element, which must be there. */
export function click(root: ParentNode, selector: string): void {
  const found = root.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`no ${selector}`);
  found.click();
}

/**
 * Press a key where the focus is: it bubbles up to the document, where the
 * console listens for the panel's keys.
 *
 * @param key the key, as `KeyboardEvent.key` names it
 * @param shiftKey whether Shift is held
 * @returns whether something prevented the key's default
 */
export function press(key: string, shiftKey = false): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event.defaultPrevented;
}

/** Type a value into a field, focused first, as the reader does. */
export function type(
  field: HTMLInputElement | HTMLTextAreaElement | null,
  value: string
): void {
  if (!field) throw new Error('no field');
  field.focus();
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Wait for what the console does once the server answers; a second at most. */
export async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (done()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('waited a second in vain');
}

/** An answer of the server held back until the test lets it go. */
export function gate(): { opened: Promise<void>; open(): void } {
  let open = (): void => undefined;
  const opened = new Promise<void>(resolve => (open = resolve));
  return { opened, open: () => open() };
}

/** The side panel of a mounted console. */
export function panelOf(root: HTMLElement): {
  panel: HTMLElement;
  dialog: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
} {
  const find = (selector: string): HTMLElement => {
    const found = root.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`no ${selector}`);
    return found;
  };
  return {
    panel: find('[data-panel]'),
    dialog: find('[data-panel-dialog]'),
    title: find('[data-panel-title]'),
    body: find('[data-panel-body]'),
  };
}
