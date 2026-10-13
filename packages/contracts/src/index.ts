export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface DocumentSnapshot {
  path: string;
  content: string;
  revision: string;
  historyWarning?: string | null;
}
export interface CreatedDocumentResult {
  document: DocumentSnapshot & { permalink: string };
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
  generation?: string;
  warnings?: Array<{ path: string | null; code: string }>;
}

export interface HistoryEntry { id: string; savedAt: string; }

export interface DocumentComment { id: string; body: string; createdAt: string; }

export interface ConnectionEntity { id: string; name: string; }
export interface ConnectionMembership { connectionId: string; permalink: string; }
export interface ConnectionSnapshot {
  version: 1;
  entities: ConnectionEntity[];
  memberships: ConnectionMembership[];
}

export interface SiteBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}
export type SiteBrowserAction = "back" | "forward" | "reload";
export interface SiteBrowserSnapshot {
  open: boolean;
  visible: boolean;
  url: string | null;
  title: string;
  loading: boolean;
  canGoBack: boolean | null;
  canGoForward: boolean | null;
}
