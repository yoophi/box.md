import { documentProperty, setDocumentProperty } from "@box/editor";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useCallback, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  readDocument,
  writeDocument,
  documentRevision,
  documentName,
  errorMessage,
  withDocumentPermalink,
  documentLink,
  resolvePermalink,
  permalinkFromLink,
} from "@/entities/document";
import type { WorkspaceSnapshot } from "@box/contracts";
import { listWorkspace } from "@/entities/workspace";
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
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("새 문서에 생각을 기록해보세요.");
  const [pending, setPending] = useState<Action | null>(null);
  const [overwrite, setOverwrite] = useState<{
    path: string;
    revision: string;
  } | null>(null);
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
    setBusy(false);
  }

  const refreshWorkspace = useCallback(async () => {
    const path = workspaceRef.current?.path;
    if (!path || refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    try {
      const snapshot = await listWorkspace(path);
      if (workspaceRef.current?.path === path) setWorkspace(snapshot);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      refreshLock.current = false;
      setRefreshing(false);
    }
  }, []);

  async function persist(
    path: string,
    expectedRevision: string | null,
  ): Promise<boolean> {
    const current = docRef.current;
    const content = withDocumentPermalink(current.content);
    const saved = await writeDocument(path, content, expectedRevision);
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

  async function insertDocumentLink(targetPath: string) {
    if (!isDesktop() || readingRef.current || !begin()) return;
    try {
      if (!workspaceRef.current?.documents.some((file) => file.path === targetPath)) throw new Error("현재 작업 디렉토리의 문서를 선택해주세요.");
      if (targetPath === docRef.current.path) throw new Error("다른 문서를 선택해주세요.");
      const target = await readDocument(targetPath);
      let permalink = documentProperty(target.content, "permalink");
      if (!permalink) {
        permalink = crypto.randomUUID();
        const saved = await writeDocument(target.path, setDocumentProperty(target.content, "permalink", permalink), target.revision);
        if (saved.historyWarning) setError(`대상 문서 히스토리 기록 실패: ${saved.historyWarning}`);
      }
      const label = documentName(target.path).replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1");
      setDocument((current) => ({ ...current, key: ++nextDocumentKey, content: current.content + (current.content ? "\n\n" : "") + `[${label}](${documentLink(permalink)})\n` }));
      setNotice("문서 링크를 추가했습니다. 저장하면 연결이 유지됩니다.");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { end(); }
  }

  const saveDocument = useCallback(async (saveAs = false): Promise<boolean> => {
    if (readingRef.current || !begin()) return false;
    try {
      if (!isDesktop()) {
        setNotice("파일 저장은 데스크톱 앱에서 사용할 수 있습니다.");
        return false;
      }
      const current = docRef.current;
      let path = current.path;
      if (!path || saveAs) {
        const picked = await save({
          title: "Markdown 문서 저장",
          defaultPath:
            path ??
            (workspaceRef.current
              ? `${workspaceRef.current.path}/이름 없는 문서.md`
              : documentName(path)),
          filters,
        });
        if (!picked) return false;
        path = /\.(md|markdown|mdown)$/i.test(picked) ? picked : `${picked}.md`;
        if (path !== current.path) {
          const revision = await documentRevision(path);
          if (revision) {
            setOverwrite({ path, revision });
            return false;
          }
          return await persist(path, null);
        }
      }
      return await persist(path, current.revision);
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      end();
    }
  }, []);

  async function confirmOverwrite() {
    if (!overwrite || !begin()) return;
    try {
      await persist(overwrite.path, overwrite.revision);
      setOverwrite(null);
      if (pending) {
        const action = pending;
        setPending(null);
        end();
        await execute(action);
      }
    } catch (cause) {
      setError(errorMessage(cause));
      setOverwrite(null);
    } finally {
      end();
    }
  }

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
        const snapshot = await listWorkspace(folder);
        workspaceRef.current = snapshot;
        setWorkspace(snapshot);
        try {
          localStorage.setItem(WORKSPACE_KEY, snapshot.path);
        } catch {
          /* Preference persistence is optional. */
        }
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
    if (!incomingLink || !workspace || busy || pending || overwrite) return;
    request({ type: "permalink", path: incomingLink });
    setIncomingLink(null);
  }, [incomingLink, workspace, busy, pending, overwrite, request]);

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
          setOverwrite(null);
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
        void saveDocument(event.shiftKey);
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
  }, [request, saveDocument]);

  return {
    document,
    reading,
    insertDocumentLink,
    restoreVersion: (content: string) => { if (!readingRef.current && !busyRef.current) setDocument((current) => ({ ...current, content, key: ++nextDocumentKey })); },
    workspace,
    refreshing,
    refreshWorkspace,
    dirty,
    busy,
    error,
    notice,
    pending,
    overwrite,
    change,
    request,
    saveDocument,
    resolvePending,
    confirmOverwrite,
    cancelOverwrite: () => setOverwrite(null),
    dismissError: () => setError(null),
  };
}
