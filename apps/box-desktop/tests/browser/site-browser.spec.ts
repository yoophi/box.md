import { expect, test, type Page } from "@playwright/test";
import { seedWorkspace } from "./native-fixture";

const document = "---\npermalink: note\n---\n# 문서\n\n보관할 생각\n\n[참고 사이트](https://example.com/articles)";
const panel = (page: Page) => page.getByRole("region", { name: "사이트 브라우저 화면", exact: true });
async function openBrowser(page: Page) { await page.getByRole("button", { name: "사이트 브라우저", exact: false }).click(); await expect(panel(page)).toBeVisible(); }
async function visit(page: Page, address: string) {
  await panel(page).getByRole("textbox", { name: "사이트 주소" }).fill(address);
  await panel(page).getByRole("button", { name: "이동", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.visible)).toBe(true);
  await expect(panel(page).getByRole("button", { name: "이동", exact: true })).toBeEnabled();
}

test("normalizes addresses, follows engine history and fits native bounds below the toolbar", async ({ page }, testInfo) => {
  await seedWorkspace(page, 1); await page.goto("/"); await openBrowser(page);

  await expect(panel(page).getByRole("textbox", { name: "사이트 주소" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("site-browser.png") });
  await visit(page, "example.com/one");
  await expect(panel(page).getByRole("textbox", { name: "사이트 주소" })).toHaveValue("https://example.com/one");
  await visit(page, "https://example.com/two");
  await panel(page).getByRole("button", { name: "사이트 뒤로", exact: true }).click();
  await expect(panel(page).getByRole("textbox", { name: "사이트 주소" })).toHaveValue("https://example.com/one");
  await panel(page).getByRole("button", { name: "사이트 앞으로", exact: true }).click();
  await expect(panel(page).getByRole("textbox", { name: "사이트 주소" })).toHaveValue("https://example.com/two");
  await panel(page).getByRole("button", { name: "사이트 새로고침", exact: true }).click();
  const bounds = await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.siteBounds);
  expect(bounds).not.toBeNull();
  const toolbar = await panel(page).locator(".site-browser-heading").boundingBox();
  const footer = await panel(page).locator("footer").boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height - 0.5);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(footer!.y + 0.5);
  const calls = await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.siteCalls);
  expect(calls.filter((call) => call.command === "site_browser_action").map((call) => call.args.action)).toEqual(["back", "forward", "reload"]);
});

test("browses document links without saving or losing the draft and editor undo history", async ({ page }) => {
  await seedWorkspace(page, 1, { contents: { "/fixture/note-001.md": document } });
  await page.goto("/"); await page.locator(".document-list button").first().click();
  await page.locator(".document-prose > p").first().click(); await page.keyboard.press("End"); await page.keyboard.insertText(" 미저장 초안");
  await page.getByRole("link", { name: "참고 사이트", exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.visible)).toBe(true);
  await panel(page).getByRole("button", { name: "문서로 돌아가기" }).click();
  await expect(page.getByText("보관할 생각 미저장 초안", { exact: true })).toBeVisible();
  await page.locator(".document-prose > p").first().click(); await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByText("보관할 생각", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.writes)).toEqual([]);
  await openBrowser(page);
  await expect.poll(() => page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.visible)).toBe(true);
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.siteCalls.filter((call) => call.command === "site_browser_open").length)).toBe(1);
});

test("defers settings until native hide completes and recovers a failed hide", async ({ page }) => {
  await seedWorkspace(page, 1); await page.goto("/"); await openBrowser(page); await visit(page, "example.com");
  await page.evaluate(() => { window.__BOX_BROWSER_FIXTURE__.siteHideDelay = 400; });
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "설정", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "설정", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.visible)).toBe(false);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.visible)).toBe(true);
  await page.evaluate(() => { const state = window.__BOX_BROWSER_FIXTURE__; state.siteHideDelay = 0; state.failSite = true; });
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByRole("button", { name: "페이지 숨김 다시 시도" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "설정", exact: true })).toHaveCount(0);
  await page.evaluate(() => { window.__BOX_BROWSER_FIXTURE__.failSite = false; });
  await page.getByRole("button", { name: "페이지 숨김 다시 시도" }).click();
  await expect(page.getByRole("dialog", { name: "설정", exact: true })).toBeVisible();
});

test("a late site open cannot cover the restored document and is reused on reopening", async ({ page }) => {
  await seedWorkspace(page, 1, { contents: { "/fixture/note-001.md": document } });
  await page.goto("/"); await page.locator(".document-list button").first().click(); await openBrowser(page);
  await page.evaluate(() => { window.__BOX_BROWSER_FIXTURE__.siteOpenDelay = 500; });
  await panel(page).getByRole("textbox", { name: "사이트 주소" }).fill("example.com/late");
  await panel(page).getByRole("button", { name: "이동", exact: true }).click();
  await panel(page).getByRole("button", { name: "문서로 돌아가기" }).click();
  await expect(page.getByRole("heading", { name: "문서", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.open)).toBe(true);
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.visible)).toBe(false);
  await openBrowser(page);
  await expect.poll(() => page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.visible)).toBe(true);
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.siteCalls.filter((call) => call.command === "site_browser_open").length)).toBe(1);
});

test("uses the central region beside inline chat without a second drawer inset, including narrow windows", async ({ page }) => {
  await seedWorkspace(page, 1); await page.goto("/"); await openBrowser(page); await visit(page, "example.com");
  await page.getByRole("button", { name: "에이전트 채팅", exact: true }).click();
  const chat = page.locator(".agent-chat-sheet"); await expect(chat).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.visible)).toBe(true);
  const chatBox = (await chat.boundingBox())!;
  await expect.poll(() => page.evaluate(() => { const bounds = window.__BOX_BROWSER_FIXTURE__.siteBounds; return bounds ? bounds.x + bounds.width : Infinity; })).toBeLessThanOrEqual(chatBox.x + 0.5);
  await page.setViewportSize({ width: 600, height: 480 });
  await expect.poll(() => page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.visible)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const region = document.querySelector('.site-browser-content')!.getBoundingClientRect();
    return window.__BOX_BROWSER_FIXTURE__.siteBounds!.width - region.width;
  })).toBeCloseTo(0, 0);
  await page.getByRole("button", { name: "채팅 숨기기" }).click();
  await expect.poll(() => page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.visible)).toBe(true);
  expect((await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.siteBounds))!.viewportWidth).toBe(600);
});

test("keeps an edited address through title/redirect updates and shows unsafe titles as text", async ({ page }) => {
  await seedWorkspace(page, 1); await page.goto("/"); await openBrowser(page); await visit(page, "example.com");
  const input = panel(page).getByRole("textbox", { name: "사이트 주소" });
  await input.fill("내가 입력 중인 주소"); await input.blur();
  const unsafe = '<img src=https://connection.invalid/title onerror=window.siteAttack=1>';
  await page.evaluate((title) => { const state = window.__BOX_BROWSER_FIXTURE__; state.site.title = title; state.site.url = "https://example.com/redirect"; }, unsafe);
  await expect(panel(page).getByRole("heading", { name: unsafe, exact: true })).toBeVisible();
  await expect(input).toHaveValue("내가 입력 중인 주소");
  await expect(panel(page).locator("img,script,iframe,[onerror]")).toHaveCount(0);
  expect(await page.evaluate(() => "siteAttack" in window)).toBe(false);
  await input.fill("file:///tmp/private.md"); await panel(page).getByRole("button", { name: "이동", exact: true }).click();
  await expect(panel(page).getByText("HTTP 또는 HTTPS 사이트 주소를 입력해주세요.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.url)).toBe("https://example.com/redirect");
  await expect(input).toHaveValue("file:///tmp/private.md");
});

test("ordinary browser preview offers the desktop hint without a native request", async ({ page }) => {
  await page.goto("/"); await openBrowser(page);
  await expect(panel(page).getByText("사이트 탐색은 box.md 데스크톱 앱에서 사용할 수 있습니다.")).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "사이트 주소" })).toBeDisabled();
});

test("offers a deliberate reload when a page remains loading", async ({ page }) => {
  await seedWorkspace(page, 1); await page.goto("/"); await openBrowser(page); await visit(page, "example.com/slow");
  await page.clock.install();
  await page.evaluate(() => { window.__BOX_BROWSER_FIXTURE__.site.loading = true; });
  await page.clock.runFor(600);
  await expect(panel(page).getByText("페이지를 불러오는 중…", { exact: true })).toBeVisible();
  await page.clock.fastForward(16000);
  await expect(panel(page).getByText("페이지 응답이 늦어지고 있습니다. 주소를 확인하거나 다시 불러오세요.", { exact: true })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "사이트 새로고침", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.siteCalls.filter((call) => call.command === "site_browser_action").length)).toBe(0);
});
