import { useEffect, useMemo, useState } from "react";
import type { WorkspaceSnapshot } from "@box/contracts";
import type { WikilinkTargets } from "@box/editor";
import { readDocument } from "./api";
import { resolveDocumentTargets } from "./permalink";

/** Shared document identity lookup; callers retain their own relationship models. */
export function useDocumentTargets(workspace: WorkspaceSnapshot | null, requested: readonly string[]): WikilinkTargets {
  const key = JSON.stringify([...new Set(requested)].sort());
  const ids = useMemo(() => JSON.parse(key) as string[], [key]);
  const loading = useMemo<WikilinkTargets>(() => new Map(ids.map((id) => [id, workspace
    ? { state: "loading" }
    : { state: "error", message: "작업 디렉터리를 선택하면 문서를 확인할 수 있습니다." }])), [ids, workspace]);
  const [result, setResult] = useState<{ workspace: WorkspaceSnapshot; key: string; targets: WikilinkTargets }>();
  useEffect(() => {
    let active = true;
    if (!workspace || !ids.length) return;
    void resolveDocumentTargets(workspace, ids, readDocument).then((targets) => {
      if (active) setResult({ workspace, key, targets });
    });
    return () => { active = false; };
  }, [workspace, key, ids]);
  return result?.workspace === workspace && result.key === key ? result.targets : loading;
}
