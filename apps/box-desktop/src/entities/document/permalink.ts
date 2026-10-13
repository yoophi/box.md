import { documentProperty, setDocumentProperty, markdownToDocument, splitDocument } from "@box/editor";
import type { WikilinkTarget, WikilinkTargets } from "@box/editor";
import type { DocumentSnapshot, WorkspaceDocument, WorkspaceSnapshot } from "@box/contracts";
type JSONContent = ReturnType<typeof markdownToDocument>;

export const documentLink = (permalink: string) => `boxmd://document?permalink=${encodeURIComponent(permalink)}`;
export function permalinkFromLink(link: string): string {
  const url = new URL(link);
  if (url.protocol !== "boxmd:" || url.hostname !== "document" || (url.pathname && url.pathname !== "/") || url.username || url.password || url.port || url.hash)
    throw new Error("box.md 문서 링크가 아닙니다.");
  const values = url.searchParams.getAll("permalink");
  if (values.length !== 1 || !values[0].trim() || Array.from(url.searchParams.keys()).some((key) => key !== "permalink"))
    throw new Error("고정 링크 값이 올바르지 않습니다.");
  return values[0];
}
export function newPermalink(): string {
  const now = new Date();
  const date = [now.getFullYear() % 100, now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, "0")).join("");
  const random = crypto.getRandomValues(new Uint8Array(4));
  return `${date}-${Array.from(random, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export function withDocumentPermalink(content: string): string {
  let existing: string;
  try {
    existing = documentProperty(content, "permalink");
  } catch { return content; } // Invalid YAML remains editable and saveable in source mode.
  return existing ? content : setDocumentProperty(content, "permalink", newPermalink());
}
async function documentIndex(files: WorkspaceDocument[], read: (path: string) => Promise<DocumentSnapshot>) {
  const index = new Map<string, DocumentSnapshot[]>();
  for (let start = 0; start < files.length; start += 8) {
    const snapshots = await Promise.all(files.slice(start, start + 8).map((file) => read(file.path)));
    for (const snapshot of snapshots) {
      try {
        const id = documentProperty(snapshot.content, "permalink");
        if (id) index.set(id, [...(index.get(id) ?? []), snapshot]);
      } catch { /* Malformed metadata cannot identify a document. */ }
    }
  }
  return index;
}
const duplicateMessage = "같은 permalink를 가진 문서가 여러 개 있습니다. 문서 속성에서 중복을 수정해주세요.";
const missingMessage = "현재 작업 디렉토리에서 이 고정 링크의 문서를 찾지 못했습니다.";
export async function resolvePermalink(files: WorkspaceDocument[], permalink: string, read: (path: string) => Promise<DocumentSnapshot>): Promise<string> {
  const matches = (await documentIndex(files, read)).get(permalink) ?? [];
  if (matches.length > 1) throw new Error(duplicateMessage);
  if (!matches.length) throw new Error(missingMessage);
  return matches[0].path;
}

function headingText(node: JSONContent): string {
  if (node.type === "wikilink") return String(node.attrs?.alias ?? node.attrs?.permalink ?? "");
  if (node.type === "image") return String(node.attrs?.alt ?? "");
  if (node.type === "hardBreak") return " ";
  return node.text ?? (node.content ?? []).map(headingText).join("");
}
function firstHeading(node: JSONContent): string {
  if (node.type === "heading") return headingText(node).trim();
  for (const child of node.content ?? []) {
    const title = firstHeading(child);
    if (title) return title;
  }
  return "";
}
function documentTitle(snapshot: DocumentSnapshot) {
  return documentProperty(snapshot.content, "title").trim()
    || firstHeading(markdownToDocument(splitDocument(snapshot.content).body))
    || snapshot.path.split(/[\\/]/).pop() || snapshot.path;
}

/** A partial listing or failed read cannot establish a permalink's uniqueness. */
export async function resolveDocumentTargets(
  workspace: WorkspaceSnapshot,
  ids: string[],
  read: (path: string) => Promise<DocumentSnapshot>,
): Promise<WikilinkTargets> {
  const error = (message: string) => new Map(ids.map((id) => [id, { state: "error", message } as WikilinkTarget]));
  if (workspace.truncated) return error("문서 목록이 일부만 표시되어 고정 링크를 확인할 수 없습니다. 더 작은 작업 디렉터리를 선택해주세요.");
  let index: Awaited<ReturnType<typeof documentIndex>>;
  try { index = await documentIndex(workspace.documents, read); }
  catch { return error("작업 디렉터리의 문서를 읽지 못해 고정 링크를 확인할 수 없습니다. 문서 목록을 새로고침해주세요."); }
  return new Map(ids.map((id): [string, WikilinkTarget] => {
    const matches = index.get(id) ?? [];
    if (matches.length > 1) return [id, { state: "duplicate", message: duplicateMessage }];
    if (!matches.length) return [id, { state: "missing", message: missingMessage }];
    try { return [id, { state: "resolved", title: documentTitle(matches[0]) }]; }
    catch { return [id, { state: "error", message: "대상 문서의 제목 속성을 확인해주세요." }]; }
  }));
}
