import type { WorkspaceSnapshot } from "@box/contracts";
import { invoke } from "@tauri-apps/api/core";
export const listWorkspace = (path: string) =>
  invoke<WorkspaceSnapshot>("list_workspace_documents", { path });
export const selectDocumentWorkspace = (path: string, rebind = false) =>
  invoke<WorkspaceSnapshot>("select_document_workspace", { path, rebind });
export function workspaceName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}
