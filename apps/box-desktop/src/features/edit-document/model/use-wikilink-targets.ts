import { useEffect, useMemo, useState } from "react";
import { markdownToDocument, splitDocument, type WikilinkTargets } from "@box/editor";
import type { WorkspaceSnapshot } from "@box/contracts";
import { readDocument, resolveWikilinkTargets } from "@/entities/document";
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
  const loading = useMemo<WikilinkTargets>(() => new Map(ids.map((id) => [id, workspace
    ? { state: "loading" }
    : { state: "error", message: "작업 디렉터리를 선택하면 고정 링크를 확인할 수 있습니다." }])), [ids, workspace]);
  const [result, setResult] = useState<{ workspace: WorkspaceSnapshot | null; key: string; targets: WikilinkTargets }>();
  useEffect(() => {
    let active = true;
    if (!workspace || !ids.length) return;
    void resolveWikilinkTargets(workspace, ids, readDocument).then((targets) => {
      if (active) setResult({ workspace, key, targets });
    });
    return () => { active = false; };
  }, [workspace, key, ids]);
  return result?.workspace === workspace && result.key === key ? result.targets : loading;
}
