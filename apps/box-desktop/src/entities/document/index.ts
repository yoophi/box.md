export { readDocument, documentRevision, writeDocument, createDocument, duplicateDocument } from "./api";
export function documentName(path: string | null): string {
  return path?.split(/[\\/]/).pop() || "이름 없는 문서.md";
}
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return String(error);
}

export { documentLink, permalinkFromLink, newPermalink, withDocumentPermalink, resolvePermalink, resolveDocumentTargets } from "./permalink";
export { useDocumentTargets } from "./use-document-targets";
