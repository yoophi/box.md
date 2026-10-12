import { expect, test, type Page } from "@playwright/test";
import { seedWorkspace } from "./native-fixture";

const source = "---\npermalink: source\n---\n# 첫 문서\n\n첫 번째 본문";
const target = "---\npermalink: target\n---\n# 두 번째 문서\n\n두 번째 본문";
const panel = (page: Page) => page.getByRole("region", { name: "명시적 문서 연결", exact: true });
async function create(page: Page, name: string) {
  await panel(page).getByText("연결 관리", { exact: true }).click();
  await panel(page).getByRole("textbox", { name: "새 연결 엔티티 이름" }).fill(name);
  await panel(page).getByRole("button", { name: "만들기", exact: true }).click();
  await expect(panel(page).getByRole("button", { name, exact: true })).toBeVisible();
}
async function attach(page: Page, name: string) {
  const details = panel(page).locator("details");
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open)))
    await panel(page).getByText("연결 관리", { exact: true }).click();
  await panel(page).getByRole("combobox", { name: "연결할 엔티티" }).selectOption({ label: name });
  await panel(page).getByRole("button", { name: "문서 연결", exact: true }).click();
  await expect(panel(page).getByLabel("현재 문서 연결").getByRole("button", { name, exact: true })).toBeVisible();
}

for (const choice of ["cancel", "discard", "save"] as const) {
  test(`creates and shares an entity then guards related-document navigation: ${choice}`, async ({ page }, testInfo) => {
    await seedWorkspace(page, 2, { contents: { "/fixture/note-001.md": source, "/fixture/note-002.md": target } });
    await page.goto("/");
    await page.locator(".document-list button").first().click();
    await create(page, "함께 검토");
    expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.connections.memberships)).toEqual([]);
    await attach(page, "함께 검토");
    await page.locator(".document-list button").nth(1).click();
    await expect(page.locator(".document-header h1")).toHaveText("note-002.md");
    await attach(page, "함께 검토");
    await panel(page).getByLabel("현재 문서 연결").getByRole("button", { name: "함께 검토", exact: true }).click();
    const related = panel(page).getByRole("complementary", { name: "관련 문서" });
    await expect(related.getByRole("button", { name: "첫 문서", exact: true })).toBeEnabled();
    await expect(related.getByRole("button", { name: "두 번째 문서", exact: true })).toBeEnabled();
    if (choice === "save") {
      await related.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("document-connections.png") });
    }
    expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.writes)).toEqual([]);
    await page.locator(".document-prose > p").last().click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(" 미저장 초안");
    await related.getByRole("button", { name: "첫 문서", exact: true }).click();
    const guard = page.getByRole("dialog", { name: "변경사항을 저장할까요?" });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: { cancel: "취소", discard: "변경 버리고 계속", save: "저장 후 계속" }[choice], exact: true }).click();
    if (choice === "cancel") {
      await expect(page.getByText("두 번째 본문 미저장 초안", { exact: true })).toBeVisible();
      await expect(page.locator(".document-header h1")).toContainText("note-002.md");
    } else await expect(page.locator(".document-header h1")).toHaveText("note-001.md");
    const state = await page.evaluate(() => ({ writes: window.__BOX_BROWSER_FIXTURE__.writes, memberships: window.__BOX_BROWSER_FIXTURE__.connections.memberships }));
    expect(state.memberships.map((edge) => edge.permalink).sort()).toEqual(["source", "target"]);
    if (choice === "save") {
      expect(state.writes).toHaveLength(1);
      expect(state.writes[0].path).toBe("/fixture/note-002.md");
      expect(state.writes[0].content).toContain("미저장 초안");
    } else expect(state.writes).toEqual([]);
  });
}

test("keeps saved chips while an identifier is dirty and detaches only the chosen relation", async ({ page }) => {
  await seedWorkspace(page, 2, { contents: { "/fixture/note-001.md": source, "/fixture/note-002.md": target } });
  await page.goto("/");
  await page.evaluate(() => {
    window.__BOX_BROWSER_FIXTURE__.connections = { version: 1,
      entities: [{ id: "one", name: "검토" }, { id: "two", name: "자료" }],
      memberships: [{ connectionId: "one", permalink: "source" }, { connectionId: "one", permalink: "target" }, { connectionId: "two", permalink: "source" }],
    };
  });
  await page.locator(".document-list button").first().click();
  const current = panel(page).getByLabel("현재 문서 연결");
  await expect(current.getByRole("button", { name: "검토", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Markdown 원문", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Markdown 원문", exact: true });
  await text.fill(source.replace("permalink: source", "permalink: changed"));
  await expect(current.getByRole("button", { name: "검토 연결 해제" })).toBeDisabled();
  await expect(current.getByRole("button", { name: "자료", exact: true })).toBeVisible();
  await text.fill(source);
  await current.getByRole("button", { name: "검토 연결 해제" }).click();
  await expect(current.getByRole("button", { name: "검토", exact: true })).toHaveCount(0);
  await expect(current.getByRole("button", { name: "자료", exact: true })).toBeVisible();
  const graph = await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.connections);
  expect(graph.entities).toHaveLength(2);
  expect(graph.memberships).toEqual([{ connectionId: "one", permalink: "target" }, { connectionId: "two", permalink: "source" }]);
  await expect(text).toHaveValue(source);
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.writes)).toEqual([]);
});

test("makes missing and duplicate related documents visible without enabling navigation", async ({ page }) => {
  await seedWorkspace(page, 3, { contents: { "/fixture/note-001.md": source, "/fixture/note-002.md": target, "/fixture/note-003.md": target } });
  await page.goto("/");
  await page.evaluate(() => {
    window.__BOX_BROWSER_FIXTURE__.connections = { version: 1, entities: [{ id: "one", name: "검토" }], memberships: [
      { connectionId: "one", permalink: "source" }, { connectionId: "one", permalink: "target" }, { connectionId: "one", permalink: "missing" },
    ] };
  });
  await page.locator(".document-list button").first().click();
  await panel(page).getByLabel("현재 문서 연결").getByRole("button", { name: "검토", exact: true }).click();
  const related = panel(page).getByRole("complementary", { name: "관련 문서" });
  await expect(related.getByText("중복", { exact: true })).toBeVisible();
  await expect(related.getByText("문서 없음", { exact: true })).toBeVisible();
  await expect(related.getByRole("button", { name: "target", exact: true })).toBeDisabled();
  await expect(related.getByRole("button", { name: "missing", exact: true })).toBeDisabled();
  await expect(page.locator(".document-header h1")).toHaveText("note-001.md");
});
