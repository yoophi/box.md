import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createChatClient } from "@/entities/agent-chat";
import { useAgentChat } from "./use-agent-chat";
import { chatFixture, readySession } from "./chat-fixture";

vi.mock("@/entities/agent-chat", () => ({ createChatClient: vi.fn() }));
vi.mock("@/shared/lib/runtime", () => ({ isDesktop: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
function nativeGrant(generation: unknown, runId: unknown) {
  return {
    grantId: `grant-${String(runId)}`,
    generation,
    runId,
    server: {
      type: "http",
      name: "box-documents",
      url: "http://127.0.0.1:43210/mcp",
      headers: [{ name: "Authorization", value: `Bearer ${"b".repeat(64)}` }],
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const values = args as Record<string, unknown>;
    return (
      command === "get_document_mcp_grant"
        ? nativeGrant(values.generation, values.runId)
        : undefined
    ) as never;
  });
});
afterEach(cleanup);

it("connects lazily, retains hidden responses and disposes only on unmount", async () => {
  const fixture = chatFixture();
  vi.mocked(createChatClient).mockReturnValue(fixture.client);
  const view = renderHook(({ visible }) => useAgentChat("/one", visible), {
    initialProps: { visible: false },
  });
  expect(createChatClient).not.toHaveBeenCalled();
  view.rerender({ visible: true });
  await waitFor(() =>
    expect(view.result.current.agents[0]?.label).toBe("Codex"),
  );
  view.rerender({ visible: false });
  act(() =>
    fixture.emit({
      connection: "connected",
      disposed: false,
      sessions: [
        {
          ...readySession(),
          messages: [
            { id: "reply", role: "assistant", text: "숨긴 동안 받은 답변" },
          ],
        },
      ],
    }),
  );
  view.rerender({ visible: true });
  expect(view.result.current.snapshot?.sessions[0].messages[0].text).toBe(
    "숨긴 동안 받은 답변",
  );
  expect(createChatClient).toHaveBeenCalledTimes(1);
  expect(fixture.client.closeSession).not.toHaveBeenCalled();
  expect(fixture.client.dispose).not.toHaveBeenCalled();
  view.unmount();
  expect(fixture.client.dispose).toHaveBeenCalledTimes(1);
});

it("keeps independent workspace conversations and routes actions to the current workspace", async () => {
  const one = chatFixture(),
    two = chatFixture();
  vi.mocked(createChatClient).mockImplementation((root) =>
    root === "/one" ? one.client : two.client,
  );
  const view = renderHook(({ root }) => useAgentChat(root, true), {
    initialProps: { root: "/one" },
  });
  await waitFor(() => expect(view.result.current.agents.length).toBe(1));
  act(() =>
    one.emit({
      connection: "connected",
      disposed: false,
      sessions: [
        {
          ...readySession(),
          messages: [{ id: "one", role: "assistant", text: "첫 폴더 답변" }],
        },
      ],
    }),
  );
  view.rerender({ root: "/two" });
  await act(async () => {
    await view.result.current.send("session-one", "두 번째 폴더");
  });
  expect(two.client.send).toHaveBeenCalledWith("session-one", "두 번째 폴더");
  expect(one.client.send).not.toHaveBeenCalled();
  expect(view.result.current.snapshot?.sessions[0].messages).toEqual([]);
  view.rerender({ root: "/one" });
  expect(view.result.current.snapshot?.sessions[0].messages[0].text).toBe(
    "첫 폴더 답변",
  );
  expect(createChatClient).toHaveBeenCalledTimes(2);
  expect(one.client.dispose).not.toHaveBeenCalled();
});

it("does not let a late old-workspace outcome overwrite current errors or busy state", async () => {
  const one = chatFixture(),
    two = chatFixture();
  let finish!: (outcome: { kind: "notApplied"; reason: "offline" }) => void;
  vi.mocked(one.client.send).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.mocked(createChatClient).mockImplementation((root) =>
    root === "/one" ? one.client : two.client,
  );
  const view = renderHook(({ root }) => useAgentChat(root, true), {
    initialProps: { root: "/one" },
  });
  await waitFor(() => expect(view.result.current.agents.length).toBe(1));
  let pending!: Promise<boolean | null>;
  act(() => {
    pending = view.result.current.send("session-one", "첫 폴더");
  });
  view.rerender({ root: "/two" });
  await act(async () => {
    finish({ kind: "notApplied", reason: "offline" });
    await pending;
  });
  expect(view.result.current.error).toBeNull();
  expect(view.result.current.busy).toBe(false);
});

it("can reconnect after React StrictMode disposes the first mount", async () => {
  const fixtures: ReturnType<typeof chatFixture>[] = [];
  vi.mocked(createChatClient).mockImplementation(() => {
    const fixture = chatFixture();
    fixtures.push(fixture);
    return fixture.client;
  });
  const view = renderHook(() => useAgentChat("/one", true), {
    wrapper: StrictMode,
  });
  await waitFor(() => expect(view.result.current.agents.length).toBe(1));
  expect(fixtures.length).toBe(2);
  expect(fixtures[0].client.dispose).toHaveBeenCalledTimes(1);
  expect(fixtures[1].client.dispose).not.toHaveBeenCalled();
});

it("binds document grants to native generation and retains them while hidden until session EOF", async () => {
  const fixture = chatFixture();
  vi.mocked(createChatClient).mockReturnValue(fixture.client);
  const view = renderHook(
    ({ visible }) => useAgentChat("/one", visible, "gen-one"),
    { initialProps: { visible: true } },
  );
  await waitFor(() => expect(view.result.current.agents.length).toBe(1));
  await act(async () => {
    await view.result.current.createSession({ agentId: "codex" });
  });
  const sent = vi.mocked(fixture.client.createSession).mock.calls[0][0];
  expect(sent.mcpServers?.[0].name).toBe("box-documents");
  expect(view.result.current.documentTools?.modes?.[sent.runId!]).toBe(
    "enabled",
  );
  view.rerender({ visible: false });
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "revoke_document_mcp_grant"),
  ).toHaveLength(0);
  act(() =>
    fixture.emit({
      connection: "connected",
      disposed: false,
      sessions: [{ ...readySession(sent.runId), status: "closed" }],
    }),
  );
  await waitFor(() =>
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([cmd]) => cmd === "revoke_document_mcp_grant"),
    ).toHaveLength(1),
  );
  expect(view.result.current.documentTools?.modes?.[sent.runId!]).toBe(
    "revoked",
  );
});

it("allows explicit plain chat without requesting native document access", async () => {
  const fixture = chatFixture();
  vi.mocked(createChatClient).mockReturnValue(fixture.client);
  const view = renderHook(() => useAgentChat("/one", true, "gen-one"));
  await waitFor(() => expect(view.result.current.agents.length).toBe(1));
  act(() => view.result.current.documentTools!.setEnabled(false));
  await act(async () => {
    await view.result.current.createSession({ agentId: "codex" });
  });
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "get_document_mcp_grant"),
  ).toHaveLength(0);
  expect(
    vi.mocked(fixture.client.createSession).mock.calls[0][0].mcpServers,
  ).toBeUndefined();
});

it("keeps a new generation's busy/error state when an old same-workspace request finishes", async () => {
  const fixture = chatFixture();
  vi.mocked(createChatClient).mockReturnValue(fixture.client);
  let oldFinish!: (
    outcome: Awaited<ReturnType<typeof fixture.client.createSession>>,
  ) => void;
  let newFinish!: (
    outcome: Awaited<ReturnType<typeof fixture.client.createSession>>,
  ) => void;
  vi.mocked(fixture.client.createSession)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldFinish = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          newFinish = resolve;
        }),
    );
  const view = renderHook(
    ({ generation }) => useAgentChat("/one", true, generation),
    { initialProps: { generation: "gen-one" } },
  );
  await waitFor(() => expect(view.result.current.agents.length).toBe(1));
  let oldPending!: Promise<string | null>, newPending!: Promise<string | null>;
  act(() => {
    oldPending = view.result.current.createSession({ agentId: "codex" });
  });
  await waitFor(() =>
    expect(fixture.client.createSession).toHaveBeenCalledTimes(1),
  );
  view.rerender({ generation: "gen-two" });
  act(() => {
    newPending = view.result.current.createSession({ agentId: "codex" });
  });
  await waitFor(() =>
    expect(fixture.client.createSession).toHaveBeenCalledTimes(2),
  );
  await act(async () => {
    oldFinish({ kind: "notApplied", reason: "offline" });
    await oldPending;
  });
  expect(view.result.current.error).toBeNull();
  expect(view.result.current.busy).toBe(true);
  const id = vi.mocked(fixture.client.createSession).mock.calls[1][0].runId!;
  await act(async () => {
    newFinish({ kind: "ok", output: { id }, revision: undefined });
    await newPending;
  });
  expect(view.result.current.busy).toBe(false);
  expect(view.result.current.error).toBeNull();
});

it("rejects a late native grant after same-path rebind without creating an agent or replacing current errors", async () => {
  const fixture = chatFixture();
  vi.mocked(createChatClient).mockReturnValue(fixture.client);
  let finish!: (value: unknown) => void;
  let captured: Record<string, unknown> | undefined;
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    if (cmd === "get_document_mcp_grant") {
      captured = args as Record<string, unknown>;
      return (await new Promise<unknown>((resolve) => {
        finish = resolve;
      })) as never;
    }
    return undefined as never;
  });
  const view = renderHook(
    ({ generation }) => useAgentChat("/one", true, generation),
    { initialProps: { generation: "gen-one" } },
  );
  await waitFor(() => expect(view.result.current.agents.length).toBe(1));
  let pending!: Promise<string | null>;
  act(() => {
    pending = view.result.current.createSession({ agentId: "codex" });
  });
  await waitFor(() => expect(captured).toBeDefined());
  view.rerender({ generation: "gen-two" });
  await act(async () => {
    finish(nativeGrant(captured!.generation, captured!.runId));
    await pending;
  });
  expect(fixture.client.createSession).not.toHaveBeenCalled();
  expect(view.result.current.error).toBeNull();
  expect(view.result.current.busy).toBe(false);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "revoke_document_mcp_grant"),
  ).toHaveLength(1);
});

it("does not cache a late previous-generation agent catalog over the current one", async () => {
  const fixture = chatFixture();
  vi.mocked(createChatClient).mockReturnValue(fixture.client);
  let finish!: (
    value: Awaited<ReturnType<typeof fixture.client.listAgents>>,
  ) => void;
  vi.mocked(fixture.client.listAgents)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({
      kind: "ok",
      output: [{ id: "new", label: "New catalog", command: "new" }],
      revision: undefined,
    });
  const view = renderHook(
    ({ generation, visible }) => useAgentChat("/one", visible, generation),
    { initialProps: { generation: "gen-one", visible: true } },
  );
  await waitFor(() =>
    expect(fixture.client.listAgents).toHaveBeenCalledTimes(1),
  );
  view.rerender({ generation: "gen-two", visible: true });
  await waitFor(() => expect(view.result.current.agents[0]?.id).toBe("new"));
  await act(async () => {
    finish({
      kind: "ok",
      output: [{ id: "old", label: "Old catalog", command: "old" }],
      revision: undefined,
    });
  });
  view.rerender({ generation: "gen-two", visible: false });
  expect(view.result.current.agents[0]?.id).toBe("new");
});
