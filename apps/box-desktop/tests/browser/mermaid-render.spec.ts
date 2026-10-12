import { expect, test } from "@playwright/test";
import { seedWorkspace } from "./native-fixture";

for (const fixture of [
  {
    name: "BOM, frontmatter and CRLF long fence",
    prefix: '\uFEFF---\r\nsummary: "차트 문서" # 메모\r\npermalink: 99999999-9999-4999-8999-999999999999\r\n---\r\n',
    diagram: "````mermaid\r\nflowchart LR\r\n  A[생각 🌱] --> B[기록]\r\n\r\n````",
    label: "기록",
  },
  {
    name: "tilde fence and mixed line endings",
    prefix: "",
    diagram: "~~~~mermaid\nsequenceDiagram\r\nA->>B: 검토\n~~~~",
    label: "검토",
  },
  {
    name: "diagram inside a quoted list",
    prefix: "",
    diagram: "- > ```mermaid\r\n  > flowchart LR\r\n  > A[생각] --> B[기록]\r\n  > ```",
    // List markers may be laid out by the serializer; the fence and its code remain verbatim.
    savedDiagram: "  > ```mermaid\r\n  > flowchart LR\r\n  > A[생각] --> B[기록]\r\n  > ```",
    label: "기록",
  },
]) {
  test(`preserves source through mode switches, prose edits, save and reopen: ${fixture.name}`, async ({ page }) => {
    const original = `${fixture.prefix}# 문서\n\n${fixture.diagram}\n\n주변 본문`;
    await seedWorkspace(page, 2, {
      contents: { "/fixture/note-001.md": original },
    });
    await page.goto("/");
    await page.locator(".document-list button").first().click();
    const chart = page.getByRole("figure", { name: "Mermaid 차트" });
    await expect(chart).toHaveAttribute("data-mermaid-state", "ready", { timeout: 20_000 });
    await page.getByRole("button", { name: "읽기 모드로 전환" }).click();
    await expect(chart).toHaveAttribute("contenteditable", "false");
    await page.getByRole("button", { name: "Markdown 원문", exact: true }).click();
    const source = page.getByRole("textbox", { name: "Markdown 원문", exact: true });
    await expect(source).toHaveAttribute("readonly", "");
    // HTML textarea values normalize CRLF; the document state and save payload must not.
    await expect(source).toHaveValue(original.replace(/\r\n/g, "\n"));
    await page.getByRole("button", { name: "편집 모드로 전환" }).click();
    await page.getByRole("button", { name: "서식 편집", exact: true }).click();
    await expect(chart).toHaveAttribute("data-mermaid-state", "ready");
    await page.locator(".document-prose > p").last().click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(" 수정한 주변 본문");
    await page.getByRole("button", { name: /^저장/ }).click();
    await expect(page.getByLabel("미저장 변경", { exact: true })).toHaveCount(0);
    const writes = await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.writes);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("/fixture/note-001.md");
    expect(writes[0].content).toContain(fixture.savedDiagram ?? fixture.diagram);
    expect(writes[0].content.startsWith(fixture.prefix)).toBe(true);
    expect(writes[0].content).toContain("수정한 주변 본문");
    await page.locator(".document-list button").nth(1).click();
    await expect(page.locator(".document-header h1")).toHaveText("note-002.md");
    await page.locator(".document-list button").first().click();
    await expect(chart).toHaveCount(1);
    await expect(chart).toHaveAttribute("data-mermaid-state", "ready");
    await expect(chart.locator("svg")).toContainText(fixture.label);
    await page.getByRole("button", { name: "Markdown 원문", exact: true }).click();
    await expect(source).toHaveValue(writes[0].content.replace(/\r\n/g, "\n"));
  });
}

test("repairs an invalid chart in source mode and renders the result in reading mode", async ({ page }) => {
  const invalid = "```mermaid\nthis is invalid !!!\n```";
  const repaired = "```mermaid\nflowchart LR\nA[복구] --> B[성공]\n```";
  const original = `# 오류 복구\n\n${invalid}\n\n나머지 문서`;
  await seedWorkspace(page, 1, { contents: { "/fixture/note-001.md": original } });
  await page.goto("/");
  await page.locator(".document-list button").click();
  const chart = page.getByRole("figure", { name: "Mermaid 차트" });
  await expect(chart).toHaveAttribute("data-mermaid-state", "error", { timeout: 20_000 });
  await expect(chart.getByRole("alert")).toContainText("Markdown 원문");
  await expect(page.getByText("나머지 문서", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Markdown 원문", exact: true }).click();
  await page.getByRole("textbox", { name: "Markdown 원문", exact: true }).fill(original.replace(invalid, repaired));
  await page.getByRole("button", { name: "서식 편집", exact: true }).click();
  await expect(chart).toHaveAttribute("data-mermaid-state", "ready");
  await expect(chart.locator("svg")).toContainText("복구");
  await page.getByRole("button", { name: /^저장/ }).click();
  await page.getByRole("button", { name: "읽기 모드로 전환" }).click();
  await expect(chart).toHaveAttribute("contenteditable", "false");
  await expect(chart.locator("svg")).toContainText("성공");
  await expect(page.getByText("나머지 문서", { exact: true })).toBeVisible();
  expect(await page.locator("[data-mermaid-measure]").count()).toBe(0);
});

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
  await page.getByRole("button", { name: "읽기 모드로 전환" }).click();
  for (let index = 0; index < 3; index++) {
    await expect(charts.nth(index)).toHaveAttribute("contenteditable", "false");
    await expect(charts.nth(index)).toHaveAttribute(
      "data-mermaid-state",
      index === 1 ? "error" : "ready",
    );
  }
  await expect(page.getByText("마지막 본문", { exact: true })).toBeVisible();
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
