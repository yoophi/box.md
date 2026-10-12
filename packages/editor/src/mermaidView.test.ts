// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import { DecorationSet } from "@tiptap/pm/view";
import { editorExtensions, markdownToDocument } from "./index";
import { createMermaidView } from "./mermaidView";

afterEach(() => document.body.replaceChildren());
const node = (source: string) =>
  getSchema(editorExtensions()).nodeFromJSON(
    markdownToDocument(`\`\`\`mermaid\n${source}\n\`\`\``).content![0],
  );
function svg(text: string) {
  const root = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  root.textContent = text;
  return root;
}
it("ignores a stale completion and isolates the chart in a noneditable shadow tree", async () => {
  const pending: ((value: SVGSVGElement) => void)[] = [];
  const render = vi.fn(
    () => new Promise<SVGSVGElement>((resolve) => pending.push(resolve)),
  );
  const view = createMermaidView(node("graph TD\nA --> B"), render);
  document.body.append(view.dom);
  expect((view.dom as HTMLElement).contentEditable).toBe("false");
  view.update!(node("graph TD\nC --> D"), [], DecorationSet.empty);
  pending[1](svg("new"));
  await vi.waitFor(() =>
    expect((view.dom as HTMLElement).dataset.mermaidState).toBe("ready"),
  );
  pending[0](svg("old"));
  await Promise.resolve();
  expect(
    view.dom.querySelector(".mermaid-drawing")!.shadowRoot!.textContent,
  ).toContain("new");
  expect(
    view.dom.querySelector(".mermaid-drawing")!.shadowRoot!.textContent,
  ).not.toContain("old");
});
it("reports one failed diagram without changing another view", async () => {
  const bad = createMermaidView(node("invalid"), async () => {
    throw new Error("private source must not leak");
  });
  const good = createMermaidView(node("graph TD\nA --> B"), async () =>
    svg("good"),
  );
  document.body.append(bad.dom, good.dom);
  await vi.waitFor(() =>
    expect((bad.dom as HTMLElement).dataset.mermaidState).toBe("error"),
  );
  expect(bad.dom.querySelector('[role="alert"]')!.textContent).toContain(
    "Markdown 원문",
  );
  expect(bad.dom.textContent).not.toContain("private source");
  expect((good.dom as HTMLElement).dataset.mermaidState).toBe("ready");
});
it("does not apply a completion to a destroyed view or rerender an unchanged source", async () => {
  let finish!: (value: SVGSVGElement) => void;
  const render = vi.fn(
    () =>
      new Promise<SVGSVGElement>((resolve) => {
        finish = resolve;
      }),
  );
  const current = node("graph TD\nA --> B"),
    view = createMermaidView(current, render);
  expect(view.update!(current, [], DecorationSet.empty)).toBe(true);
  expect(render).toHaveBeenCalledTimes(1);
  view.destroy!();
  finish(svg("late"));
  await Promise.resolve();
  expect((view.dom as HTMLElement).dataset.mermaidState).toBe("loading");
  expect(
    view.dom
      .querySelector(".mermaid-drawing")!
      .shadowRoot!.querySelector("svg"),
  ).toBeNull();
});
