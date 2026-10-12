import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentChatModel } from "../model/use-agent-chat";
import { readySession } from "../model/chat-fixture";
import { AgentChatSheet } from "./AgentChatSheet";

afterEach(cleanup);
function model(): AgentChatModel {
  return {
    snapshot: {
      connection: "connected",
      disposed: false,
      sessions: [readySession()],
    },
    agents: [{ id: "codex", label: "Codex", command: "codex-acp" }],
    busy: false,
    error: null,
    reconnect: vi.fn(async () => null),
    createSession: vi.fn(async () => null),
    send: vi.fn(async () => true),
    respond: vi.fn(async () => null),
    closeSession: vi.fn(async () => null),
  };
}
it("retains a draft across hide/show and hiding never cancels the session", () => {
  const chat = model(),
    hide = vi.fn();
  const view = render(
    <AgentChatSheet
      model={chat}
      open
      workspace="/one"
      blocked={false}
      onHide={hide}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "채팅 메시지" }), {
    target: { value: "작성 중" },
  });
  fireEvent.click(screen.getByRole("button", { name: "채팅 숨기기" }));
  expect(hide).toHaveBeenCalledOnce();
  expect(chat.closeSession).not.toHaveBeenCalled();
  view.rerender(
    <AgentChatSheet
      model={chat}
      open={false}
      workspace="/one"
      blocked={false}
      onHide={hide}
    />,
  );
  view.rerender(
    <AgentChatSheet
      model={chat}
      open
      workspace="/one"
      blocked={false}
      onHide={hide}
    />,
  );
  expect(
    (
      screen.getByRole("textbox", {
        name: "채팅 메시지",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("작성 중");
});
it("shows streaming text and sends the exact permission/session identifiers", () => {
  const chat = model();
  chat.snapshot = {
    ...chat.snapshot!,
    sessions: [
      {
        ...readySession("run-permission"),
        status: "busy",
        messages: [{ id: "reply", role: "assistant", text: "실시간 답변 🌱" }],
        permissions: [
          {
            id: "permission-42",
            title: "문서 읽기",
            input: { path: "note.md" },
            options: [
              { optionId: "allow-one", name: "한 번 허용", kind: "allow_once" },
            ],
            responding: false,
          },
        ],
      },
    ],
  };
  render(
    <AgentChatSheet
      model={chat}
      open
      workspace="/one"
      blocked={false}
      onHide={() => {}}
    />,
  );
  expect(screen.getByText("실시간 답변 🌱")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "한 번 허용" }));
  expect(chat.respond).toHaveBeenCalledWith(
    "run-permission",
    "permission-42",
    "allow-one",
  );
  fireEvent.click(screen.getByRole("button", { name: "세션 종료" }));
  expect(chat.closeSession).toHaveBeenCalledWith("run-permission");
});
it("blocks keyboard submission when disconnected and displays an unknown delivery without resending", () => {
  const chat = model();
  chat.snapshot = {
    ...chat.snapshot!,
    connection: "reconnecting",
    sessions: [
      {
        ...readySession(),
        messages: [
          {
            id: "unknown",
            role: "user",
            text: "확인 필요",
            delivery: { kind: "unknown", reason: "lost" },
          },
        ],
      },
    ],
  };
  render(
    <AgentChatSheet
      model={chat}
      open
      workspace="/one"
      blocked={false}
      onHide={() => {}}
    />,
  );
  const input = screen.getByRole("textbox", { name: "채팅 메시지" });
  fireEvent.change(input, { target: { value: "오프라인 새 메시지" } });
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  fireEvent.submit(input.closest("form")!);
  expect(chat.send).not.toHaveBeenCalled();
  expect(screen.getByText("전송 결과 확인 필요")).toBeTruthy();
});
