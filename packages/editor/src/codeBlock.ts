import CodeBlock from "@tiptap/extension-code-block";

/** Avoid closing an ordinary code block on a literal fence inside its contents. */
export const PreservedCodeBlock = CodeBlock.extend({
  renderMarkdown(node, helpers) {
    const language = String(node.attrs?.language ?? "");
    const source = node.content ? helpers.renderChildren(node.content) : "";
    const marker = language.includes("`") ? "~" : "`";
    const runs = [...source.matchAll(marker === "`" ? /`+/g : /~+/g)];
    const fence = marker.repeat(
      Math.max(3, ...runs.map((match) => match[0].length + 1)),
    );
    return `${fence}${language}\n${source}\n${fence}`;
  },
});
