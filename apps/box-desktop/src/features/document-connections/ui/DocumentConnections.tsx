import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { documentProperty } from "@box/editor";
import type { ConnectionSnapshot, WorkspaceSnapshot } from "@box/contracts";
import { attachConnection, createConnection, detachConnection, listConnections } from "@/entities/connection";
import { errorMessage, useDocumentTargets } from "@/entities/document";
import { isDesktop } from "@/shared/lib/runtime";
import { listenDocumentChanges } from "@/entities/document-change";

interface Props {
  path: string | null;
  content: string;
  baseline: string;
  workspace: WorkspaceSnapshot | null;
  disabled: boolean;
  onOpen: (permalink: string) => void;
}
function identity(path: string | null, baseline: string, content: string) {
  if (!path) return { id: null, writable: false, reason: "문서를 저장하면 연결할 수 있습니다." };
  let saved: string;
  try {
    saved = documentProperty(baseline, "permalink");
  } catch { return { id: null, writable: false, reason: "문서의 고정 링크 속성을 확인해주세요." }; }
  if (!saved) return { id: null, writable: false, reason: "고정 링크를 설정하고 문서를 저장해주세요." };
  try {
    if (saved !== documentProperty(content, "permalink")) return { id: saved, writable: false, reason: "변경한 고정 링크를 저장한 뒤 연결해주세요." };
    return { id: saved, writable: true, reason: "" };
  } catch { return { id: saved, writable: false, reason: "문서의 고정 링크 속성을 확인해주세요." }; }
}
export function DocumentConnections(props: Props) {
  const document = identity(props.path, props.baseline, props.content);
  const context = JSON.stringify([props.path, document.id, document.writable]);
  const contextRef = useRef(context); contextRef.current = context;
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot | null>(null);
  const [loading, setLoading] = useState(true), [mutating, setMutating] = useState(false);
  const [storeReady, setStoreReady] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [name, setName] = useState(""), [choice, setChoice] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const mounted = useRef(false), sequence = useRef(0), lock = useRef(false);
  const manager = useRef<HTMLDetailsElement>(null);
  const load = useCallback(async () => {
    if (!isDesktop()) { setLoading(false); return; }
    const request = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const data = await listConnections();
      if (!data || data.version !== 1 || !Array.isArray(data.entities) || !Array.isArray(data.memberships)) throw new Error("연결 정보를 불러오지 못했습니다. 앱을 다시 실행해주세요.");
      if (mounted.current && request === sequence.current) { setSnapshot(data); setStoreReady(true); }
    } catch (cause) { if (mounted.current && request === sequence.current) { setStoreReady(false); setError(errorMessage(cause)); } }
    finally { if (mounted.current && request === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++sequence.current; }; }, []);
  useEffect(() => { setNotice(""); void load(); }, [load, props.path, props.baseline]);
  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false, stop: (() => void) | undefined;
    void listenDocumentChanges((change) => {
      if (change.kind === "connectionsChanged" && change.generation === props.workspace?.generation) void load();
    }).then((unlisten) => {
      if (disposed) unlisten(); else stop = unlisten;
    }).catch((cause) => { if (!disposed) setError(errorMessage(cause)); });
    return () => { disposed = true; stop?.(); };
  }, [load, props.workspace?.generation]);
  const entities = snapshot?.entities ?? [];
  const connected = entities.filter((entity) => snapshot?.memberships.some((edge) => edge.connectionId === entity.id && edge.permalink === document.id));
  const available = entities.filter((entity) => !connected.some((item) => item.id === entity.id));
  const related = useMemo(() => snapshot?.memberships.filter((edge) => edge.connectionId === selected).map((edge) => edge.permalink) ?? [], [snapshot, selected]);
  const targets = useDocumentTargets(props.workspace, related);
  const blocked = props.disabled || loading || mutating || !storeReady || !isDesktop();

  async function mutate(operation: () => Promise<ConnectionSnapshot>, message: string) {
    if (lock.current || blocked) return false;
    lock.current = true; setMutating(true); setError(null);
    const request = ++sequence.current, originalContext = contextRef.current;
    try {
      const data = await operation();
      if (!mounted.current) return false;
      if (request !== sequence.current || contextRef.current !== originalContext) { void load(); return false; }
      setSnapshot(data); setNotice(message); return true;
    } catch (cause) {
      if (mounted.current && contextRef.current === originalContext) setError(errorMessage(cause));
      return false;
    } finally { lock.current = false; if (mounted.current) setMutating(false); }
  }

  return <section className="document-connections" aria-label="명시적 문서 연결">
    <div className="connection-strip">
      <span className="file-label">연결 엔티티</span>
      <div className="connection-chips" aria-label="현재 문서 연결">
        {connected.map((entity) => <span className="connection-chip" key={entity.id}>
          <button type="button" aria-pressed={selected === entity.id} onClick={() => setSelected(entity.id)}>{entity.name}</button>
          <button type="button" aria-label={`${entity.name} 연결 해제`} disabled={blocked || !document.writable} onClick={() => {
            if (document.id && document.writable) void mutate(() => detachConnection(entity.id, document.id!), "연결 관계를 해제했습니다.");
          }}>×</button>
        </span>)}
        {!connected.length && <small>{loading ? "연결을 읽는 중…" : storeReady ? "연결된 엔티티가 없습니다." : "연결을 확인할 수 없습니다."}</small>}
      </div>
    </div>
    <details className="connection-manager" ref={manager}>
      <summary>연결 관리</summary>
      <div className="connection-forms">
        <form onSubmit={async (event) => {
          event.preventDefault(); const submitted = name;
          if (await mutate(() => createConnection(submitted), "연결 엔티티를 만들었습니다.")) setName((current) => current === submitted ? "" : current);
        }}>
          <label>새 연결 엔티티<input aria-label="새 연결 엔티티 이름" value={name} maxLength={120} disabled={blocked} onChange={(event) => setName(event.target.value)} placeholder="함께 살펴볼 문서의 이름" /></label>
          <button disabled={blocked || !name.trim()}>만들기</button>
        </form>
        <form onSubmit={async (event) => {
          event.preventDefault(); if (!document.id || !document.writable || !available.some((entity) => entity.id === choice)) return;
          if (await mutate(() => attachConnection(choice, document.id!), "문서를 연결했습니다.")) {
            setChoice("");
            if (manager.current) manager.current.open = false;
          }
        }}>
          <label>기존 엔티티<select aria-label="연결할 엔티티" value={choice} disabled={blocked || !document.writable} onChange={(event) => setChoice(event.target.value)}>
            <option value="">엔티티를 선택해주세요</option>{available.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select></label>
          <button disabled={blocked || !document.writable || !available.some((entity) => entity.id === choice)}>문서 연결</button>
        </form>
      </div>
      {document.reason && <p className="connection-hint">{document.reason}</p>}
      <div className="connection-catalog" aria-label="연결 엔티티 목록">
        {entities.map((entity) => <button type="button" key={entity.id} aria-pressed={selected === entity.id} onClick={() => setSelected(entity.id)}>{entity.name}</button>)}
      </div>
      <button type="button" className="plain-button" disabled={loading || mutating} onClick={() => void load()}>연결 새로고침</button>
    </details>
    {selected && <aside className="connection-related" aria-label="관련 문서">
      <header><strong>{entities.find((entity) => entity.id === selected)?.name}</strong><button type="button" className="plain-button" onClick={() => setSelected(null)}>관련 문서 닫기</button></header>
      {!related.length && <p>아직 연결된 문서가 없습니다.</p>}
      <ul>{related.map((id) => {
        const target = targets.get(id);
        return <li key={id}><button type="button" disabled={props.disabled || target?.state !== "resolved"} onClick={() => props.onOpen(id)}>{target?.state === "resolved" ? target.title : id}</button>
          {target?.state !== "resolved" && <small title={target && "message" in target ? target.message : ""}>{({ loading: "확인 중", missing: "문서 없음", duplicate: "중복", error: "확인 오류" })[target?.state ?? "loading"]}</small>}
        </li>;
      })}</ul>
    </aside>}
    {error && <p className="connection-error" role="alert">{error}<button type="button" disabled={loading || mutating} onClick={() => void load()}>다시 시도</button></p>}
    {notice && <p className="connection-notice" role="status">{notice}</p>}
  </section>;
}
