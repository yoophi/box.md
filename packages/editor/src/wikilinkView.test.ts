// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions, markdownToDocument, setWikilinkTargets } from "./index";

let editor: Editor;
afterEach(() => editor?.destroy());

it("updates titles without editing source or adding transactions and keeps aliases", () => {
  const source = "[[stable]] 그리고 [[ stable | 고정 별칭 ]]";
  const update = vi.fn(), transaction = vi.fn();
  editor = new Editor({ extensions: editorExtensions(), content: markdownToDocument(source), onUpdate: update, onTransaction: transaction });
  setWikilinkTargets(editor, new Map([["stable", { state: "resolved", title: "첫 제목" }]]));
  const anchors = editor.view.dom.querySelectorAll("a.wikilink");
  expect(anchors[0].textContent).toBe("첫 제목");
  expect(anchors[1].textContent).toBe("고정 별칭");
  setWikilinkTargets(editor, new Map([["stable", { state: "resolved", title: "<img onerror=attack()> 새 제목" }]]));
  expect(anchors[0].textContent).toBe("<img onerror=attack()> 새 제목");
  expect(anchors[1].textContent).toBe("고정 별칭");
  expect(anchors[0].querySelector("img,script")).toBeNull();
  expect(editor.getMarkdown()).toBe(source);
  expect(update).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
});

it("makes missing, duplicate and failed targets identifiable without navigable hrefs", () => {
  editor = new Editor({ extensions: editorExtensions(), content: markdownToDocument("[[stable | 별칭]]") });
  const anchor = editor.view.dom.querySelector("a.wikilink")!;
  expect(anchor.getAttribute("data-wikilink-state")).toBe("loading");
  expect(anchor.hasAttribute("href")).toBe(false);
  for (const state of ["missing", "duplicate", "error"] as const) {
    setWikilinkTargets(editor, new Map([["stable", { state, message: "설명" }]]));
    expect(anchor.getAttribute("data-wikilink-state")).toBe(state);
    expect(anchor.getAttribute("aria-disabled")).toBe("true");
    expect(anchor.hasAttribute("href")).toBe(false);
    expect(anchor.querySelector("span")!.textContent).toBe("별칭");
    expect(anchor.textContent).toContain({ missing: "문서 없음", duplicate: "중복", error: "확인 오류" }[state]);
  }
  setWikilinkTargets(editor, new Map([["stable", { state: "resolved", title: "제목" }]]));
  expect(anchor.getAttribute("href")).toBe("boxmd://document?permalink=stable");
  expect(anchor.getAttribute("aria-disabled")).toBe("false");
});

it("retires display subscriptions with the editor", () => {
  editor = new Editor({ extensions: editorExtensions(), content: markdownToDocument("[[stable]]") });
  const anchor = editor.view.dom.querySelector("a.wikilink")!;
  const original = anchor.textContent;
  const storage = editor.storage.wikilink;
  expect(storage.views.size).toBe(1);
  editor.destroy();
  expect(storage.views.size).toBe(0);
  setWikilinkTargets(editor, new Map([["stable", { state: "resolved", title: "지연 결과" }]]));
  expect(anchor.textContent).toBe(original);
});
