import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { documentLink, newPermalink } from "@/entities/document";
import { isDesktop } from "@/shared/lib/runtime";
import { useEffect, useState } from "react";
import { documentProperty, setDocumentProperty } from "@box/editor";
import { errorMessage } from "@/entities/document";

export function DocumentProperties({ content, disabled, identityPending = false, onChange }: {content: string; disabled: boolean; identityPending?: boolean; onChange: (content: string) => void}) {
  const [summary, setSummary] = useState("");
  const [permalink, setPermalink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  useEffect(() => {
    try { setPermalink(documentProperty(content, "permalink")); setSummary(documentProperty(content, "summary")); setParseError(null); }
    catch (cause) { setParseError(errorMessage(cause)); }
  }, [content]);
  return <form className="document-properties" aria-label="문서 속성" onSubmit={(event) => {
    event.preventDefault();
    try {
      const next = setDocumentProperty(content, "summary", summary.trim());
      onChange(identityPending ? next : setDocumentProperty(next, "permalink", permalink.trim())); setError(null);
    }
    catch (cause) { setError(errorMessage(cause)); }
  }}>
    <label>한 줄 요약<input aria-label="한 줄 요약" value={summary} disabled={disabled || Boolean(parseError)} onChange={(event) => setSummary(event.target.value)} placeholder="이 문서를 한 문장으로" /></label>
    <label>고정 링크<input aria-label="permalink" value={identityPending ? "" : permalink} disabled={disabled || Boolean(parseError) || identityPending} onChange={(event) => setPermalink(event.target.value)} placeholder={identityPending ? "저장 시 자동 생성" : "/notes/my-document"} /></label>
    <button type="button" disabled={disabled || Boolean(parseError) || Boolean(permalink) || identityPending} onClick={() => {
      try { setPermalink(newPermalink()); setError(null); } catch (cause) { setError(errorMessage(cause)); }
    }}>새 링크 생성</button>
    <button disabled={disabled || Boolean(parseError)} type="submit">문서에 적용</button>
    <small>{identityPending ? "먼저 저장하면 고정 링크가 생성됩니다." : "적용 후 문서를 저장해주세요."}</small>
    {permalink && !parseError && !identityPending && <label>문서 링크<input aria-label="문서 고정 링크" readOnly value={documentLink(permalink)} onFocus={(event) => event.target.select()} /><button type="button" disabled={disabled} onClick={() => {
      const link = documentLink(permalink);
      void (isDesktop() ? writeText(link) : navigator.clipboard.writeText(link)).catch((cause) => setError(errorMessage(cause)));
    }}>링크 복사</button></label>}
    {(parseError || error) && <p role="alert">{parseError || error}</p>}
  </form>;
}
