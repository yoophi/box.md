// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getSchema, type JSONContent } from "@tiptap/core";
import { DOMParser, DOMSerializer } from "@tiptap/pm/model";
import {
  documentToMarkdown,
  editorExtensions,
  markdownToDocument,
  richTextIssue,
} from "./index";

function links(node: JSONContent): JSONContent[] {
  return node.type === "wikilink" ? [node] : (node.content ?? []).flatMap(links);
}

describe("wikilink source contract", () => {
  it.each([
    ["[[stable]]", "stable", null],
    ["[[ stable | 별칭 🌱 ]]", "stable", "별칭 🌱"],
    ["[[/notes/한글 ?#&|표시 | 추가]]", "/notes/한글 ?#&", "표시 | 추가"],
  ])("keeps the original token %s while prose changes", (raw, permalink, alias) => {
    const doc = markdownToDocument(`앞 ${raw} 뒤`);
    expect(links(doc)).toHaveLength(1);
    expect(links(doc)[0].attrs).toEqual({ permalink, alias, raw });
    expect(links(doc)[0].content).toBeUndefined();
    doc.content![0].content![0].text = "수정한 앞 ";
    expect(documentToMarkdown(doc)).toBe(`수정한 앞 ${raw} 뒤`);
    expect(links(markdownToDocument(documentToMarkdown(doc)))[0].attrs).toEqual({ permalink, alias, raw });
  });

  it("keeps several links inside marks, lists and tables and preserves the schema", () => {
    const source = "**[[one]]** 그리고 [[two | 이름]]\n\n- [[three]]\n\n| 링크 |\n| --- |\n| [[four]] |";
    const doc = markdownToDocument(source);
    expect(links(doc).map((node) => node.attrs!.permalink)).toEqual(["one", "two", "three", "four"]);
    getSchema(editorExtensions()).nodeFromJSON(doc).check();
    expect(links(markdownToDocument(documentToMarkdown(doc))).map((node) => node.attrs)).toEqual(links(doc).map((node) => node.attrs));
  });

  it("does not interpret fenced code, inline code or escaped brackets as links", () => {
    const source = "`[[inline]]`\n\n```md\n[[fenced | 別名]]\n```\n\n\\[[escaped]]\n\n[[actual]]";
    const doc = markdownToDocument(source);
    expect(links(doc).map((node) => node.attrs!.permalink)).toEqual(["actual"]);
    const saved = documentToMarkdown(doc);
    expect(saved).toContain("`[[inline]]`");
    expect(saved).toContain("[[fenced | 別名]]");
    expect(links(markdownToDocument(saved)).map((node) => node.attrs!.permalink)).toEqual(["actual"]);
  });

  it.each(["[[]]", "[[ | alias]]", "[[target | ]]", "[[unclosed", "[[two\nlines]]"])(
    "keeps malformed syntax as literal text: %s", (source) => {
      const doc = markdownToDocument(source);
      expect(links(doc)).toHaveLength(0);
      expect(markdownToDocument(documentToMarkdown(doc))).toEqual(doc);
    },
  );

  it("allows wikilinks in rich mode without interpreting alias text as HTML or math", () => {
    expect(richTextIssue('[[stable | <img src=x onerror=attack()> $alias$ ]]')).toBeNull();
    expect(richTextIssue("[[stable]]\n\n<iframe>outside</iframe>")).not.toBeNull();
  });

  it("uses a leaf atom and serializes identity rather than an added display title", () => {
    const schema = getSchema(editorExtensions());
    const doc = markdownToDocument("[[stable]]");
    const link = schema.nodeFromJSON(links(doc)[0]);
    expect(link.isInline && link.isLeaf && link.isAtom).toBe(true);
    links(doc)[0].attrs!.displayTitle = "대상의 새 제목";
    expect(documentToMarkdown(doc)).toBe("[[stable]]");
  });

  it("exports inert alias text and restores validated raw from HTML clipboard", () => {
    const source = '[[ stable | <img src=x onerror=attack()> ]]';
    const schema = getSchema(editorExtensions());
    const doc = schema.nodeFromJSON(markdownToDocument(source));
    const container = document.createElement("div");
    container.append(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
    const anchor = container.querySelector("a")!;
    expect(anchor.textContent).toBe("<img src=x onerror=attack()>");
    expect(container.querySelector("img,script")).toBeNull();
    expect(anchor.getAttribute("href")).toBe("boxmd://document?permalink=stable");
    expect(anchor.getAttribute("contenteditable")).toBe("false");
    const reopened = DOMParser.fromSchema(schema).parse(container).toJSON();
    expect(documentToMarkdown(reopened)).toBe(source);
    // Display labels are disposable; the raw identity remains authoritative.
    anchor.textContent = "対象の最新タイトル";
    expect(documentToMarkdown(DOMParser.fromSchema(schema).parse(container).toJSON())).toBe(source);
    anchor.setAttribute("data-wikilink-raw", "[[broken");
    expect(links(DOMParser.fromSchema(schema).parse(container).toJSON())).toHaveLength(0);
  });
});
