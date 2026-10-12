import type { WorkspaceSnapshot } from "@box/contracts";
import { invoke } from "@tauri-apps/api/core";
export const listWorkspace = (path: string) =>
  invoke<WorkspaceSnapshot>("list_workspace_documents", { path });
export function workspaceName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}
