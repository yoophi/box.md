import { invoke } from "@tauri-apps/api/core";
import type { SiteBrowserAction, SiteBrowserBounds, SiteBrowserSnapshot, SiteSelection } from "@box/contracts";

async function request(command: string, args?: Record<string, unknown>): Promise<SiteBrowserSnapshot> {
  const page = await invoke<SiteBrowserSnapshot>(command, args);
  if (!page || typeof page.open !== "boolean" || typeof page.visible !== "boolean" || typeof page.loading !== "boolean" || typeof page.title !== "string"
      || !(page.url === null || typeof page.url === "string") || !(page.canGoBack === null || typeof page.canGoBack === "boolean")
      || !(page.canGoForward === null || typeof page.canGoForward === "boolean") || (page.visible && !page.open))
    throw new Error("사이트 상태를 확인하지 못했습니다. 최신 앱을 다시 실행해주세요.");
  return page;
}
export const openSite = (url: string, bounds: SiteBrowserBounds) => request("site_browser_open", { url, bounds });
export const layoutSite = (bounds: SiteBrowserBounds | null) => request("site_browser_layout", { bounds });
export const actOnSite = (action: SiteBrowserAction) => request("site_browser_action", { action });
export const readSite = () => request("site_browser_snapshot");
export async function readSiteSelection(): Promise<SiteSelection> {
  const selection = await invoke<SiteSelection>("site_browser_selection");
  if (!selection || typeof selection.url !== "string" || typeof selection.title !== "string" || typeof selection.text !== "string" || !selection.url || !selection.text)
    throw new Error("사이트 선택 영역을 확인하지 못했습니다. 최신 앱을 다시 실행해주세요.");
  return selection;
}
