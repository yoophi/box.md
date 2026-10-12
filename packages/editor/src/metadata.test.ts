import { describe, it, expect } from "vitest";
import { parseDocument } from "yaml";
import { documentProperty, setDocumentProperty } from "./metadata";

describe("document front matter properties", () => {
  it("stores summary as a string and leaves existing permalink and nested metadata intact", () => {
    const original = "---\npermalink: stable\nextra: {a: 2}\n---\nbody\n";
    const saved = setDocumentProperty(original, "summary", "true");
    expect(documentProperty(saved, "summary")).toBe("true");
    expect(documentProperty(saved, "permalink")).toBe("stable");
    expect(saved.endsWith("---\nbody\n")).toBe(true);
  });
  it("adds a string permalink and preserves body exactly", () => {
    const body = "\n# 문서\n\n원문 🌱  \n";
    const saved = setDocumentProperty(body, "permalink", "/notes/생각");
    expect(documentProperty(saved, "permalink")).toBe("/notes/생각");
    expect(saved.slice(saved.indexOf("---\n", 4) + 4)).toBe(body);
  });
  it("preserves unknown metadata, comments, CRLF and the body while changing a value", () => {
    const original = '\uFEFF---\r\n# 속성 메모\r\nsummary: 기존 요약\r\ntags: [a, b]\r\ncustom: {count: 2, enabled: true}\r\npermalink: /old\r\n...\r\n\r\n# 본문\r\n  그대로\r\n';
    const saved = setDocumentProperty(original, "permalink", "true");
    expect(documentProperty(saved, "permalink")).toBe("true");
    expect(documentProperty(saved, "summary")).toBe("기존 요약");
    expect(saved).toContain("# 속성 메모\r\n");
    expect(saved.endsWith('...\r\n\r\n# 본문\r\n  그대로\r\n')).toBe(true);
    const values = parseDocument(saved.slice(6, saved.indexOf('...'))).toJS();
    expect(values.custom).toEqual({count: 2, enabled: true});
    expect(values.tags).toEqual(["a", "b"]);
  });
  it("rejects malformed, duplicate or unclosed metadata without returning a replacement", () => {
    for (const source of ["---\nkey: [\n---\nbody", "---\npermalink: a\npermalink: b\n---\nbody", "---\nkey: a\nbody"])
      expect(() => setDocumentProperty(source, "permalink", "/new")).toThrow();
  });
  it("accepts empty front matter and rejects multiline values", () => {
    expect(documentProperty(setDocumentProperty("---\n---\nbody", "permalink", "2026-01-01"), "permalink")).toBe("2026-01-01");
    expect(() => setDocumentProperty("body", "summary", "a\nb")).toThrow();
  });
});
