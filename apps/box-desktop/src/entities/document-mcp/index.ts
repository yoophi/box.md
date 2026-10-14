import { invoke } from "@tauri-apps/api/core";
import type { SessionOptions } from "@yoophi/workbench-agent-client";

export interface DocumentMcpGrant {
  grantId: string;
  generation: string;
  runId: string;
  server: NonNullable<SessionOptions["mcpServers"]>[number];
}
export interface DocumentMcpGrantApi {
  issue(generation: string, runId: string): Promise<DocumentMcpGrant>;
  revoke(grantId: string): Promise<void>;
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function validGrant(value: unknown): value is DocumentMcpGrant {
  if (
    !object(value) ||
    typeof value.grantId !== "string" ||
    !value.grantId ||
    typeof value.generation !== "string" ||
    typeof value.runId !== "string" ||
    !object(value.server)
  )
    return false;
  const server = value.server;
  if (
    server.type !== "http" ||
    typeof server.name !== "string" ||
    !server.name.trim() ||
    typeof server.url !== "string"
  )
    return false;
  try {
    const url = new URL(server.url);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.pathname !== "/mcp" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false;
  } catch {
    return false;
  }
  if (!Array.isArray(server.headers) || server.headers.length !== 1)
    return false;
  const header = server.headers[0];
  return (
    object(header) &&
    typeof header.name === "string" &&
    header.name.toLowerCase() === "authorization" &&
    typeof header.value === "string" &&
    /^Bearer [a-f0-9]{64}$/.test(header.value)
  );
}
export const documentMcpGrantApi: DocumentMcpGrantApi = {
  async issue(generation, runId) {
    const value = await invoke<unknown>("get_document_mcp_grant", {
      generation,
      runId,
    });
    if (
      validGrant(value) &&
      value.generation === generation &&
      value.runId === runId
    )
      return value;
    if (object(value) && typeof value.grantId === "string" && value.grantId) {
      await invoke("revoke_document_mcp_grant", {
        grantId: value.grantId,
      }).catch(() => {});
    }
    throw new Error(
      "문서 도구 연결 정보를 확인하지 못했습니다. 다시 연결해주세요.",
    );
  },
  revoke: (grantId) => invoke("revoke_document_mcp_grant", { grantId }),
};
