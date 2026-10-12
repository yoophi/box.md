import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChatClient,
  type AgentChatClient,
  type AgentChatSnapshot,
  type AgentDescriptor,
  type SessionOptions,
} from "@/entities/agent-chat";
import { isDesktop } from "@/shared/lib/runtime";

export function useAgentChat(workspace: string | undefined, visible: boolean) {
  const clients = useRef(new Map<string, AgentChatClient>());
  const catalogs = useRef(new Map<string, AgentDescriptor[]>());
  const current = useRef<AgentChatClient | null>(null);
  const desiredWorkspace = useRef(workspace);
  desiredWorkspace.current = workspace;
  const desiredClient = () =>
    desiredWorkspace.current
      ? clients.current.get(desiredWorkspace.current)
      : undefined;
  const actions = useRef(new Set<AgentChatClient>());
  const [snapshot, setSnapshot] = useState<AgentChatSnapshot | null>(null);
  const [agents, setAgents] = useState<AgentDescriptor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => () => {
      for (const client of clients.current.values()) client.dispose();
      clients.current.clear();
      catalogs.current.clear();
      actions.current.clear();
    },
    [],
  );
  useEffect(() => {
    if (!workspace || !isDesktop()) {
      current.current = null;
      setSnapshot(null);
      setAgents([]);
      return;
    }
    let client = clients.current.get(workspace);
    if (!client && visible) {
      client = createChatClient(workspace);
      clients.current.set(workspace, client);
    }
    current.current = client ?? null;
    setSnapshot(client?.getSnapshot() ?? null);
    setAgents(catalogs.current.get(workspace) ?? []);
    setBusy(client ? actions.current.has(client) : false);
    setError(null);
    if (!client || !visible) return;
    const target = client;
    let cancelled = false;
    const unsubscribe = target.subscribe((state) => {
      if (desiredWorkspace.current === workspace) setSnapshot(state);
    });
    void (async () => {
      try {
        const connected = await target.connect();
        if (connected.kind !== "ok")
          throw new Error(
            "작업 디렉터리에 연결하지 못했습니다. 다시 연결해주세요.",
          );
        const result = await target.listAgents();
        if (result.kind !== "ok")
          throw new Error("에이전트 목록을 불러오지 못했습니다.");
        catalogs.current.set(workspace, result.output);
        if (!cancelled) setAgents(result.output);
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [workspace, visible]);

  const run = useCallback(
    async <T>(
      action: (client: AgentChatClient) => Promise<T>,
    ): Promise<T | null> => {
      const client = desiredClient();
      if (!client || actions.current.has(client)) return null;
      actions.current.add(client);
      setBusy(true);
      setError(null);
      try {
        return await action(client);
      } catch (cause) {
        if (desiredClient() === client)
          setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      } finally {
        actions.current.delete(client);
        if (desiredClient() === client) setBusy(false);
      }
    },
    [],
  );

  function resultError(client: AgentChatClient, outcome: { kind: string }) {
    if (desiredClient() !== client) return;
    if (outcome.kind === "unknown")
      setError(
        "요청 결과를 확인할 수 없습니다. 세션 상태와 대화를 확인해주세요.",
      );
    else if (outcome.kind === "notApplied")
      setError("연결이 끊겨 요청을 보내지 못했습니다.");
    else if (outcome.kind === "fault")
      setError("요청을 처리하지 못했습니다. 세션 상태를 확인해주세요.");
  }
  return {
    snapshot:
      current.current === desiredClient()
        ? snapshot
        : (desiredClient()?.getSnapshot() ?? null),
    agents:
      current.current === desiredClient()
        ? agents
        : (catalogs.current.get(workspace ?? "") ?? []),
    error: current.current === desiredClient() ? error : null,
    busy: current.current === desiredClient() && busy,
    reconnect: () =>
      run(async (client) => {
        const result = await client.connect();
        resultError(client, result);
        if (result.kind !== "ok") return;
        const catalog = await client.listAgents();
        resultError(client, catalog);
        if (catalog.kind === "ok" && desiredClient() === client) {
          catalogs.current.set(desiredWorkspace.current!, catalog.output);
          setAgents(catalog.output);
        }
      }),
    createSession: (options: SessionOptions) =>
      run(async (client) => {
        const id = crypto.randomUUID();
        const outcome = await client.createSession({ ...options, runId: id });
        resultError(client, outcome);
        return id;
      }),
    send: (id: string, text: string) =>
      run(async (client) => {
        const result = await client.send(id, text);
        resultError(client, result);
        return result.kind === "ok";
      }),
    respond: (id: string, permissionId: string, optionId: string) =>
      run(async (client) => {
        const result = await client.respondPermission(
          id,
          permissionId,
          optionId,
        );
        resultError(client, result);
      }),
    closeSession: (id: string) =>
      run(async (client) => {
        const result = await client.closeSession(id);
        resultError(client, result);
      }),
  };
}
export type AgentChatModel = ReturnType<typeof useAgentChat>;
