import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DocumentSnapshot, WorkspaceSnapshot } from "@box/contracts";
import { readDocument } from "@/entities/document";
import { useWikilinkTargets } from "./use-wikilink-targets";

vi.mock("@/entities/document", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/entities/document")>(), readDocument: vi.fn(),
}));
afterEach(() => { cleanup(); vi.mocked(readDocument).mockReset(); });
const workspace = (root: string): WorkspaceSnapshot => ({
  path: root, truncated: false,
  documents: [{ path: `${root}/note.md`, name: "note.md", relativePath: "note.md" }],
});
const snapshot = (root: string, title: string): DocumentSnapshot => ({
  path: `${root}/note.md`, revision: "1", content: `---\npermalink: stable\n---\n# ${title}`,
});

it("ignores an old workspace result and does not rescan for surrounding prose edits", async () => {
  let finishOld!: (value: DocumentSnapshot) => void;
  const pending = new Promise<DocumentSnapshot>((resolve) => { finishOld = resolve; });
  vi.mocked(readDocument).mockImplementation((path) => path.startsWith("/old/") ? pending : Promise.resolve(snapshot("/new", "새 디렉터리 제목")));
  const old = workspace("/old"), next = workspace("/new");
  const hook = renderHook(({ folder, content }) => useWikilinkTargets(folder, content), {
    initialProps: { folder: old, content: "[[stable]]" },
  });
  expect(hook.result.current.get("stable")!.state).toBe("loading");
  hook.rerender({ folder: next, content: "[[stable]]" });
  await waitFor(() => expect(hook.result.current.get("stable")).toEqual({ state: "resolved", title: "새 디렉터리 제목" }));
  await act(async () => { finishOld(snapshot("/old", "오래된 제목")); await pending; });
  expect(hook.result.current.get("stable")).toEqual({ state: "resolved", title: "새 디렉터리 제목" });
  hook.rerender({ folder: next, content: "[[stable]] 주변 본문 수정" });
  expect(readDocument).toHaveBeenCalledTimes(2);
});

it("does not query wikilink-looking text in frontmatter or code", () => {
  const content = '---\nsummary: "[[metadata]]"\n---\n`[[inline]]`\n\n```md\n[[code]]\n```';
  const root = workspace("/root");
  const hook = renderHook(() => useWikilinkTargets(root, content));
  expect(hook.result.current.size).toBe(0);
  expect(readDocument).not.toHaveBeenCalled();
});
