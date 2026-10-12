import { useState } from "react";
import type { WorkspaceDocument } from "@box/contracts";

export function LinkDocument({ documents, currentPath, disabled, onInsert }: {
  documents: WorkspaceDocument[]; currentPath: string | null; disabled: boolean; onInsert: (path: string) => Promise<void>;
}) {
  const [path, setPath] = useState("");
  const targets = documents.filter((file) => file.path !== currentPath);
  return <form className="document-properties" aria-label="문서 연결" onSubmit={(event) => {
    event.preventDefault(); if (path) void onInsert(path);
  }}><label>문서 연결<select aria-label="연결할 문서" value={path} disabled={disabled} onChange={(event) => setPath(event.target.value)}>
    <option value="">문서를 선택해주세요</option>{targets.map((file) => <option key={file.path} value={file.path}>{file.relativePath}</option>)}
  </select></label><button disabled={disabled || !targets.some((file) => file.path === path)}>링크 추가</button><small>본문 끝에 문서 링크를 추가합니다.</small></form>;
}
