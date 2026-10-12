import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SiteBrowserBounds, SiteBrowserSnapshot } from "@box/contracts";
import { actOnSite, layoutSite, openSite, readSite } from "@/entities/site-browser";
import { SiteBrowserController } from "./site-browser-controller";
import { siteBounds } from "../ui/SiteBrowser";

vi.mock("@/entities/site-browser", () => ({ actOnSite: vi.fn(), layoutSite: vi.fn(), openSite: vi.fn(), readSite: vi.fn() }));
let page: SiteBrowserSnapshot;
const owners: SiteBrowserController[] = [];
const bounds: SiteBrowserBounds = { x: 230, y: 156, width: 870, height: 540, viewportWidth: 1100, viewportHeight: 760 };
beforeEach(() => {
  vi.clearAllMocks();
  page = { open: false, visible: false, url: null, title: "", loading: false, canGoBack: false, canGoForward: false };
  vi.mocked(layoutSite).mockImplementation(async (bounds) => { page.visible = page.open && Boolean(bounds); return structuredClone(page); });
  vi.mocked(readSite).mockImplementation(async () => structuredClone(page));
  vi.mocked(openSite).mockImplementation(async (url) => { page = { ...page, open: true, visible: false, url, title: "사이트" }; return structuredClone(page); });
  vi.mocked(actOnSite).mockImplementation(async () => structuredClone(page));
});
afterEach(async () => { owners.splice(0).forEach((owner) => owner.stop()); await new Promise((resolve) => setTimeout(resolve, 0)); });
async function owner() { const controller = new SiteBrowserController(); owners.push(controller); controller.start(); await vi.waitFor(() => expect(controller.getSnapshot().ready).toBe(true)); return controller; }

it("prepares navigation hidden and reopens by layout without repeating the address request", async () => {
  const controller = await owner();
  controller.setLayout(bounds); controller.navigate("https://example.com/");
  await vi.waitFor(() => expect(controller.getSnapshot().page.visible).toBe(true));
  await controller.hide();
  expect(controller.getSnapshot().overlaySafe).toBe(true);
  controller.setLayout(bounds);
  await vi.waitFor(() => expect(controller.getSnapshot().page.visible).toBe(true));
  expect(openSite).toHaveBeenCalledTimes(1);
  expect(openSite).toHaveBeenCalledWith("https://example.com/", bounds);
});

it("a delayed open stays hidden after the document or modal becomes active", async () => {
  const controller = await owner();
  let finish!: (value: SiteBrowserSnapshot) => void;
  vi.mocked(openSite).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  controller.setLayout(bounds); controller.navigate("https://example.com/late");
  await vi.waitFor(() => expect(openSite).toHaveBeenCalledTimes(1));
  const hiding = controller.hide();
  page = { ...page, open: true, visible: false, url: "https://example.com/late" };
  finish(structuredClone(page));
  expect(await hiding).toBe(true);
  expect(controller.getSnapshot().page.visible).toBe(false);
  expect(controller.getSnapshot().overlaySafe).toBe(true);
  expect(vi.mocked(layoutSite).mock.calls.at(-1)).toEqual([null]);
});

it("waits for an actual hide acknowledgement before permitting an overlay", async () => {
  const controller = await owner(); controller.setLayout(bounds); controller.navigate("https://example.com/");
  await vi.waitFor(() => expect(controller.getSnapshot().page.visible).toBe(true));
  let finish!: (value: SiteBrowserSnapshot) => void;
  vi.mocked(layoutSite).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const hiding = controller.hide();
  expect(controller.getSnapshot().overlaySafe).toBe(false);
  page.visible = false; finish(structuredClone(page));
  expect(await hiding).toBe(true);
  expect(controller.getSnapshot().overlaySafe).toBe(true);
});

it("an uncertain history action is read again without automatically replaying it", async () => {
  const controller = await owner(); controller.setLayout(bounds); controller.navigate("https://example.com/two");
  await vi.waitFor(() => expect(controller.getSnapshot().page.visible).toBe(true));
  vi.mocked(actOnSite).mockImplementationOnce(async () => { page.url = "https://example.com/one"; throw new Error("응답 유실"); });
  controller.act("back");
  await vi.waitFor(() => expect(controller.getSnapshot().error).toBe("응답 유실"));
  controller.retry();
  await vi.waitFor(() => expect(controller.getSnapshot().page.url).toBe("https://example.com/one"));
  expect(actOnSite).toHaveBeenCalledTimes(1);
});

it("a stale layout failure still reconciles the latest hide request", async () => {
  const controller = await owner(); controller.setLayout(bounds); controller.navigate("https://example.com/");
  await vi.waitFor(() => expect(controller.getSnapshot().page.visible).toBe(true));
  let fail!: (reason: Error) => void;
  vi.mocked(layoutSite).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  controller.setLayout({ ...bounds, width: 700 });
  const hiding = controller.hide(); fail(new Error("이전 크기 변경 실패"));
  expect(await hiding).toBe(true);
  expect(controller.getSnapshot().error).toBeNull();
  expect(controller.getSnapshot().page.visible).toBe(false);
});

it("does not treat a visible hide response as proof that a modal is safe", async () => {
  const controller = await owner(); controller.setLayout(bounds); controller.navigate("https://example.com/");
  await vi.waitFor(() => expect(controller.getSnapshot().page.visible).toBe(true));
  vi.mocked(layoutSite).mockImplementationOnce(async () => structuredClone(page));
  expect(await controller.hide()).toBe(false);
  expect(controller.getSnapshot().overlaySafe).toBe(false);
  expect(controller.getSnapshot().error).toContain("표시 상태");
});

it("clips the native rectangle to the viewport and chat while suppressing unusable space", () => {
  const rect = { left: 230, top: 156, right: 1100, bottom: 696 };
  expect(siteBounds(rect, 1100, 760)).toEqual(bounds);
  expect(siteBounds(rect, 1100, 760, new DOMRect(668, 22, 410, 716))).toEqual({ ...bounds, width: 426 });
  expect(siteBounds(rect, 600, 480, new DOMRect(168, 22, 410, 436))).toBeNull();
  expect(siteBounds({ ...rect, top: 740 }, 1100, 760)).toBeNull();
});

it("a renderer with an existing native child stays unsafe during a pending show", async () => {
  page = { ...page, open: true, visible: true, url: "https://example.com/existing" };
  const controller = await owner();
  expect(controller.getSnapshot().overlaySafe).toBe(true);
  let finish!: (value: SiteBrowserSnapshot) => void;
  vi.mocked(layoutSite).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  controller.setLayout(bounds);
  expect(controller.getSnapshot().overlaySafe).toBe(false);
  page.visible = true; finish(structuredClone(page));
  await vi.waitFor(() => expect(controller.getSnapshot().page.visible).toBe(true));
  expect(controller.getSnapshot().overlaySafe).toBe(false);
});

it("component shutdown reconciles a late open without presenting the page", async () => {
  const controller = await owner();
  let finish!: (value: SiteBrowserSnapshot) => void;
  vi.mocked(openSite).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  controller.setLayout(bounds); controller.navigate("https://example.com/late");
  await vi.waitFor(() => expect(openSite).toHaveBeenCalledTimes(1));
  controller.stop();
  page = { ...page, open: true, visible: false, url: "https://example.com/late" };
  finish(structuredClone(page));
  await vi.waitFor(() => expect(controller.getSnapshot().overlaySafe).toBe(true));
  expect(controller.getSnapshot().page.visible).toBe(false);
  expect(vi.mocked(layoutSite).mock.calls.at(-1)).toEqual([null]);
});

it("keeps a queued address when only display space is temporarily unavailable", async () => {
  const controller = await owner();
  let finish!: (value: SiteBrowserSnapshot) => void;
  vi.mocked(layoutSite).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  controller.setLayout(bounds); controller.navigate("https://example.com/waiting");
  controller.setLayout(null, true); finish(structuredClone(page));
  await vi.waitFor(() => expect(controller.getSnapshot().overlaySafe).toBe(true));
  expect(openSite).not.toHaveBeenCalled();
  expect(controller.getSnapshot().requestedAddress).toBe("https://example.com/waiting");
  controller.setLayout(bounds);
  await vi.waitFor(() => expect(controller.getSnapshot().page.visible).toBe(true));
  expect(openSite).toHaveBeenCalledTimes(1);
});

it("a newer address supersedes an in-flight preparation without presenting the old page", async () => {
  const controller = await owner();
  const presented: (string | null)[] = [];
  vi.mocked(layoutSite).mockImplementation(async (bounds) => { page.visible = page.open && Boolean(bounds); if (page.visible) presented.push(page.url); return structuredClone(page); });
  let finish!: (value: SiteBrowserSnapshot) => void;
  vi.mocked(openSite).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  controller.setLayout(bounds); controller.navigate("https://example.com/old");
  await vi.waitFor(() => expect(openSite).toHaveBeenCalledTimes(1));
  expect(controller.navigate("https://example.com/new")).toBe(true);
  page = { ...page, open: true, visible: false, url: "https://example.com/old" }; finish(structuredClone(page));
  await vi.waitFor(() => expect(controller.getSnapshot().page.visible).toBe(true));
  expect(controller.getSnapshot().page.url).toBe("https://example.com/new");
  expect(presented).not.toContain("https://example.com/old");
  expect(openSite).toHaveBeenCalledTimes(2);
});
