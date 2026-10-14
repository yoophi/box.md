import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createAgentChatClient } from "@yoophi/workbench-agent-client";
import { startHost } from "@yoophi/workbench-client/test-host";
import { DocumentChatSessions } from "./document-chat-sessions";

// Actual AW HTTP/WS router and ACP subprocess. Native grant boundary is substituted;
// production native grant/HTTP isolation is covered by document_mcp_runtime Rust tests.
const cleanup = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
async function fixture(mode) {
  const dir = mkdtempSync(resolve(tmpdir(), "box-document-acp-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const script = resolve(dir, "agent.py"),
    evidence = resolve(dir, "session.json");
  writeFileSync(
    script,
    `import json, sys, hashlib, os
mode, evidence = sys.argv[1:]
for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    if method == "initialize":
        result = {"protocolVersion": 1, "agentCapabilities": {"mcpCapabilities": {"http": mode != "unsupported"}}, "authMethods": [], "agentInfo": {"name": "box-document-fixture", "version": "1"}}
    elif method == "session/new":
        servers = request["params"].get("mcpServers", [])
        safe = [{"type": server.get("type"), "name": server["name"], "url": server.get("url"), "headers": [{"name": header["name"], "digest": hashlib.sha256(header["value"].encode()).hexdigest()} for header in server.get("headers", [])]} for server in servers]
        with open(evidence, "w") as output: json.dump(safe, output)
        if mode == "failure":
            print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32000, "message": "fixture setup failed"}}), flush=True)
            continue
        result = {"sessionId": "fixture-session"}
    else:
        continue
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
    if method == "session/new" and mode == "eof": os._exit(0)
`,
  );
  const host = await startHost({
    HOST_USE_ACP_ENGINE: "1",
    HOST_JOURNAL_CAPACITY: "1000",
  });
  cleanup.push(() => host.stop());
  const client = createAgentChatClient({
    workspace: host.workDir,
    connectionProvider: async () => ({
      baseUrl: host.baseUrl,
      token: host.tokens.windowA,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      incarnation: "document-fixture",
    }),
  });
  cleanup.push(() => client.dispose());
  const value = `Bearer ${"a".repeat(64)}`;
  const api = {
    issue: vi.fn(async (generation, runId) => ({
      generation,
      runId,
      grantId: "fixture-grant",
      server: {
        type: "http",
        name: "box-documents",
        url: "http://127.0.0.1:19991/mcp",
        headers: [{ name: "Authorization", value }],
      },
    })),
    revoke: vi.fn(async () => {}),
  };
  const controller = new DocumentChatSessions(client, api);
  cleanup.push(() => controller.dispose());
  controller.setGeneration("fixture-generation");
  expect((await client.connect()).kind).toBe("ok");
  const runId = randomUUID();
  const outcome = await controller.createSession(
    {
      runId,
      agentId: "codex",
      permissionMode: "default",
      agentCommand: ["python3", script, mode, evidence].map(quote).join(" "),
    },
    true,
  );
  expect(outcome.kind, JSON.stringify(outcome)).toBe("ok");
  await vi.waitFor(
    () =>
      expect(
        existsSync(evidence),
        JSON.stringify(controller.getSnapshot()),
      ).toBe(true),
    { timeout: 15_000 },
  );
  return { client, controller, api, runId, value, evidence };
}
it("passes the bound HTTP server and header through AW session/new and revokes before close", async () => {
  const f = await fixture("supported");
  await vi.waitFor(() =>
    expect(f.client.getSnapshot().sessions[0].status).toBe("ready"),
  );
  const servers = JSON.parse(readFileSync(f.evidence, "utf8"));
  expect(servers.filter((server) => server.name === "box-documents")).toEqual([
    {
      type: "http",
      name: "box-documents",
      url: "http://127.0.0.1:19991/mcp",
      headers: [
        {
          name: "Authorization",
          digest: createHash("sha256").update(f.value).digest("hex"),
        },
      ],
    },
  ]);
  expect(servers.some((server) => server.name === "agentic_workbench")).toBe(
    true,
  );
  expect(f.api.revoke).not.toHaveBeenCalled();
  expect(JSON.stringify(f.controller.getSnapshot())).not.toContain(f.value);
  expect((await f.controller.closeSession(f.runId)).kind).toBe("ok");
  expect(f.api.revoke).toHaveBeenCalledWith("fixture-grant");
});
it("uses the actual unsupported capability diagnostic and keeps general chat ready", async () => {
  const f = await fixture("unsupported");
  await vi.waitFor(() =>
    expect(f.controller.getStatus().modes[f.runId]).toBe("unsupported"),
  );
  expect(JSON.parse(readFileSync(f.evidence, "utf8"))).toEqual([]);
  await vi.waitFor(() =>
    expect(f.client.getSnapshot().sessions[0].status).toBe("ready"),
  );
  expect(f.api.revoke).toHaveBeenCalledTimes(1);
});
it.each(["failure", "eof"])(
  "revokes the grant after actual ACP %s without a visible panel",
  async (mode) => {
    const f = await fixture(mode);
    await vi.waitFor(
      () => expect(f.api.revoke).toHaveBeenCalledWith("fixture-grant"),
      { timeout: 15_000 },
    );
    expect(f.api.revoke).toHaveBeenCalledTimes(1);
    expect(["closed", "failed", "lost"]).toContain(
      f.client.getSnapshot().sessions[0].status,
    );
  },
);

it("revokes a ready real ACP session on same-path generation rebind without closing the conversation", async () => {
  const f = await fixture("supported");
  await vi.waitFor(() =>
    expect(f.client.getSnapshot().sessions[0].status).toBe("ready"),
  );
  f.controller.setGeneration("rebound-generation");
  await vi.waitFor(() => expect(f.api.revoke).toHaveBeenCalledTimes(1));
  expect(f.client.getSnapshot().sessions[0].status).toBe("ready");
  expect(f.controller.getStatus().modes[f.runId]).toBe("revoked");
});

it("releases its grant on controller disposal while retaining the shared client", async () => {
  const f = await fixture("supported");
  await vi.waitFor(() =>
    expect(f.client.getSnapshot().sessions[0].status).toBe("ready"),
  );
  await f.controller.dispose();
  expect(f.api.revoke).toHaveBeenCalledTimes(1);
  expect(f.client.getSnapshot().disposed).toBe(false);
  expect((await f.client.closeSession(f.runId)).kind).toBe("ok");
});
