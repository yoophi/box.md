import { describe, expect, it } from "vitest";
import {
  markdownToDocument,
  documentToMarkdown,
  splitDocument,
  richTextIssue,
} from "./index";

describe("Markdown document preservation", () => {
  it("preserves boxmd document link targets through rich editing", () => {
    const source = "[문서](boxmd://document?permalink=stable)";
    expect(documentToMarkdown(markdownToDocument(source))).toContain("boxmd://document?permalink=stable");
  });
  it("keeps nested YAML, comments, CRLF and body separate", () => {
    const prefix =
      "---\r\n# keep\r\ntitle: 생각\r\nmeta:\r\n  owner: me\r\n---\r\n\r\n";
    expect(splitDocument(prefix + "# 본문")).toEqual({
      prefix,
      body: "# 본문",
    });
    expect(richTextIssue(prefix + "# 본문")).toBeNull();
  });
  it("round trips headings, Unicode, emphasis, links and code", () => {
    const input =
      "# 생각 🌱\n\n**굵게** 그리고 *기울임* [링크](https://example.com)\n\n```ts\nconst x = 1\n```";
    const output = documentToMarkdown(markdownToDocument(input));
    expect(markdownToDocument(output)).toEqual(markdownToDocument(input));
    expect(output).toContain("생각 🌱");
  });
  it("preserves task list checked states and table cells", () => {
    const input =
      "- [x] 완료\n- [ ] 예정\n\n| 이름 | 값 |\n| --- | --- |\n| 생각 | 1 |";
    const output = documentToMarkdown(markdownToDocument(input));
    expect(markdownToDocument(output)).toEqual(markdownToDocument(input));
    expect(output).toContain("[x]");
    expect(output).toContain("생각");
  });
  it.each([
    "[[Logseq]]",
    "<iframe src='view.html'></iframe>",
    "[^ref]: footnote",
    "---\ninvalid: [\n---\nbody",
    "| A |\n| :---: |\n| B |",
  ])("keeps unsupported syntax in source mode: %s", (input) => {
    expect(richTextIssue(input)).not.toBeNull();
  });
  it("does not mistake ordinary fenced code for YAML", () => {
    expect(splitDocument("```yaml\ntitle: hi\n```")).toEqual({
      prefix: "",
      body: "```yaml\ntitle: hi\n```",
    });
  });
});
