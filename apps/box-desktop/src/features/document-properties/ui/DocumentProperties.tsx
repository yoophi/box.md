import { useEffect, useState } from "react";
import { documentProperty, setDocumentProperty } from "@box/editor";
import { errorMessage } from "@/entities/document";

export function DocumentProperties({ content, disabled, onChange }: {content: string; disabled: boolean; onChange: (content: string) => void}) {
  const [permalink, setPermalink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  useEffect(() => {
    try { setPermalink(documentProperty(content, "permalink")); setParseError(null); }
    catch (cause) { setParseError(errorMessage(cause)); }
  }, [content]);
  return <form className="document-properties" aria-label="문서 속성" onSubmit={(event) => {
    event.preventDefault();
    try { onChange(setDocumentProperty(content, "permalink", permalink.trim())); setError(null); }
    catch (cause) { setError(errorMessage(cause)); }
  }}>
    <label>고정 링크<input aria-label="permalink" value={permalink} disabled={disabled || Boolean(parseError)} onChange={(event) => setPermalink(event.target.value)} placeholder="/notes/my-document" /></label>
    <button disabled={disabled || Boolean(parseError)} type="submit">문서에 적용</button>
    <small>적용 후 문서를 저장해주세요.</small>
    {(parseError || error) && <p role="alert">{parseError || error}</p>}
  </form>;
}
