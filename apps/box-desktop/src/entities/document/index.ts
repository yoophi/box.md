import { invoke } from "@tauri-apps/api/core";
import type { DocumentSnapshot } from "@box/contracts";

export const readDocument = (path: string) =>
  invoke<DocumentSnapshot>("open_document", { path });
export const documentRevision = (path: string) =>
  invoke<string | null>("document_revision", { path });
export const writeDocument = (
  path: string,
  content: string,
  expectedRevision: string | null,
) =>
  invoke<DocumentSnapshot>("save_document", {
    path,
    content,
    expectedRevision,
  });
export function documentName(path: string | null): string {
  return path?.split(/[\\/]/).pop() || "이름 없는 문서.md";
}
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return String(error);
}
