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

export interface HistoryEntry { id: string; savedAt: string; }

export interface DocumentComment { id: string; body: string; createdAt: string; }

export interface ConnectionEntity { id: string; name: string; }
export interface ConnectionMembership { connectionId: string; permalink: string; }
export interface ConnectionSnapshot {
  version: 1;
  entities: ConnectionEntity[];
  memberships: ConnectionMembership[];
}
