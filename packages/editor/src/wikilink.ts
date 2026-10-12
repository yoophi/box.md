import { Node } from "@tiptap/core";

const pattern = /^\[\[([^\[\]\r\n]+)\]\]/;

function parse(raw: string) {
  const match = pattern.exec(raw);
  if (!match || match[0] !== raw) return null;
  const separator = match[1].indexOf("|");
  const permalink = (separator < 0 ? match[1] : match[1].slice(0, separator)).trim();
  const alias = separator < 0 ? null : match[1].slice(separator + 1).trim();
  if (!permalink || alias === "") return null;
  return { permalink, alias, raw };
}

function original(attrs: Record<string, unknown>) {
  const permalink = String(attrs.permalink ?? "");
  const alias = attrs.alias == null ? null : String(attrs.alias);
  const raw = String(attrs.raw ?? "");
  const parsed = parse(raw);
  if (parsed?.permalink === permalink && parsed.alias === alias) return raw;
  const fallback = `[[${permalink}${alias === null ? "" : ` | ${alias}`}]]`;
  // Imported JSON with invalid attributes remains literal Markdown.
  return parse(fallback) ? fallback : fallback.replace(/([\\\[\]])/g, "\\$1");
}

/** Display names never become editable content or replace the stored permalink. */
export const Wikilink = Node.create({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      permalink: { default: "", rendered: false },
      alias: { default: null, rendered: false },
      raw: { default: "", rendered: false },
    };
  },
  parseHTML() {
    return [{
      tag: "a[data-wikilink]",
      // Parse this node before the ordinary link mark.
      priority: 60,
      getAttrs: (element) => parse(element.getAttribute("data-wikilink-raw") ?? "") ?? false,
    }];
  },
  renderHTML({ node }) {
    return ["a", {
      "data-wikilink": "",
      "data-wikilink-raw": original(node.attrs),
      "data-permalink": node.attrs.permalink,
      class: "wikilink",
      contenteditable: "false",
      href: `boxmd://document?permalink=${encodeURIComponent(node.attrs.permalink)}`,
    }, node.attrs.alias ?? node.attrs.permalink];
  },
  markdownTokenName: "wikilink",
  markdownTokenizer: {
    name: "wikilink",
    level: "inline",
    start: (source) => source.indexOf("[["),
    tokenize(source) {
      const match = pattern.exec(source);
      if (!match || !parse(match[0])) return;
      return { type: "wikilink", raw: match[0] };
    },
  },
  parseMarkdown(token, helpers) {
    const attrs = parse(String(token.raw ?? ""));
    return attrs ? helpers.createNode("wikilink", attrs) : [];
  },
  renderMarkdown(node) {
    return original(node.attrs ?? {});
  },
});
