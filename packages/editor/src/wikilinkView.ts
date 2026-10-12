import type { Editor, NodeViewRenderer, NodeViewRendererProps } from "@tiptap/core";

export type WikilinkTarget =
  | { state: "loading" }
  | { state: "resolved"; title: string }
  | { state: "missing" | "duplicate" | "error"; message: string };
export type WikilinkTargets = ReadonlyMap<string, WikilinkTarget>;
export interface WikilinkStorage {
  targets: WikilinkTargets;
  views: Set<() => void>;
}
declare module "@tiptap/core" {
  interface Storage {
    wikilink: WikilinkStorage;
  }
}

/** Updating a display name creates no document transaction, dirty state or undo entry. */
export function setWikilinkTargets(editor: Editor, targets: WikilinkTargets) {
  if (editor.isDestroyed) return;
  const storage = editor.storage.wikilink as WikilinkStorage;
  storage.targets = targets;
  for (const refresh of storage.views) refresh();
}

export function createWikilinkView(
  node: NodeViewRendererProps["node"],
  storage: WikilinkStorage,
): ReturnType<NodeViewRenderer> {
  const dom = document.createElement("a");
  dom.className = "wikilink";
  dom.contentEditable = "false";
  dom.setAttribute("role", "link");
  dom.setAttribute("data-wikilink", "");
  const label = document.createElement("span");
  const status = document.createElement("span");
  status.className = "wikilink-state";
  dom.append(label, status);
  let current = node;
  function draw() {
    const id = String(current.attrs.permalink);
    const target = storage.targets.get(id) ?? { state: "loading" };
    label.textContent = current.attrs.alias ?? (target.state === "resolved" ? target.title : id);
    dom.dataset.permalink = id;
    dom.dataset.wikilinkState = target.state;
    dom.setAttribute("aria-disabled", String(target.state !== "resolved"));
    dom.setAttribute("aria-busy", String(target.state === "loading"));
    status.hidden = target.state === "resolved";
    if (target.state === "resolved") {
      dom.setAttribute("href", `boxmd://document?permalink=${encodeURIComponent(id)}`);
      dom.title = target.title;
      status.textContent = "";
    } else {
      dom.removeAttribute("href");
      status.textContent = {
        loading: "확인 중",
        missing: "문서 없음",
        duplicate: "중복",
        error: "확인 오류",
      }[target.state];
      dom.title = target.state === "loading" ? "대상 문서를 확인하고 있습니다." : target.message;
    }
  }
  storage.views.add(draw);
  draw();
  return {
    dom,
    update(next) {
      if (next.type.name !== "wikilink") return false;
      current = next;
      draw();
      return true;
    },
    ignoreMutation: () => true,
    stopEvent: () => true,
    destroy: () => { storage.views.delete(draw); },
  };
}
