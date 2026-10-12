import { invoke } from "@tauri-apps/api/core";
import type { DocumentSnapshot } from "@box/contracts";

export const readDocument = (path: string) => invoke<DocumentSnapshot>("open_document", { path });
export const documentRevision = (path: string) => invoke<string | null>("document_revision", { path });
export const writeDocument = (path: string, content: string, expectedRevision: string | null) =>
  invoke<DocumentSnapshot>("save_document", { path, content, expectedRevision });
