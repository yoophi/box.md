import { expect, test } from "@playwright/test";
import { seedWorkspace } from "./native-fixture";

test("does not execute HTML or load its resources while querying source-mode references", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().startsWith("https://example.com/")) requests.push(request.url()); });
  await page.route("https://example.com/**", (route) => route.abort());
  await page.addInitScript(() => {
    const parse = DOMParser.prototype.parseFromString;
    Object.assign(window, { sourceHtmlParses: 0 });
    DOMParser.prototype.parseFromString = function (value, type) {
      if (type === "text/html") Object.assign(window, { sourceHtmlParses: Number(Reflect.get(window, "sourceHtmlParses")) + 1 });
      return parse.call(this, value, type);
    };
  });
  const body = '<img src="https://example.com/source-html" onerror="window.boxAttack=1">';
  const source = `---\npermalink: source\n---\n${body}\n\n[[stable]]`;
  await seedWorkspace(page, 2, { contents: {
    "/fixture/note-001.md": source,
    "/fixture/note-002.md": `---\npermalink: stable\n---\n${body.replace("source-html", "target-html")}\n\n# 대상 제목`,
  } });
  await page.goto("/");
  await page.locator(".document-list button").first().click();
  await expect(page.getByRole("textbox", { name: "Markdown 원문", exact: true })).toHaveValue(source);
  await expect.poll(() => page.evaluate(() => Number(Reflect.get(window, "sourceHtmlParses")))).toBeGreaterThanOrEqual(2);
  await page.waitForLoadState("networkidle");
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => "boxAttack" in window)).toBe(false);
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.writes)).toEqual([]);
});
