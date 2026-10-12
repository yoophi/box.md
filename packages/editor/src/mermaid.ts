import { Node, nodeInputRule, type JSONContent } from "@tiptap/core";
import { marked } from "marked";

/** A leaf node keeps diagram source outside ProseMirror's editable text content. */
export const MermaidBlock = Node.create({
  name: "mermaidBlock",
  priority: 1000,
  group: "block",
  atom: true,
  isolating: true,
  marks: "",
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
  function visit(node: JSONContent) {
    if (node.type === "mermaidBlock" && typeof node.attrs?.raw === "string") {
      const raw = node.attrs.raw.split("\n");
      for (let start = cursor; start <= lines.length - raw.length; start++) {
        const prefix = lines[start].text.slice(
          0,
          lines[start].text.length - raw[0].length,
        );
        if (
          !/^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?[ \t]*$/.test(prefix)
        )
          continue;
        if (
          !raw.every((line: string, index: number) =>
            lines[start + index].text.endsWith(line),
          )
        )
          continue;
        node.attrs.raw = raw
          .map(
            (line: string, index: number) =>
              line +
              (index < raw.length - 1 ? lines[start + index].ending : ""),
          )
          .join("");
        cursor = start + raw.length;
        break;
      }
    }
    node.content?.forEach(visit);
  }
  visit(document);
  return document;
}
