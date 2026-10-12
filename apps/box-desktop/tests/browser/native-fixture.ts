import type { Page } from "@playwright/test";

/** Replaces only native IPC for browser layout checks; the application and editor are real. */
export async function seedWorkspace(page: Page, count: number) {
  await page.addInitScript(
    ({ count }) => {
      localStorage.setItem("box.md.workspace-path", "/fixture");
      const documents = Array.from({ length: count }, (_, index) => {
        const name = `note-${String(index + 1).padStart(3, "0")}.md`;
        return { name, relativePath: name, path: `/fixture/${name}` };
      });
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
          if (command === "list_workspace_documents")
            return { path: "/fixture", documents, truncated: false };
          if (command === "open_document")
            return {
              path: args.path,
              content: `# ${String(args.path).split("/").pop()}\n\n브라우저 레이아웃 검증 문서`,
              revision: "1",
            };
          if (command === "document_revision") return "1";
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
    { count },
  );
}
