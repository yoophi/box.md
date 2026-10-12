import { permalinkFromLink } from "@/entities/document";
import { DocumentProperties } from "@/features/document-properties";
import { useEffect, useState } from "react";
import { DocumentHistory } from "@/features/document-history";
import { Button } from "@box/ui";
import { documentName } from "@/entities/document";
import { MarkdownEditor } from "@/features/edit-document";
import { useDocumentWorkspace } from "@/features/manage-document";
import { workspaceName } from "@/entities/workspace";
import { isDesktop } from "@/shared/lib/runtime";

export function HomePage() {
  const workspace = useDocumentWorkspace();
  const [linkToOpen, setLinkToOpen] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => setShowHistory(false), [workspace.document.key]);
  const {
    document,
    dirty,
    busy,
    error,
    notice,
    pending,
    overwrite,
    workspace: folder,
    refreshing,
  } = workspace;
  return (
    <main className="document-workspace">
      <aside
        className="workspace-sidebar"
        inert={Boolean(pending || overwrite)}
      >
        <a className="wordmark" href="#">
          box.md<span>▧</span>
        </a>
        <p className="sidebar-caption">생각의 보관함</p>
        <button
          className="workspace-picker"
          title={folder?.path}
          disabled={busy || !isDesktop()}
          onClick={() => workspace.request("directory")}
        >
          {folder ? `▱ ${workspaceName(folder.path)}` : "작업 디렉터리 선택"}
          <span>{folder ? "변경" : "＋"}</span>
        </button>
        <button
          className="new-document"
          disabled={busy}
          onClick={() => workspace.request("new")}
        >
          ＋ 새 문서
        </button>
        <button
          className="sidebar-action"
          disabled={busy || !isDesktop()}
          onClick={() => workspace.request("open")}
        >
          문서 열기 <kbd>⌘O</kbd>
        </button>
        <form className="open-document-link" onSubmit={(event) => {
          event.preventDefault();
          try { workspace.request({ type: "permalink", path: permalinkFromLink(linkToOpen) }); setLinkError(null); }
          catch { setLinkError("유효한 box.md 문서 링크를 입력해주세요."); }
        }}><label>고정 링크로 열기<input aria-label="열 문서 링크" value={linkToOpen} onChange={(event) => setLinkToOpen(event.target.value)} placeholder="boxmd://document?…" /></label><button disabled={busy || !folder || !isDesktop()}>열기</button>{linkError && <p role="alert">{linkError}</p>}</form>
        <section
          className="sidebar-section document-list-section"
          aria-label="작업 디렉터리 문서"
        >
          <div className="document-list-heading">
            <span>문서 {folder ? `· ${folder.documents.length}` : ""}</span>
            <button
              aria-label="문서 목록 새로고침"
              title="문서 목록 새로고침"
              disabled={!folder || busy || refreshing}
              onClick={() => void workspace.refreshWorkspace()}
            >
              {refreshing ? "…" : "↻"}
            </button>
          </div>
          {!folder ? (
            <p className="sidebar-empty">
              작업 디렉터리를 선택하면
              <br />
              문서 목록이 표시됩니다.
            </p>
          ) : folder.documents.length === 0 ? (
            <p className="sidebar-empty">
              아직 Markdown 문서가 없습니다.
              <br />새 문서를 작성해 저장해보세요.
            </p>
          ) : (
            <ul className="document-list">
              {folder.documents.map((file) => (
                <li key={file.path}>
                  <button
                    aria-current={
                      document.path === file.path ? "page" : undefined
                    }
                    disabled={busy}
                    title={file.relativePath}
                    onClick={() =>
                      workspace.request({ type: "open-path", path: file.path })
                    }
                  >
                    <span className="document-list-icon">▤</span>
                    <span>
                      <strong>{file.name}</strong>
                      {file.relativePath !== file.name && (
                        <small>{file.relativePath}</small>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {folder?.truncated && (
            <p className="sidebar-empty">
              목록이 일부 표시됩니다. 더 작은 작업 폴더를 선택해주세요.
            </p>
          )}
        </section>
        <p className="sidebar-footer">
          수집 · 기록 · 연결
          <br />
          <span>내 파일에 남는 생각.</span>
        </p>
      </aside>
      <section className="workspace-main" inert={Boolean(pending || overwrite)}>
        <header className="document-header">
          <div className="document-title">
            <span className="file-label">DOCUMENT</span>
            <h1>
              {documentName(document.path)}
              {dirty && (
                <span className="dirty-dot" aria-label="미저장 변경">
                  ●
                </span>
              )}
            </h1>
            <span className="document-path" title={document.path ?? ""}>
              {document.path ?? "아직 저장하지 않은 문서"}
            </span>
          </div>
          <div className="file-actions">
            <button className="plain-button" disabled={busy || !document.path || !isDesktop()} onClick={() => setShowHistory(!showHistory)}>히스토리</button>
            {document.path && (
              <button
                className="plain-button"
                disabled={busy}
                onClick={() => workspace.request("reload")}
              >
                다시 불러오기
              </button>
            )}
            <button
              className="plain-button"
              disabled={busy || !isDesktop()}
              onClick={() => void workspace.saveDocument(true)}
            >
              다른 이름 저장
            </button>
            <Button
              disabled={busy || !isDesktop()}
              onClick={() => void workspace.saveDocument()}
            >
              {busy ? "처리 중…" : "저장"}
              <kbd>⌘S</kbd>
            </Button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={workspace.dismissError}>닫기</button>
          </div>
        )}
        <DocumentProperties content={document.content} disabled={busy} onChange={workspace.restoreVersion} />
        {showHistory && document.path ? <DocumentHistory key={document.path} path={document.path} dirty={dirty} busy={busy} onRestore={workspace.restoreVersion} onClose={() => setShowHistory(false)} /> : <MarkdownEditor
          key={document.key}
          content={document.content}
          onChange={workspace.change}
          disabled={busy}
        />}
        <footer className="document-status" role="status">
          <span>{dirty ? "저장하지 않은 변경사항" : notice}</span>
          <span>
            {document.content.length.toLocaleString()}자 ·{" "}
            {isDesktop() ? "로컬 Markdown" : "브라우저 미리보기"}
          </span>
        </footer>
      </section>
      {pending && !overwrite && (
        <div className="modal-overlay">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-title"
          >
            <h2 id="unsaved-title">변경사항을 저장할까요?</h2>
            <p>계속하기 전에 현재 문서의 변경사항을 저장할 수 있습니다.</p>
            <div className="dialog-actions">
              <button
                autoFocus
                disabled={busy}
                onClick={() => void workspace.resolvePending("cancel")}
              >
                취소
              </button>
              <button
                disabled={busy}
                onClick={() => void workspace.resolvePending("discard")}
              >
                변경 버리고 계속
              </button>
              <Button
                disabled={busy}
                onClick={() => void workspace.resolvePending("save")}
              >
                저장 후 계속
              </Button>
            </div>
          </section>
        </div>
      )}
      {overwrite && (
        <div className="modal-overlay">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="overwrite-title"
          >
            <h2 id="overwrite-title">기존 파일을 바꿀까요?</h2>
            <p>{documentName(overwrite.path)} 파일을 현재 문서로 덮어씁니다.</p>
            <div className="dialog-actions">
              <button
                autoFocus
                disabled={busy}
                onClick={workspace.cancelOverwrite}
              >
                취소
              </button>
              <Button
                disabled={busy}
                onClick={() => void workspace.confirmOverwrite()}
              >
                덮어쓰기
              </Button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
