import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChatClient,
  type AgentChatClient,
  type AgentChatSnapshot,
  type AgentDescriptor,
  type SessionOptions,
} from "@/entities/agent-chat";
import { documentMcpGrantApi } from "@/entities/document-mcp";
import { isDesktop } from "@/shared/lib/runtime";
import { DocumentChatSessions } from "./document-chat-sessions";

export function useAgentChat(
  workspace: string | undefined,
  visible: boolean,
  generation?: string,
) {
  const clients = useRef(new Map<string, AgentChatClient>());
  const documents = useRef(new Map<string, DocumentChatSessions>());
  const catalogs = useRef(new Map<string, AgentDescriptor[]>());
  const current = useRef<AgentChatClient | null>(null);
  const currentGeneration = useRef<string | undefined>(undefined);
  const desiredWorkspace = useRef(workspace);
  const desiredGeneration = useRef(generation);
  desiredWorkspace.current = workspace;
  desiredGeneration.current = generation;
  const desiredClient = () =>
    desiredWorkspace.current
      ? clients.current.get(desiredWorkspace.current)
      : undefined;
  const desiredDocuments = () =>
    desiredWorkspace.current
      ? documents.current.get(desiredWorkspace.current)
      : undefined;
  const actions = useRef(new Map<AgentChatClient, Set<string | undefined>>());
  const active = (
    client: AgentChatClient | undefined,
    scope: string | undefined,
  ) => Boolean(client && actions.current.get(client)?.has(scope));
  const [snapshot, setSnapshot] = useState<AgentChatSnapshot | null>(null);
  const [agents, setAgents] = useState<AgentDescriptor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [documentsEnabled, setDocumentsEnabled] = useState(true);
  const [, setDocumentVersion] = useState(0);

  useEffect(
    () => () => {
      for (const controller of documents.current.values())
        void controller.dispose();
      for (const client of clients.current.values()) client.dispose();
      documents.current.clear();
      clients.current.clear();
      catalogs.current.clear();
      actions.current.clear();
    },
    [],
  );
  useEffect(() => {
    for (const [root, controller] of documents.current)
      controller.setGeneration(root === workspace ? generation : undefined);
    if (!workspace || !isDesktop()) {
      current.current = null;
      currentGeneration.current = generation;
      setSnapshot(null);
      setAgents([]);
      return;
    }
    let client = clients.current.get(workspace);
    if (!client && visible) {
      client = createChatClient(workspace);
      clients.current.set(workspace, client);
      const controller = new DocumentChatSessions(
        client,
        documentMcpGrantApi,
        () => {
          if (
            desiredWorkspace.current === workspace &&
            documents.current.get(workspace) === controller
          )
            setDocumentVersion((version) => version + 1);
        },
      );
      documents.current.set(workspace, controller);
      controller.setGeneration(generation);
    }
    const controller = documents.current.get(workspace);
    current.current = client ?? null;
    currentGeneration.current = generation;
    setSnapshot(controller?.getSnapshot() ?? null);
    setAgents(catalogs.current.get(workspace) ?? []);
    setBusy(active(client, generation));
    setError(null);
    if (!client || !controller || !visible) return;
    const target = client;
    const isCurrent = () =>
      desiredWorkspace.current === workspace &&
      desiredGeneration.current === generation;
    let cancelled = false;
    const unsubscribe = controller.subscribe((state) => {
      if (isCurrent()) setSnapshot(state);
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
        if (!cancelled && isCurrent()) {
          catalogs.current.set(workspace, result.output);
          setAgents(result.output);
        }
      } catch (cause) {
        if (!cancelled && isCurrent()) setError(controller.safeMessage(cause));
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [workspace, visible, generation]);

  const run = useCallback(
    async <T>(
      action: (client: AgentChatClient, isCurrent: () => boolean) => Promise<T>,
    ): Promise<T | null> => {
      const client = desiredClient(),
        root = desiredWorkspace.current,
        scope = desiredGeneration.current;
      if (!client || active(client, scope)) return null;
      let flights = actions.current.get(client);
      if (!flights) {
        flights = new Set();
        actions.current.set(client, flights);
      }
      flights.add(scope);
      setBusy(true);
      setError(null);
      const isCurrent = () =>
        desiredClient() === client &&
        desiredWorkspace.current === root &&
        desiredGeneration.current === scope;
      try {
        return await action(client, isCurrent);
      } catch (cause) {
        if (isCurrent())
          setError(
            desiredDocuments()?.safeMessage(cause) ??
              "요청을 처리하지 못했습니다.",
          );
        return null;
      } finally {
        flights.delete(scope);
        if (isCurrent()) setBusy(false);
      }
    },
    [],
  );
  function resultError(outcome: { kind: string }) {
    if (outcome.kind === "unknown")
      setError(
        "요청 결과를 확인할 수 없습니다. 세션 상태와 대화를 확인해주세요.",
      );
    else if (outcome.kind === "notApplied")
      setError("연결이 끊겨 요청을 보내지 못했습니다.");
    else if (outcome.kind === "fault")
      setError("요청을 처리하지 못했습니다. 세션 상태를 확인해주세요.");
  }
  const currentContext =
    current.current === desiredClient() &&
    currentGeneration.current === generation;
  const controller = desiredDocuments();
  return {
    snapshot: currentContext ? snapshot : (controller?.getSnapshot() ?? null),
    agents: currentContext
      ? agents
      : (catalogs.current.get(workspace ?? "") ?? []),
    error: currentContext ? error : null,
    busy: currentContext ? busy : active(desiredClient(), generation),
    ...(generation
      ? {
          documentTools: {
            enabled: documentsEnabled,
            setEnabled: setDocumentsEnabled,
            ...controller?.getStatus(),
          },
        }
      : {}),
    reconnect: () =>
      run(async (client, isCurrent) => {
        await desiredDocuments()?.retryCleanup();
        const result = await client.connect();
        if (isCurrent()) resultError(result);
        if (result.kind !== "ok") return;
        const catalog = await client.listAgents();
        if (isCurrent()) {
          resultError(catalog);
          if (catalog.kind === "ok") {
            catalogs.current.set(desiredWorkspace.current!, catalog.output);
            setAgents(catalog.output);
          }
        }
      }),
    createSession: (options: SessionOptions) =>
      run(async (client, isCurrent) => {
        const id = crypto.randomUUID();
        const controller = desiredDocuments();
        if (!controller) return null;
        const outcome = await controller.createSession(
          { ...options, runId: id },
          documentsEnabled && Boolean(desiredGeneration.current),
        );
        if (isCurrent()) resultError(outcome);
        return id;
      }),
    send: (id: string, text: string) =>
      run(async (client, isCurrent) => {
        const result = await client.send(id, text);
        if (isCurrent()) resultError(result);
        return result.kind === "ok";
      }),
    respond: (id: string, permissionId: string, optionId: string) =>
      run(async (client, isCurrent) => {
        const result = await client.respondPermission(
          id,
          permissionId,
          optionId,
        );
        if (isCurrent()) resultError(result);
      }),
    closeSession: (id: string) =>
      run(async (client, isCurrent) => {
        const result = await desiredDocuments()!.closeSession(id);
        if (isCurrent()) resultError(result);
      }),
  };
}
export type AgentChatModel = ReturnType<typeof useAgentChat>;
