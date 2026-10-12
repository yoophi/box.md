import type { SiteBrowserAction, SiteBrowserBounds, SiteBrowserSnapshot } from "@box/contracts";
import { actOnSite, layoutSite, openSite, readSite } from "@/entities/site-browser";
import { errorMessage } from "@/entities/document";

export interface BrowserViewState {
  page: SiteBrowserSnapshot;
  ready: boolean;
  busy: boolean;
  overlaySafe: boolean;
  error: string | null;
  requestedAddress: string | null;
}
type Control = { url: string } | { action: SiteBrowserAction };
/** One serialized native owner. Layout intent is coalesced and precedes all controls and reads. */
export class SiteBrowserController {
  private state: BrowserViewState = {
    page: { open: false, visible: false, url: null, title: "", loading: false, canGoBack: false, canGoForward: false },
    ready: false, busy: false, overlaySafe: false, error: null, requestedAddress: null,
  };
  private listeners = new Set<() => void>();
  private desired: SiteBrowserBounds | null = null;
  private layoutVersion = 0;
  private appliedVersion = -1;
  private presence = 0;
  private intent = 0;
  private running = false;
  private controlling = false;
  private mounted = false;
  private pending: Control | null = null;
  private readPending = false;
  private failed = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private hideWaiters: ((safe: boolean) => void)[] = [];
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(value: Partial<BrowserViewState>) { this.state = { ...this.state, ...value }; this.listeners.forEach((listener) => listener()); }
  start() {
    this.mounted = true;
    this.timer ??= setInterval(() => {
      if (this.desired && this.state.page.open && !this.failed) { this.readPending = true; void this.drain(); }
    }, 500);
    void this.drain();
  }
  stop() {
    this.mounted = false;
    clearInterval(this.timer); this.timer = undefined;
    this.setLayout(null);
  }
  setLayout(bounds: SiteBrowserBounds | null, keepPending = false) {
    if (!bounds && this.pending && !keepPending) { this.pending = null; this.patch({ busy: this.controlling, requestedAddress: null }); }
    if (JSON.stringify(this.desired) === JSON.stringify(bounds)) return;
    if (Boolean(this.desired) !== Boolean(bounds)) ++this.presence;
    this.desired = bounds; ++this.layoutVersion;
    if (this.state.page.open || this.running) this.patch({ overlaySafe: false });
    this.failed = false;
    void this.drain();
  }
  hide(): Promise<boolean> {
    this.setLayout(null);
    if (this.state.overlaySafe) return Promise.resolve(true);
    const result = new Promise<boolean>((resolve) => this.hideWaiters.push(resolve));
    this.retry();
    return result;
  }
  navigate(url: string) { return this.enqueue({ url }); }
  act(action: SiteBrowserAction) { return this.enqueue({ action }); }
  private enqueue(control: Control) {
    if (!this.mounted || (this.state.busy && "action" in control)) return false;
    this.pending = control; ++this.intent;
    this.failed = false; this.patch({ busy: true, error: null, requestedAddress: "url" in control ? control.url : null });
    void this.drain(); return true;
  }
  retry() {
    this.failed = false; this.appliedVersion = -1; this.readPending = true;
    this.patch({ error: null }); void this.drain();
  }
  private finishHide(safe: boolean) { this.hideWaiters.splice(0).forEach((resolve) => resolve(safe)); }
  private endControl() {
    this.controlling = false;
    const queued = this.pending;
    this.patch({ busy: Boolean(queued), requestedAddress: queued && "url" in queued ? queued.url : null });
  }
  private async drain() {
    if (this.running || this.failed) return;
    this.running = true;
    let attemptVersion = this.layoutVersion;
    let reconcile = false;
    try {
      if (!this.state.ready) {
        // A renderer reload may leave an existing native child alive. Confirm it hidden first.
        const page = await layoutSite(null);
        if (page.visible) throw new Error("사이트 숨김을 확인하지 못했습니다.");
        this.patch({ page, ready: true, overlaySafe: true });
        if (!this.desired) this.finishHide(true);
      }
      while (!this.failed) {
        const preparingAddress = this.pending && "url" in this.pending && this.desired && this.mounted;
        if (this.appliedVersion !== this.layoutVersion && !preparingAddress) {
          const version = this.layoutVersion, bounds = this.desired;
          attemptVersion = version;
          if (bounds && this.state.page.open) this.patch({ overlaySafe: false });
          const page = await layoutSite(bounds);
          if ((!bounds && page.visible) || (bounds && page.open && !page.visible)) throw new Error("사이트 표시 상태를 확인하지 못했습니다.");
          if (version === this.layoutVersion) {
            this.appliedVersion = version;
            this.patch({ page, overlaySafe: !bounds || !page.open });
            if (!bounds) this.finishHide(true);
          }
          continue;
        }
        if (this.pending && this.desired && this.mounted) {
          const control = this.pending, presence = this.presence, intent = this.intent;
          this.pending = null;
          this.controlling = true;
          try {
            const page = "url" in control ? await openSite(control.url, this.desired) : await actOnSite(control.action);
            if (presence === this.presence && intent === this.intent && this.mounted) this.patch({ page, error: null });
          } catch (cause) {
            if (presence === this.presence && intent === this.intent && this.mounted) this.patch({ error: errorMessage(cause) });
            this.readPending = true;
          } finally {
            // Open prepares a hidden view. Reconcile only the latest visibility, including a late hide.
            this.appliedVersion = -1;
            this.endControl();
          }
          continue;
        }
        if (this.readPending && this.mounted) {
          this.readPending = false;
          const intent = this.intent, presence = this.presence;
          attemptVersion = this.layoutVersion;
          const page = await readSite();
          if (intent === this.intent && presence === this.presence) this.patch({ page });
          continue;
        }
        break;
      }
    } catch (cause) {
      if (attemptVersion !== this.layoutVersion) { reconcile = true; return; }
      this.failed = true;
      this.pending = null;
      const message = errorMessage(cause);
      // A pre-browser backend cannot have created this child. Keep document dialogs usable.
      const missing = /Command site_browser_layout not found/i.test(message);
      this.patch({ error: missing ? "사이트 브라우저를 사용할 수 없습니다. 최신 앱을 다시 실행해주세요." : message, busy: false, requestedAddress: null, ...(missing ? { overlaySafe: true } : {}) });
      this.finishHide(false);
    } finally { this.running = false; if (reconcile) void this.drain(); }
  }
}
