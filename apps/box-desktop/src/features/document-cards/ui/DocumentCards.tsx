import { useEffect, useMemo, useState } from "react";
import { documentProperty } from "@box/editor";
import type { WorkspaceSnapshot } from "@box/contracts";
import { readDocument, errorMessage } from "@/entities/document";
import { workspaceName } from "@/entities/workspace";

const PAGE_SIZE = 24;
export function DocumentCards({ workspace, disabled, onOpen, onClose }: {
  workspace: WorkspaceSnapshot; disabled: boolean; onOpen: (path: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [metadata, setMetadata] = useState<Record<string, {summary: string; error?: string}>>({});
  const filtered = useMemo(() => workspace.documents.filter((file) => file.relativePath.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [workspace.documents, query]);
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = useMemo(() => filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), [filtered, currentPage]);
  useEffect(() => {
    let active = true;
    setMetadata({});
    void (async () => {
      for (let start = 0; start < visible.length; start += 8) {
        const batch = await Promise.all(visible.slice(start, start + 8).map(async (file) => {
          try { const snapshot = await readDocument(file.path); return [file.path, { summary: documentProperty(snapshot.content, "summary") }] as const; }
          catch (cause) { return [file.path, { summary: "", error: errorMessage(cause) }] as const; }
        }));
        if (!active) return;
        setMetadata((previous) => ({ ...previous, ...Object.fromEntries(batch) }));
      }
    })();
    return () => { active = false; };
  }, [visible, reload]);
  return <section className="document-cards" aria-label="문서 카드">
    <header className="cards-header"><div><span className="file-label">COLLECTION</span><h1>{workspaceName(workspace.path)}</h1><p>{filtered.length}개의 문서 · 파일에 남는 생각</p></div><button className="plain-button" onClick={onClose}>편집 화면으로 돌아가기</button></header>
    <div className="cards-controls"><input aria-label="문서 검색" value={query} onChange={(event) => {setQuery(event.target.value); setPage(0);}} placeholder="파일 이름이나 경로로 찾기" /><button onClick={() => setReload(reload + 1)}>요약 새로고침</button></div>
    <div className="cards-grid">{visible.map((file) => <article key={file.path}><button disabled={disabled} aria-label={`${file.name} 문서 열기`} onClick={() => onOpen(file.path)}><span className="card-mark">▤</span><h2>{file.name}</h2><p className="card-summary" title={metadata[file.path]?.summary}>{metadata[file.path]?.summary || (metadata[file.path] ? "요약을 추가해보세요." : "요약을 읽는 중…")}</p><small>{file.relativePath}</small>{metadata[file.path]?.error && <p className="comment-error">{metadata[file.path].error}</p>}</button></article>)}</div>
    {!filtered.length && <p className="panel-empty">{query ? "검색 결과가 없습니다." : "아직 Markdown 문서가 없습니다."}</p>}
    <footer className="cards-pagination"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage + 1} / {lastPage + 1}</span><button disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>다음</button></footer>
    {workspace.truncated && <p className="frontmatter-note">작업 디렉토리의 일부 문서만 표시됩니다.</p>}
    {Boolean(workspace.warnings?.length) && <p className="frontmatter-note">일부 폴더를 조회하지 못했습니다. 접근 권한을 확인해주세요.</p>}
  </section>;
}
