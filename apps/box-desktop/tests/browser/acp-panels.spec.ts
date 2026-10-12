import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { buildBrowserHost, startBrowserHost } from "./workbench-host";
import { seedWorkspace } from "./native-fixture";

test.beforeAll(() => buildBrowserHost());
let host: Awaited<ReturnType<typeof startBrowserHost>>;
test.beforeEach(async ({ page, baseURL }) => {
  host = await startBrowserHost({ HOST_USE_ACP_ENGINE: "1", HOST_JOURNAL_CAPACITY: "1000", HOST_ALLOWED_ORIGINS: baseURL! });
  const agent = resolve(process.cwd(), "../../vendor/agentic-workspace/crates/workbench-core/tests/support/agents/fake_acp_permission_agent.py");
  writeFileSync(resolve(host.dataDir, "agent-run-settings.json"), JSON.stringify([{
    workingDirectory: "__app_agent_command_overrides__",
    commandOverrides: { globalCommand: `python3 ${agent} --log ${resolve(host.dataDir, "agent.log")} --pid-file ${resolve(host.dataDir, "agent.pid")} --log-session --echo` },
  }]));
  await seedWorkspace(page, 1, {
    workspacePath: host.workDir,
    contents: { [`${host.workDir}/note-001.md`]: "---\npermalink: panel-note\n---\n# 문서\n\n보관할 생각" },
    workbenchConnection: { baseUrl: host.baseUrl, token: host.tokens.windowA, expiresAt: new Date(Date.now() + 3600_000).toISOString(), incarnation: "panel-test" },
  });
});
test.afterEach(async ({ page }) => {
  // Stop this test's renderer before disposing its private host/processes/files.
  await page.close();
  if (host) await host.stop();
});
async function width(page: Page) { return page.getByTestId("box-agent-chat").evaluate((el) => el.getBoundingClientRect().width); }
async function startChat(page: Page) {
  await page.getByRole("button", { name: "에이전트 채팅", exact: true }).click();
  const start = page.getByRole("button", { name: "새 세션", exact: true });
  await expect(start).toBeEnabled({ timeout: 15_000 }); await start.click();
  const composer = page.getByRole("textbox", { name: "채팅 메시지", exact: true });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  return composer;
}

test("rightmost shared pane preserves editor/undo, chat draft and measured width through all toggles and resize", async ({ page }, testInfo) => {
  await page.goto("/"); await page.locator(".document-list button").first().click();
  const body = page.getByLabel("문서 본문"), bodyNode = await body.elementHandle();
  await page.locator(".document-prose > p").first().click(); await page.keyboard.press("End"); await page.keyboard.insertText(" 미저장 초안");
  await expect(page.getByRole("button", { name: "채팅 패널", exact: true })).toHaveAttribute("aria-expanded", "false");
  const composer = await startChat(page), composerNode = await composer.elementHandle();
  await composer.fill("보관할 질문");
  const center = page.getByTestId("box-primary"), chat = page.locator(".agent-chat-inline");
  const centerBox = (await center.boundingBox())!, chatBox = (await chat.boundingBox())!;
  expect(centerBox.x + centerBox.width).toBeLessThanOrEqual(chatBox.x + 1);
  expect(chatBox.x + chatBox.width).toBeCloseTo(1100, 0);
  expect(await chat.evaluate((el) => getComputedStyle(el).position)).toBe("static");
  await page.screenshot({ path: testInfo.outputPath("acp-panels-wide.png") });
  const original = await width(page), separator = page.getByRole("separator");
  await separator.focus(); await separator.press("ArrowLeft");
  await expect.poll(() => width(page)).toBeGreaterThan(original);
  const handle = (await separator.boundingBox())!;
  await page.mouse.move(handle.x + .5, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x - 35, handle.y + handle.height / 2, { steps: 5 }); await page.mouse.up();
  const resized = await width(page); expect(resized).toBeGreaterThan(original + 20);
  await page.getByRole("button", { name: "채팅 숨기기" }).click(); await expect(composer).toBeHidden();
  await page.getByRole("button", { name: "채팅 패널", exact: true }).click();
  await expect.poll(() => width(page)).toBeCloseTo(resized, 0); await expect(composer).toHaveValue("보관할 질문");
  await page.getByRole("button", { name: "채팅 패널", exact: true }).click();
  await page.getByRole("button", { name: "에이전트 채팅", exact: true }).click();
  await expect(composer).toHaveValue("보관할 질문");
  expect(await composerNode!.evaluate((el) => el === document.querySelector('[aria-label="채팅 메시지"]'))).toBe(true);
  expect(await bodyNode!.evaluate((el) => el === document.querySelector('[aria-label="문서 본문"]'))).toBe(true);
  await page.locator(".document-prose > p").first().click(); await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByText("보관할 생각", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 600, height: 480 });
  await expect(composer).toBeVisible();
  // ResizeObserver applies constraints on the next frame; compare both rectangles together.
  await expect.poll(() => page.evaluate(() => {
    const primary = document.querySelector('[data-testid="box-primary"]')!.getBoundingClientRect();
    const chat = document.querySelector('.agent-chat-inline')!.getBoundingClientRect();
    return primary.right <= chat.left + 1 && chat.right <= 600.5 && chat.width >= 219.5;
  })).toBe(true);
  await composer.scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("acp-panels-narrow.png") });
  expect(await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.writes)).toEqual([]);
});

test("real HTTP/WS and ACP permission/session state survive collapse and coexist with central site bounds", async ({ page }) => {
  await page.goto("/"); await page.locator(".document-list button").first().click();
  const composer = await startChat(page);
  const pid = Number(readFileSync(resolve(host.dataDir, "agent.pid"), "utf8"));
  await composer.fill("첫 질문"); await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("echo:첫 질문", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "채팅 숨기기" }).click();
  expect(() => process.kill(pid, 0)).not.toThrow();
  await page.getByRole("button", { name: "채팅 패널", exact: true }).click();
  await expect(page.getByText("echo:첫 질문", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Allow", exact: true }).click(); await expect(composer).toBeEnabled();
  await composer.fill("두 번째 질문"); await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("echo:두 번째 질문", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.getByRole("button", { name: "채팅 숨기기" }).click();
  await page.getByRole("button", { name: "에이전트 채팅", exact: true }).click(); await expect(composer).toBeEnabled();
  await composer.fill("사이트와 함께 보관할 초안");
  await page.getByRole("button", { name: "사이트 브라우저", exact: false }).click();
  await page.getByRole("textbox", { name: "사이트 주소" }).fill("example.com/panels");
  await page.getByRole("button", { name: "이동", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.site.visible)).toBe(true);
  const region = (await page.getByLabel("사이트 표시 영역").boundingBox())!;
  await expect.poll(() => page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.siteBounds!.width)).toBeCloseTo(region.width, 0);
  await expect(composer).toHaveValue("사이트와 함께 보관할 초안");
  expect(() => process.kill(pid, 0)).not.toThrow();
  await page.getByRole("button", { name: "세션 종료", exact: true }).click();
  await expect.poll(() => { try { process.kill(pid, 0); return false; } catch { return true; } }).toBe(true);
  expect(readFileSync(resolve(host.dataDir, "agent.log"), "utf8").split("\n").filter(line => line.startsWith("prompt:"))).toHaveLength(2);
});
