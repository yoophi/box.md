import type { Page } from "@playwright/test";
import type { ConnectionSnapshot, WorkspaceDocument, SiteBrowserSnapshot, SiteBrowserBounds, SiteSelection } from "@box/contracts";
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
  site: SiteBrowserSnapshot;
  siteCalls: { command: string; args: Record<string, unknown> }[];
  siteBounds: SiteBrowserBounds | null;
  failSite: boolean;
  siteOpenDelay: number;
  siteHideDelay: number;
  siteSelection: SiteSelection;
  failSiteSelection: boolean;
  selectedRoot: string | null;
  generation: number;
  failCreation: boolean;
  loseCreateResponse: boolean;
  creationCalls: { command: string; args: Record<string, unknown> }[];
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
    workspacePath?: string;
    workbenchConnection?: { baseUrl: string; token: string; expiresAt: string; incarnation: string };
    invalidRoots?: string[];
    contents?: Record<string, string>;
    persistConnections?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({ count, initialPath, invalidRoots, contents, persistConnections, workspacePath, workbenchConnection }) => {
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
        site: { open: false, visible: false, url: null, title: "", loading: false, canGoBack: false, canGoForward: false },
        siteCalls: [], siteBounds: null, failSite: false, siteOpenDelay: 0, siteHideDelay: 0,
        siteSelection: { url: "https://example.com/article", title: "검증 사이트", text: "선택한 원문" }, failSiteSelection: false,
        selectedRoot: null, generation: 0, failCreation: false, loseCreateResponse: false, creationCalls: [],
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
        return { name, relativePath: name, path: `${workspacePath}/${name}` };
      });
      state.documents = documents;
      const content = state.content,
        revisions = new Map<string, number>();
      const creationResults = new Map<string, { path: string; content: string; revision: string; permalink: string }>();
      const fixtureProperty = (text: string, key: string, value: string) => {
        const nl = text.includes("\r\n") ? "\r\n" : "\n", line = `${key}: ${JSON.stringify(value)}`;
        const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(text);
        if (!opening) return `${text.startsWith("\uFEFF") ? "\uFEFF" : ""}---${nl}${line}${nl}---${nl}${text.replace(/^\uFEFF/, "")}`;
        const rest = text.slice(opening[0].length), closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
        if (!closing) throw { code: "invalidMetadata", message: "fixture unclosed header" };
        const head = rest.slice(0, closing.index), field = new RegExp(`^${key}:[^\\r\\n]*`, "m");
        return opening[0] + (field.test(head) ? head.replace(field, line) : `${line}${nl}${head}`) + rest.slice(closing.index);
      };
      let callbackId = 0;
      const siteHistory: string[] = [];
      let siteIndex = -1;
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
          if (command === "get_workbench_connection" && workbenchConnection) return workbenchConnection;
          if (command.startsWith("site_browser_")) {
            state.siteCalls.push({ command, args: structuredClone(args) });
            if (state.failSite) throw new Error("사이트 상태를 확인하지 못했습니다.");
            if (command === "site_browser_selection") {
              if (state.failSiteSelection) throw { code: "selectionEmpty", message: "사이트에서 저장할 텍스트를 선택해주세요." };
              return structuredClone(state.siteSelection);
            }
            if (command === "site_browser_open") {
              const input = String(args.url), url = new URL(input.includes("://") ? input : `https://${input}`);
              if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("HTTP 또는 HTTPS 사이트 주소를 입력해주세요.");
              if (state.siteOpenDelay) await new Promise((resolve) => setTimeout(resolve, state.siteOpenDelay));
              siteHistory.splice(++siteIndex); siteHistory.push(url.href);
              state.site = { ...state.site, open: true, visible: false, url: url.href, title: "검증 사이트", loading: false };
            }
            if (command === "site_browser_layout") {
              if (!args.bounds && state.siteHideDelay) await new Promise((resolve) => setTimeout(resolve, state.siteHideDelay));
              state.siteBounds = args.bounds as SiteBrowserBounds | null;
              state.site.visible = state.site.open && Boolean(args.bounds);
            }
            if (command === "site_browser_action") {
              if (args.action === "back") siteIndex = Math.max(0, siteIndex - 1);
              if (args.action === "forward") siteIndex = Math.min(siteHistory.length - 1, siteIndex + 1);
              state.site.url = siteHistory[siteIndex] ?? null;
            }
            state.site.canGoBack = siteIndex > 0;
            state.site.canGoForward = siteIndex < siteHistory.length - 1;
            return structuredClone(state.site);
          }
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
          if (command === "list_workspace_documents" || command === "select_document_workspace") {
            if (state.invalidRoots.includes(path))
              throw new Error("작업 디렉터리에 접근할 수 없습니다.");
            if (command === "select_document_workspace") {
              if (state.selectedRoot !== path || args.rebind) state.generation++;
              state.selectedRoot = path;
            }
            return {
              path,
              generation: state.selectedRoot === path ? `scope:${state.generation}:${path}` : undefined,
              documents:
                path === workspacePath
                  ? state.documents.filter((doc) => doc.path.startsWith(`${path}/`))
                  : [
                      {
                        name: "other.md",
                        relativePath: "other.md",
                        path: `${path}/other.md`,
                      },
                    ].concat(state.documents.filter((doc) => doc.path.startsWith(`${path}/`))),
              truncated: path === workspacePath && state.truncated,
            };
          }
          if (command === "create_document" || command === "duplicate_document") {
            state.creationCalls.push({ command, args: structuredClone(args) });
            if (state.failCreation) throw { code: "io", message: "문서 생성 실패" };
            const generation = `scope:${state.generation}:${state.selectedRoot}`;
            if (args.generation !== generation || !state.selectedRoot) throw { code: "scopeRevoked", message: "fixture generation revoked" };
            const key = `${generation}:${args.requestId}`;
            let result = creationResults.get(key);
            if (!result) {
              const id = `261013174600-${creationResults.size.toString(16).padStart(8, "0")}`;
              let input = String(args.content);
              if (command === "duplicate_document") {
                const relative = String((args.document as {path: string}).path);
                let title = /^title:[ \t]*(.*?)[ \t]*\r?$/m.exec(input)?.[1] ?? relative.split("/").pop()!;
                if (title.startsWith('"')) title = JSON.parse(title);
                input = fixtureProperty(input, "title", `${title} 사본`);
              }
              result = { path: `${state.selectedRoot}/${id}.md`, content: fixtureProperty(input, "permalink", id), revision: "1", permalink: id };
              content.set(result.path, result.content); revisions.set(result.path, 1);
              state.documents.push({ path: result.path, name: `${id}.md`, relativePath: `${id}.md` });
              state.writes.push({ path: result.path, content: result.content });
              creationResults.set(key, result);
            }
            if (state.loseCreateResponse) { state.loseCreateResponse = false; throw new Error("fixture response lost"); }
            return { document: { ...result } };
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
        options.initialPath === undefined ? (options.workspacePath ?? "/fixture") : options.initialPath,
      workspacePath: options.workspacePath ?? "/fixture",
      workbenchConnection: options.workbenchConnection,
      invalidRoots: options.invalidRoots ?? [],
      contents: options.contents ?? {},
      persistConnections: options.persistConnections ?? false,
    },
  );
}
