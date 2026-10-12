import type { Page } from "@playwright/test";
interface NativeFixture {
  pickedFolder: string | null;
  invalidRoots: string[];
  failPreferences: boolean;
  writes: { path: string; content: string }[];
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
  options: { initialPath?: string | null; invalidRoots?: string[] } = {},
) {
  await page.addInitScript(
    ({ count, initialPath, invalidRoots }) => {
      const key = "box.md.workspace-path";
      if (initialPath && !localStorage.getItem(key))
        localStorage.setItem(key, initialPath);
      const state: NativeFixture = {
        pickedFolder: null,
        invalidRoots,
        failPreferences: false,
        writes: [],
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
      const content = new Map<string, string>(),
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
          if (command === "list_workspace_documents") {
            if (state.invalidRoots.includes(path))
              throw new Error("작업 디렉터리에 접근할 수 없습니다.");
            return {
              path,
              documents:
                path === "/fixture"
                  ? documents
                  : [
                      {
                        name: "other.md",
                        relativePath: "other.md",
                        path: `${path}/other.md`,
                      },
                    ],
              truncated: false,
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
    },
  );
}
