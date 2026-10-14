import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SiteBrowserBounds, SiteSelection } from "@box/contracts";
import { isDesktop } from "@/shared/lib/runtime";
import { readSiteSelection } from "@/entities/site-browser";
import { errorMessage } from "@/entities/document";
import type { BrowserViewState, SiteBrowserController } from "../model/site-browser-controller";

export function siteBounds(rect: Pick<DOMRect, "left" | "top" | "right" | "bottom">, width: number, height: number): SiteBrowserBounds | null {
  const x = Math.max(0, rect.left), y = Math.max(0, rect.top);
  const right = Math.min(width, rect.right), bottom = Math.min(height, rect.bottom);
  if (right - x < 120 || bottom - y < 80) return null;
  return { x, y, width: right - x, height: bottom - y, viewportWidth: width, viewportHeight: height };
}
export function SiteBrowser({ controller, state, visible, blocked, documentBusy, documentError, onDismissDocumentError, onScrap, onClose }: {
  controller: SiteBrowserController;
  state: BrowserViewState;
  visible: boolean;
  blocked: boolean;
  documentBusy: boolean;
  documentError: string | null;
  onDismissDocumentError(): void;
  onScrap(selection: SiteSelection, capturedAt: string, onCreated: () => void): void;
  onClose(): void;
}) {
  const region = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState("");
  const editing = useRef(false);
  const addressDirty = useRef(false);
  const [slow, setSlow] = useState(false);
  const [space, setSpace] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [scrapError, setScrapError] = useState<string | null>(null);
  const scrapAttempt = useRef<{ fingerprint: string; capturedAt: string } | null>(null);
  useEffect(() => {
    if (state.requestedAddress !== null) { editing.current = false; addressDirty.current = false; setAddress(state.requestedAddress); }
  }, [state.requestedAddress]);
  useEffect(() => {
    if (editing.current || addressDirty.current) return;
    if (state.requestedAddress !== null) setAddress(state.requestedAddress);
    else if (!state.busy && !state.error && state.page.url) setAddress(state.page.url);
  }, [state.page.url, state.busy, state.error, state.requestedAddress]);
  useEffect(() => {
    setSlow(false);
    if (!state.page.loading) return;
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [state.page.loading, state.page.url, state.busy]);
  useLayoutEffect(() => {
    if (!isDesktop()) return;
    const measure = () => {
      const bounds = visible && !blocked && region.current
        ? siteBounds(region.current.getBoundingClientRect(), window.innerWidth, window.innerHeight) : null;
      setSpace(Boolean(bounds)); controller.setLayout(bounds, visible && !blocked && !bounds);
    };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (region.current) resize?.observe(region.current);
    window.addEventListener("resize", measure);
    return () => { resize?.disconnect(); window.removeEventListener("resize", measure); };
  }, [controller, visible, blocked]);
  const disabled = blocked || !state.ready || state.busy || !isDesktop() || !space;
  const act = (action: "back" | "forward" | "reload") => { editing.current = false; addressDirty.current = false; controller.act(action); };
  const scrap = async () => {
    if (disabled || documentBusy || scraping || !state.page.open || state.page.loading) return;
    setScraping(true); setScrapError(null);
    try {
      const selection = await readSiteSelection();
      const fingerprint = JSON.stringify([selection.url, selection.title, selection.text]);
      const capturedAt = scrapAttempt.current?.fingerprint === fingerprint
        ? scrapAttempt.current.capturedAt : new Date().toISOString();
      scrapAttempt.current = { fingerprint, capturedAt };
      onScrap(selection, capturedAt, () => { scrapAttempt.current = null; });
    } catch (cause) {
      setScrapError(errorMessage(cause));
    } finally { setScraping(false); }
  };
  return <section className="workspace-main site-browser-panel" hidden={!visible} aria-label="사이트 브라우저 화면">
    <header className="site-browser-heading">
      <div className="site-browser-title"><span className="file-label">BROWSE · 사이트</span><h1 title={state.page.title}>{state.page.title || "사이트 브라우저"}</h1></div>
      <button className="plain-button" type="button" onClick={onClose}>문서로 돌아가기</button>
      <form className="site-browser-toolbar" onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && controller.navigate(address)) { editing.current = false; addressDirty.current = false; }
      }}>
        <div className="site-browser-navigation">
          <button type="button" aria-label="사이트 뒤로" title="뒤로" disabled={disabled || !state.page.open || state.page.canGoBack === false} onClick={() => act("back")}>←</button>
          <button type="button" aria-label="사이트 앞으로" title="앞으로" disabled={disabled || !state.page.open || state.page.canGoForward === false} onClick={() => act("forward")}>→</button>
          <button type="button" aria-label="사이트 새로고침" title="새로고침" disabled={disabled || !state.page.open} onClick={() => act("reload")}>↻</button>
        </div>
        <input aria-label="사이트 주소" type="text" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https:// 또는 사이트 주소" value={address} disabled={disabled} onFocus={() => { editing.current = true; }} onBlur={() => { editing.current = false; }} onChange={(event) => { editing.current = true; addressDirty.current = true; setAddress(event.target.value); }} />
        <button type="submit" disabled={disabled || !address.trim()}>이동</button>
        <button type="button" disabled={disabled || documentBusy || scraping || !state.page.open || state.page.loading} onClick={() => void scrap()}>{scraping ? "선택 확인 중…" : "선택 영역 스크랩"}</button>
      </form>
    </header>
    <div className="site-browser-content" ref={region} aria-label="사이트 표시 영역">
      {!isDesktop() ? <div className="site-browser-empty"><span>↗</span><h2>사이트를 살펴보는 공간</h2><p>사이트 탐색은 box.md 데스크톱 앱에서 사용할 수 있습니다.</p></div>
        : !space && visible && !blocked ? <div className="site-browser-empty"><p>창을 넓히거나 채팅을 닫으면 사이트가 다시 표시됩니다.</p></div>
        : !state.page.open ? <div className="site-browser-empty"><span>↗</span><h2>새로운 생각을 찾아서</h2><p>주소를 입력해 사이트를 열어보세요.<br />작성 중인 문서는 그대로 보관됩니다.</p></div> : null}
    </div>
    <footer className="site-browser-status" aria-live="polite">
      <span>{scrapError || documentError || state.error || (blocked ? "페이지를 잠시 숨겼습니다." : slow ? "페이지 응답이 늦어지고 있습니다. 주소를 확인하거나 다시 불러오세요." : state.busy || state.page.loading ? "페이지를 불러오는 중…" : state.page.url || "문서와 사이트를 오가며 살펴보세요.")}</span>
      {scrapError || documentError ? <button type="button" disabled={documentBusy || scraping} onClick={() => { onDismissDocumentError(); void scrap(); }}>스크랩 다시 시도</button>
        : state.error && <button type="button" onClick={() => controller.retry()}>상태 다시 확인</button>}
    </footer>
  </section>;
}
