import { expect, test } from "@playwright/test";
import { seedWorkspace } from "./native-fixture";

test("new save and Shift-save duplicate use ID files without a Save As dialog", async ({ page }) => {
  await seedWorkspace(page, 1); await page.goto("/");
  await expect(page.locator(".document-list button")).toHaveCount(1);
  await page.getByRole("button", { name: "Markdown 원문", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown 원문", exact: true });
  await source.fill("# 새 문서\n\n본문");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".document-header h1")).toHaveText("261013174600-00000000.md");
  await expect(page.getByRole("button", { name: "다른 이름 저장", exact: true })).toHaveCount(0);
  await expect(page.locator(".document-list button")).toHaveCount(2);
  await page.getByRole("button", { name: "Markdown 원문", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await expect(page.locator(".document-header h1")).toHaveText("261013174600-00000001.md");
  const state = await page.evaluate(() => ({ calls: window.__BOX_BROWSER_FIXTURE__.creationCalls, writes: window.__BOX_BROWSER_FIXTURE__.writes }));
  expect(state.calls.map((call) => call.command)).toEqual(["create_document", "duplicate_document"]);
  expect(state.writes.map((write) => write.path)).toEqual(["/fixture/261013174600-00000000.md", "/fixture/261013174600-00000001.md"]);
  expect(state.writes[1].content).toContain('title: "261013174600-00000000.md 사본"');
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("read-mode duplication preserves BOM/CRLF/body and the source and opens an editable copy", async ({ page }, testInfo) => {
  const original = '\uFEFF---\r\npermalink: original\r\ntitle: "원본"\r\nunknown: { keep: true }\r\n# KEEP\r\n---\r\n# 문서\r\n\r\n본문\r\n';
  await seedWorkspace(page, 1, { contents: { "/fixture/note-001.md": original } });
  await page.goto("/"); await page.locator(".document-list button").first().click();
  await page.getByRole("button", { name: "읽기 모드로 전환", exact: true }).click();
  await page.getByRole("button", { name: /^복제/ }).click();
  await expect(page.locator(".document-header h1")).toHaveText("261013174600-00000000.md");
  await expect(page.getByRole("button", { name: "읽기 모드로 전환", exact: true })).toBeVisible();
  const state = await page.evaluate(() => ({ original: window.__BOX_BROWSER_FIXTURE__.content.get("/fixture/note-001.md"), writes: window.__BOX_BROWSER_FIXTURE__.writes }));
  expect(state.original).toBe(original);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].content).toMatch(/^\uFEFF---\r\n/);
  expect(state.writes[0].content).toContain('title: "원본 사본"\r\n');
  expect(state.writes[0].content).toContain("unknown: { keep: true }\r\n# KEEP\r\n");
  expect(state.writes[0].content.endsWith("# 문서\r\n\r\n본문\r\n")).toBe(true);
  await page.setViewportSize({ width: 600, height: 480 });
  await page.getByRole("button", { name: /^복제/ }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: /^복제/ })).toBeInViewport();
  await page.getByRole("button", { name: "Markdown 원문", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("document-duplicate.png") });
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.locator(".document-header").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("document-duplicate-wide.png") });
});

test("failed duplication preserves the rich editor instance, draft and undo", async ({ page }) => {
  const original = "---\npermalink: original\n---\n# 문서\n\n원래 본문";
  await seedWorkspace(page, 1, { contents: { "/fixture/note-001.md": original } });
  await page.goto("/"); await page.locator(".document-list button").first().click();
  const editor = page.getByLabel("문서 본문", { exact: true }), node = await editor.elementHandle();
  await page.locator(".document-prose > p").last().click();
  await page.keyboard.press("End"); await page.keyboard.insertText(" 미저장 초안");
  await page.evaluate(() => { window.__BOX_BROWSER_FIXTURE__.failCreation = true; });
  await page.getByRole("button", { name: /^복제/ }).click();
  await expect(page.getByText("문서 생성 실패", { exact: true })).toBeVisible();
  expect(await node!.evaluate((el) => el === document.querySelector('[aria-label="문서 본문"]'))).toBe(true);
  await expect(page.getByText("원래 본문 미저장 초안", { exact: true })).toBeVisible();
  await page.locator(".document-prose > p").last().click(); await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByText("원래 본문", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.writes)).toEqual([]);
});

test("a lost response retries the same request and shows the single created file", async ({ page }) => {
  await seedWorkspace(page, 1); await page.goto("/");
  await expect(page.locator(".document-list button")).toHaveCount(1);
  await page.getByRole("button", { name: "Markdown 원문", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown 원문", exact: true });
  await source.fill("# 보관할 초안");
  await page.evaluate(() => { window.__BOX_BROWSER_FIXTURE__.loseCreateResponse = true; });
  await page.getByRole("button", { name: /^저장/ }).click();
  await expect(page.getByText("fixture response lost", { exact: true })).toBeVisible();
  await expect(source).toHaveValue("# 보관할 초안");
  await page.getByRole("button", { name: /^저장/ }).click();
  await expect(page.locator(".document-header h1")).toHaveText("261013174600-00000000.md");
  const state = await page.evaluate(() => ({ calls: window.__BOX_BROWSER_FIXTURE__.creationCalls, writes: window.__BOX_BROWSER_FIXTURE__.writes }));
  expect(state.writes).toHaveLength(1);
  expect(state.calls).toHaveLength(2);
  expect(state.calls[0].args.requestId).toBe(state.calls[1].args.requestId);
});
