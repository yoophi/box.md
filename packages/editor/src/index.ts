import { Markdown, MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import { parseMarkdownFrontMatter } from "./frontMatter";

export function editorExtensions() {
  return [
    StarterKit.configure({ link: { openOnClick: false, protocols: ["boxmd"] }, underline: false }),
    Image,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Markdown,
  ];
}

const manager = new MarkdownManager({ extensions: editorExtensions() });
export const markdownToDocument = (markdown: string) => manager.parse(markdown);
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
    : { prefix: "", body: markdown };
}

export function richTextIssue(markdown: string): string | null {
  const parsed = parseMarkdownFrontMatter(markdown.replace(/^\uFEFF/, ""));
  if (parsed.type === "invalid") return "YAML 속성을 원문에서 확인해주세요.";
  const { body } = splitDocument(markdown);
  // These dialects are outside this editor schema; keep the full original in source mode.
  if (
    /\[\[|\(\([a-zA-Z0-9-]+\)\)|^\s*\[\^|^\s*\[[^\]]+\]:|<\/?[a-zA-Z][^>]*>|^\$\$|\$[^\n$]+\$/m.test(
      body,
    )
  )
    return "이 문서의 확장 문법은 Markdown 원문에서 편집합니다.";
  if (/^\s*\|?.*:[-]{3,}|^\s*\|?.*[-]{3,}:/m.test(body))
    return "정렬된 표는 Markdown 원문에서 편집합니다.";
  return null;
}

export { parseMarkdownFrontMatter } from "./frontMatter";

export { documentProperty, setDocumentProperty } from "./metadata";
