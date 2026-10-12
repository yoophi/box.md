import { Node, nodeInputRule, type JSONContent } from "@tiptap/core";
import { marked } from "marked";
import { createMermaidView } from "./mermaidView";

/** A leaf node keeps diagram source outside ProseMirror's editable text content. */
export const MermaidBlock = Node.create({
  name: "mermaidBlock",
  priority: 100,
  group: "block",
  atom: true,
  isolating: true,
  marks: "",
  addNodeView() {
    return ({ node }) => createMermaidView(node);
  },
  addInputRules() {
    return [
      nodeInputRule({
        find: /^(?:`{3,}|~{3,})mermaid[ \t\n]$/i,
        type: this.type,
        getAttributes: (match) => {
          const opening = match[0].trim();
          const fence = opening.match(/^(?:`+|~+)/)![0];
          return { source: "", raw: `${opening}\n\n${fence}` };
        },
      }),
    ];
  },
  addAttributes() {
    return {
      source: { default: "", rendered: false },
      raw: { default: "", rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: "pre",
        getAttrs: (element) => {
          const code = element.querySelector("code");
          if (
            !element.hasAttribute("data-mermaid-block") &&
            !code?.classList.contains("language-mermaid")
          )
            return false;
          const source = element.textContent ?? "";
          const raw = element.getAttribute("data-mermaid-raw") ?? "";
          const tokens = marked
            .lexer(raw)
            .filter((token) => token.type !== "space");
          const valid =
            tokens.length === 1 &&
            tokens[0].type === "code" &&
            String(tokens[0].lang ?? "")
              .split(/\s+/)[0]
              .toLowerCase() === "mermaid" &&
            tokens[0].text === source.replace(/\r\n?/g, "\n");
          return { source, raw: valid ? raw : "" };
        },
      },
    ];
  },
  renderHTML({ node }) {
    // HTML export/clipboard contains inert, escaped text, never SVG or executable diagram input.
    return [
      "pre",
      {
        "data-mermaid-block": "",
        "data-mermaid-raw": node.attrs.raw,
        contenteditable: "false",
      },
      ["code", { class: "language-mermaid" }, node.attrs.source],
    ];
  },
  markdownTokenName: "code",
  parseMarkdown(token, helpers) {
    if (
      String(token.lang ?? "")
        .split(/\s+/)[0]
        .toLowerCase() !== "mermaid"
    )
      return [];
    return helpers.createNode("mermaidBlock", {
      source: token.text ?? "",
      raw: String(token.raw ?? "").replace(/\n+$/, ""),
    });
  },
  renderMarkdown(node) {
    if (node.attrs?.raw) return String(node.attrs.raw);
    const source = String(node.attrs?.source ?? "");
    const length = Math.max(
      3,
      ...[...source.matchAll(/`+/g)].map((match) => match[0].length + 1),
    );
    const fence = "`".repeat(length);
    return `${fence}mermaid\n${source}\n${fence}`;
  },
});

/** Marked normalizes line endings. Recover each diagram's original endings before rich editing.
 * Container prefixes (quotes/lists) stay with the Markdown serializer; diagram lines stay verbatim.
 */
export function restoreMermaidLineEndings(
  document: JSONContent,
  markdown: string,
): JSONContent {
  const lines = [...markdown.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)]
    .filter((match) => match[0])
    .map((match) => ({ text: match[1], ending: match[2] }));
  let cursor = 0;
  const originals: { normalized: string; original: string }[] = [];
  type Token = {
    type: string;
    lang?: string;
    raw: string;
    tokens?: Token[];
    items?: Token[];
  };
  function scan(tokens: Token[]) {
    for (const token of tokens) {
      if (token.type !== "code") {
        scan(token.tokens ?? token.items ?? []);
        continue;
      }
      const raw = token.raw.replace(/\n+$/, "").split("\n");
      let original = raw.join("\n");
      for (let start = cursor; start <= lines.length - raw.length; start++) {
        const prefix = lines[start].text.slice(
          0,
          lines[start].text.length - raw[0].length,
        );
        if (!/^(?:[ \t]+|>[ \t]*|(?:[-+*]|\d+[.)])[ \t]+)*$/.test(prefix))
          continue;
        if (
          !raw.every((line: string, index: number) =>
            lines[start + index].text.endsWith(line),
          )
        )
          continue;
        original = raw
          .map(
            (line: string, index: number) =>
              line +
              (index < raw.length - 1 ? lines[start + index].ending : ""),
          )
          .join("");
        cursor = start + raw.length;
        break;
      }
      if (
        String(token.lang ?? "")
          .split(/\s+/)[0]
          .toLowerCase() === "mermaid"
      )
        originals.push({ normalized: raw.join("\n"), original });
    }
  }
  // Advance past every real code token, including ordinary code containing a diagram example.
  scan(marked.lexer(markdown) as Token[]);
  function visit(node: JSONContent) {
    if (node.type === "mermaidBlock" && node.attrs && originals.length) {
      const normalized = String(node.attrs.raw ?? "").replace(/\r\n?/g, "\n");
      const index = originals.findIndex(
        (item) => item.normalized === normalized,
      );
      if (index >= 0) node.attrs.raw = originals.splice(index, 1)[0].original;
    }
    node.content?.forEach(visit);
    if (
      (node.type === "listItem" || node.type === "taskItem") &&
      node.content?.[0]?.type !== "paragraph"
    ) {
      const containsDiagram = (child: JSONContent): boolean =>
        child.type === "mermaidBlock" ||
        Boolean(child.content?.some(containsDiagram));
      if (node.content?.some(containsDiagram))
        node.content.unshift({ type: "paragraph", content: [] });
    }
  }
  visit(document);
  return document;
}
