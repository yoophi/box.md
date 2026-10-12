import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createChatClient } from "@/entities/agent-chat";
import { useAgentChat } from "./use-agent-chat";
import { chatFixture, readySession } from "./chat-fixture";

vi.mock("@/entities/agent-chat", () => ({ createChatClient: vi.fn() }));
vi.mock("@/shared/lib/runtime", () => ({ isDesktop: () => true }));
beforeEach(() => vi.clearAllMocks());
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
