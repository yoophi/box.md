import { documentProperty } from "@box/editor";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePage } from "./HomePage";
import { createChatClient } from "@/entities/agent-chat";
import { chatFixture, readySession } from "@/features/agent-chat/model/chat-fixture";
import { act } from "@testing-library/react";

vi.mock("@/entities/agent-chat", () => ({ createChatClient: vi.fn() }));

const native = vi.hoisted(() => ({ content: "", revision: 1, versions: [] as string[], path: "/workspace/note.md", folder: null as string | null, brokenRoots: [] as string[], urls: null as string[] | null, targetContent: null as string | null, comments: {} as Record<string, {id: string; body: string; createdAt: string}[]> }));
vi.mock("@/shared/lib/runtime", () => ({ isDesktop: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string, args: Record<string, unknown>) => {
  if (command === "list_connections") return { version: 1, entities: [], memberships: [] };
  if (command === "list_workspace_documents") {
    if (native.brokenRoots.includes(String(args.path))) throw new Error("작업 디렉터리에 접근할 수 없습니다.");
    if (args.path !== "/workspace") return { path: args.path, documents: [{ path: `${args.path}/other.md`, name: "other.md", relativePath: "other.md" }], truncated: false };
    return { path: "/workspace", documents: [{ path: native.path, name: native.path.split("/").pop(), relativePath: native.path.split("/").pop() }, ...(native.targetContent === null ? [] : [{ path: "/workspace/target.md", name: "target.md", relativePath: "target.md" }])], truncated: false };
  }
  if (command === "open_document") return { path: args.path, content: args.path === "/workspace/target.md" ? native.targetContent : native.content, revision: String(native.revision) };
  if (command === "save_document") {
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
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {}, close: async () => {} }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async (options: { directory?: boolean }) => options.directory ? native.folder : null, save: async () => null }));

beforeEach(() => {
  vi.mocked(createChatClient).mockImplementation(() => chatFixture().client);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), clear: () => stored.clear(), removeItem: (key: string) => stored.delete(key) });
  localStorage.clear(); localStorage.setItem("box.md.workspace-path", "/workspace");
  native.content = "---\nsummary: 원래 요약\ncustom: {enabled: true}\n---\n# 문서\n\n안녕 🌱\n";
  native.revision = 1; native.versions = []; native.path = "/workspace/note.md"; native.urls = null; native.targetContent = null; native.comments = {};
  native.folder = null; native.brokenRoots = [];
});
afterEach(cleanup);
describe("document workspace flows", () => {
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
    await user.click(screen.getByRole("button", { name: "채팅 숨기기" }));
    await user.click(screen.getByRole("button", { name: "에이전트 채팅" }));
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
