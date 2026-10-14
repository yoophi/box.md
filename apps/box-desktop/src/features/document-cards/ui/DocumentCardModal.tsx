import { useEffect, useRef, useState } from "react";
import type { DocumentSnapshot, WorkspaceSnapshot } from "@box/contracts";
import { documentName, errorMessage, readDocument, writeDocument } from "@/entities/document";
import { MarkdownEditor } from "@/features/edit-document";

interface Props {
  path: string;
  workspace: WorkspaceSnapshot;
  onClose: () => void;
  onSaved: () => void;
}

export function DocumentCardModal({ path, workspace, onClose, onSaved }: Props) {
  const [snapshot, setSnapshot] = useState<DocumentSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [contextChanged, setContextChanged] = useState(false);
  const sequence = useRef(0);
  const rootAtOpen = useRef(workspace.path);
  const dirty = Boolean(snapshot && draft !== snapshot.content);

  useEffect(() => {
    const request = ++sequence.current;
    rootAtOpen.current = workspace.path;
    setLoading(true); setError(null); setNotice(""); setEditing(false); setConfirmClose(false); setContextChanged(false);
    void readDocument(path).then((document) => {
      if (request !== sequence.current) return;
      setSnapshot(document); setDraft(document.content);
    }).catch((cause) => {
      if (request === sequence.current) setError(errorMessage(cause));
    }).finally(() => {
      if (request === sequence.current) setLoading(false);
    });
    return () => { ++sequence.current; };
  }, [path]);

  useEffect(() => {
    if (workspace.path === rootAtOpen.current) return;
    ++sequence.current;
    if (dirty) {
      setContextChanged(true);
      setError("작업 디렉터리가 변경되어 이 초안을 저장할 수 없습니다. 내용을 확인한 뒤 닫아주세요.");
    } else {
      onClose();
    }
  }, [workspace.path, dirty, onClose]);

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmClose(true); else onClose();
  };

  const save = async () => {
    if (!snapshot || !dirty || saving || contextChanged) return;
    const request = ++sequence.current;
    const expectedRoot = rootAtOpen.current;
    setSaving(true); setError(null); setNotice("");
    try {
      const saved = await writeDocument(path, draft, snapshot.revision);
      if (request !== sequence.current || workspace.path !== expectedRoot) return;
      setSnapshot(saved); setDraft(saved.content); setEditing(false); setNotice("문서를 저장했습니다."); onSaved();
    } catch (cause) {
      if (request === sequence.current) setError(errorMessage(cause));
    } finally {
      if (request === sequence.current) setSaving(false);
    }
  };

  return <div className="card-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
    <section className="card-document-modal" role="dialog" aria-modal="true" aria-labelledby="card-document-title">
      <header>
        <div><span className="file-label">CARD DOCUMENT</span><h2 id="card-document-title">{documentName(path)}</h2><small>{path}</small></div>
        <div className="card-modal-actions">
          {snapshot && <button className="plain-button" disabled={loading || saving || contextChanged} onClick={() => setEditing((value) => !value)}>{editing ? "읽기 모드" : "편집"}</button>}
          <button className="plain-button" disabled={!snapshot || !dirty || saving || contextChanged} onClick={() => void save()}>{saving ? "저장 중…" : "저장"}</button>
          <button className="plain-button" disabled={saving} onClick={requestClose}>닫기</button>
        </div>
      </header>
      {loading ? <p className="panel-empty">문서를 읽는 중…</p> : snapshot ? <MarkdownEditor key={`${path}:${snapshot.revision}`} content={draft} workspace={workspace} disabled={saving || contextChanged} readOnly={!editing} onChange={setDraft} /> : null}
      {error && <p className="connection-error" role="alert">{error}</p>}
      {notice && <p className="connection-notice" role="status">{notice}</p>}
      {snapshot && <footer><span>{editing ? dirty ? "저장하지 않은 변경사항" : "편집 모드" : "읽기 모드"}</span><span>revision {snapshot.revision}</span></footer>}
      {confirmClose && <div className="card-close-confirm" role="alertdialog" aria-modal="true" aria-labelledby="card-close-title">
        <h3 id="card-close-title">변경사항을 버릴까요?</h3>
        <p>저장하지 않은 카드 문서 편집 내용이 있습니다.</p>
        <div><button autoFocus onClick={() => setConfirmClose(false)}>계속 편집</button><button onClick={onClose}>변경 버리고 닫기</button></div>
      </div>}
    </section>
  </div>;
}
