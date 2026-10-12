export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface DocumentSnapshot {
  path: string;
  content: string;
  revision: string;
}
export interface DocumentError {
  code: string;
  message: string;
}

export interface WorkspaceDocument {
  path: string;
  relativePath: string;
  name: string;
}
export interface WorkspaceSnapshot {
  path: string;
  documents: WorkspaceDocument[];
  truncated: boolean;
}
