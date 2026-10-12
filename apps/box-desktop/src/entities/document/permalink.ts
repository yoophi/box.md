import { documentProperty, setDocumentProperty } from "@box/editor";
import type { DocumentSnapshot, WorkspaceDocument } from "@box/contracts";

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
export function withDocumentPermalink(content: string): string {
  try {
    return documentProperty(content, "permalink") ? content : setDocumentProperty(content, "permalink", crypto.randomUUID());
  } catch { return content; } // Invalid YAML remains editable and saveable in source mode.
}
export async function resolvePermalink(files: WorkspaceDocument[], permalink: string, read: (path: string) => Promise<DocumentSnapshot>): Promise<string> {
  const matches: string[] = [];
  for (let start = 0; start < files.length; start += 8) {
    await Promise.all(files.slice(start, start + 8).map(async (file) => {
      const snapshot = await read(file.path);
      try { if (documentProperty(snapshot.content, "permalink") === permalink) matches.push(snapshot.path); }
      catch { /* Malformed metadata cannot identify a document. */ }
    }));
  }
  if (matches.length > 1) throw new Error("같은 permalink를 가진 문서가 여러 개 있습니다. 문서 속성에서 중복을 수정해주세요.");
  if (!matches.length) throw new Error("현재 작업 디렉토리에서 이 고정 링크의 문서를 찾지 못했습니다.");
  return matches[0];
}
