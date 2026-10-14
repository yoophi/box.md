import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type DocumentChange = {
  generation: string;
  kind: "documentChanged" | "documentDeleted" | "connectionsChanged";
  document: { path: string; revision: string } | null;
};

function isDocumentChange(value: unknown): value is DocumentChange {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.generation !== "string" ||
    !item.generation ||
    item.generation.length > 128 ||
    /[\r\n\0]/.test(item.generation) ||
    !["documentChanged", "documentDeleted", "connectionsChanged"].includes(
      String(item.kind),
    )
  )
    return false;
  if (item.kind === "connectionsChanged") return item.document === null;
  if (!item.document || typeof item.document !== "object") return false;
  const document = item.document as Record<string, unknown>;
  return (
    typeof document.path === "string" &&
    Boolean(document.path) &&
    document.path.length <= 8192 &&
    !document.path.startsWith("/") &&
    !document.path.startsWith("\\") &&
    !/^[A-Za-z]:[\\/]/.test(document.path) &&
    !/[\r\n\0]/.test(document.path) &&
    !document.path.split(/[\\/]/).includes("..") &&
    typeof document.revision === "string" &&
    Boolean(document.revision) &&
    document.revision.length <= 256 &&
    !/[\r\n\0]/.test(document.revision)
  );
}

export function listenDocumentChanges(
  receive: (change: DocumentChange) => void,
): Promise<UnlistenFn> {
  return listen<unknown>("box:document-change", ({ payload }) => {
    if (isDocumentChange(payload)) receive(payload);
  });
}
