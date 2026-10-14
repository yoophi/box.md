import { describe, expect, it } from "vitest";
import { siteScrapContent } from "./site-scrap";

describe("siteScrapContent", () => {
  it("stores source metadata, a one-line summary and unchanged selected text", () => {
    const text = "  첫 줄 🌱\r\n둘째   줄  ";
    const content = siteScrapContent(
      {
        url: "https://example.com/article?q=one&two=2",
        title: '제목: "인용" <script>',
        text,
      },
      "2026-10-14T14:00:00.000Z",
    );
    expect(content).toContain('title: "제목: \\"인용\\" <script>"');
    expect(content).toContain('summary: "첫 줄 🌱 둘째 줄"');
    expect(content).toContain('source: "https://example.com/article?q=one&two=2"');
    expect(content).toContain('source_title: "제목: \\"인용\\" <script>"');
    expect(content).toContain('captured_at: "2026-10-14T14:00:00.000Z"');
    expect(content).toContain('# 제목: "인용" \\<script\\>');
    expect(content).toContain(`\n\`\`\`text\n${text}\n\`\`\`\n`);
    expect(content).not.toContain("permalink:");
  });

  it("uses a longer fence than every backtick run and truncates summary by code point", () => {
    const text = `${"🌱".repeat(161)}\n\`\`\`\` embedded`;
    const content = siteScrapContent(
      { url: "https://example.com", title: "", text },
      "2026-10-14T14:00:00Z",
    );
    expect(content).toContain('title: "웹 스크랩"');
    expect(content).toContain(`\n\`\`\`\`\`text\n${text}\n\`\`\`\`\`\n`);
    const encodedSummary = /^summary: (.+)$/m.exec(content)![1];
    expect([...JSON.parse(encodedSummary)]).toHaveLength(160);
  });

  it("rejects an invalid capture timestamp", () => {
    expect(() =>
      siteScrapContent(
        { url: "https://example.com", title: "title", text: "selected" },
        "not-a-date",
      ),
    ).toThrow("스크랩 시각을 확인하지 못했습니다.");
  });
});
