import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConnectionSnapshot } from "@box/contracts";
import { attachConnection, createConnection, detachConnection, listConnections } from "@/entities/connection";
import { DocumentConnections } from "./DocumentConnections";

vi.mock("@/entities/connection", () => ({ attachConnection: vi.fn(), createConnection: vi.fn(), detachConnection: vi.fn(), listConnections: vi.fn() }));
vi.mock("@/shared/lib/runtime", () => ({ isDesktop: () => true }));
let graph: ConnectionSnapshot;
const content = (id: string) => `---\npermalink: ${id}\n---\n# 문서`;
const props = (id: string) => ({ path: `/fixture/${id}.md`, baseline: content(id), content: content(id), workspace: null, disabled: false, onOpen: vi.fn() });
beforeEach(() => {
  vi.clearAllMocks();
  graph = { version: 1, entities: [{ id: "one", name: "검토" }, { id: "two", name: "자료" }], memberships: [] };
  vi.mocked(listConnections).mockImplementation(async () => structuredClone(graph));
  vi.mocked(createConnection).mockImplementation(async (name) => { graph.entities.push({ id: "created", name: name.trim() }); return structuredClone(graph); });
  vi.mocked(attachConnection).mockImplementation(async (connectionId, permalink) => { graph.memberships.push({ connectionId, permalink }); return structuredClone(graph); });
  vi.mocked(detachConnection).mockImplementation(async (connectionId, permalink) => { graph.memberships = graph.memberships.filter((edge) => !(edge.connectionId === connectionId && edge.permalink === permalink)); return structuredClone(graph); });
});
afterEach(cleanup);
it("creates an independent entity without a saved document or an implicit membership", async () => {
  render(<DocumentConnections {...props("a")} path={null} />);
  await userEvent.click(screen.getByText("연결 관리", { exact: true }));
  await waitFor(() => expect(screen.getByLabelText("새 연결 엔티티 이름").hasAttribute("disabled")).toBe(false));
  await userEvent.type(screen.getByLabelText("새 연결 엔티티 이름"), "독립 연결");
  await userEvent.click(screen.getByRole("button", { name: "만들기" }));
  expect(await screen.findByRole("button", { name: "독립 연결" })).toBeTruthy();
  expect(createConnection).toHaveBeenCalledWith("독립 연결");
  expect(attachConnection).not.toHaveBeenCalled();
  expect(graph.memberships).toEqual([]);
});

it("attaches and detaches only the current document relation and keeps other chips", async () => {
  graph.memberships = [{ connectionId: "one", permalink: "other" }, { connectionId: "two", permalink: "a" }];
  render(<DocumentConnections {...props("a")} />);
  await userEvent.click(screen.getByText("연결 관리", { exact: true }));
  await waitFor(() => expect(screen.getByLabelText("연결할 엔티티").hasAttribute("disabled")).toBe(false));
  await userEvent.selectOptions(screen.getByLabelText("연결할 엔티티"), "one");
  await userEvent.click(screen.getByRole("button", { name: "문서 연결" }));
  const current = screen.getByLabelText("현재 문서 연결");
  await waitFor(() => expect(within(current).getByRole("button", { name: "검토" })).toBeTruthy());
  await userEvent.click(within(current).getByRole("button", { name: "검토 연결 해제" }));
  await waitFor(() => expect(within(current).queryByRole("button", { name: "검토" })).toBeNull());
  expect(within(current).getByRole("button", { name: "자료" })).toBeTruthy();
  expect(attachConnection).toHaveBeenCalledWith("one", "a");
  expect(detachConnection).toHaveBeenCalledWith("one", "a");
  expect(graph.memberships).toEqual([{ connectionId: "one", permalink: "other" }, { connectionId: "two", permalink: "a" }]);
});

it("keeps saved connections visible and disables writes during unsaved permalink changes", async () => {
  graph.memberships = [{ connectionId: "one", permalink: "a" }];
  render(<DocumentConnections {...props("a")} content={content("new")} />);
  const current = screen.getByLabelText("현재 문서 연결");
  expect(await within(current).findByRole("button", { name: "검토" })).toBeTruthy();
  expect(within(current).getByRole("button", { name: "검토 연결 해제" }).hasAttribute("disabled")).toBe(true);
  await userEvent.click(screen.getByText("연결 관리", { exact: true }));
  expect(screen.getByText("변경한 고정 링크를 저장한 뒤 연결해주세요.")).toBeTruthy();
  expect(screen.getByLabelText("연결할 엔티티").hasAttribute("disabled")).toBe(true);
  expect(attachConnection).not.toHaveBeenCalled();
  expect(detachConnection).not.toHaveBeenCalled();
});

it("does not apply an old document's completion to the newly opened document", async () => {
  let finish!: (value: ConnectionSnapshot) => void;
  const pending = new Promise<ConnectionSnapshot>((resolve) => { finish = resolve; });
  vi.mocked(attachConnection).mockReturnValue(pending);
  const view = render(<DocumentConnections {...props("a")} />);
  await userEvent.click(screen.getByText("연결 관리", { exact: true }));
  await waitFor(() => expect(screen.getByLabelText("연결할 엔티티").hasAttribute("disabled")).toBe(false));
  await userEvent.selectOptions(screen.getByLabelText("연결할 엔티티"), "one");
  fireEvent.submit(screen.getByRole("button", { name: "문서 연결" }).closest("form")!);
  view.rerender(<DocumentConnections {...props("b")} />);
  await act(async () => { graph.memberships.push({ connectionId: "one", permalink: "a" }); finish(structuredClone(graph)); await pending; });
  await waitFor(() => expect(screen.getByText("연결된 엔티티가 없습니다.")).toBeTruthy());
  expect(within(screen.getByLabelText("현재 문서 연결")).queryByRole("button", { name: "검토" })).toBeNull();
  expect(screen.queryByText("문서를 연결했습니다.")).toBeNull();
  expect(attachConnection).toHaveBeenCalledWith("one", "a");
});

it("shows a store failure and retries without clearing existing data", async () => {
  vi.mocked(listConnections).mockRejectedValueOnce(new Error("연결 데이터를 읽지 못했습니다."));
  render(<DocumentConnections {...props("a")} />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("연결 데이터를 읽지 못했습니다."));
  expect(screen.getByText("연결을 확인할 수 없습니다.")).toBeTruthy();
  await userEvent.click(screen.getByText("연결 관리", { exact: true }));
  expect(screen.getByLabelText("새 연결 엔티티 이름").hasAttribute("disabled")).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(createConnection).not.toHaveBeenCalled();
  expect(graph.entities).toHaveLength(2);
});
