import { useEffect, useMemo, useRef, useState } from "react";
import { documentProperty } from "@box/editor";
import type { ConnectionSnapshot, WorkspaceDocument, WorkspaceSnapshot } from "@box/contracts";
import { attachConnection, createConnection, listConnections } from "@/entities/connection";
import { readDocument, errorMessage } from "@/entities/document";
import { listenDocumentChanges } from "@/entities/document-change";
import { workspaceName } from "@/entities/workspace";
import { isDesktop } from "@/shared/lib/runtime";
import {
  initialCardPosition,
  moveCard,
  panCamera,
  zoomCameraAt,
  ZOOM_STEP,
  type Camera,
  type Point,
} from "../model/canvas";

type CardMetadata = { summary: string; permalink: string; error?: string };
type Gesture =
  | { kind: "pan"; pointerId: number; pointer: Point; camera: Camera }
  | { kind: "card"; pointerId: number; pointer: Point; path: string; position: Point; moved: boolean };

const INITIAL_CAMERA: Camera = { x: 48, y: 42, scale: 1 };

function connectionName(files: WorkspaceDocument[], snapshot: ConnectionSnapshot): string {
  const base = files.map((file) => file.name.replace(/\.md$/i, "")).join(" · ").slice(0, 112);
  const names = new Set(snapshot.entities.map((entity) => entity.name));
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} (${suffix})`)) suffix += 1;
  return `${base} (${suffix})`;
}

function pointer(event: React.PointerEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

export function DocumentCards({ workspace, disabled, onOpen, onClose }: {
  workspace: WorkspaceSnapshot; disabled: boolean; onOpen: (path: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  const [metadata, setMetadata] = useState<Record<string, CardMetadata>>({});
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [interaction, setInteraction] = useState<"idle" | "pan" | "card">("idle");
  const [selected, setSelected] = useState<string[]>([]);
  const [connections, setConnections] = useState<ConnectionSnapshot | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState("");
  const [connecting, setConnecting] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(new Set<string>());
  const connectionRequest = useRef(0);
  const connectionOperation = useRef(0);
  const filtered = useMemo(
    () => workspace.documents.filter((file) => file.relativePath.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    [workspace.documents, query],
  );

  useEffect(() => {
    setCamera(INITIAL_CAMERA);
    setPositions(Object.fromEntries(workspace.documents.map((file, index) => [file.path, initialCardPosition(index)])));
    setSelected([]);
  }, [workspace.path, workspace.documents]);

  const loadConnections = async () => {
    if (!isDesktop()) return;
    const request = ++connectionRequest.current;
    try {
      const snapshot = await listConnections();
      if (request === connectionRequest.current) {
        setConnections(snapshot);
        setConnectionError(null);
      }
    } catch (cause) {
      if (request === connectionRequest.current) setConnectionError(errorMessage(cause));
    }
  };

  useEffect(() => {
    setConnections(null); setConnectionError(null); setConnectionNotice("");
    void loadConnections();
    return () => { ++connectionRequest.current; ++connectionOperation.current; };
  }, [workspace.path]);

  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false, stop: (() => void) | undefined;
    void listenDocumentChanges((change) => {
      if (change.kind === "connectionsChanged" && change.generation === workspace.generation) void loadConnections();
    }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; })
      .catch((cause) => { if (!disposed) setConnectionError(errorMessage(cause)); });
    return () => { disposed = true; stop?.(); };
  }, [workspace.generation, workspace.path]);

  useEffect(() => {
    let active = true;
    setMetadata({});
    void (async () => {
      for (let start = 0; start < filtered.length; start += 8) {
        const batch = await Promise.all(filtered.slice(start, start + 8).map(async (file) => {
          try {
            const snapshot = await readDocument(file.path);
            return [file.path, {
              summary: documentProperty(snapshot.content, "summary"),
              permalink: documentProperty(snapshot.content, "permalink"),
            }] as const;
          } catch (cause) {
            return [file.path, { summary: "", permalink: "", error: errorMessage(cause) }] as const;
          }
        }));
        if (!active) return;
        setMetadata((previous) => ({ ...previous, ...Object.fromEntries(batch) }));
      }
    })();
    return () => { active = false; };
  }, [filtered, reload, workspace.path]);

  const zoom = (next: number, anchor?: Point) => {
    const bounds = viewport.current?.getBoundingClientRect();
    const center = anchor ?? { x: (bounds?.width ?? 0) / 2, y: (bounds?.height ?? 0) / 2 };
    setCamera((current) => zoomCameraAt(current, next, center));
  };

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gesture.current = { kind: "pan", pointerId: event.pointerId, pointer: pointer(event), camera };
    setInteraction("pan");
  };

  const beginCardDrag = (event: React.PointerEvent<HTMLElement>, file: WorkspaceDocument) => {
    if (event.button !== 0 || disabled) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gesture.current = {
      kind: "card",
      pointerId: event.pointerId,
      pointer: pointer(event),
      path: file.path,
      position: positions[file.path] ?? initialCardPosition(workspace.documents.indexOf(file)),
      moved: false,
    };
    setInteraction("card");
  };

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const delta = { x: event.clientX - active.pointer.x, y: event.clientY - active.pointer.y };
    if (active.kind === "pan") {
      setCamera(panCamera(active.camera, delta));
      return;
    }
    const moved = active.moved || Math.hypot(delta.x, delta.y) > 4;
    gesture.current = { ...active, moved };
    setPositions((current) => ({ ...current, [active.path]: moveCard(active.position, delta, camera.scale) }));
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === "card" && active.moved) suppressClick.current.add(active.path);
    gesture.current = null;
    setInteraction("idle");
  };

  const selectedFiles = selected.map((path) => workspace.documents.find((file) => file.path === path)).filter((file): file is WorkspaceDocument => Boolean(file));
  const selectedIds = selectedFiles.map((file) => metadata[file.path]?.permalink).filter(Boolean);
  const sharedConnection = connections?.entities.find((entity) => selectedIds.length === 2 && selectedIds.every((permalink) => connections.memberships.some((edge) => edge.connectionId === entity.id && edge.permalink === permalink)));
  const canConnect = selectedFiles.length === 2 && selectedIds.length === 2 && new Set(selectedIds).size === 2 && !sharedConnection && !connecting && Boolean(connections);
  const documentPathById = new Map(Object.entries(metadata).filter(([, value]) => value.permalink).map(([path, value]) => [value.permalink, path]));
  const connectionLines = (connections?.entities ?? []).flatMap((entity) => {
    const paths = connections!.memberships.filter((edge) => edge.connectionId === entity.id).map((edge) => documentPathById.get(edge.permalink)).filter((path): path is string => Boolean(path));
    const origin = paths[0];
    return origin ? paths.slice(1).map((target) => ({ id: `${entity.id}:${origin}:${target}`, entity, origin, target })) : [];
  });

  const connectSelected = async () => {
    if (!canConnect || !connections) return;
    const request = ++connectionOperation.current;
    const root = workspace.path;
    setConnecting(true); setConnectionError(null); setConnectionNotice("");
    try {
      const before = new Set(connections.entities.map((entity) => entity.id));
      let snapshot = await createConnection(connectionName(selectedFiles, connections));
      const entity = snapshot.entities.find((item) => !before.has(item.id));
      if (!entity) throw new Error("새 연결 엔티티를 확인하지 못했습니다.");
      snapshot = await attachConnection(entity.id, selectedIds[0]!);
      snapshot = await attachConnection(entity.id, selectedIds[1]!);
      if (request !== connectionOperation.current || root !== workspace.path) return;
      setConnections(snapshot); setSelected([]); setConnectionNotice("두 문서를 연결했습니다.");
    } catch (cause) {
      if (request === connectionOperation.current && root === workspace.path) {
        setConnectionError(errorMessage(cause));
        void loadConnections();
      }
    } finally {
      if (request === connectionOperation.current && root === workspace.path) setConnecting(false);
    }
  };

  return <section className="document-cards" aria-label="문서 카드">
    <header className="cards-header">
      <div><span className="file-label">SPATIAL COLLECTION</span><h1>{workspaceName(workspace.path)}</h1><p>{filtered.length}개의 문서 · 생각의 위치를 직접 정리하세요</p></div>
      <button className="plain-button" onClick={onClose}>편집 화면으로 돌아가기</button>
    </header>
    <div className="cards-controls">
      <input aria-label="문서 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="파일 이름이나 경로로 찾기" />
      <button onClick={() => setReload(reload + 1)}>요약 새로고침</button>
      <div className="canvas-zoom" aria-label="캔버스 확대/축소">
        <button aria-label="축소" onClick={() => zoom(camera.scale - ZOOM_STEP)}>−</button>
        <output aria-label="확대율">{Math.round(camera.scale * 100)}%</output>
        <button aria-label="확대" onClick={() => zoom(camera.scale + ZOOM_STEP)}>＋</button>
        <button onClick={() => setCamera(INITIAL_CAMERA)}>중앙으로</button>
      </div>
    </div>
    <div className="card-connection-toolbar" aria-label="카드 연결 도구">
      <span><strong>{selected.length}</strong> / 2 선택</span>
      <button disabled={!canConnect} onClick={() => void connectSelected()}>{connecting ? "연결 중…" : "선택한 두 문서 연결"}</button>
      {selected.length > 0 && <button className="plain-button" onClick={() => setSelected([])}>선택 해제</button>}
      <button className="plain-button" disabled={connecting} onClick={() => void loadConnections()}>연결 새로고침</button>
      {selectedFiles.length === 2 && selectedIds.length < 2 && <small>두 문서에 저장된 permalink가 필요합니다.</small>}
      {selectedIds.length === 2 && new Set(selectedIds).size < 2 && <small>같은 문서 ID는 서로 연결할 수 없습니다.</small>}
      {sharedConnection && <small>이미 ‘{sharedConnection.name}’ 연결을 공유합니다.</small>}
      {connectionNotice && <small role="status">{connectionNotice}</small>}
      {connectionError && <small role="alert">{connectionError} <button className="plain-button" onClick={() => void loadConnections()}>다시 읽기</button></small>}
    </div>
    <div
      ref={viewport}
      className="cards-canvas"
      role="region"
      aria-label="무한 문서 캔버스"
      data-panning={interaction === "pan" || undefined}
      style={{
        "--canvas-x": `${camera.x}px`,
        "--canvas-y": `${camera.y}px`,
        "--canvas-grid": `${28 * camera.scale}px`,
      } as React.CSSProperties}
      onPointerDown={beginPan}
      onPointerMove={move}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onWheel={(event) => {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.ctrlKey || event.metaKey) {
          zoom(camera.scale - Math.sign(event.deltaY) * ZOOM_STEP, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
        } else {
          setCamera((current) => panCamera(current, { x: -event.deltaX, y: -event.deltaY }));
        }
      }}
    >
      <div className="cards-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
        <svg className="card-connections" aria-label="문서 카드 연결">
          {connectionLines.map((line) => {
            const from = positions[line.origin] ?? initialCardPosition(workspace.documents.findIndex((file) => file.path === line.origin));
            const to = positions[line.target] ?? initialCardPosition(workspace.documents.findIndex((file) => file.path === line.target));
            return <line key={line.id} className="card-connection-line" data-connection-id={line.entity.id} x1={from.x + 125} y1={from.y + 94} x2={to.x + 125} y2={to.y + 94}><title>{line.entity.name}</title></line>;
          })}
        </svg>
        {filtered.map((file) => {
          const position = positions[file.path] ?? initialCardPosition(workspace.documents.indexOf(file));
          const details = metadata[file.path];
          return <article
            key={file.path}
            className="document-card"
            data-document-id={details?.permalink || file.path}
            data-selected={selected.includes(file.path) || undefined}
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            onPointerDown={(event) => beginCardDrag(event, file)}
          >
            <button disabled={disabled} aria-label={`${file.name} 카드 선택`} aria-pressed={selected.includes(file.path)} onClick={() => {
              if (suppressClick.current.delete(file.path)) return;
              setConnectionNotice("");
              setSelected((current) => current.includes(file.path) ? current.filter((path) => path !== file.path) : current.length < 2 ? [...current, file.path] : [current[1]!, file.path]);
            }} onDoubleClick={() => onOpen(file.path)}>
              <span className="card-mark">▤</span><h2>{file.name}</h2>
              <p className="card-summary" title={details?.summary}>{details?.summary || (details ? "요약을 추가해보세요." : "요약을 읽는 중…")}</p>
              <small>{file.relativePath}</small>
              {details?.error && <p className="comment-error">{details.error}</p>}
            </button>
          </article>;
        })}
      </div>
      {!filtered.length && <p className="panel-empty cards-empty">{query ? "검색 결과가 없습니다." : "아직 Markdown 문서가 없습니다."}</p>}
      <p className="canvas-hint">빈 공간을 끌어 이동 · 카드를 끌어 배치 · 트랙패드로 탐색</p>
    </div>
    {workspace.truncated && <p className="frontmatter-note">작업 디렉토리의 일부 문서만 표시됩니다.</p>}
    {Boolean(workspace.warnings?.length) && <p className="frontmatter-note">일부 폴더를 조회하지 못했습니다. 접근 권한을 확인해주세요.</p>}
  </section>;
}
