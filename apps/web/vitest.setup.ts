import '@testing-library/jest-dom/vitest';

/**
 * Radix's Popover measures its trigger and positions itself with the
 * ResizeObserver / matchMedia APIs, neither of which jsdom implements.
 * Without these stubs a popover test fails on the environment rather than on
 * the component.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as never;

// jsdom has no layout engine, so these are undefined on every element.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
