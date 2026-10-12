import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DocumentComment } from "@box/contracts";
import { errorMessage } from "@/entities/document";

export function DocumentComments({ documentKey }: { documentKey: string }) {
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void invoke<DocumentComment[]>("list_document_comments", { key: documentKey })
      .then((items) => { if (active) setComments(items); })
      .catch((cause) => { if (active) setError(errorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [documentKey, reload]);
  return <aside className="document-comments" aria-label="문서 댓글">
    <div className="comments-heading"><h2>의견 <span>{comments.length}</span></h2><button disabled={loading || sending} onClick={() => setReload(reload + 1)}>새로고침</button></div>
    {error && <p className="comment-error" role="alert">{error}</p>}
    <ol className="comments-list">{comments.map((comment) => <li key={comment.id}><time>{new Date(Number(comment.createdAt)).toLocaleString()}</time><p>{comment.body}</p></li>)}</ol>
    {!comments.length && <p className="comments-empty">{loading ? "의견을 불러오는 중…" : "첫 의견을 남겨보세요."}</p>}
    <form onSubmit={(event) => {
      event.preventDefault(); if (sending || !body.trim()) return;
      setSending(true); setError(null);
      void invoke<DocumentComment>("add_document_comment", { key: documentKey, body })
        .then((comment) => { setComments((items) => [...items, comment]); setBody(""); })
        .catch((cause) => setError(errorMessage(cause)))
        .finally(() => setSending(false));
    }}><label>댓글 내용<textarea aria-label="댓글 내용" value={body} maxLength={10000} disabled={loading || sending} onChange={(event) => setBody(event.target.value)} placeholder="원문은 그대로 두고 생각을 더하세요…" /></label><button disabled={loading || sending || !body.trim()}>{sending ? "저장 중…" : "댓글 남기기"}</button><small>댓글은 원문과 별도로 보관됩니다.</small></form>
  </aside>;
}
