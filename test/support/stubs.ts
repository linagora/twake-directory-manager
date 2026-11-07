/**
 * Hand-made stand-ins for what the console renders into, and a console built
 * with them: the unit suite has a DOM (test/support/dom.ts) but most of its
 * tests predate it and drive the code through these stubs, which record what
 * was written and answer the few DOM calls the code makes. New tests mount
 * into `document.body` instead (#221).
 */
export const baseUrl = 'http://localhost:8099';

/**
 * Make the screen hoverless, as a touch screen is, until the returned
 * function puts the browser's own back.
 */
export function pretendHoverless(): () => void {
  const media = window.matchMedia;
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: query === '(hover: none)',
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
  return () => {
    window.matchMedia = media;
  };
}

/** What a real element answers when there is nothing under it. */
function noElements(): NodeListOf<Element> {
  return document.createElement('div').querySelectorAll('*');
}

/** Minimal stand-in for the element a component renders into. */
export function stubContainer(): HTMLElement & { innerHTML: string } {
  return {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => noElements(),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLElement & { innerHTML: string };
}
