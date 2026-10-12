import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import {
  documentToMarkdown,
  editorExtensions,
  markdownToDocument,
  richTextIssue,
  splitDocument,
} from "./index";

describe("Mermaid source preservation", () => {
  it("preserves a standalone BOM before a diagram without YAML", () => {
    const raw = "```mermaid\r\ngraph TD\r\nA --> B\r\n```";
    const { prefix, body } = splitDocument("\uFEFF" + raw);
    expect(prefix).toBe("\uFEFF");
    const doc = markdownToDocument(body);
    expect(doc.content![0].type).toBe("mermaidBlock");
    expect(prefix + documentToMarkdown(doc)).toBe("\uFEFF" + raw);
  });
  it.each(["```", "~~~~", "````"])(
    "preserves the %s fence and source while surrounding prose changes",
    (fence) => {
      const raw = `${fence}mermaid\nflowchart LR\n  A[생각 🌱] --> B[기록]\n\n${fence}`;
      const doc = markdownToDocument(`# 문서\n\n${raw}\n\n마지막 본문`);
      const chart = doc.content!.find((node) => node.type === "mermaidBlock")!;
      expect(chart.attrs?.raw).toBe(raw);
      expect(chart.content).toBeUndefined();
      doc.content!.at(-1)!.content![0].text = "수정한 주변 본문";
      expect(documentToMarkdown(doc)).toContain(raw);
      expect(documentToMarkdown(doc)).toContain("수정한 주변 본문");
    },
  );
  it("preserves CRLF and mixed endings in multiple charts", () => {
    const one = "```mermaid\r\nflowchart LR\r\nA --> B\r\n```";
    const two = "~~~mermaid\nsequenceDiagram\r\nA->>B: 안녕\n~~~";
    const doc = markdownToDocument(`${one}\r\n\r\n본문\n\n${two}`);
    const output = documentToMarkdown(doc);
    expect(output).toContain(one);
    expect(output).toContain(two);
    expect(
      doc.content!.filter((node) => node.type === "mermaidBlock"),
    ).toHaveLength(2);
  });
  it("keeps nested quote diagrams and ordinary code as separate node types", () => {
    const doc = markdownToDocument(
      "> ```mermaid\r\n> graph TD\r\n> A --> B\r\n> ```\n\n```ts\nconst x = 1\n```",
    );
    expect(doc.content![0].content![0].type).toBe("mermaidBlock");
    expect(doc.content![1].type).toBe("codeBlock");
    expect(documentToMarkdown(doc)).toContain(
      "> ```mermaid\r\n> graph TD\r\n> A --> B\r\n> ```",
    );
  });
  it("does not borrow line endings from a diagram literal inside another code block", () => {
    const literal =
      "````txt\r\n```mermaid\r\ngraph TD\r\nA --> B\r\n```\r\n````";
    const actual = "```mermaid\ngraph TD\nA --> B\n```";
    const doc = markdownToDocument(`${literal}\n\n${actual}`);
    expect(
      doc.content!.find((node) => node.type === "mermaidBlock")!.attrs!.raw,
    ).toBe(actual);
    const reopened = markdownToDocument(documentToMarkdown(doc));
    expect(
      reopened.content!.filter((node) => node.type === "mermaidBlock"),
    ).toHaveLength(1);
    expect(reopened.content![0].content).toEqual(doc.content![0].content);
  });
  it("preserves line endings in a quote nested within a list", () => {
    const doc = markdownToDocument(
      "- > ```mermaid\r\n  > graph TD\r\n  > A --> B\r\n  > ```",
    );
    const output = documentToMarkdown(doc);
    expect(output).toContain("```mermaid\r\n");
    expect(output).toContain("A --> B\r\n");
    getSchema(editorExtensions()).nodeFromJSON(doc).check();
    const reopened = markdownToDocument(output);
    const diagrams = (node: typeof doc): string[] =>
      node.type === "mermaidBlock"
        ? [String(node.attrs!.source)]
        : (node.content ?? []).flatMap(diagrams);
    expect(diagrams(reopened)).toEqual(diagrams(doc));
  });
  it("does not mistake code or diagram labels for unsupported document syntax", () => {
    expect(
      richTextIssue(
        '```mermaid\ngraph TD\nA["<b>[[label]]</b> $cost$"] --> B\n```',
      ),
    ).toBeNull();
    expect(richTextIssue("`<iframe> [[code]] $x$`")).toBeNull();
    expect(richTextIssue('```ts\nconst html = "<b>raw</b>"\n```')).toBeNull();
    expect(
      richTextIssue(
        "```mermaid\ngraph TD\nA --> B\n```\n\n<iframe>outside</iframe>",
      ),
    ).not.toBeNull();
  });
  it("creates a leaf atom with no editable text content", () => {
    const schema = getSchema(editorExtensions());
    expect(schema.topNodeType.contentMatch.defaultType?.name).toBe("paragraph");
    const chart = schema.nodeFromJSON(
      markdownToDocument("```mermaid\ngraph TD\nA --> B\n```").content![0],
    );
    expect(chart.isAtom).toBe(true);
    expect(chart.isLeaf).toBe(true);
    expect(chart.childCount).toBe(0);
    expect(chart.attrs.source).toContain("A --> B");
  });
});
