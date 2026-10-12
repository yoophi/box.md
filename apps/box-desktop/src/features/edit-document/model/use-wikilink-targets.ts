import { useMemo } from "react";
import { markdownToDocument, splitDocument, type WikilinkTargets } from "@box/editor";
import type { WorkspaceSnapshot } from "@box/contracts";
import { useDocumentTargets } from "@/entities/document";
type JSONContent = ReturnType<typeof markdownToDocument>;

function references(content: string) {
  const ids = new Set<string>();
  function visit(node: JSONContent) {
    if (node.type === "wikilink") ids.add(String(node.attrs!.permalink));
    node.content?.forEach(visit);
  }
  visit(markdownToDocument(splitDocument(content).body));
  return JSON.stringify([...ids].sort());
}

export function useWikilinkTargets(workspace: WorkspaceSnapshot | null, content: string): WikilinkTargets {
  const key = useMemo(() => references(content), [content]);
  const ids = useMemo(() => JSON.parse(key) as string[], [key]);
  return useDocumentTargets(workspace, ids);
}
