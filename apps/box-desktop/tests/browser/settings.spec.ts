import { expect, test, type Page } from "@playwright/test";
import { seedWorkspace } from "./native-fixture";
async function settings(page: Page) {
  await page.getByRole("button", { name: "설정", exact: true }).click();
  return page.getByRole("dialog", { name: "설정", exact: true });
}
async function alternate(page: Page) {
  await page.evaluate(() => {
    window.__BOX_BROWSER_FIXTURE__.pickedFolder = "/alternate";
  });
  await page.getByRole("button", { name: "폴더 선택", exact: true }).click();
}
async function preference(page: Page) {
  return page.evaluate(() => localStorage.getItem("box.md.workspace-path"));
}

test("saves explicitly and restores after reload", async ({
  page,
}, testInfo) => {
  await seedWorkspace(page, 2);
  await page.goto("/");
  await expect(page.locator(".document-list button")).toHaveCount(2);
  const dialog = await settings(page);
  await expect(dialog.getByText("/fixture", { exact: true })).toBeVisible();
  await alternate(page);
  await expect(
    dialog.getByRole("textbox", { name: "선택한 작업 디렉터리" }),
  ).toHaveValue("/alternate");
  expect(await preference(page)).toBe("/fixture");
  await dialog.getByRole("button", { name: "설정 저장" }).click();
  await expect(page.locator(".document-list button")).toHaveText(/other.md/);
  expect(await preference(page)).toBe("/alternate");
  await page.reload();
  await expect(page.locator(".document-list button")).toHaveText(/other.md/);
  const restored = await settings(page);
  await expect(restored.getByText("/alternate", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-restored.png") });
});
test("keeps selection on picker cancellation and settings on Escape", async ({
  page,
}) => {
  await seedWorkspace(page, 2);
  await page.goto("/");
  const dialog = await settings(page);
  await alternate(page);
  await page.evaluate(() => {
    window.__BOX_BROWSER_FIXTURE__.pickedFolder = null;
  });
  await dialog.getByRole("button", { name: "폴더 선택", exact: true }).click();
  await expect(
    dialog.getByRole("textbox", { name: "선택한 작업 디렉터리" }),
  ).toHaveValue("/alternate");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(await preference(page)).toBe("/fixture");
  await expect(
    (await settings(page)).getByRole("textbox", {
      name: "선택한 작업 디렉터리",
    }),
  ).toHaveValue("/fixture");
});
for (const choice of ["cancel", "discard", "save"] as const) {
  test(`guards unsaved edits before applying settings: ${choice}`, async ({
    page,
  }) => {
    await seedWorkspace(page, 2);
    await page.goto("/");
    await page.locator(".document-list button").first().click();
    await expect(page.locator(".document-header h1")).toHaveText("note-001.md");
    await page
      .getByRole("button", { name: "Markdown 원문", exact: true })
      .click();
    const source = page.getByRole("textbox", {
      name: "Markdown 원문",
      exact: true,
    });
    await source.fill("# 변경 전 초안\n\n미저장 본문");
    const dialog = await settings(page);
    await alternate(page);
    await dialog.getByRole("button", { name: "설정 저장" }).click();
    const guard = page.getByRole("dialog", { name: "변경사항을 저장할까요?" });
    await expect(guard).toBeVisible();
    expect(await preference(page)).toBe("/fixture");
    await guard
      .getByRole("button", {
        name: {
          cancel: "취소",
          discard: "변경 버리고 계속",
          save: "저장 후 계속",
        }[choice],
        exact: true,
      })
      .click();
    if (choice === "cancel") {
      await expect(source).toHaveValue("# 변경 전 초안\n\n미저장 본문");
      expect(await preference(page)).toBe("/fixture");
    } else {
      await expect(page.locator(".document-list button")).toHaveText(
        /other.md/,
      );
      expect(await preference(page)).toBe("/alternate");
    }
    const writes = await page.evaluate(
      () => window.__BOX_BROWSER_FIXTURE__.writes,
    );
    if (choice === "save") {
      expect(writes).toHaveLength(1);
      expect(writes[0].path).toBe("/fixture/note-001.md");
      expect(writes[0].content).toContain("미저장 본문");
    } else expect(writes).toHaveLength(0);
  });
}
test("shows an inaccessible saved directory and recovers", async ({ page }) => {
  await seedWorkspace(page, 2, {
    initialPath: "/gone",
    invalidRoots: ["/gone"],
  });
  await page.goto("/");
  await expect(
    page.getByText("작업 디렉터리에 접근할 수 없습니다.", { exact: true }),
  ).toBeVisible();
  const dialog = await settings(page);
  await expect(dialog.getByText("/gone", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(
    "저장된 디렉터리를 열지 못했습니다",
  );
  await alternate(page);
  await dialog.getByRole("button", { name: "설정 저장" }).click();
  await expect(page.locator(".document-list button")).toHaveText(/other.md/);
  expect(await preference(page)).toBe("/alternate");
});
test("preserves document and preferences on invalid selection or storage failure", async ({
  page,
}) => {
  await seedWorkspace(page, 2, { invalidRoots: ["/alternate"] });
  await page.goto("/");
  await page.locator(".document-list button").first().click();
  await expect(page.locator(".document-header h1")).toHaveText("note-001.md");
  let dialog = await settings(page);
  await alternate(page);
  await dialog.getByRole("button", { name: "설정 저장" }).click();
  await expect(
    page.getByText("작업 디렉터리에 접근할 수 없습니다.", { exact: true }),
  ).toBeVisible();
  expect(await preference(page)).toBe("/fixture");
  await expect(page.locator(".document-header h1")).toHaveText("note-001.md");
  await page.evaluate(() => {
    window.__BOX_BROWSER_FIXTURE__.invalidRoots = [];
    window.__BOX_BROWSER_FIXTURE__.failPreferences = true;
  });
  dialog = await settings(page);
  await alternate(page);
  await dialog.getByRole("button", { name: "설정 저장" }).click();
  await expect(
    page.getByText(/작업 디렉터리 설정을 저장하지 못했습니다/),
  ).toBeVisible();
  expect(await preference(page)).toBe("/fixture");
  await expect(page.locator(".document-header h1")).toHaveText("note-001.md");
});
test("supports first setup and dialog actions at a small window size", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 760, height: 480 });
  await seedWorkspace(page, 2, { initialPath: null });
  await page.goto("/");
  const dialog = await settings(page);
  await expect(
    dialog.getByText(/저장된 작업 디렉터리가 없습니다/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "설정 저장" }),
  ).toBeDisabled();
  await alternate(page);
  const save = dialog.getByRole("button", { name: "설정 저장" });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await expect(dialog.locator(".file-label")).toBeInViewport({ ratio: 1 });
  const box = await dialog.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(480);
  await page.screenshot({
    path: testInfo.outputPath("settings-small-window.png"),
  });
  await save.click();
  await expect(page.locator(".document-list button")).toHaveText(/other.md/);
});
