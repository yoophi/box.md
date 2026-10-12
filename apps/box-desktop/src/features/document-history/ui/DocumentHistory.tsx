import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { HistoryEntry } from "@box/contracts";
import { errorMessage } from "@/entities/document";

export function DocumentHistory({ path, dirty, busy, onRestore, onClose }: {
  path: string; dirty: boolean; busy: boolean; onRestore: (content: string) => void; onClose: () => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let active = true;
    void invoke<HistoryEntry[]>("document_history", { path }).then((result) => {
      if (active) { setEntries(result); setSelected(result[0]?.id ?? null); }
    }).catch((cause) => { if (active) setError(errorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setContent(null); setConfirm(false); setError(null);
    void invoke<string>("history_content", { path, id: selected })
      .then((result) => { if (active) setContent(result); })
      .catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [path, selected]);
  const restore = () => { if (content !== null) { onRestore(content); onClose(); } };
  return <section className="history-panel" aria-label="문서 히스토리">
    <div className="mode-bar"><strong>저장 기록</strong><button className="plain-button" onClick={onClose}>문서로 돌아가기</button></div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {loading ? <p className="panel-empty">기록을 불러오는 중…</p> : entries.length === 0 ? <p className="panel-empty">저장하면 첫 기록이 남습니다.</p> : <>
      <div className="history-layout"><ol className="history-list">{entries.map((entry, index) => <li key={entry.id}>
        <button aria-pressed={selected === entry.id} onClick={() => setSelected(entry.id)}>
          <strong>{new Date(entry.savedAt).toLocaleString()}</strong><small>{index === 0 ? "최근 저장 · " : ""}{entry.id.slice(0, 8)}</small>
        </button></li>)}</ol>
        <textarea className="source-editor history-preview" aria-label="이전 버전 원문" readOnly value={content ?? "불러오는 중…"} />
      </div>
      <div className="history-actions">
        {confirm ? <><span>현재 미저장 변경을 선택한 버전으로 바꿀까요?</span><button onClick={() => setConfirm(false)}>취소</button><button disabled={busy} onClick={restore}>변경 버리고 복원</button></> : <><span>복원한 내용은 저장하기 전까지 디스크에 반영되지 않습니다.</span><button disabled={busy || content === null} onClick={() => dirty ? setConfirm(true) : restore()}>이 버전으로 복원</button></>}
      </div>
    </>}
  </section>;
}
