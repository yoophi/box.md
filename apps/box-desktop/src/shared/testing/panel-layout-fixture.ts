/** jsdom layout shim for real AW components; browser tests prove actual geometry. */
export function installPanelLayoutFixture(view: Window & typeof globalThis) {
  const prototype = view.HTMLElement.prototype;
  const width = Object.getOwnPropertyDescriptor(prototype, "offsetWidth")!;
  const rectangle = prototype.getBoundingClientRect;
  const observer = Object.getOwnPropertyDescriptor(view, "ResizeObserver");
  class PanelResizeObserver {
    private active = true;
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      queueMicrotask(() => {
        if (this.active && target.isConnected) this.callback([
          { target, borderBoxSize: [{ inlineSize: 1000, blockSize: 760 }] } as unknown as ResizeObserverEntry,
        ], this as unknown as ResizeObserver);
      });
    }
    unobserve() {}
    disconnect() { this.active = false; }
  }
  Object.defineProperty(view, "ResizeObserver", { configurable: true, value: PanelResizeObserver });
  Object.defineProperty(prototype, "offsetWidth", { configurable: true, get(this: HTMLElement) {
    if (this.hasAttribute("data-group")) return 1000;
    if (this.hasAttribute("data-panel")) return this.id === "box-agent-chat" ? 360 : 640;
    if (this.hasAttribute("data-separator")) return 1;
    return width.get?.call(this) ?? 0;
  } });
  prototype.getBoundingClientRect = function () {
    if (this.hasAttribute("data-group")) return new view.DOMRect(0, 0, 1000, 760);
    if (this.hasAttribute("data-separator")) return new view.DOMRect(640, 0, 1, 760);
    if (this.hasAttribute("data-panel")) return this.id === "box-agent-chat" ? new view.DOMRect(641, 0, 360, 760) : new view.DOMRect(0, 0, 640, 760);
    return rectangle.call(this);
  };
  return () => {
    Object.defineProperty(prototype, "offsetWidth", width);
    prototype.getBoundingClientRect = rectangle;
    if (observer) Object.defineProperty(view, "ResizeObserver", observer);
    else Reflect.deleteProperty(view, "ResizeObserver");
  };
}
