import { Markdown, MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import { parseMarkdownFrontMatter } from "./frontMatter";
import { marked } from "marked";
import { MermaidBlock, restoreMermaidLineEndings } from "./mermaid";
import { PreservedCodeBlock } from "./codeBlock";

export function editorExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: false, protocols: ["boxmd"] },
      underline: false,
    }),
    // Paragraph remains the schema's default block; Mermaid still precedes the code parser.
    MermaidBlock,
    PreservedCodeBlock,
    Image,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Markdown,
  ];
}

const manager = new MarkdownManager({ extensions: editorExtensions() });
export const markdownToDocument = (markdown: string) =>
  restoreMermaidLineEndings(manager.parse(markdown), markdown);
export const documentToMarkdown = (
  document: Parameters<MarkdownManager["serialize"]>[0],
) => manager.serialize(document);

// Preserve the entire front matter envelope, including comments and line endings.
export function splitDocument(markdown: string): {
  prefix: string;
  body: string;
} {
  const match = markdown.match(
    /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/,
  );
  return match
    ? { prefix: match[0], body: markdown.slice(match[0].length) }
    : markdown.startsWith("\uFEFF")
      ? { prefix: "\uFEFF", body: markdown.slice(1) }
      : { prefix: "", body: markdown };
}

export function richTextIssue(markdown: string): string | null {
  const parsed = parseMarkdownFrontMatter(markdown.replace(/^\uFEFF/, ""));
  if (parsed.type === "invalid") return "YAML 속성을 원문에서 확인해주세요.";
  const { body } = splitDocument(markdown);
  type Token = { type: string; raw: string; tokens?: Token[]; items?: Token[] };
  const outsideCode = (tokens: Token[]): string =>
    tokens
      .map((token) =>
        token.type === "code" || token.type === "codespan"
          ? ""
          : token.tokens
            ? outsideCode(token.tokens)
            : token.items
              ? outsideCode(token.items)
              : token.raw,
      )
      .join("\n");
  const prose = outsideCode(marked.lexer(body) as Token[]);
  // These dialects are outside this editor schema; keep the full original in source mode.
  if (
    /\[\[|\(\([a-zA-Z0-9-]+\)\)|^\s*\[\^|^\s*\[[^\]]+\]:|<\/?[a-zA-Z][^>]*>|^\$\$|\$[^\n$]+\$/m.test(
      prose,
    )
  )
    return "이 문서의 확장 문법은 Markdown 원문에서 편집합니다.";
  if (/^\s*\|?.*:[-]{3,}|^\s*\|?.*[-]{3,}:/m.test(prose))
    return "정렬된 표는 Markdown 원문에서 편집합니다.";
  return null;
}

export { parseMarkdownFrontMatter } from "./frontMatter";

export { documentProperty, setDocumentProperty } from "./metadata";
export { MermaidBlock } from "./mermaid";
