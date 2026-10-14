import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { DocumentSnapshot, WorkspaceSnapshot } from "@box/contracts";
import { readDocument, writeDocument } from "@/entities/document";
import { DocumentCardModal } from "./DocumentCardModal";

vi.mock("@/entities/document", () => ({
  documentName: (path: string) => path.split("/").pop(),
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
  readDocument: vi.fn(),
  writeDocument: vi.fn(),
}));
vi.mock("@/features/edit-document", () => ({
  MarkdownEditor: ({ content, readOnly, onChange }: { content: string; readOnly?: boolean; onChange: (value: string) => void }) =>
    <textarea aria-label="테스트 문서 본문" value={content} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />,
}));

const workspace = (path: string): WorkspaceSnapshot => ({ path, generation: `scope:${path}`, documents: [], truncated: false });
const document = (path: string, content: string, revision = "1"): DocumentSnapshot => ({ path, content, revision });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("ignores an older document read that completes after a newer path", async () => {
  let finishOld!: (value: DocumentSnapshot) => void;
  let finishNew!: (value: DocumentSnapshot) => void;
  vi.mocked(readDocument)
    .mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
    .mockReturnValueOnce(new Promise((resolve) => { finishNew = resolve; }));
  const view = render(<DocumentCardModal path="/one.md" workspace={workspace("/root")} onClose={vi.fn()} onSaved={vi.fn()} />);
  view.rerender(<DocumentCardModal path="/two.md" workspace={workspace("/root")} onClose={vi.fn()} onSaved={vi.fn()} />);
  await act(async () => { finishNew(document("/two.md", "새 문서")); });
  expect(await screen.findByDisplayValue("새 문서")).toBeTruthy();
  await act(async () => { finishOld(document("/one.md", "오래된 문서")); });
  expect(screen.getByDisplayValue("새 문서")).toBeTruthy();
  expect(screen.queryByDisplayValue("오래된 문서")).toBeNull();
});

it("keeps a dirty draft and blocks saving after the workspace root changes", async () => {
  vi.mocked(readDocument).mockResolvedValue(document("/root/note.md", "원문"));
  vi.mocked(writeDocument).mockResolvedValue(document("/root/note.md", "저장되면 안 됨", "2"));
  const close = vi.fn();
  const view = render(<DocumentCardModal path="/root/note.md" workspace={workspace("/root")} onClose={close} onSaved={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "편집" }));
  fireEvent.change(screen.getByRole("textbox", { name: "테스트 문서 본문" }), { target: { value: "보존할 초안" } });
  view.rerender(<DocumentCardModal path="/root/note.md" workspace={workspace("/other")} onClose={close} onSaved={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("작업 디렉터리가 변경"));
  expect(screen.getByRole("textbox", { name: "테스트 문서 본문" })).toHaveProperty("value", "보존할 초안");
  expect(screen.getByRole("button", { name: "저장" }).hasAttribute("disabled")).toBe(true);
  expect(close).not.toHaveBeenCalled();
  expect(writeDocument).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(screen.getByRole("alertdialog", { name: "변경사항을 버릴까요?" })).toBeTruthy());
});
