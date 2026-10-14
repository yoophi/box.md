import type { SiteSelection } from "@box/contracts";

function yaml(value: string) {
  return JSON.stringify(value);
}

function heading(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([`*_[\]<>#])/g, "\\$1");
}

function summary(text: string) {
  return [...text.trim().replace(/\s+/gu, " ")].slice(0, 160).join("");
}

function fence(text: string) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(([run]) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function siteScrapContent(selection: SiteSelection, capturedAt: string) {
  if (!Number.isFinite(Date.parse(capturedAt)))
    throw new Error("스크랩 시각을 확인하지 못했습니다.");
  const title = selection.title.trim() || "웹 스크랩";
  const marker = fence(selection.text);
  return [
    "---",
    `title: ${yaml(title)}`,
    `summary: ${yaml(summary(selection.text))}`,
    `source: ${yaml(selection.url)}`,
    `source_title: ${yaml(selection.title)}`,
    `captured_at: ${yaml(capturedAt)}`,
    "---",
    `# ${heading(title)}`,
    "",
    `${marker}text`,
    selection.text,
    marker,
    "",
  ].join("\n");
}
