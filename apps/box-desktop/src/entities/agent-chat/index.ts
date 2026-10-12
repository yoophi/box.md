import { invoke } from "@tauri-apps/api/core";
import {
  createAgentChatClient,
  type AgentChatOptions,
} from "@yoophi/workbench-agent-client";
export type {
  AgentChatClient,
  AgentChatSnapshot,
  AgentDescriptor,
  ChatSession,
  SessionOptions,
} from "@yoophi/workbench-agent-client";
type ConnectionInfo = Awaited<
  ReturnType<AgentChatOptions["connectionProvider"]>
>;
export function createChatClient(workspace: string) {
  return createAgentChatClient({
    workspace,
    connectionProvider: () =>
      invoke<ConnectionInfo>("get_workbench_connection"),
  });
}
