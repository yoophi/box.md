import { documentProperty } from "@box/editor";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePage } from "./HomePage";

const native = vi.hoisted(() => ({ content: "", revision: 1, versions: [] as string[], path: "/workspace/note.md", urls: null as string[] | null, targetContent: null as string | null }));
vi.mock("@/shared/lib/runtime", () => ({ isDesktop: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string, args: Record<string, unknown>) => {
  if (command === "list_workspace_documents") return { path: "/workspace", documents: [{ path: native.path, name: native.path.split("/").pop(), relativePath: native.path.split("/").pop() }, ...(native.targetContent === null ? [] : [{ path: "/workspace/target.md", name: "target.md", relativePath: "target.md" }])], truncated: false };
  if (command === "open_document") return { path: args.path, content: args.path === "/workspace/target.md" ? native.targetContent : native.content, revision: String(native.revision) };
  if (command === "save_document") {
    if (args.path === "/workspace/target.md") { native.targetContent = String(args.content); return { path: args.path, content: native.targetContent, revision: "2" }; }
    native.versions.push(native.content); native.content = String(args.content); native.revision++;
    return { path: args.path, content: native.content, revision: String(native.revision) };
  }
  if (command === "document_history") return native.versions.map((_, i) => ({ id: String(i), savedAt: "2026-10-12T10:00:00Z" }));
  if (command === "history_content") return native.versions[Number(args.id)];
  return null;
}) }));
vi.mock("@tauri-apps/plugin-deep-link", () => ({ getCurrent: async () => native.urls, onOpenUrl: async () => () => {} }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: async () => {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {}, close: async () => {} }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null, save: async () => null }));

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), clear: () => stored.clear(), removeItem: (key: string) => stored.delete(key) });
  localStorage.clear(); localStorage.setItem("box.md.workspace-path", "/workspace");
  native.content = "---\nsummary: 원래 요약\ncustom: {enabled: true}\n---\n# 문서\n\n안녕 🌱\n";
  native.revision = 1; native.versions = []; native.path = "/workspace/note.md"; native.urls = null; native.targetContent = null;
});
afterEach(cleanup);
describe("document workspace flows", () => {
  it("creates a target identity, saves a document link, and follows it with unsaved protection", async () => {
    native.targetContent = "# 대상\n\n대상 본문 그대로\n";
    const source = native.content;
    const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "연결할 문서" }), "/workspace/target.md");
    await user.click(screen.getByRole("button", { name: "링크 추가" }));
    const link = await screen.findByRole("link", { name: "target.md" });
    expect(documentProperty(native.targetContent!, "permalink")).toMatch(/^[a-f0-9-]{36}$/);
    expect(native.targetContent?.endsWith("# 대상\n\n대상 본문 그대로\n")).toBe(true);
    expect(native.content).toBe(source);
    fireEvent.click(link);
    expect(screen.getByRole("dialog", { name: "변경사항을 저장할까요?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "취소" }));
    await user.click(screen.getByRole("button", { name: /^저장/ }));
    await waitFor(() => expect(native.content).toContain("[target.md](boxmd://document?permalink="));
    fireEvent.click(screen.getByRole("link", { name: "target.md" }));
    expect(await screen.findByRole("heading", { name: "target.md" })).toBeTruthy();
  });
  it("opens a stable document link after its file was renamed", async () => {
    native.content = "---\npermalink: stable\n---\n# 문서";
    const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    const link = (screen.getByRole("textbox", { name: "문서 고정 링크" }) as HTMLInputElement).value;
    native.path = "/workspace/renamed.md";
    await user.type(screen.getByRole("textbox", { name: "열 문서 링크" }), link);
    await user.click(screen.getByRole("button", { name: "열기" }));
    expect(await screen.findByRole("heading", { name: "renamed.md" })).toBeTruthy();
    expect(screen.getByText("고정 링크로 문서를 열었습니다.")).toBeTruthy();
  });
  it("opens a startup deep link after restoring the workspace", async () => {
    native.content = "---\npermalink: startup\n---\n# 문서";
    native.urls = ["boxmd://document?permalink=startup"];
    render(<HomePage />);
    expect(await screen.findByRole("heading", { name: "note.md" })).toBeTruthy();
    expect(screen.getByText("고정 링크로 문서를 열었습니다.")).toBeTruthy();
  });
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
    await waitFor(() => expect(native.content).toContain("# 이전 버전\n\n복원 내용"));
  });
});
