/**
 * What the tests share besides the DOM (test/support/dom.ts): the address
 * the console asks, and a hoverless screen. A component is rendered into a
 * real element now (`page()`), so no container stand-in is left (#221).
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
