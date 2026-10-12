import type { NodeViewRenderer, NodeViewRendererProps } from "@tiptap/core";
import { renderMermaid } from "./mermaidRenderer";

export function createMermaidView(
  node: NodeViewRendererProps["node"],
  render = renderMermaid,
): ReturnType<NodeViewRenderer> {
  const dom = document.createElement("figure");
  dom.className = "mermaid-block";
  dom.contentEditable = "false";
  dom.setAttribute("aria-label", "Mermaid 차트");
  const caption = document.createElement("figcaption");
  caption.textContent = "MERMAID · 차트";
  const host = document.createElement("div");
  host.className = "mermaid-drawing";
  // SVG styles remain inside the chart, including user class definitions.
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent =
    ":host{display:block}svg{display:block;height:auto;max-width:100%}";
  const status = document.createElement("p");
  status.className = "mermaid-status";
  dom.append(caption, host, status);
  let source = String(node.attrs.source ?? ""),
    generation = 0,
    destroyed = false;
  function draw() {
    const current = ++generation;
    dom.dataset.mermaidState = "loading";
    status.setAttribute("role", "status");
    status.hidden = false;
    status.textContent = "차트를 그리는 중…";
    shadow.replaceChildren(style);
    void render(source)
      .then((svg) => {
        if (destroyed || current !== generation) return;
        shadow.append(svg);
        status.hidden = true;
        dom.dataset.mermaidState = "ready";
      })
      .catch(() => {
        if (destroyed || current !== generation) return;
        dom.dataset.mermaidState = "error";
        status.setAttribute("role", "alert");
        status.textContent =
          "차트를 표시하지 못했습니다. Markdown 원문에서 문법을 확인하거나 차트를 나눠주세요.";
      });
  }
  draw();
  return {
    dom,
    update(next) {
      if (next.type.name !== "mermaidBlock") return false;
      const changed = String(next.attrs.source ?? "");
      if (changed !== source) {
        source = changed;
        draw();
      }
      return true;
    },
    ignoreMutation: () => true,
    stopEvent: () => true,
    destroy() {
      destroyed = true;
      generation++;
    },
  };
}
