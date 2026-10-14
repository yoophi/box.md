import { installPanelLayoutFixture } from "@/shared/testing/panel-layout-fixture";
import { documentProperty } from "@box/editor";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePage } from "./HomePage";
import { createChatClient } from "@/entities/agent-chat";
import { chatFixture, readySession } from "@/features/agent-chat/model/chat-fixture";
import { act } from "@testing-library/react";

vi.mock("@/entities/agent-chat", () => ({ createChatClient: vi.fn() }));

type Created = { path: string; content: string; revision: string; permalink: string };
const native = vi.hoisted(() => ({ content: "", revision: 1, versions: [] as string[], path: "/workspace/note.md", folder: null as string | null, brokenRoots: [] as string[], selectionFailures: [] as string[], selectedRoot: null as string | null, workspaceWarnings: [] as {path: string | null; code: string}[], urls: null as string[] | null, targetContent: null as string | null, comments: {} as Record<string, {id: string; body: string; createdAt: string}[]>, created: {} as Record<string, Created>, requests: {} as Record<string, Created>, createGate: null as Promise<void> | null, openGate: null as Promise<void> | null, saveGate: null as Promise<void> | null, listGate: null as Promise<void> | null, deleted: false, failCreate: false, loseResponse: false, rejectIdentityOnce: false }));
const eventBus = vi.hoisted(() => ({ listeners: new Map<string, Set<(event: { payload: unknown }) => void>>() }));
vi.mock("@/shared/lib/runtime", () => ({ isDesktop: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string, args: Record<string, unknown>) => {
  if (command.startsWith("site_browser_")) return { open: false, visible: false, url: null, title: "", loading: false, canGoBack: false, canGoForward: false };
  if (command === "get_document_mcp_grant") return {grantId:`grant:${args.runId}`,generation:args.generation,runId:args.runId,server:{type:"http",name:"box-documents",url:"http://127.0.0.1:43210/mcp",headers:[{name:"Authorization",value:`Bearer ${"d".repeat(64)}`} ]}};
  if (command === "revoke_document_mcp_grant") return null;
  if (command === "list_connections") return { version: 1, entities: [], memberships: [] };
  if (command === "list_workspace_documents" || command === "select_document_workspace") {
    if (command === "list_workspace_documents" && native.listGate) await native.listGate;
    if (native.brokenRoots.includes(String(args.path))) throw new Error("작업 디렉터리에 접근할 수 없습니다.");
    if (command === "select_document_workspace") {
      if (native.selectionFailures.includes(String(args.path))) throw new Error("작업 루트 연결 실패");
      native.selectedRoot = String(args.path);
    }
    const generation = native.selectedRoot === args.path ? `scope:${args.path}` : undefined;
    if (args.path !== "/workspace") return { path: args.path, generation, documents: [{ path: `${args.path}/other.md`, name: "other.md", relativePath: "other.md" }], truncated: false, warnings: native.workspaceWarnings };
    return { path: "/workspace", generation, documents: [...(native.deleted ? [] : [{ path: native.path, name: native.path.split("/").pop(), relativePath: native.path.split("/").pop() }]), ...(native.targetContent === null ? [] : [{ path: "/workspace/target.md", name: "target.md", relativePath: "target.md" }]), ...Object.values(native.created).map((doc) => ({ path: doc.path, name: doc.path.split("/").pop(), relativePath: doc.path.split("/").pop() }))], truncated: false, warnings: native.workspaceWarnings };
  }
  if (command === "create_document" || command === "duplicate_document") {
    if (native.createGate) await native.createGate;
    if (native.failCreate) throw { code: "io", message: "생성 실패" };
    const key = `${args.generation}:${args.requestId}`;
    let doc = native.requests[key];
    if (!doc) {
      // This scalar-only test adapter preserves the response's other bytes.
      // The actual native CST/metadata behavior is covered by Rust file tests.
      const property = (text: string, key: string, value: string) => {
        const newline = text.includes("\r\n") ? "\r\n" : "\n";
        const line = `${key}: ${JSON.stringify(value)}`;
        const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(text);
        if (!opening) return `${text.startsWith("\uFEFF") ? "\uFEFF" : ""}---${newline}${line}${newline}---${newline}${text.replace(/^\uFEFF/, "")}`;
        const field = new RegExp(`^${key}:[^\\r\\n]*`, "m");
        return field.test(text) ? text.replace(field, line) : text.replace(opening[0], `${opening[0]}${line}${newline}`);
      };
      const id = `261013174600-${Object.keys(native.created).length.toString(16).padStart(8, "0")}`;
      let content = String(args.content);
      if (command === "duplicate_document") {
        const path = (args.document as {path: string}).path;
        content = property(content, "title", `${documentProperty(content, "title") || path.split("/").pop()} 사본`);
      }
      doc = { path: `${String(args.generation).slice(6)}/${id}.md`, content: property(content, "permalink", id), revision: "created-1", permalink: id };
      native.created[doc.path] = doc; native.requests[key] = { ...doc };
    }
    if (native.loseResponse) { native.loseResponse = false; throw new Error("response lost"); }
    return { document: { ...doc } };
  }
  if (command === "open_document") {
    if (native.openGate) await native.openGate;
    return native.created[String(args.path)] ?? { path: args.path, content: args.path === "/workspace/target.md" ? native.targetContent : native.content, revision: String(native.revision) };
  }
  if (command === "save_document") {
    if (native.saveGate) await native.saveGate;
    if (native.rejectIdentityOnce) { native.rejectIdentityOnce = false; throw {code:"duplicatePermalink", message:"identity collision"}; }
    const created = native.created[String(args.path)];
    if (created) { created.content = String(args.content); created.revision += "1"; return { ...created }; }
    if (args.path === "/workspace/target.md") { native.targetContent = String(args.content); return { path: args.path, content: native.targetContent, revision: "2" }; }
    native.versions.push(native.content); native.content = String(args.content); native.revision++;
    return { path: args.path, content: native.content, revision: String(native.revision) };
  }
  if (command === "list_document_comments") return [...(native.comments[String(args.key)] ?? [])];
  if (command === "add_document_comment") {
    const items = native.comments[String(args.key)] ??= [];
    const comment = { id: String(items.length), body: String(args.body), createdAt: "1791801000000" }; items.push(comment); return comment;
  }
  if (command === "document_history") return native.versions.map((_, i) => ({ id: String(i), savedAt: "2026-10-12T10:00:00Z" }));
  if (command === "history_content") return native.versions[Number(args.id)];
  return null;
}) }));
vi.mock("@tauri-apps/plugin-deep-link", () => ({ getCurrent: async () => native.urls, onOpenUrl: async () => () => {} }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: async () => {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (name: string, receive: (event: { payload: unknown }) => void) => { let listeners = eventBus.listeners.get(name); if (!listeners) eventBus.listeners.set(name, listeners = new Set()); listeners.add(receive); return () => listeners!.delete(receive); } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {}, close: async () => {} }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async (options: { directory?: boolean }) => options.directory ? native.folder : null, save: vi.fn(async () => null) }));

let restorePanelLayout: () => void;
beforeEach(() => {
  restorePanelLayout = installPanelLayoutFixture(window);
  vi.mocked(createChatClient).mockImplementation(() => chatFixture().client);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), clear: () => stored.clear(), removeItem: (key: string) => stored.delete(key) });
  localStorage.clear(); localStorage.setItem("box.md.workspace-path", "/workspace");
  native.content = "---\nsummary: 원래 요약\ncustom: {enabled: true}\n---\n# 문서\n\n안녕 🌱\n";
  native.revision = 1; native.versions = []; native.path = "/workspace/note.md"; native.urls = null; native.targetContent = null; native.comments = {};
  native.folder = null; native.brokenRoots = []; native.selectionFailures = []; native.selectedRoot = null; native.workspaceWarnings = [];
  native.created = {}; native.requests = {}; native.createGate = null; native.openGate = null; native.saveGate = null; native.listGate = null; native.deleted = false; native.failCreate = false; native.loseResponse = false;
  native.rejectIdentityOnce = false; eventBus.listeners.clear();
  vi.mocked(save).mockClear(); vi.mocked(invoke).mockClear();
});
afterEach(() => { cleanup(); restorePanelLayout(); vi.restoreAllMocks(); });
describe("document workspace flows", () => {
  async function emitDocumentChange(payload: unknown) {
    await act(async () => {
      for (const receive of eventBus.listeners.get("box:document-change") ?? [])
        receive({ payload });
      await Promise.resolve();
    });
  }

  it("applies an external MCP change to a clean document and uses its new revision on save", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    native.content = "---\nsummary: 외부 변경\n---\n# 외부 문서\n\n새 본문";
    native.revision = 2;
    await emitDocumentChange({
      generation: "scope:/workspace",
      kind: "documentChanged",
      document: { path: "note.md", revision: "2" },
    });
    expect(
      await screen.findByRole("heading", { name: "외부 문서" }),
    ).toBeTruthy();
    expect(
      screen.getByText("외부에서 변경된 문서를 반영했습니다."),
    ).toBeTruthy();
    await user.type(
      screen.getByRole("textbox", { name: "permalink" }),
      "after-external",
    );
    await user.click(screen.getByRole("button", { name: "문서에 적용" }));
    await user.click(screen.getByRole("button", { name: /^저장/ }));
    await waitFor(() =>
      expect(
        vi
          .mocked(invoke)
          .mock.calls.some(
            ([command, args]) =>
              command === "save_document" &&
              (args as Record<string, unknown>).expectedRevision === "2",
          ),
      ).toBe(true),
    );
  });

  it("keeps a dirty editor instance and draft when MCP changes or deletes the open document", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    const source = screen.getByRole("textbox", {
      name: "Markdown 원문",
    }) as HTMLTextAreaElement;
    await user.type(source, "\n로컬 초안");
    native.content = "# 외부 변경";
    native.revision = 2;
    await emitDocumentChange({
      generation: "scope:/workspace",
      kind: "documentChanged",
      document: { path: "note.md", revision: "2" },
    });
    expect(screen.getByRole("textbox", { name: "Markdown 원문" })).toBe(source);
    expect(source.value).toContain("로컬 초안");
    expect(screen.getByText(/편집 중인 내용은 유지했으며/)).toBeTruthy();
    native.deleted = true;
    await emitDocumentChange({
      generation: "scope:/workspace",
      kind: "documentDeleted",
      document: { path: "note.md", revision: "2" },
    });
    expect(source.value).toContain("로컬 초안");
    expect(screen.getByText(/외부에서 삭제되었습니다/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /note.md/ })).toBeNull(),
    );
  });
  it("keeps recoverable clean content while removing an externally deleted document from the list", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    const original = native.content;
    native.deleted = true;
    await emitDocumentChange({
      generation: "scope:/workspace",
      kind: "documentDeleted",
      document: { path: "note.md", revision: "1" },
    });
    expect(screen.getByRole("heading", { name: "note.md" })).toBeTruthy();
    expect(screen.getByText(/복구할 수 있도록 유지했습니다/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Markdown 원문",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(original);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /note.md/ })).toBeNull(),
    );
  });
  it("runs a pending workspace refresh after a second event arrives during listing", async () => {
    render(<HomePage />);
    await screen.findByRole("button", { name: /note.md/ });
    const calls = () =>
      vi
        .mocked(invoke)
        .mock.calls.filter(
          ([command]) => command === "list_workspace_documents",
        ).length;
    const before = calls();
    let release!: () => void;
    native.listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await emitDocumentChange({
      generation: "scope:/workspace",
      kind: "connectionsChanged",
      document: null,
    });
    await emitDocumentChange({
      generation: "scope:/workspace",
      kind: "connectionsChanged",
      document: null,
    });
    native.listGate = null;
    release();
    await waitFor(() => expect(calls()).toBe(before + 2));
  });
  it("ignores stale generations and an external read that finishes after user input", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    native.content = "# 무시할 이전 root";
    native.revision = 2;
    await emitDocumentChange({
      generation: "scope:/old",
      kind: "documentChanged",
      document: { path: "note.md", revision: "2" },
    });
    expect(
      screen.queryByRole("heading", { name: "무시할 이전 root" }),
    ).toBeNull();
    let release!: () => void;
    native.openGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await emitDocumentChange({
      generation: "scope:/workspace",
      kind: "documentChanged",
      document: { path: "note.md", revision: "2" },
    });
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    const source = screen.getByRole("textbox", {
      name: "Markdown 원문",
    }) as HTMLTextAreaElement;
    await user.type(source, "\n입력 중 변경");
    release();
    native.openGate = null;
    await waitFor(() => expect(source.value).toContain("입력 중 변경"));
    expect(
      screen.queryByRole("heading", { name: "무시할 이전 root" }),
    ).toBeNull();
  });
  it("queues an MCP event during save without overwriting the saved result", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.type(
      screen.getByRole("textbox", { name: "permalink" }),
      "local-save",
    );
    await user.click(screen.getByRole("button", { name: "문서에 적용" }));
    let release!: () => void;
    native.saveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await user.click(screen.getByRole("button", { name: /^저장/ }));
    await emitDocumentChange({
      generation: "scope:/workspace",
      kind: "documentChanged",
      document: { path: "note.md", revision: "2" },
    });
    release();
    native.saveGate = null;
    await waitFor(() =>
      expect(documentProperty(native.content, "permalink")).toBe("local-save"),
    );
    expect(
      (screen.getByRole("textbox", { name: "permalink" }) as HTMLInputElement)
        .value,
    ).toBe("local-save");
  });
  it("stages a dated link on a legacy document without changing its file or identity before apply/save", async () => {
    const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    const original = native.content;
    await user.click(screen.getByRole("button", { name: "새 링크 생성" }));
    const id = (screen.getByRole("textbox", { name: "permalink" }) as HTMLInputElement).value;
    expect(id).toMatch(/^[0-9]{12}-[0-9a-f]{8}$/);
    expect(native.content).toBe(original);
    await user.click(screen.getByRole("button", { name: "문서에 적용" }));
    await user.click(screen.getByRole("button", { name: /^저장/ }));
    await waitFor(() => expect(documentProperty(native.content, "permalink")).toBe(id));
    expect(native.path).toBe("/workspace/note.md");
    expect(Object.keys(native.created)).toHaveLength(0);
  });
  it("assigns a dated identity to a legacy file and retries a collision without renaming it", async () => {
    const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    native.rejectIdentityOnce = true;
    let counter = 0;
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      if (!(array instanceof Uint8Array)) throw new Error("unexpected array");
      array.fill(0); array[3] = counter++; return array;
    });
    try {
      await user.click(screen.getByRole("button", { name: /^저장/ }));
      await waitFor(() => expect(documentProperty(native.content, "permalink")).toMatch(/^[0-9]{12}-00000001$/));
      const calls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "save_document");
      expect(calls).toHaveLength(2);
      expect(calls.every(([, args]) => (args as Record<string, unknown>).path === "/workspace/note.md" && (args as Record<string, unknown>).expectedRevision === "1")).toBe(true);
      expect(native.versions).toHaveLength(1);
      expect(Object.keys(native.created)).toHaveLength(0);
    } finally { random.mockRestore(); }
  });
  it("creates an ID-named file in the selected workspace without a filename picker", async () => {
    const user = userEvent.setup(); render(<HomePage />);
    await screen.findByRole("button", { name: /note.md/ });
    expect((screen.getByRole("textbox", { name: "permalink" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("먼저 저장하면 고정 링크가 생성됩니다.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown 원문" }), { target: { value: "# 새 본문\n" } });
    expect(screen.queryByRole("button", { name: "다른 이름 저장" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^저장/ }));
    await screen.findByRole("heading", { name: "261013174600-00000000.md" });
    const created = Object.values(native.created)[0];
    expect(created.path).toBe(`/workspace/${created.permalink}.md`);
    expect(created.content.endsWith("# 새 본문\n")).toBe(true);
    expect((screen.getByRole("textbox", { name: "permalink" }) as HTMLInputElement).value).toBe(created.permalink);
    expect(vi.mocked(save)).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown 원문" }), { target: { value: created.content + "later\n" } });
    await user.click(screen.getByRole("button", { name: /^저장/ }));
    await waitFor(() => expect(native.created[created.path].content).toContain("later"));
    expect(Object.keys(native.created)).toHaveLength(1);
    expect(vi.mocked(invoke).mock.calls.some(([cmd, args]) => cmd === "save_document" && (args as Record<string, unknown>).expectedRevision === "created-1")).toBe(true);
  });
  it("duplicates a dirty document with a new identity and title while keeping the original", async () => {
    native.content = "---\npermalink: original\ntitle: 제목\ncustom: {enabled: true}\n---\n# 본문\n";
    const original = native.content;
    const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    const draft = original + "미저장 내용\n";
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown 원문" }), { target: { value: draft } });
    await user.click(screen.getByRole("button", { name: /^복제/ }));
    await screen.findByRole("heading", { name: "261013174600-00000000.md" });
    const copy = Object.values(native.created)[0];
    expect(documentProperty(copy.content, "title")).toBe("제목 사본");
    expect(copy.content).toContain("custom: {enabled: true}");
    expect(copy.content.endsWith("# 본문\n미저장 내용\n")).toBe(true);
    expect(native.content).toBe(original); expect(native.versions).toHaveLength(0);
    expect(vi.mocked(invoke).mock.calls.some(([cmd, args]) => cmd === "duplicate_document" && (args as Record<string, unknown>).expectedRevision === "1")).toBe(true);
    expect(vi.mocked(save)).not.toHaveBeenCalled();
  });
  it("keeps the dirty editor and its instance on duplication failure and retries a terminal error", async () => {
    native.failCreate = true;
    const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    const editor = screen.getByRole("textbox", { name: "Markdown 원문" }) as HTMLTextAreaElement;
    const draft = native.content + "dirty\n";
    fireEvent.change(editor, { target: { value: draft } });
    await user.click(screen.getByRole("button", { name: /^복제/ }));
    await screen.findByText("생성 실패");
    expect(screen.getByRole("textbox", { name: "Markdown 원문" })).toBe(editor);
    expect(editor.value).toBe(draft); expect(Object.keys(native.created)).toHaveLength(0);
    expect(screen.getByText("저장하지 않은 변경사항")).toBeTruthy();
    native.failCreate = false;
    await user.click(screen.getByRole("button", { name: /^복제/ }));
    await screen.findByRole("heading", { name: "261013174600-00000000.md" });
    const calls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "duplicate_document");
    expect((calls[0][1] as Record<string, unknown>).requestId).not.toBe((calls[1][1] as Record<string, unknown>).requestId);
    expect(documentProperty(Object.values(native.created)[0].content, "title")).toBe("note.md 사본");
  });
  it("reuses the request ID after a lost creation response without making a second file", async () => {
    native.loseResponse = true;
    const user = userEvent.setup(); render(<HomePage />);
    await screen.findByRole("button", { name: /note.md/ });
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    const editor = screen.getByRole("textbox", { name: "Markdown 원문" }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "# draft\n" } });
    await user.click(screen.getByRole("button", { name: /^저장/ }));
    await screen.findByText("response lost");
    expect(editor.value).toBe("# draft\n");
    await user.click(screen.getByRole("button", { name: /^저장/ }));
    await screen.findByRole("heading", { name: "261013174600-00000000.md" });
    expect(Object.keys(native.created)).toHaveLength(1);
    const calls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "create_document");
    expect((calls[0][1] as Record<string, unknown>).requestId).toBe((calls[1][1] as Record<string, unknown>).requestId);
  });
  it("ignores an old creation response after remounting in another workspace", async () => {
    let release!: () => void;
    native.createGate = new Promise<void>((resolve) => { release = resolve; });
    const user = userEvent.setup(); const view = render(<HomePage />);
    await screen.findByRole("button", { name: /note.md/ });
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown 원문" }), { target: { value: "old draft" } });
    await user.click(screen.getByRole("button", { name: /^저장/ }));
    await waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "create_document")).toBe(true));
    view.unmount(); localStorage.setItem("box.md.workspace-path", "/other"); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /other.md/ }));
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    const editor = screen.getByRole("textbox", { name: "Markdown 원문" }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "new root draft" } });
    await act(async () => { release(); await Promise.resolve(); });
    expect(editor.value).toBe("new root draft");
    expect(screen.getByRole("heading", { name: /^other.md/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "261013174600-00000000.md" })).toBeNull();
  });
  it("shows a partial listing warning and refuses an incomplete permalink lookup", async () => {
    native.workspaceWarnings = [{path:"unreadable",code:"io"}];
    native.content = "---\npermalink: stable\n---\nbody";
    native.urls = ["boxmd://document?permalink=stable"];
    render(<HomePage />);
    await screen.findByText("문서 목록을 완전히 조회하지 못해 고정 링크를 확인할 수 없습니다. 폴더 접근 권한을 확인해주세요.");
    expect(screen.getByText("일부 폴더를 조회하지 못했습니다. 접근 권한을 확인해주세요.")).toBeTruthy();
    expect(screen.queryByText("고정 링크로 문서를 열었습니다.")).toBeNull();
  });
  it("restores the preference and document when backend scope binding fails", async () => {
    const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    const original = native.content;
    await user.click(screen.getByRole("button", { name: "설정" }));
    native.folder = "/new-workspace"; native.selectionFailures = ["/new-workspace"];
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "설정 저장" }));
    await screen.findByText("작업 루트 연결 실패");
    expect(localStorage.getItem("box.md.workspace-path")).toBe("/workspace");
    expect(native.selectedRoot).toBe("/workspace");
    expect(native.content).toBe(original);
    expect(screen.getByRole("button", { name: /note.md/ })).toBeTruthy();
  });
  it.each(["cancel", "discard", "save"] as const)("protects unsaved edits when applying a settings directory: %s", async (choice) => {
    const original = native.content, draft = original + "\n작업 디렉터리 변경 전 초안";
    const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    const source = screen.getByRole("textbox", { name: "Markdown 원문" });
    fireEvent.change(source, { target: { value: draft } });
    await user.click(screen.getByRole("button", { name: "설정" }));
    native.folder = "/new-workspace";
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "설정 저장" }));
    expect(screen.getByRole("dialog", { name: "변경사항을 저장할까요?" })).toBeTruthy();
    expect(localStorage.getItem("box.md.workspace-path")).toBe("/workspace");
    const label = { cancel: "취소", discard: "변경 버리고 계속", save: "저장 후 계속" }[choice];
    await user.click(screen.getByRole("button", { name: label }));
    if (choice === "cancel") {
      expect(localStorage.getItem("box.md.workspace-path")).toBe("/workspace");
      expect((source as HTMLTextAreaElement).value).toBe(draft);
    } else {
      await screen.findByRole("button", { name: /other.md/ });
      expect(localStorage.getItem("box.md.workspace-path")).toBe("/new-workspace");
    }
    if (choice === "save") expect(native.content.endsWith("작업 디렉터리 변경 전 초안")).toBe(true);
    else expect(native.content).toBe(original);
  });
  it("stages a settings folder selection, saves explicitly and restores after remount", async () => {
    const user = userEvent.setup(); const view = render(<HomePage />);
    await screen.findByRole("button", { name: /note.md/ });
    await user.click(screen.getByRole("button", { name: "설정" }));
    const settings = screen.getByRole("dialog", { name: "설정" });
    expect(within(settings).getByText("/workspace")).toBeTruthy();
    native.folder = "/new-workspace";
    await user.click(within(settings).getByRole("button", { name: "폴더 선택" }));
    expect(localStorage.getItem("box.md.workspace-path")).toBe("/workspace");
    expect((within(settings).getByRole("textbox", { name: "선택한 작업 디렉터리" }) as HTMLInputElement).value).toBe("/new-workspace");
    await user.click(within(settings).getByRole("button", { name: "설정 저장" }));
    await screen.findByRole("button", { name: /other.md/ });
    expect(localStorage.getItem("box.md.workspace-path")).toBe("/new-workspace");
    view.unmount(); render(<HomePage />);
    await screen.findByRole("button", { name: /other.md/ });
    await user.click(screen.getByRole("button", { name: "설정" }));
    expect(within(screen.getByRole("dialog", { name: "설정" })).getByText("/new-workspace")).toBeTruthy();
  });
  it("preserves a staged selection on picker cancel and the saved setting on settings cancel", async () => {
    const user = userEvent.setup(); render(<HomePage />);
    await screen.findByRole("button", { name: /note.md/ });
    await user.click(screen.getByRole("button", { name: "설정" }));
    native.folder = "/new-workspace";
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    native.folder = null;
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    expect((screen.getByRole("textbox", { name: "선택한 작업 디렉터리" }) as HTMLInputElement).value).toBe("/new-workspace");
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(localStorage.getItem("box.md.workspace-path")).toBe("/workspace");
    await user.click(screen.getByRole("button", { name: "설정" }));
    expect((screen.getByRole("textbox", { name: "선택한 작업 디렉터리" }) as HTMLInputElement).value).toBe("/workspace");
  });
  it("shows an inaccessible saved path and allows recovery from settings", async () => {
    localStorage.setItem("box.md.workspace-path", "/gone"); native.brokenRoots = ["/gone"];
    const user = userEvent.setup(); render(<HomePage />);
    await screen.findByText("작업 디렉터리에 접근할 수 없습니다.");
    await user.click(screen.getByRole("button", { name: "설정" }));
    expect(within(screen.getByRole("dialog", { name: "설정" })).getByText("/gone")).toBeTruthy();
    expect(screen.getByText(/저장된 디렉터리를 열지 못했습니다/)).toBeTruthy();
    native.folder = "/new-workspace";
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "설정 저장" }));
    await screen.findByRole("button", { name: /other.md/ });
    expect(localStorage.getItem("box.md.workspace-path")).toBe("/new-workspace");
  });
  it("keeps the original workspace and unsaved document if preference storage fails", async () => {
    const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    const source = screen.getByRole("textbox", { name: "Markdown 원문" });
    const draft = native.content + "\n저장되지 않은 문서";
    fireEvent.change(source, { target: { value: draft } });
    await user.click(screen.getByRole("button", { name: "설정" }));
    native.folder = "/new-workspace";
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "설정 저장" }));
    const failStorage = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await user.click(screen.getByRole("button", { name: "변경 버리고 계속" }));
    await screen.findByText(/작업 디렉터리 설정을 저장하지 못했습니다/);
    failStorage.mockRestore();
    expect(localStorage.getItem("box.md.workspace-path")).toBe("/workspace");
    expect(native.selectedRoot).toBe("/workspace");
    expect((source as HTMLTextAreaElement).value).toBe(draft);
    expect(screen.getByText("저장하지 않은 변경사항")).toBeTruthy();
    expect(screen.getByRole("button", { name: /note.md/ })).toBeTruthy();
  });
  it("retains the unsaved document, conversation and message draft while toggling chat", async () => {
    const fixture = chatFixture(); vi.mocked(createChatClient).mockReturnValue(fixture.client);
    const original = native.content, user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    const source = screen.getByRole("textbox", { name: "Markdown 원문" });
    fireEvent.change(source, { target: { value: original + "\n미저장 변경" } });
    await user.click(screen.getByRole("button", { name: "에이전트 채팅" }));
    await screen.findByRole("option", { name: "Codex" });
    act(() => fixture.emit({ connection: "connected", disposed: false, sessions: [{ ...readySession(), messages: [{ id: "reply", role: "assistant", text: "문서를 함께 검토해요" }] }] }));
    await user.type(screen.getByRole("textbox", { name: "채팅 메시지" }), "작성 중인 질문");
    const draftNode = screen.getByRole("textbox", { name: "채팅 메시지" }) as HTMLTextAreaElement;
    expect(draftNode.value).toBe("작성 중인 질문");
    await user.click(screen.getByRole("button", { name: "채팅 숨기기" }));
    await user.click(screen.getByRole("button", { name: "에이전트 채팅" }));
    expect(screen.getByRole("textbox", { name: "채팅 메시지" })).toBe(draftNode);
    expect(screen.getByText("문서를 함께 검토해요")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "채팅 메시지" }) as HTMLTextAreaElement).value).toBe("작성 중인 질문");
    expect((source as HTMLTextAreaElement).value).toBe(original + "\n미저장 변경");
    expect(screen.getByText("저장하지 않은 변경사항")).toBeTruthy();
    expect(native.content).toBe(original);
    expect(fixture.client.closeSession).not.toHaveBeenCalled();
  });
  it("shows original frontmatter summaries on cards and opens their documents", async () => {
    const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: "문서 카드 보기" }));
    const cards = screen.getByRole("region", { name: "문서 카드" });
    expect(await within(cards).findByText("원래 요약")).toBeTruthy();
    await user.click(within(cards).getByRole("button", { name: "note.md 문서 열기" }));
    expect(await screen.findByRole("heading", { name: "note.md" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "문서 카드" })).toBeNull();
  });
  it("saves a one-line summary in front matter and reloads it without changing the body", async () => {
    native.content = "---\npermalink: fixed\ncustom: {enabled: true}\n---\n# 원문\n\n본문 보존\n";
    const user = userEvent.setup(); const view = render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.type(screen.getByRole("textbox", { name: "한 줄 요약" }), "원문을 설명하는 한 문장 🌱");
    await user.click(screen.getByRole("button", { name: "문서에 적용" }));
    await user.click(screen.getByRole("button", { name: /^저장/ }));
    await waitFor(() => expect(documentProperty(native.content, "summary")).toBe("원문을 설명하는 한 문장 🌱"));
    expect(documentProperty(native.content, "permalink")).toBe("fixed");
    expect(native.content.endsWith("# 원문\n\n본문 보존\n")).toBe(true);
    view.unmount(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    expect((screen.getByRole("textbox", { name: "한 줄 요약" }) as HTMLInputElement).value).toBe("원문을 설명하는 한 문장 🌱");
  });
  it("reads without changing the original and persists separate comments across reopening", async () => {
    native.content += "\n- [ ] 아직\n";
    const original = native.content;
    const user = userEvent.setup(); const view = render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.click(screen.getByRole("button", { name: "읽기 모드로 전환" }));
    expect(await screen.findByText("읽기 모드 · READ ONLY")).toBeTruthy();
    const richBody = screen.getByLabelText("문서 본문");
    expect(richBody.getAttribute("contenteditable")).toBe("false");
    expect(screen.queryByRole("button", { name: "굵게" })).toBeNull();
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox); expect(checkbox.checked).toBe(false);
    await user.click(screen.getByRole("button", { name: "Markdown 원문" }));
    const source = screen.getByRole("textbox", { name: "Markdown 원문" }) as HTMLTextAreaElement;
    expect(source.readOnly).toBe(true);
    await user.click(source); await user.paste("바뀌면 안 됨");
    expect(source.value).toBe(original);
    await user.type(screen.getByRole("textbox", { name: "댓글 내용" }), "의견 🌱");
    await user.click(screen.getByRole("button", { name: "댓글 남기기" }));
    expect(await screen.findByText("의견 🌱")).toBeTruthy();
    expect(native.content).toBe(original); expect(native.revision).toBe(1);
    view.unmount(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.click(screen.getByRole("button", { name: "읽기 모드로 전환" }));
    expect(await screen.findByText("의견 🌱")).toBeTruthy();
    expect(native.content).toBe(original);
  });
  it("protects unsaved changes when entering read mode with cancel, discard and save", async () => {
    const original = native.content; const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.type(screen.getByRole("textbox", { name: "permalink" }), "draft");
    await user.click(screen.getByRole("button", { name: "문서에 적용" }));
    await user.click(screen.getByRole("button", { name: "읽기 모드로 전환" }));
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByText("저장하지 않은 변경사항")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "읽기 모드로 전환" }));
    await user.click(screen.getByRole("button", { name: "변경 버리고 계속" }));
    expect(await screen.findByText("읽기 모드 · READ ONLY")).toBeTruthy();
    expect(native.content).toBe(original);
    await user.click(screen.getByRole("button", { name: "편집 모드로 전환" }));
    expect((screen.getByRole("textbox", { name: "permalink" }) as HTMLInputElement).value).toBe("");
    await user.type(screen.getByRole("textbox", { name: "permalink" }), "saved");
    await user.click(screen.getByRole("button", { name: "문서에 적용" }));
    await user.click(screen.getByRole("button", { name: "읽기 모드로 전환" }));
    await user.click(screen.getByRole("button", { name: "저장 후 계속" }));
    expect(await screen.findByText("읽기 모드 · READ ONLY")).toBeTruthy();
    expect(documentProperty(native.content, "permalink")).toBe("saved");
  });
  it("creates a target identity, saves a document link, and follows it with unsaved protection", async () => {
    native.targetContent = "# 대상\n\n대상 본문 그대로\n";
    const source = native.content;
    const user = userEvent.setup(); render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /note.md/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "연결할 문서" }), "/workspace/target.md");
    await user.click(screen.getByRole("button", { name: "링크 추가" }));
    const link = await screen.findByRole("link", { name: "target.md" });
    expect(documentProperty(native.targetContent!, "permalink")).toMatch(/^[0-9]{12}-[a-f0-9]{8}$/);
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
