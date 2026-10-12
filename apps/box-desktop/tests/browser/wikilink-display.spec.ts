import { expect, test } from "@playwright/test";
import { seedWorkspace } from "./native-fixture";

for (const choice of ["cancel", "discard", "save"] as const) {
  test(`renders title and alias then protects a wikilink click: ${choice}`, async ({ page }) => {
    const source = "---\npermalink: source\n---\n# 원본 문서\n\n[[stable]] 그리고 [[ stable | 고정 별칭 ]]\n\n`[[stable]]`\n\n주변 본문";
    await seedWorkspace(page, 2, {
      contents: {
        "/fixture/note-001.md": source,
        "/fixture/note-002.md": "---\npermalink: stable\n---\n# 대상 제목\n\n대상 본문",
      },
    });
    await page.goto("/");
    await page.locator(".document-list button").first().click();
    const link = page.getByRole("link", { name: "대상 제목", exact: true });
    await expect(link).toHaveAttribute("data-wikilink-state", "resolved");
    await expect(page.getByRole("link", { name: "고정 별칭", exact: true })).toHaveAttribute("href", "boxmd://document?permalink=stable");
    await expect(page.locator(".document-prose a.wikilink")).toHaveCount(2);
    await expect(page.getByLabel("미저장 변경", { exact: true })).toHaveCount(0);
    await page.locator(".document-prose > p").last().click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(" 미저장 초안");
    await link.click();
    const guard = page.getByRole("dialog", { name: "변경사항을 저장할까요?" });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", {
      name: { cancel: "취소", discard: "변경 버리고 계속", save: "저장 후 계속" }[choice], exact: true,
    }).click();
    if (choice === "cancel") {
      await expect(page.locator(".document-header h1")).toContainText("note-001.md");
      await expect(page.getByText("주변 본문 미저장 초안", { exact: true })).toBeVisible();
      await expect(page.getByLabel("미저장 변경", { exact: true })).toBeVisible();
    } else {
      await expect(page.locator(".document-header h1")).toHaveText("note-002.md");
      await expect(page.getByRole("heading", { name: "대상 제목", exact: true })).toBeVisible();
    }
    const writes = await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.writes);
    if (choice === "save") {
      expect(writes).toHaveLength(1);
      expect(writes[0].path).toBe("/fixture/note-001.md");
      expect(writes[0].content).toContain("[[stable]] 그리고 [[ stable | 고정 별칭 ]]");
      expect(writes[0].content).toContain("미저장 초안");
    } else expect(writes).toHaveLength(0);
  });
}
