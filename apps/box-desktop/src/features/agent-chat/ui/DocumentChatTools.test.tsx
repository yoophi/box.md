import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentChatModel } from "../model/use-agent-chat";
import { DocumentChatTools } from "./DocumentChatTools";

afterEach(cleanup);
function model(): AgentChatModel {
  return {
    snapshot: null,
    agents: [],
    busy: false,
    error: null,
    reconnect: vi.fn(async () => null),
    createSession: vi.fn(async () => null),
    send: vi.fn(async () => true),
    respond: vi.fn(async () => null),
    closeSession: vi.fn(async () => null),
    documentTools: {
      enabled: true,
      setEnabled: vi.fn(),
      notice: null,
      modes: {},
      cleanupPending: false,
    },
  };
}
it("lets the next session opt out without closing the current conversation", () => {
  const chat = model();
  render(<DocumentChatTools model={chat} open blocked={false} />);
  const checkbox = screen.getByRole("checkbox", {
    name: "새 채팅에서 문서 도구 사용",
  });
  expect(checkbox.getAttribute("aria-describedby")).toBeTruthy();
  fireEvent.click(checkbox);
  expect(chat.documentTools!.setEnabled).toHaveBeenCalledWith(false);
  expect(chat.closeSession).not.toHaveBeenCalled();
  expect(chat.createSession).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});
it("offers general chat and reconnect when document tools cannot connect", () => {
  const chat = model();
  chat.documentTools!.notice = "문서 도구를 연결하지 못했습니다.";
  render(<DocumentChatTools model={chat} open blocked={false} />);
  expect(screen.getByRole("status").textContent).toContain(
    chat.documentTools!.notice,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "새 세션은 일반 채팅으로" }),
  );
  expect(chat.documentTools!.setEnabled).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByRole("button", { name: "다시 연결" }));
  expect(chat.reconnect).toHaveBeenCalledTimes(1);
});
it("disables changes during an action and hides controls with the panel", () => {
  const chat = model();
  chat.busy = true;
  chat.documentTools!.notice = "연결을 확인해주세요.";
  const view = render(<DocumentChatTools model={chat} open blocked={false} />);
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
    true,
  );
  for (const button of screen.getAllByRole("button"))
    expect((button as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<DocumentChatTools model={chat} open={false} blocked />);
  expect(screen.queryByRole("checkbox")).toBeNull();
  const region = screen.getByRole("region", { hidden: true });
  expect(region.hasAttribute("inert")).toBe(true);
});
it("renders no document controls without a bound workspace", () => {
  const chat = model();
  delete chat.documentTools;
  const view = render(<DocumentChatTools model={chat} open blocked={false} />);
  expect(view.container.childElementCount).toBe(0);
});
