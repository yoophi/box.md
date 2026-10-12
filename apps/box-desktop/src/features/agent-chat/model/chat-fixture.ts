import { vi } from "vitest";
import type {
  AgentChatClient,
  AgentChatSnapshot,
  ChatSession,
} from "@/entities/agent-chat";

export const readySession = (id = "session-one"): ChatSession => ({
  id,
  agentId: "codex",
  label: "문서 대화",
  status: "ready",
  messages: [],
  events: [],
  permissions: [],
  lastSequence: 0,
  historyIncomplete: false,
});

/** UI boundary fixture; wire/ACP integration is tested against the real AW server. */
export function chatFixture() {
  let snapshot: AgentChatSnapshot = {
    connection: "connected",
    sessions: [readySession()],
    disposed: false,
  };
  const listeners = new Set<(state: AgentChatSnapshot) => void>();
  const client: AgentChatClient = {
    connect: vi.fn<AgentChatClient["connect"]>(async () => ({
      kind: "ok",
      output: { benchId: "bench-one" },
      revision: undefined,
    })),
    listAgents: vi.fn<AgentChatClient["listAgents"]>(async () => ({
      kind: "ok",
      output: [{ id: "codex", label: "Codex", command: "codex-acp" }],
      revision: undefined,
    })),
    createSession: vi.fn<AgentChatClient["createSession"]>(async (options) => ({
      kind: "ok",
      output: { id: options.runId! },
      revision: undefined,
    })),
    send: vi.fn<AgentChatClient["send"]>(async () => ({
      kind: "ok",
      output: undefined,
      revision: undefined,
    })),
    respondPermission: vi.fn<AgentChatClient["respondPermission"]>(
      async () => ({ kind: "ok", output: undefined, revision: undefined }),
    ),
    closeSession: vi.fn<AgentChatClient["closeSession"]>(async () => ({
      kind: "ok",
      output: undefined,
      revision: undefined,
    })),
    subscribe: vi.fn<AgentChatClient["subscribe"]>((listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    getSnapshot: () => snapshot,
    dispose: vi.fn<AgentChatClient["dispose"]>(() => {
      listeners.clear();
      snapshot = { ...snapshot, disposed: true };
    }),
  };
  return {
    client,
    emit(next: AgentChatSnapshot) {
      snapshot = next;
      listeners.forEach((listener) => listener(next));
    },
  };
}
