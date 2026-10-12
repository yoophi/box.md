import { expect, test } from "@playwright/test";
import { seedWorkspace } from "./native-fixture";

const source = "---\npermalink: source\n---\n# 연결한 생각\n\n[[stable]] 그리고 [[ stable | 고정 별칭 ]]\n\n`[[stable]]`\n\n```md\n[[stable | 코드 예시]]\n```\n\n주변 본문";
const target = "---\npermalink: stable\n---\n# 대상 제목\n\n대상 본문";
async function openSource(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator(".document-list button").first().click();
  await expect(page.getByRole("link", { name: "대상 제목", exact: true })).toBeVisible();
}

test("preserves tokens through all modes, source and prose edits, save and reopen", async ({ page }, testInfo) => {
  await seedWorkspace(page, 3, { contents: {
    "/fixture/note-001.md": source,
    "/fixture/note-002.md": target,
    "/fixture/note-003.md": "---\npermalink: alternate\n---\n# 다른 대상",
  } });
  await openSource(page);
  await expect(page.locator(".document-prose a.wikilink")).toHaveCount(2);
  await page.getByRole("button", { name: "읽기 모드로 전환" }).click();
  await expect(page.getByRole("link", { name: "대상 제목", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "고정 별칭", exact: true })).toBeVisible();
  await expect(page.getByLabel("문서 본문", { exact: true })).toHaveAttribute("contenteditable", "false");
  await page.getByRole("button", { name: "Markdown 원문", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Markdown 원문", exact: true });
  await expect(text).toHaveAttribute("readonly", "");
  await expect(text).toHaveValue(source);
  await page.getByRole("button", { name: "편집 모드로 전환" }).click();
  await expect(text).not.toHaveAttribute("readonly", "");
  const changed = source.replace("[[ stable | 고정 별칭 ]]", "[[ alternate | 바뀐 별칭 ]]");
  await text.fill(changed);
  await page.getByRole("button", { name: "서식 편집", exact: true }).click();
  await expect(page.getByRole("link", { name: "바뀐 별칭", exact: true })).toHaveAttribute("href", "boxmd://document?permalink=alternate");
  await page.locator(".document-prose > p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" 수정한 주변 본문");
  await page.getByRole("button", { name: /^저장/ }).click();
  await expect(page.getByLabel("미저장 변경", { exact: true })).toHaveCount(0);
  const writes = await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.writes);
  expect(writes).toHaveLength(1);
  expect(writes[0].content).toContain("[[stable]] 그리고 [[ alternate | 바뀐 별칭 ]]");
  expect(writes[0].content).toContain("`[[stable]]`");
  expect(writes[0].content).toContain("[[stable | 코드 예시]]");
  expect(writes[0].content).toContain("수정한 주변 본문");
  await page.locator(".document-list button").nth(1).click();
  await expect(page.locator(".document-header h1")).toHaveText("note-002.md");
  await page.locator(".document-list button").first().click();
  await expect(page.getByRole("link", { name: "바뀐 별칭", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Markdown 원문", exact: true }).click();
  await expect(text).toHaveValue(writes[0].content);
  await page.getByRole("button", { name: "서식 편집", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("wikilinks.png") });
  await page.getByRole("link", { name: "바뀐 별칭", exact: true }).click();
  await expect(page.locator(".document-header h1")).toHaveText("note-003.md");
});

test("refreshes a renamed target's latest title and keeps alias and unsaved prose", async ({ page }) => {
  await seedWorkspace(page, 2, { contents: { "/fixture/note-001.md": source, "/fixture/note-002.md": target } });
  await openSource(page);
  await page.locator(".document-prose > p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" 남아야 하는 초안");
  await page.evaluate(() => {
    const state = window.__BOX_BROWSER_FIXTURE__;
    state.documents = state.documents.map((doc) => doc.path.endsWith("note-002.md")
      ? { path: "/fixture/moved/renamed.md", name: "renamed.md", relativePath: "moved/renamed.md" } : doc);
    state.content.delete("/fixture/note-002.md");
    state.content.set("/fixture/moved/renamed.md", "---\npermalink: stable\n---\n# 최신 제목\n\n대상 본문");
  });
  await page.getByRole("button", { name: "문서 목록 새로고침" }).click();
  await expect(page.getByRole("link", { name: "최신 제목", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "고정 별칭", exact: true })).toBeVisible();
  await expect(page.getByText("주변 본문 남아야 하는 초안", { exact: true })).toBeVisible();
  await expect(page.getByLabel("미저장 변경", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.writes)).toEqual([]);
  await page.getByRole("button", { name: "Markdown 원문", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown 원문", exact: true })).toHaveValue(/\[\[stable\]\] 그리고 \[\[ stable \| 고정 별칭 \]\]/);
  await page.getByRole("button", { name: "서식 편집", exact: true }).click();
  await page.getByRole("link", { name: "고정 별칭", exact: true }).click();
  await page.getByRole("button", { name: "저장 후 계속", exact: true }).click();
  await expect(page.locator(".document-header h1")).toHaveText("renamed.md");
  await expect(page.getByRole("heading", { name: "최신 제목", exact: true })).toBeVisible();
});

test("shows missing, duplicate and partial-list states without opening an arbitrary target", async ({ page }) => {
  await seedWorkspace(page, 3, { contents: {
    "/fixture/note-001.md": source + "\n\n[[absent | 없는 문서]]",
    "/fixture/note-002.md": target,
    "/fixture/note-003.md": target.replace("대상 제목", "복제 제목"),
  } });
  await page.goto("/");
  await page.locator(".document-list button").first().click();
  const duplicate = page.locator('a.wikilink[data-permalink="stable"]').first();
  const missing = page.locator('a.wikilink[data-permalink="absent"]');
  await expect(duplicate).toHaveAttribute("data-wikilink-state", "duplicate");
  await expect(duplicate).toContainText("중복");
  await expect(missing).toHaveAttribute("data-wikilink-state", "missing");
  await expect(missing).toContainText("문서 없음");
  await expect(duplicate).not.toHaveAttribute("href", /.+/);
  await expect(duplicate).toHaveAttribute("aria-disabled", "true");
  await expect(missing).toHaveAttribute("aria-disabled", "true");
  // Deliberately attempt a pointer click on disabled links; normal actionability rejects them.
  await duplicate.click({ force: true });
  await missing.click({ force: true });
  await expect(page.locator(".document-header h1")).toHaveText("note-001.md");
  await page.evaluate(() => { window.__BOX_BROWSER_FIXTURE__.truncated = true; });
  await page.getByRole("button", { name: "문서 목록 새로고침" }).click();
  await expect(duplicate).toHaveAttribute("data-wikilink-state", "error");
  await expect(duplicate).not.toHaveAttribute("href", /.+/);
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.writes)).toEqual([]);
});

test("displays HTML-shaped alias and title as text without execution or external requests", async ({ page }) => {
  const unsafe = '<img src=https://example.com/unsafe onerror=window.boxAttack=1>';
  const requests: string[] = [];
  page.on("request", (request) => { if (!request.url().startsWith("http://127.0.0.1:18143/") && !request.url().startsWith("data:")) requests.push(request.url()); });
  await seedWorkspace(page, 2, { contents: {
    "/fixture/note-001.md": `---\npermalink: source\n---\n[[stable]] 그리고 [[ stable | ${unsafe} ]]`,
    "/fixture/note-002.md": `---\npermalink: stable\ntitle: '${unsafe}'\n---\n# 대상`,
  } });
  await page.goto("/");
  await page.locator(".document-list button").first().click();
  const links = page.locator(".document-prose a.wikilink");
  await expect(links).toHaveCount(2);
  await expect(links.first()).toHaveAttribute("data-wikilink-state", "resolved");
  await expect(links.nth(0)).toHaveText(unsafe);
  await expect(links.nth(1)).toHaveText(unsafe);
  await expect(links.locator("img,script,iframe,[onerror]")).toHaveCount(0);
  expect(await page.evaluate(() => "boxAttack" in window)).toBe(false);
  expect(requests).toEqual([]);
});
