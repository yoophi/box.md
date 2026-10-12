import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePage } from "./HomePage";

const native = vi.hoisted(() => ({ content: "", revision: 1, versions: [] as string[] }));
vi.mock("@/shared/lib/runtime", () => ({ isDesktop: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string, args: Record<string, unknown>) => {
  if (command === "list_workspace_documents") return { path: "/workspace", documents: [{ path: "/workspace/note.md", name: "note.md", relativePath: "note.md" }], truncated: false };
  if (command === "open_document") return { path: args.path, content: native.content, revision: String(native.revision) };
  if (command === "save_document") {
    native.versions.push(native.content); native.content = String(args.content); native.revision++;
    return { path: args.path, content: native.content, revision: String(native.revision) };
  }
  if (command === "document_history") return native.versions.map((_, i) => ({ id: String(i), savedAt: "2026-10-12T10:00:00Z" }));
  if (command === "history_content") return native.versions[Number(args.id)];
  return null;
}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {}, close: async () => {} }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null, save: async () => null }));

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), clear: () => stored.clear(), removeItem: (key: string) => stored.delete(key) });
  localStorage.clear(); localStorage.setItem("box.md.workspace-path", "/workspace");
  native.content = "---\nsummary: 원래 요약\ncustom: {enabled: true}\n---\n# 문서\n\n안녕 🌱\n";
  native.revision = 1; native.versions = [];
});
afterEach(cleanup);
describe("document workspace flows", () => {
  it("sets permalink, saves the full document and reopens the stored value", async () => {
    const user = userEvent.setup();
    const view = render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.type(screen.getByRole("textbox", { name: "permalink" }), "/notes/hello");
    await user.click(screen.getByRole("button", { name: "문서에 적용" }));
    expect(screen.getByText("저장하지 않은 변경사항")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^저장/ }));
    await waitFor(() => expect(native.content).toContain('/notes/hello'));
    expect(native.content).toContain("summary: 원래 요약");
    expect(native.content).toContain("custom: { enabled: true }");
    expect(native.content.endsWith("# 문서\n\n안녕 🌱\n")).toBe(true);
    view.unmount(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "permalink" }) as HTMLInputElement).value).toBe("/notes/hello"));
  });
  it("previews history and restores into the editor before saving", async () => {
    native.versions = ["# 이전 버전\n\n복원 내용"];
    const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    const disk = native.content;
    await user.click(screen.getByRole("button", { name: "히스토리" }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "이전 버전 원문" }) as HTMLTextAreaElement).value).toContain("복원 내용"));
    await user.click(screen.getByRole("button", { name: "이 버전으로 복원" }));
    expect(native.content).toBe(disk);
    expect(screen.getByText("저장하지 않은 변경사항")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^저장/ }));
    await waitFor(() => expect(native.content).toBe("# 이전 버전\n\n복원 내용"));
  });
});
