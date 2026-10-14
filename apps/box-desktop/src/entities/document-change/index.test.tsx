import { expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { listenDocumentChanges } from "./index";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

it("accepts only bounded relative document events from the native main channel", async () => {
  let dispatch!: (event: { payload: unknown }) => void;
  const stop = vi.fn();
  vi.mocked(listen).mockImplementationOnce(async (_name, receive) => {
    dispatch = receive as typeof dispatch;
    return stop;
  });
  const receive = vi.fn();
  const unlisten = await listenDocumentChanges(receive);
  expect(listen).toHaveBeenCalledWith(
    "box:document-change",
    expect.any(Function),
  );
  dispatch({
    payload: {
      generation: "g1",
      kind: "documentChanged",
      document: { path: "notes/a.md", revision: "r1" },
    },
  });
  dispatch({
    payload: { generation: "g1", kind: "connectionsChanged", document: null },
  });
  for (const payload of [
    {
      generation: "g1",
      kind: "documentChanged",
      document: { path: "/private/a.md", revision: "r1" },
    },
    {
      generation: "g1",
      kind: "documentChanged",
      document: { path: "../a.md", revision: "r1" },
    },
    {
      generation: "g1",
      kind: "documentChanged",
      document: { path: "C:\\private\\a.md", revision: "r1" },
    },
    {
      generation: "g1",
      kind: "documentChanged",
      document: { path: "a.md", revision: "x".repeat(257) },
    },
    {
      generation: "g1",
      kind: "connectionsChanged",
      document: { path: "a.md", revision: "r1" },
    },
    {
      generation: "",
      kind: "documentDeleted",
      document: { path: "a.md", revision: "r1" },
    },
    { token: "secret", path: "a.md" },
  ])
    dispatch({ payload });
  expect(receive).toHaveBeenCalledTimes(2);
  expect(receive).toHaveBeenNthCalledWith(1, {
    generation: "g1",
    kind: "documentChanged",
    document: { path: "notes/a.md", revision: "r1" },
  });
  unlisten();
  expect(stop).toHaveBeenCalledOnce();
});
