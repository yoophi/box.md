import { expect, test } from "@playwright/test";
import { seedWorkspace } from "./native-fixture";

const first = "---\npermalink: first\nsummary: 첫 카드 요약\n---\n# 첫 문서\n\n첫 본문";
const second = "---\npermalink: second\nsummary: 둘째 카드 요약\n---\n# 둘째 문서\n\n둘째 본문";

test("pans, zooms, connects cards and edits a document through the persisted canvas", async ({ page }, testInfo) => {
  await seedWorkspace(page, 2, {
    contents: { "/fixture/note-001.md": first, "/fixture/note-002.md": second },
    persistConnections: true,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "문서 카드 보기" }).click();
  const canvas = page.getByRole("region", { name: "무한 문서 캔버스" });
  const world = canvas.locator(".cards-world");
  const cards = canvas.locator(".document-card");
  await expect(cards).toHaveCount(2);
  await expect(page.getByText("첫 카드 요약", { exact: true })).toBeVisible();
  await expect(world).toHaveCSS("transform", /matrix\(1, 0, 0, 1, 48, 42\)/);

  const canvasBox = (await canvas.boundingBox())!;
  await page.mouse.move(canvasBox.x + canvasBox.width - 40, canvasBox.y + canvasBox.height - 45);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width - 95, canvasBox.y + canvasBox.height - 80);
  await page.mouse.up();
  await expect(world).not.toHaveCSS("transform", /matrix\(1, 0, 0, 1, 48, 42\)/);

  await page.getByRole("button", { name: "확대", exact: true }).click();
  await expect(page.getByRole("status", { name: "확대율" })).toHaveText("115%");
  const firstCard = cards.first();
  const beforeDrag = await firstCard.getAttribute("style");
  const cardBox = (await firstCard.boundingBox())!;
  await page.mouse.move(cardBox.x + 200, cardBox.y + 70);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + 246, cardBox.y + 93);
  await page.mouse.up();
  await expect.poll(() => firstCard.getAttribute("style")).not.toBe(beforeDrag);
  await expect(page.getByRole("dialog", { name: "note-001.md" })).toHaveCount(0);

  const firstButton = page.getByRole("button", { name: "note-001.md 카드 선택" });
  const secondButton = page.getByRole("button", { name: "note-002.md 카드 선택" });
  await firstButton.click(); await secondButton.click();
  await expect(firstButton).toHaveAttribute("aria-pressed", "true");
  await expect(secondButton).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "선택한 두 문서 연결" }).click();
  await expect(page.getByText("두 문서를 연결했습니다.", { exact: true })).toBeVisible();
  await expect(canvas.locator(".card-connection-line")).toHaveCount(1);
  const connectionState = await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.connections);
  expect(connectionState.entities).toHaveLength(1);
  expect(connectionState.memberships.map((edge) => edge.permalink).sort()).toEqual(["first", "second"]);

  await firstButton.dblclick();
  const modal = page.getByRole("dialog", { name: "note-001.md" });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "편집", exact: true }).click();
  await modal.getByRole("button", { name: "Markdown 원문", exact: true }).click();
  const source = modal.getByRole("textbox", { name: "Markdown 원문", exact: true });
  await source.fill(`${first.replace("permalink: first", 'permalink: first\ntitle: "변경한 카드 제목 🌱"')}\n\n캔버스 모달 저장`);
  await modal.getByRole("button", { name: "저장", exact: true }).click();
  await expect(modal.getByText("문서를 저장했습니다.", { exact: true })).toBeVisible();
  const fileState = await page.evaluate(() => ({
    content: window.__BOX_BROWSER_FIXTURE__.content.get("/fixture/note-001.md"),
    writes: window.__BOX_BROWSER_FIXTURE__.writes,
  }));
  expect(fileState.content).toContain("캔버스 모달 저장");
  expect(fileState.writes).toHaveLength(1);
  expect(fileState.writes[0].path).toBe("/fixture/note-001.md");
  await modal.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(firstCard.getByRole("heading", { name: "변경한 카드 제목 🌱" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "문서 카드 보기" }).click();
  await expect(page.getByRole("region", { name: "무한 문서 캔버스" }).locator(".card-connection-line")).toHaveCount(1);
  await testInfo.attach("document-card-canvas.png", { body: await page.screenshot(), contentType: "image/png" });
});

test("saves title frontmatter through properties and uses it on cards after reopening", async ({ page }) => {
  await seedWorkspace(page, 2, { contents: { "/fixture/note-001.md": first, "/fixture/note-002.md": second } });
  await page.goto("/");
  await page.getByRole("button", { name: "문서 카드 보기" }).click();
  await expect(page.locator(".document-card h2")).toHaveText(["제목 없음", "제목 없음"]);
  await page.getByRole("button", { name: "편집 화면으로 돌아가기" }).click();
  await page.getByRole("region", { name: "작업 디렉터리 문서" }).getByRole("button", { name: /note-001\.md/ }).click();
  await page.getByRole("textbox", { name: "문서 제목", exact: true }).fill('문서: "제목" 🌱');
  await page.getByRole("button", { name: "문서에 적용", exact: true }).click();
  await page.getByRole("button", { name: /^저장/ }).click();
  await expect(page.getByText("저장하지 않은 변경사항", { exact: true })).toHaveCount(0);
  const stored = await page.evaluate(() => window.__BOX_BROWSER_FIXTURE__.content.get("/fixture/note-001.md"));
  expect(stored).toContain("permalink: first");
  expect(stored).toContain("첫 카드 요약");
  expect(stored).toContain("# 첫 문서\n\n첫 본문");
  await page.getByRole("button", { name: "다시 불러오기", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "문서 제목", exact: true })).toHaveValue('문서: "제목" 🌱');
  await page.getByRole("button", { name: "문서 카드 보기" }).click();
  await expect(page.locator(".document-card h2")).toHaveText(['문서: "제목" 🌱', "제목 없음"]);
});
