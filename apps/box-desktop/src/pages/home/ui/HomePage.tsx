import { AgentChatSheet, DocumentChatTools, useAgentChat } from "@/features/agent-chat";
import { WorkspaceSettings } from "@/features/workspace-settings";
import { DocumentCards } from "@/features/document-cards";
import { DocumentComments } from "@/features/document-comments";
import { LinkDocument } from "@/features/link-document";
import { permalinkFromLink } from "@/entities/document";
import { DocumentProperties } from "@/features/document-properties";
import { DocumentConnections } from "@/features/document-connections";
import { SiteBrowser, useSiteBrowser } from "@/features/site-browser";
import { useEffect, useRef, useState } from "react";
import { DocumentHistory } from "@/features/document-history";
import { Button, CollapsibleResizablePanels, type CollapsibleResizablePanelsHandle } from "@box/ui";
import { documentName } from "@/entities/document";
import { MarkdownEditor } from "@/features/edit-document";
import { useDocumentWorkspace } from "@/features/manage-document";
import { workspaceName } from "@/entities/workspace";
import { isDesktop } from "@/shared/lib/runtime";

export function HomePage() {
  const workspace = useDocumentWorkspace();
  const browser = useSiteBrowser();
  const [showBrowser, setShowBrowser] = useState(false);
  const panels = useRef<CollapsibleResizablePanelsHandle>(null);
  const [linkToOpen, setLinkToOpen] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const chat = useAgentChat(workspace.workspace?.path, showChat, workspace.workspace?.generation ?? undefined);
  const [showCards, setShowCards] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => { setShowHistory(false); setShowCards(false); }, [workspace.document.key]);
  const {
    document,
    dirty,
    busy,
    error,
    notice,
    externalNotice,
    pending,
    workspace: folder,
    refreshing,
    reading,
  } = workspace;
  const commentKey = document.path ? `path:${document.path}` : null;
  const blocked = Boolean(pending || showSettings);
  const toggleChat = async () => {
    const controller = panels.current;
    if (!controller) return;
    if (controller.getState().collapsedPanel !== "right") { controller.collapse("right"); return; }
    // Before shrinking the primary area, confirm the foreign native child hidden.
    if (browser.overlaySafe || await browser.controller.hide()) controller.expand("right");
  };
  const requestDocument = (action: Parameters<typeof workspace.request>[0]) => { setShowBrowser(false); workspace.request(action); };
  return (
    <main className="document-workspace">
      <aside
        className="workspace-sidebar"
        inert={Boolean(pending || showSettings)}
      >
        <a className="wordmark" href="#">
          box.md<span>▧</span>
        </a>
        <p className="sidebar-caption">생각의 보관함</p>
        <button
          className="workspace-picker"
          title={folder?.path}
          disabled={busy || !isDesktop()}
          onClick={() => requestDocument("directory")}
        >
          <span className="workspace-picker-name">{folder ? `▱ ${workspaceName(folder.path)}` : "작업 디렉터리 선택"}</span>
          <span>{folder ? "변경" : "＋"}</span>
        </button>
        <button
          className="new-document"
          disabled={busy}
          onClick={() => requestDocument("new")}
        >
          ＋ 새 문서
        </button>
        <button
          className="sidebar-action"
          disabled={busy || !isDesktop()}
          onClick={() => requestDocument("open")}
        >
          문서 열기 <kbd>⌘O</kbd>
        </button>
        <button className="sidebar-action" disabled={!folder || busy} onClick={() => { setShowBrowser(false); setShowCards(true); }}>문서 카드 보기</button>
        <button className="sidebar-action" aria-expanded={showBrowser} disabled={busy} onClick={() => setShowBrowser(!showBrowser)}>사이트 브라우저 <span>↗</span></button>
        <button className="sidebar-action" disabled={!folder || !isDesktop()} aria-expanded={showChat} onClick={() => void toggleChat()}>에이전트 채팅</button>
        <button className="sidebar-action" disabled={busy || !isDesktop()} onClick={() => setShowSettings(true)}>설정</button>
        <form className="open-document-link" onSubmit={(event) => {
          event.preventDefault();
          try { requestDocument({ type: "permalink", path: permalinkFromLink(linkToOpen) }); setLinkError(null); }
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
                      requestDocument({ type: "open-path", path: file.path })
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
          {Boolean(folder?.warnings?.length) && (
            <p className="sidebar-empty">일부 폴더를 조회하지 못했습니다. 접근 권한을 확인해주세요.</p>
          )}
        </section>
        <p className="sidebar-footer">
          수집 · 기록 · 연결
          <br />
          <span>내 파일에 남는 생각.</span>
        </p>
      </aside>
      <div className="workspace-body" inert={blocked} onClickCapture={(event) => {
        const rail = event.target instanceof Element
          ? event.target.closest('[data-panel-side="right"] > button[aria-expanded="false"]') : null;
        if (rail && !browser.overlaySafe) {
          event.preventDefault(); event.stopPropagation(); void toggleChat();
        }
      }}>
        <CollapsibleResizablePanels
          className="workspace-split"
          controllerRef={panels}
          defaultCollapsedPanel="right"
          onStateChange={(state) => setShowChat(state.collapsedPanel !== "right")}
          leftPanel={{
            id: "box-primary", title: "작업 영역", collapsible: false, showTitle: false,
            keepMounted: true, minSize: "30%", contentClassName: "workspace-panel-content workspace-primary",
            content: (<>
      <section className="workspace-main" hidden={showBrowser || !browser.overlaySafe} inert={blocked} onClickCapture={(event) => {
        const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
        const href = anchor?.getAttribute("href");
        if (href && /^https?:/i.test(href)) {
          event.preventDefault(); event.stopPropagation(); setShowBrowser(true); browser.controller.navigate(href); return;
        }
        if (!href?.startsWith("boxmd:")) return;
        event.preventDefault(); event.stopPropagation();
        try { workspace.request({ type: "permalink", path: permalinkFromLink(href) }); }
        catch { setLinkError("유효하지 않은 문서 링크입니다."); }
      }}>
        {showCards && folder ? <>
          {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={workspace.dismissError}>닫기</button></div>}
          <DocumentCards workspace={folder} disabled={busy} onOpen={(path) => workspace.request({ type: "open-path", path })} onClose={() => setShowCards(false)} />
        </> : <>
        <header className="document-header">
          <div className="document-title">
            <span className="file-label">{reading ? "읽기 모드 · READ ONLY" : "편집 모드 · DOCUMENT"}</span>
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
            <button className="plain-button" disabled={busy} aria-pressed={reading} onClick={() => workspace.request(reading ? "edit" : "read")}>{reading ? "편집 모드로 전환" : "읽기 모드로 전환"}</button>
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
              disabled={busy || !document.path || !folder || !isDesktop()}
              onClick={() => void workspace.duplicateDocument()}
            >
              복제 <kbd>⇧⌘S</kbd>
            </button>
            <Button
              disabled={busy || reading || !isDesktop()}
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
        {folder && !reading && <LinkDocument documents={folder.documents} currentPath={document.path} disabled={busy} onInsert={workspace.insertDocumentLink} />}
        <DocumentProperties content={document.content} disabled={busy || reading} identityPending={!document.path} onChange={workspace.restoreVersion} />
        <DocumentConnections path={document.path} content={document.content} baseline={document.baseline} workspace={folder} disabled={busy} onOpen={(id) => workspace.request({ type: "permalink", path: id })} />
        <div className={reading ? "reading-layout" : "editor-layout"}>
        {showHistory && document.path ? <DocumentHistory key={document.path} path={document.path} dirty={dirty} busy={busy || reading} onRestore={workspace.restoreVersion} onClose={() => setShowHistory(false)} /> : <MarkdownEditor
          key={document.key}
          content={document.content}
          workspace={folder}
          onChange={workspace.change}
          disabled={busy}
          readOnly={reading}
        />}
        {reading && (document.path && commentKey ? <DocumentComments key={commentKey} documentKey={commentKey} /> : <aside className="document-comments"><p>댓글을 남기려면 먼저 문서를 저장해주세요.</p></aside>)}
        </div>
        <footer className="document-status" role="status">
          <span>{externalNotice ?? (dirty ? "저장하지 않은 변경사항" : notice)}</span>
          <span>
            {document.content.length.toLocaleString()}자 ·{" "}
            {isDesktop() ? "로컬 Markdown" : "브라우저 미리보기"}
          </span>
        </footer>
        </>}
      </section>
      <SiteBrowser controller={browser.controller} state={browser.state} visible={showBrowser} blocked={blocked} onClose={() => setShowBrowser(false)} />
            </>),
          }}
          rightPanel={{
            id: "box-agent-chat", title: "채팅 패널", keepMounted: true,
            defaultSize: "360px", minSize: "220px", maxSize: "60%",
            contentClassName: "workspace-panel-content workspace-chat",
            content: <><DocumentChatTools model={chat} open={showChat} blocked={blocked} /><AgentChatSheet model={chat} open={showChat} variant="inline" workspace={folder?.path} blocked={blocked} onHide={() => panels.current?.collapse("right")} /></>,
          }}
        />
      </div>
      {showSettings && browser.overlaySafe && <WorkspaceSettings savedPath={workspace.configuredWorkspacePath} activePath={folder?.path} onClose={() => setShowSettings(false)} onSave={(path) => {
        setShowSettings(false);
        workspace.request({ type: "workspace", path });
      }} />}
      {(blocked || !showBrowser) && !browser.overlaySafe && browser.state.error && <div className="browser-cover-recovery" role="alert"><span>사이트 표시를 정리하지 못했습니다. 다시 시도해주세요.</span><button onClick={() => browser.controller.retry()}>페이지 숨김 다시 시도</button></div>}
      {pending && browser.overlaySafe && (
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
    </main>
  );
}
