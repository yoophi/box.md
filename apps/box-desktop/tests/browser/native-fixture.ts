import type { Page } from "@playwright/test";
import type { ConnectionSnapshot, WorkspaceDocument } from "@box/contracts";
interface NativeFixture {
  pickedFolder: string | null;
  invalidRoots: string[];
  failPreferences: boolean;
  writes: { path: string; content: string }[];
  documents: WorkspaceDocument[];
  content: Map<string, string>;
  truncated: boolean;
  connections: ConnectionSnapshot;
  failConnections: boolean;
}
declare global {
  interface Window {
    __BOX_BROWSER_FIXTURE__: NativeFixture;
  }
}

/** Native test adapter only. App rendering, preference storage and editor are real. */
export async function seedWorkspace(
  page: Page,
  count: number,
  options: {
    initialPath?: string | null;
    invalidRoots?: string[];
    contents?: Record<string, string>;
    persistConnections?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({ count, initialPath, invalidRoots, contents, persistConnections }) => {
      const key = "box.md.workspace-path";
      // Only the test IPC adapter uses browser storage. Production uses the native file repository.
      const connectionKey = "box.md.browser-fixture.connections";
      const storedConnections = persistConnections ? localStorage.getItem(connectionKey) : null;
      if (initialPath && !localStorage.getItem(key))
        localStorage.setItem(key, initialPath);
      const state: NativeFixture = {
        pickedFolder: null,
        invalidRoots,
        failPreferences: false,
        writes: [],
        documents: [],
        content: new Map(Object.entries(contents)),
        truncated: false,
        connections: storedConnections ? JSON.parse(storedConnections) : { version: 1, entities: [], memberships: [] },
        failConnections: false,
      };
      window.__BOX_BROWSER_FIXTURE__ = state;
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key && state.failPreferences)
          throw new DOMException("fixture quota", "QuotaExceededError");
        setItem.call(this, name, value);
      };
      const documents = Array.from({ length: count }, (_, index) => {
        const name = `note-${String(index + 1).padStart(3, "0")}.md`;
        return { name, relativePath: name, path: `/fixture/${name}` };
      });
      state.documents = documents;
      const content = state.content,
        revisions = new Map<string, number>();
      let callbackId = 0;
      const callbacks = new Map<number, unknown>();
      const bridge = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback(callback: unknown) {
          callbacks.set(++callbackId, callback);
          return callbackId;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        async invoke(command: string, args: Record<string, unknown> = {}) {
          const path = String(args.path ?? "");
          if (["list_connections", "create_connection_entity", "attach_document_connection", "detach_document_connection"].includes(command)) {
            if (state.failConnections) throw new Error("연결 저장소를 읽지 못했습니다.");
            const graph = state.connections;
            if (command === "create_connection_entity") {
              const name = String(args.name).trim();
              if (!name || graph.entities.some((entity) => entity.name.toLowerCase() === name.toLowerCase())) throw new Error("같은 이름의 연결 엔티티가 이미 있습니다.");
              graph.entities.push({ id: crypto.randomUUID(), name });
            }
            if (command === "attach_document_connection") {
              const connectionId = String(args.connectionId), permalink = String(args.permalink);
              if (!graph.entities.some((entity) => entity.id === connectionId)) throw new Error("연결 엔티티를 찾지 못했습니다.");
              if (!graph.memberships.some((edge) => edge.connectionId === connectionId && edge.permalink === permalink)) graph.memberships.push({ connectionId, permalink });
            }
            if (command === "detach_document_connection") graph.memberships = graph.memberships.filter((edge) => !(edge.connectionId === args.connectionId && edge.permalink === args.permalink));
            if (persistConnections && command !== "list_connections") localStorage.setItem(connectionKey, JSON.stringify(graph));
            return structuredClone(graph);
          }
          if (command === "list_workspace_documents") {
            if (state.invalidRoots.includes(path))
              throw new Error("작업 디렉터리에 접근할 수 없습니다.");
            return {
              path,
              documents:
                path === "/fixture"
                  ? state.documents
                  : [
                      {
                        name: "other.md",
                        relativePath: "other.md",
                        path: `${path}/other.md`,
                      },
                    ],
              truncated: path === "/fixture" && state.truncated,
            };
          }
          if (command === "open_document")
            return {
              path,
              content:
                content.get(path) ??
                `# ${path.split("/").pop()}\n\n브라우저 검증 문서`,
              revision: String(revisions.get(path) ?? 1),
            };
          if (command === "save_document") {
            const revision = (revisions.get(path) ?? 1) + 1;
            content.set(path, String(args.content));
            revisions.set(path, revision);
            state.writes.push({ path, content: String(args.content) });
            return {
              path,
              content: String(args.content),
              revision: String(revision),
            };
          }
          if (command === "document_revision")
            return String(revisions.get(path) ?? 1);
          if (command === "list_document_comments") return [];
          if (command === "plugin:dialog|open") return state.pickedFolder;
          if (
            command === "set_exit_allowed" ||
            command === "plugin:event|unlisten"
          )
            return;
          if (command === "plugin:event|listen") return ++callbackId;
          if (command === "plugin:deep-link|get_current") return null;
          throw new Error(
            `Unimplemented native browser fixture command: ${command}`,
          );
        },
      };
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: bridge });
      Object.defineProperty(window, "isTauri", { value: true });
      Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
        value: { unregisterListener() {} },
      });
    },
    {
      count,
      initialPath:
        options.initialPath === undefined ? "/fixture" : options.initialPath,
      invalidRoots: options.invalidRoots ?? [],
      contents: options.contents ?? {},
      persistConnections: options.persistConnections ?? false,
    },
  );
}
