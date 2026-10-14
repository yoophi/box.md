import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { documentMcpGrantApi } from ".";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const value = () => ({
  grantId: "grant",
  generation: "generation",
  runId: "run",
  server: {
    type: "http",
    name: "box-documents",
    url: "http://127.0.0.1:43210/mcp",
    headers: [{ name: "Authorization", value: `Bearer ${"c".repeat(64)}` }],
  },
});
beforeEach(() => vi.clearAllMocks());
it("uses the registered native command names and shared HTTP configuration shape", async () => {
  vi.mocked(invoke).mockResolvedValue(value());
  const result = await documentMcpGrantApi.issue("generation", "run");
  expect(invoke).toHaveBeenCalledWith("get_document_mcp_grant", {
    generation: "generation",
    runId: "run",
  });
  expect(result.server.type).toBe("http");
  expect(
    result.server.headers?.[0].value === value().server.headers[0].value,
  ).toBe(true);
  await documentMcpGrantApi.revoke("grant");
  expect(invoke).toHaveBeenLastCalledWith("revoke_document_mcp_grant", {
    grantId: "grant",
  });
});
it.each(["remote", "generation", "run", "header", "null"])(
  "rejects malformed or mismatched %s responses without exposing their content",
  async (kind) => {
    const bad = value();
    if (kind === "remote")
      bad.server.url = "https://private-marker.example/mcp";
    if (kind === "generation") bad.generation = "other";
    if (kind === "run") bad.runId = "other";
    if (kind === "header") bad.server.headers[0].value = "private-marker";
    vi.mocked(invoke).mockImplementation(
      async (command) =>
        (command === "get_document_mcp_grant"
          ? kind === "null"
            ? null
            : bad
          : undefined) as never,
    );
    const failure = await documentMcpGrantApi
      .issue("generation", "run")
      .catch((error) => error);
    expect(failure.message).not.toContain("private-marker");
    expect(failure.message).not.toContain("c".repeat(64));
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(
          ([command]) => command === "revoke_document_mcp_grant",
        ),
    ).toHaveLength(kind === "null" ? 0 : 1);
  },
);
