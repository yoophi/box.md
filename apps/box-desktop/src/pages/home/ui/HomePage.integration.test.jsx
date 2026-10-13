import { installPanelLayoutFixture } from "@/shared/testing/panel-layout-fixture";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { startHost } from "@yoophi/workbench-client/test-host";

const bridge = vi.hoisted(() => ({
  host: null,
  content: "# 통합 문서\n\n원래 본문\n",
  site: { open: false, visible: false, url: null, title: "", loading: false, canGoBack: false, canGoForward: false },
}));
vi.mock("@/shared/lib/runtime", () => ({ isDesktop: () => true }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command, args) => {
    if (command.startsWith("site_browser_")) {
      if (command === "site_browser_open") bridge.site = { ...bridge.site, open: true, visible: false, url: args.url, title: "사이트 adapter" };
      if (command === "site_browser_layout") bridge.site.visible = bridge.site.open && Boolean(args.bounds);
      return { ...bridge.site };
    }
    if (command === "get_workbench_connection")
      return {
        baseUrl: bridge.host.baseUrl,
        token: bridge.host.tokens.windowA,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        incarnation: "inc-1",
      };
    if (command === "list_workspace_documents" || command === "select_document_workspace")
      return {
        path: bridge.host.workDir,
        documents: [
          {
            path: `${bridge.host.workDir}/note.md`,
            name: "note.md",
            relativePath: "note.md",
          },
        ],
        truncated: false,
      };
    if (command === "open_document")
      return {
        path: `${bridge.host.workDir}/note.md`,
        content: bridge.content,
        revision: "1",
      };
    if (command === "document_revision") return "1";
    if (command === "list_connections") return { version: 1, entities: [], memberships: [] };
    return null;
  }),
}));
vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: async () => null,
  onOpenUrl: async () => () => {},
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: async () => {},
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async () => null,
  save: async () => null,
}));

const teardown = [];
afterEach(async () => {
  for (const action of teardown.splice(0).reverse()) await action();
  vi.unstubAllGlobals();
});

it("runs two permission-gated ACP turns through the actual HTTP/WS client while retaining the unsaved editor", async () => {
  // Keep Node's real fetch/WebSocket. Only the native document/credential boundary is substituted.
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost:1430",
    pretendToBeVisual: true,
  });
  teardown.push(() => dom.window.close());
  const rectangle = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains("site-browser-content") ? new dom.window.DOMRect(230, 156, 700, 500) : rectangle.call(this);
  };
  teardown.push(installPanelLayoutFixture(dom.window));
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "Text",
    "MutationObserver",
    "DOMParser",
    "DOMRect",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "localStorage",
  ])
    vi.stubGlobal(key, key === "window" ? dom.window : dom.window[key]);
  const host = await startHost({
    HOST_USE_ACP_ENGINE: "1",
    HOST_JOURNAL_CAPACITY: "1000",
  });
  teardown.push(() => host.stop());
  bridge.host = host;
  localStorage.setItem("box.md.workspace-path", host.workDir);
  const agent = resolve(
    __dirname,
    "../../../../../../vendor/agentic-workspace/crates/workbench-core/tests/support/agents/fake_acp_permission_agent.py",
  );
  const agentLog = resolve(host.dataDir, "agent.log"),
    pidFile = resolve(host.dataDir, "agent.pid");
  writeFileSync(
    resolve(host.dataDir, "agent-run-settings.json"),
    JSON.stringify([
      {
        workingDirectory: "__app_agent_command_overrides__",
        commandOverrides: {
          globalCommand: `python3 ${agent} --log ${agentLog} --pid-file ${pidFile} --log-session --echo`,
        },
      },
    ]),
  );
  const { render, fireEvent, waitFor } = await import(
    "@testing-library/react/pure"
  );
  const { HomePage } = await import("./HomePage");
  const view = render(<HomePage />);
  teardown.push(() => view.unmount());
  fireEvent.click(await view.findByRole("button", { name: /note.md/ }));
  await view.findByRole("heading", { name: "note.md" });
  fireEvent.click(view.getByRole("button", { name: "Markdown 원문" }));
  const source = await view.findByRole("textbox", { name: "Markdown 원문" });
  const edited = bridge.content + "\n저장하지 않은 메모";
  fireEvent.change(source, { target: { value: edited } });
  fireEvent.click(view.getByRole("button", { name: /사이트 브라우저/ }));
  const address = view.getByRole("textbox", { name: "사이트 주소" });
  await waitFor(() => expect(address.disabled).toBe(false));
  fireEvent.change(address, { target: { value: "https://example.com/adapter" } });
  fireEvent.click(view.getByRole("button", { name: "이동" }));
  await waitFor(() => expect(bridge.site.visible).toBe(true));
  fireEvent.click(view.getByRole("button", { name: "문서로 돌아가기" }));
  expect(source.value).toBe(edited);
  fireEvent.click(view.getByRole("button", { name: "에이전트 채팅" }));
  const start = await view.findByRole("button", { name: "새 세션" });
  await waitFor(() => expect(start.disabled).toBe(false), { timeout: 15_000 });
  fireEvent.click(start);
  const composer = view.getByRole("textbox", { name: "채팅 메시지" });
  await waitFor(() => expect(composer.disabled).toBe(false), {
    timeout: 15_000,
  });
  expect(readFileSync(agentLog, "utf8").trim().split("\n")).toEqual([
    "initialize",
    "session/new",
  ]);
  const pid = Number(readFileSync(pidFile, "utf8"));
  for (const text of ["첫 질문", "두 번째 질문"]) {
    fireEvent.change(composer, { target: { value: text } });
    fireEvent.click(view.getByRole("button", { name: "보내기" }));
    expect(
      await view.findByText(`echo:${text}`, {}, { timeout: 10_000 }),
    ).toBeTruthy();
    fireEvent.click(await view.findByRole("button", { name: "Allow" }));
    await waitFor(() => expect(composer.disabled).toBe(false), {
      timeout: 10_000,
    });
  }
  fireEvent.change(composer, { target: { value: "보관할 채팅 초안" } });
  fireEvent.click(view.getByRole("button", { name: /사이트 브라우저/ }));
  await waitFor(() => expect(bridge.site.visible).toBe(true));
  expect(() => process.kill(pid, 0)).not.toThrow();
  expect(composer.value).toBe("보관할 채팅 초안");
  expect(source.value).toBe(edited);
  fireEvent.click(view.getByRole("button", { name: "문서로 돌아가기" }));
  fireEvent.click(view.getByRole("button", { name: "채팅 숨기기" }));
  expect(() => process.kill(pid, 0)).not.toThrow();
  fireEvent.click(view.getByRole("button", { name: "에이전트 채팅" }));
  expect(await view.findByText("echo:첫 질문")).toBeTruthy();
  expect(view.getByText("echo:두 번째 질문")).toBeTruthy();
  expect(composer.value).toBe("보관할 채팅 초안");
  expect(source.value).toBe(edited);
  expect(view.getByText("저장하지 않은 변경사항")).toBeTruthy();
  expect(bridge.content).not.toContain("저장하지 않은 메모");
  fireEvent.click(view.getByRole("button", { name: "세션 종료" }));
  await waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), {
    timeout: 10_000,
  });
  await waitFor(() => expect(view.getByText("종료됨")).toBeTruthy());
  expect(
    readFileSync(agentLog, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("prompt:")),
  ).toHaveLength(2);
  expect(source.value).toBe(edited);
});
