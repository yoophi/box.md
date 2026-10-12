import { expect, test } from "@playwright/test";
import { seedWorkspace } from "./native-fixture";

test("keeps charts readonly in both modes while prose and source edits rerender", async ({
  page,
}) => {
  const source =
    "# 문서\n\n```mermaid\nflowchart LR\nA[처음] --> B[기록]\n```\n\n주변 본문";
  await seedWorkspace(page, 1, {
    contents: { "/fixture/note-001.md": source },
  });
  await page.goto("/");
  await page.locator(".document-list button").click();
  const chart = page.getByRole("figure", { name: "Mermaid 차트" });
  await expect(chart).toHaveAttribute("data-mermaid-state", "ready", {
    timeout: 20_000,
  });
  await expect(
    page.getByText("저장하지 않은 변경사항", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "읽기 모드로 전환" }).click();
  await expect(page.getByLabel("문서 본문", { exact: true })).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(chart).toHaveAttribute("data-mermaid-state", "ready");
  await expect(chart).toHaveAttribute("contenteditable", "false");
  await page.getByRole("button", { name: "편집 모드로 전환" }).click();
  await page.locator(".document-prose > p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" 수정한 주변 본문");
  await page
    .getByRole("button", { name: "Markdown 원문", exact: true })
    .click();
  const text = page.getByRole("textbox", {
    name: "Markdown 원문",
    exact: true,
  });
  await expect(text).toHaveValue(/수정한 주변 본문/);
  expect(await text.inputValue()).toMatch(/^# 문서/);
  expect(
    (await text.inputValue()).match(/```mermaid/g),
    await text.inputValue(),
  ).toHaveLength(1);
  expect(await text.inputValue()).toContain(
    "```mermaid\nflowchart LR\nA[처음] --> B[기록]\n```",
  );
  await text.fill((await text.inputValue()).replace("처음", "바뀜"));
  await page.getByRole("button", { name: "서식 편집", exact: true }).click();
  await expect(chart).toHaveCount(1);
  await expect(chart).toHaveAttribute("data-mermaid-state", "ready");
  await expect(chart.locator("svg")).toContainText("바뀜");
  await expect(chart).toHaveAttribute("contenteditable", "false");
});

test("renders multiple noneditable charts and isolates an invalid block", async ({
  page,
}, testInfo) => {
  const source =
    "# 차트 문서\n\n```mermaid\nflowchart LR\nA[생각] --> B[기록]\n```\n\n```mermaid\nthis is invalid !!!\n```\n\n~~~mermaid\nsequenceDiagram\nA->>B: 검토\n~~~\n\n마지막 본문";
  await seedWorkspace(page, 1, {
    contents: { "/fixture/note-001.md": source },
  });
  await page.goto("/");
  await page.locator(".document-list button").click();
  const charts = page.getByRole("figure", { name: "Mermaid 차트" });
  await expect(charts).toHaveCount(3);
  await expect(charts.nth(0)).toHaveAttribute("data-mermaid-state", "ready", {
    timeout: 20_000,
  });
  await expect(charts.nth(1)).toHaveAttribute("data-mermaid-state", "error");
  await expect(charts.nth(2)).toHaveAttribute("data-mermaid-state", "ready");
  await expect(charts.nth(0).locator("svg")).toBeVisible();
  await expect(charts.nth(0)).toHaveAttribute("contenteditable", "false");
  await expect(page.getByText("마지막 본문", { exact: true })).toBeVisible();
  expect(await page.locator("[data-mermaid-measure]").count()).toBe(0);
  await charts.nth(0).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("mermaid-charts.png") });
});

test("cannot loosen security using directives or execute HTML labels and links", async ({
  page,
}) => {
  const source =
    '```mermaid\n%%{init: {"securityLevel":"loose","htmlLabels":true}}%%\nflowchart TD\nA["<img src=x onerror=window.boxAttack=1>"] --> B["safe"]\nclick B "javascript:window.boxAttack=2"\n```';
  const foreignRequests: string[] = [];
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:18143/") &&
      !request.url().startsWith("data:")
    )
      foreignRequests.push(request.url());
  });
  await seedWorkspace(page, 1, {
    contents: { "/fixture/note-001.md": source },
  });
  await page.goto("/");
  await page.locator(".document-list button").click();
  const chart = page.getByRole("figure", { name: "Mermaid 차트" });
  await expect(chart).toHaveAttribute("data-mermaid-state", "ready", {
    timeout: 20_000,
  });
  expect(
    await chart
      .locator("script,foreignObject,img,iframe,[onerror],[onclick]")
      .count(),
  ).toBe(0);
  expect(await page.evaluate(() => "boxAttack" in window)).toBe(false);
  expect(foreignRequests).toEqual([]);
  expect(await chart.locator("a[href],a[xlink\\:href]").count()).toBe(0);
});
