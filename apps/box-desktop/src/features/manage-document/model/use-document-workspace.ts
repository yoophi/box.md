import { documentProperty } from "@box/editor";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  readDocument,
  writeDocument,
  createDocument,
  duplicateDocument as duplicateFile,
  documentName,
  errorMessage,
  withDocumentPermalink,
  documentLink,
  resolvePermalink,
  permalinkFromLink,
} from "@/entities/document";
import type { WorkspaceSnapshot } from "@box/contracts";
import { listWorkspace, selectDocumentWorkspace } from "@/entities/workspace";
import { isDesktop } from "@/shared/lib/runtime";

type Action =
  | "new"
  | "open"
  | "reload"
  | "close"
  | "directory"
  | "read"
  | "edit"
  | { type: "open-path" | "workspace" | "permalink"; path: string };
const WORKSPACE_KEY = "box.md.workspace-path";
function storedWorkspacePath(): string | null {
  try { return isDesktop() ? localStorage.getItem(WORKSPACE_KEY) : null; }
  catch { return null; }
}
interface DocumentState {
  path: string | null;
  content: string;
  baseline: string;
  revision: string | null;
  key: number;
}
let nextDocumentKey = 0;
const emptyDocument = (): DocumentState => ({
  path: null,
  content: "",
  baseline: "",
  revision: null,
  key: ++nextDocumentKey,
});
const filters = [{ name: "Markdown", extensions: ["md", "markdown", "mdown"] }];

export function useDocumentWorkspace() {
  const [document, setDocument] = useState<DocumentState>(emptyDocument);
  const [reading, setReading] = useState(false);
  const readingRef = useRef(reading);
  readingRef.current = reading;
  const [incomingLink, setIncomingLink] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [configuredWorkspacePath, setConfiguredWorkspacePath] = useState(storedWorkspacePath);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("새 문서에 생각을 기록해보세요.");
  const [pending, setPending] = useState<Action | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const creationAttempt = useRef<{ kind: "create" | "duplicate"; document: DocumentState; root: WorkspaceSnapshot; requestId: string } | null>(null);
  const docRef = useRef(document);
  docRef.current = document;
  const busyRef = useRef(false);
  const allowClose = useRef(false);
  const dirty = document.content !== document.baseline;

  const change = useCallback(
    (content: string) => { if (!readingRef.current) setDocument((current) => ({ ...current, content })); },
    [],
  );
  function begin() {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    return true;
  }
  function end() {
    busyRef.current = false;
    if (alive.current) setBusy(false);
  }

  const refreshWorkspace = useCallback(async () => {
    const root = workspaceRef.current;
    const path = root?.path;
    if (!path || refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    try {
      const snapshot = await listWorkspace(path);
      if (alive.current && workspaceRef.current?.path === path && workspaceRef.current?.generation === root?.generation && root?.generation === snapshot.generation) setWorkspace(snapshot);
    } catch (cause) {
      if (alive.current && workspaceRef.current?.path === path && workspaceRef.current?.generation === root?.generation) setError(errorMessage(cause));
    } finally {
      refreshLock.current = false;
      if (alive.current) setRefreshing(false);
    }
  }, []);

  async function persist(
    path: string,
    expectedRevision: string | null,
  ): Promise<boolean> {
    const current = docRef.current;
    const root = workspaceRef.current;
    const saved = await writeWithIdentity(path, current.content, expectedRevision);
    if (!currentRequest(current, root)) return false;
    setDocument((state) => ({
      ...state,
      path: saved.path,
      content: saved.content,
      key: state.content === saved.content ? state.key : ++nextDocumentKey,
      baseline: saved.content,
      revision: saved.revision,
    }));
    setNotice(saved.historyWarning ? "파일을 저장했지만 히스토리를 기록하지 못했습니다." : "파일과 Git 히스토리에 저장했습니다.");
    if (saved.historyWarning) setError(`히스토리 저장 실패: ${saved.historyWarning}`);
    await refreshWorkspace();
    return true;
  }

  async function writeWithIdentity(path: string, content: string, revision: string | null) {
    let existing = true;
    try { existing = Boolean(documentProperty(content, "permalink")); } catch { /* Keep malformed source editable. */ }
    for (let attempt = 0; attempt < 32; attempt++) {
      try { return await writeDocument(path, withDocumentPermalink(content), revision); }
      catch (cause) {
        if (existing || !cause || typeof cause !== "object" || !("code" in cause) || cause.code !== "duplicatePermalink") throw cause;
      }
    }
    throw new Error("문서 식별자 충돌이 반복되었습니다. 다시 시도해주세요.");
  }

  function currentRequest(current: DocumentState, root: WorkspaceSnapshot | null) {
    return alive.current && docRef.current.key === current.key && docRef.current.path === current.path
      && docRef.current.content === current.content && docRef.current.revision === current.revision
      && workspaceRef.current?.path === root?.path && workspaceRef.current?.generation === root?.generation;
  }
  async function createOrDuplicate(kind: "create" | "duplicate") {
    const current = docRef.current, root = workspaceRef.current;
    if (!root?.generation) throw new Error("먼저 설정에서 작업 디렉터리를 선택해주세요.");
    let relative = "";
    if (kind === "duplicate") {
      const prefix = `${root.path.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
      const path = current.path?.replace(/\\/g, "/");
      if (!path?.startsWith(prefix) || !current.revision) throw new Error("현재 작업 디렉터리에 저장된 문서를 복제해주세요.");
      relative = path.slice(prefix.length);
    }
    let attempt = creationAttempt.current;
    if (!attempt || attempt.kind !== kind || attempt.root.path !== root.path || attempt.root.generation !== root.generation
      || attempt.document.key !== current.key || attempt.document.path !== current.path
      || attempt.document.content !== current.content || attempt.document.revision !== current.revision) {
      attempt = { kind, document: current, root, requestId: crypto.randomUUID() };
      creationAttempt.current = attempt;
    }
    try {
      const saved = kind === "create"
        ? await createDocument(root.generation, attempt.requestId, current.content)
        : await duplicateFile(root.generation, attempt.requestId, relative, current.revision!, current.content);
      if (!currentRequest(current, root)) return false;
      creationAttempt.current = null;
      setDocument({ ...saved, baseline: saved.content, key: ++nextDocumentKey });
      setReading(false);
      setNotice(saved.historyWarning ? "파일을 만들었지만 이력을 기록하지 못했습니다." : kind === "duplicate" ? "새 파일로 복제했습니다." : "새 문서를 저장했습니다.");
      await refreshWorkspace();
      return true;
    } catch (cause) {
      // Transport failures can lose a successful response; retain the same ID.
      // A terminal application error permits a fresh user attempt.
      if (cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string") creationAttempt.current = null;
      throw cause;
    }
  }

  async function insertDocumentLink(targetPath: string) {
    if (!isDesktop() || readingRef.current || !begin()) return;
    try {
      if (!workspaceRef.current?.documents.some((file) => file.path === targetPath)) throw new Error("현재 작업 디렉토리의 문서를 선택해주세요.");
      if (targetPath === docRef.current.path) throw new Error("다른 문서를 선택해주세요.");
      const target = await readDocument(targetPath);
      let permalink = documentProperty(target.content, "permalink");
      if (!permalink) {
        const saved = await writeWithIdentity(target.path, target.content, target.revision);
        permalink = documentProperty(saved.content, "permalink");
        if (saved.historyWarning) setError(`대상 문서 히스토리 기록 실패: ${saved.historyWarning}`);
      }
      const label = documentName(target.path).replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1");
      setDocument((current) => ({ ...current, key: ++nextDocumentKey, content: current.content + (current.content ? "\n\n" : "") + `[${label}](${documentLink(permalink)})\n` }));
      setNotice("문서 링크를 추가했습니다. 저장하면 연결이 유지됩니다.");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { end(); }
  }

  const saveDocument = useCallback(async (): Promise<boolean> => {
    if (readingRef.current || !begin()) return false;
    const started = docRef.current, root = workspaceRef.current;
    try {
      if (!isDesktop()) {
        setNotice("파일 저장은 데스크톱 앱에서 사용할 수 있습니다.");
        return false;
      }
      const current = docRef.current;
      return current.path ? await persist(current.path, current.revision) : await createOrDuplicate("create");
    } catch (cause) {
      if (currentRequest(started, root)) setError(errorMessage(cause));
      return false;
    } finally {
      end();
    }
  }, []);

  const duplicateDocument = useCallback(async () => {
    if (!isDesktop() || !begin()) return false;
    const started = docRef.current, root = workspaceRef.current;
    try {
      return await createOrDuplicate("duplicate");
    } catch (cause) {
      if (currentRequest(started, root)) setError(errorMessage(cause));
      return false;
    } finally {
      end();
    }
  }, []);

  const execute = useCallback(async (action: Action) => {
    if (!begin()) return;
    try {
      if (action === "read" || action === "edit") {
        if (action === "read") setDocument((current) => ({ ...current, content: current.baseline, key: ++nextDocumentKey }));
        setReading(action === "read");
        setNotice(action === "read" ? "읽기 모드 · 댓글로 의견을 남길 수 있습니다." : "편집 모드입니다.");
        return;
      }
      if (action === "new") {
        setReading(false);
        setDocument(emptyDocument());
        setNotice("새 문서입니다.");
        return;
      }
      if (action === "close") {
        allowClose.current = true;
        await invoke("set_exit_allowed", { allowed: true });
        await getCurrentWindow().close();
        return;
      }
      if (!isDesktop()) {
        setNotice("파일 열기는 데스크톱 앱에서 사용할 수 있습니다.");
        return;
      }
      if (
        action === "directory" ||
        (typeof action === "object" && action.type === "workspace")
      ) {
        const folder =
          typeof action === "object"
            ? action.path
            : await open({
                title: "작업 디렉터리 선택",
                multiple: false,
                directory: true,
              });
        if (!folder || Array.isArray(folder)) return;
        const preview = await listWorkspace(folder);
        let previous: string | null;
        try {
          previous = localStorage.getItem(WORKSPACE_KEY);
          if (previous !== preview.path) localStorage.setItem(WORKSPACE_KEY, preview.path);
        } catch {
          throw new Error("작업 디렉터리 설정을 저장하지 못했습니다. 기존 문서와 설정을 유지합니다.");
        }
        let snapshot: WorkspaceSnapshot;
        try {
          snapshot = await selectDocumentWorkspace(preview.path, action === "directory");
        } catch (cause) {
          try {
            if (previous === null) localStorage.removeItem(WORKSPACE_KEY);
            else localStorage.setItem(WORKSPACE_KEY, previous);
          } catch {
            throw new Error("작업 루트를 열지 못했고 설정 복원에도 실패했습니다. 기존 문서는 유지됩니다.");
          }
          throw cause;
        }
        workspaceRef.current = snapshot;
        setWorkspace(snapshot);
        setConfiguredWorkspacePath(snapshot.path);
        setDocument(emptyDocument());
        setReading(false);
        setNotice("작업 디렉터리를 열었습니다. 목록에서 문서를 선택해주세요.");
        return;
      }
      if (typeof action === "object" && action.type === "permalink") {
        const root = workspaceRef.current?.path;
        if (!root) throw new Error("먼저 작업 디렉토리를 선택해주세요.");
        const listed = await listWorkspace(root);
        if (listed.truncated) throw new Error("문서 목록이 너무 커 전체 고정 링크를 확인할 수 없습니다. 더 작은 작업 디렉토리를 선택해주세요.");
        if (listed.warnings?.length) throw new Error("문서 목록을 완전히 조회하지 못해 고정 링크를 확인할 수 없습니다. 폴더 접근 권한을 확인해주세요.");
        const path = await resolvePermalink(listed.documents, action.path, readDocument);
        const snapshot = await readDocument(path);
        setWorkspace(listed);
        setDocument({ ...snapshot, baseline: snapshot.content, key: ++nextDocumentKey });
        setNotice("고정 링크로 문서를 열었습니다.");
        return;
      }
      const path =
        typeof action === "object"
          ? action.path
          : action === "reload"
            ? docRef.current.path
            : await open({
                title: "Markdown 문서 열기",
                multiple: false,
                directory: false,
                filters,
              });
      if (!path || Array.isArray(path)) return;
      const snapshot = await readDocument(path);
      setDocument({
        ...snapshot,
        baseline: snapshot.content,
        key: ++nextDocumentKey,
      });
      setNotice(
        action === "reload"
          ? "디스크의 문서를 다시 불러왔습니다."
          : "문서를 열었습니다.",
      );
    } catch (cause) {
      allowClose.current = false;
      if (action === "close")
        void invoke("set_exit_allowed", { allowed: false });
      setError(errorMessage(cause));
    } finally {
      end();
    }
  }, []);

  const request = useCallback(
    (action: Action) => {
      if (busyRef.current) return;
      if (docRef.current.content !== docRef.current.baseline) {
        setPending(action);
        return;
      }
      void execute(action);
    },
    [execute],
  );

  async function resolvePending(choice: "save" | "discard" | "cancel") {
    if (!pending) return;
    if (choice === "cancel") {
      setPending(null);
      return;
    }
    if (choice === "save" && !(await saveDocument())) return;
    const action = pending;
    setPending(null);
    await execute(action);
  }

  useEffect(() => {
    if (!isDesktop()) return;
    try {
      const stored = localStorage.getItem(WORKSPACE_KEY);
      if (stored) void execute({ type: "workspace", path: stored });
    } catch {
      /* No stored workspace. */
    }
  }, [execute]);

  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    const receive = (urls: string[]) => {
      try { if (urls[0]) { setIncomingLink(permalinkFromLink(urls[0])); if (!workspaceRef.current) setNotice("링크 문서를 열려면 작업 디렉토리를 선택해주세요."); } }
      catch (cause) { setError(errorMessage(cause)); }
    };
    void onOpenUrl(receive).then((unlisten) => {
      if (disposed) unlisten(); else stop = unlisten;
      return getCurrent();
    }).then((urls) => { if (!disposed && urls) receive(urls); })
      .catch((cause) => { if (!disposed) setError(errorMessage(cause)); });
    return () => { disposed = true; stop?.(); };
  }, []);
  useEffect(() => {
    if (!incomingLink || !workspace || busy || pending) return;
    request({ type: "permalink", path: incomingLink });
    setIncomingLink(null);
  }, [incomingLink, workspace, busy, pending, request]);

  useEffect(() => {
    const onFocus = () => {
      if (!busyRef.current) void refreshWorkspace();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshWorkspace]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (
        !allowClose.current &&
        docRef.current.content !== docRef.current.baseline
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const keys = (event: KeyboardEvent) => {
      const dialog = window.document.querySelector<HTMLElement>(
        '[aria-modal="true"]',
      );
      if (dialog) {
        if (event.key === "Escape" && !busyRef.current) {
          event.preventDefault();
          setPending(null);
        }
        if (event.key === "Tab") {
          const buttons = Array.from(
            dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
          );
          const first = buttons[0],
            last = buttons.at(-1);
          if (event.shiftKey && window.document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && window.document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (event.shiftKey) void duplicateDocument();
        else void saveDocument();
      }
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        request("open");
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        request("new");
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("keydown", keys);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let unlistenQuit: (() => void) | undefined;
    if (isDesktop())
      void listen("box:request-close", () => request("close"))
        .then((stop) => {
          if (disposed) stop();
          else unlistenQuit = stop;
        })
        .catch((cause) => setError(errorMessage(cause)));
    if (isDesktop())
      void getCurrentWindow()
        .onCloseRequested((event) => {
          if (allowClose.current) return;
          if (
            busyRef.current ||
            docRef.current.content !== docRef.current.baseline
          ) {
            event.preventDefault();
            if (!busyRef.current) setPending("close");
          }
        })
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch((cause) => setError(errorMessage(cause)));
    return () => {
      disposed = true;
      unlisten?.();
      unlistenQuit?.();
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("keydown", keys);
    };
  }, [request, saveDocument, duplicateDocument]);

  return {
    document,
    reading,
    insertDocumentLink,
    restoreVersion: (content: string) => { if (!readingRef.current && !busyRef.current) setDocument((current) => ({ ...current, content, key: ++nextDocumentKey })); },
    workspace,
    configuredWorkspacePath,
    refreshing,
    refreshWorkspace,
    dirty,
    busy,
    error,
    notice,
    pending,
    change,
    request,
    saveDocument,
    duplicateDocument,
    resolvePending,
    dismissError: () => setError(null),
  };
}
