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
  | { type: "open-path" | "workspace"; path: string };
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
    (content: string) => setDocument((current) => ({ ...current, content })),
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
    const saved = await writeDocument(path, current.content, expectedRevision);
    setDocument((state) => ({
      ...state,
      path: saved.path,
      baseline: saved.content,
      revision: saved.revision,
    }));
    setNotice(saved.historyWarning ? "파일을 저장했지만 히스토리를 기록하지 못했습니다." : "파일과 Git 히스토리에 저장했습니다.");
    if (saved.historyWarning) setError(`히스토리 저장 실패: ${saved.historyWarning}`);
    await refreshWorkspace();
    return true;
  }

  const saveDocument = useCallback(async (saveAs = false): Promise<boolean> => {
    if (!begin()) return false;
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
      if (action === "new") {
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
        setNotice("작업 디렉터리를 열었습니다. 목록에서 문서를 선택해주세요.");
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
    restoreVersion: (content: string) => setDocument((current) => ({ ...current, content, key: ++nextDocumentKey })),
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
