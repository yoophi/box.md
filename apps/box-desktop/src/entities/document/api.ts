import { invoke } from "@tauri-apps/api/core";
import type { CreatedDocumentResult, DocumentSnapshot } from "@box/contracts";

export const readDocument = (path: string) => invoke<DocumentSnapshot>("open_document", { path });
export const documentRevision = (path: string) => invoke<string | null>("document_revision", { path });
export const writeDocument = (path: string, content: string, expectedRevision: string | null) =>
  invoke<DocumentSnapshot>("save_document", { path, content, expectedRevision });

export async function createDocument(generation: string, requestId: string, content: string) {
  return (await invoke<CreatedDocumentResult>("create_document", { generation, requestId, content })).document;
}
export async function duplicateDocument(generation: string, requestId: string, path: string, expectedRevision: string, content: string) {
  return (await invoke<CreatedDocumentResult>("duplicate_document", { generation, requestId, document: { path }, expectedRevision, content })).document;
}
