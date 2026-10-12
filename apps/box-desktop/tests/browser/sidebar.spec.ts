import { expect, test } from "@playwright/test";
import { seedWorkspace } from "./native-fixture";

for (const height of [760, 600, 480]) {
  test(`scrolls 569 documents without moving controls at ${height}px height`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1100, height });
    await seedWorkspace(page, 569);
    await page.goto("/");
    const list = page.locator(".document-list");
    await expect(list.getByRole("button")).toHaveCount(569);
    const scroll = await list.evaluate((node) => ({
      height: node.clientHeight,
      content: node.scrollHeight,
    }));
    expect(scroll.height).toBeGreaterThan(40);
    expect(scroll.content).toBeGreaterThan(scroll.height);
    const picker = page.locator(".workspace-picker"),
      footer = page.locator(".sidebar-footer");
    const controlsBefore = {
      picker: await picker.boundingBox(),
      footer: await footer.boundingBox(),
    };
    expect(controlsBefore.picker!.y).toBeGreaterThanOrEqual(0);
    expect(
      controlsBefore.footer!.y + controlsBefore.footer!.height,
    ).toBeLessThanOrEqual(height);
    await list.hover();
    await page.mouse.wheel(0, 100_000);
    const last = list.getByRole("button", { name: /note-569.md/ });
    await expect(last).toBeInViewport();
    expect(await picker.boundingBox()).toEqual(controlsBefore.picker);
    expect(await footer.boundingBox()).toEqual(controlsBefore.footer);
    await last.click();
    await expect(
      page
        .locator(".document-header")
        .getByRole("heading", { name: "note-569.md" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("sidebar-last-document.png"),
    });
    await page.setViewportSize({ width: 760, height: 480 });
    await list.hover();
    await page.mouse.wheel(0, 100_000);
    await expect(
      list.getByRole("button", { name: /note-569.md/ }),
    ).toBeInViewport();
    expect(await list.evaluate((node) => node.clientHeight)).toBeGreaterThan(
      40,
    );
  });
}

for (const count of [0, 2]) {
  test(`keeps a ${count}-document workspace usable`, async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 480 });
    await seedWorkspace(page, count);
    await page.goto("/");
    if (!count)
      await expect(
        page.getByText("아직 Markdown 문서가 없습니다."),
      ).toBeVisible();
    else {
      await expect(page.locator(".document-list button")).toHaveCount(2);
      await page.locator(".document-list button").last().click();
      await expect(
        page
          .locator(".document-header")
          .getByRole("heading", { name: "note-002.md" }),
      ).toBeVisible();
    }
    const footer = await page.locator(".sidebar-footer").boundingBox();
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(480);
  });
}
