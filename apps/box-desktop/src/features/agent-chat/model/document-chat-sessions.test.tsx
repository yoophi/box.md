import { expect, it, vi } from "vitest";
import type { AgentChatSnapshot, SessionOptions } from "@/entities/agent-chat";
import type {
  DocumentMcpGrant,
  DocumentMcpGrantApi,
} from "@/entities/document-mcp";
import { chatFixture, readySession } from "./chat-fixture";
import { DocumentChatSessions } from "./document-chat-sessions";

const secret = "a".repeat(64);
const options: SessionOptions = { agentId: "codex", runId: "run-one" };
function grant(generation = "gen-one", runId = "run-one"): DocumentMcpGrant {
  return {
    grantId: `grant-${generation}-${runId}`,
    generation,
    runId,
    server: {
      type: "http",
      name: "box-documents",
      url: "http://127.0.0.1:43210/mcp",
      headers: [{ name: "Authorization", value: `Bearer ${secret}` }],
    },
  };
}
function setup() {
  const fixture = chatFixture();
  const api: DocumentMcpGrantApi = {
    issue: vi.fn(async (generation, runId) => grant(generation, runId)),
    revoke: vi.fn(async () => {}),
  };
  const controller = new DocumentChatSessions(fixture.client, api);
  controller.setGeneration("gen-one");
  return { ...fixture, api, controller };
}
function emitSession(
  f: ReturnType<typeof setup>,
  status = "ready",
  events: AgentChatSnapshot["sessions"][number]["events"] = [],
) {
  f.emit({
    connection: "connected",
    disposed: false,
    sessions: [
      { ...readySession("run-one"), status: status as "ready", events },
    ],
  });
}

it("adds the bound native server to shared SessionOptions without putting its headers in public state", async () => {
  const f = setup();
  await f.controller.createSession(
    {
      ...options,
      mcpServers: [
        { type: "http", name: "other", url: "http://127.0.0.1:43211/mcp" },
      ],
    },
    true,
  );
  expect(f.api.issue).toHaveBeenCalledWith("gen-one", "run-one");
  const sent = vi.mocked(f.client.createSession).mock.calls[0][0];
  expect(sent.mcpServers?.map((server) => server.name)).toEqual([
    "other",
    "box-documents",
  ]);
  expect(sent.mcpServers?.[1].headers?.[0].value === `Bearer ${secret}`).toBe(
    true,
  );
  expect(JSON.stringify(f.controller.getStatus()).includes(secret)).toBe(false);
  expect(f.controller.getStatus().modes["run-one"]).toBe("enabled");
  await f.controller.dispose();
});

it("keeps plain chat independent from native grants and rejects duplicate run IDs without revoking the original", async () => {
  const f = setup();
  await f.controller.createSession(options, false);
  expect(f.api.issue).not.toHaveBeenCalled();
  await f.controller.createSession(options, true);
  await expect(f.controller.createSession(options, true)).rejects.toThrow(
    "이미 사용한 세션",
  );
  expect(f.api.issue).toHaveBeenCalledTimes(1);
  expect(f.api.revoke).not.toHaveBeenCalled();
  await f.controller.dispose();
});

it.each([
  { kind: "notApplied", reason: "offline" },
  { kind: "unknown", reason: "lost" },
])(
  "revokes after non-confirmed creation $kind without retrying agent creation",
  async (outcome) => {
    const f = setup();
    vi.mocked(f.client.createSession).mockResolvedValue(
      outcome as Awaited<ReturnType<typeof f.client.createSession>>,
    );
    expect((await f.controller.createSession(options, true)).kind).toBe(
      outcome.kind,
    );
    expect(f.api.revoke).toHaveBeenCalledWith(grant().grantId);
    expect(f.client.createSession).toHaveBeenCalledTimes(1);
    await f.controller.dispose();
  },
);

it("revokes and redacts a thrown create failure, including late agent error/permission echoes", async () => {
  const f = setup();
  vi.mocked(f.client.createSession).mockRejectedValue(
    new Error(`create failed Bearer ${secret}`),
  );
  const failed = await f.controller
    .createSession(options, true)
    .catch((error) => error);
  expect(failed.message.includes(secret)).toBe(false);
  expect(f.api.revoke).toHaveBeenCalledOnce();
  let publicState: AgentChatSnapshot | undefined;
  f.controller.subscribe((snapshot) => {
    publicState = snapshot;
  });
  f.emit({
    connection: "connected",
    disposed: false,
    sessions: [
      {
        ...readySession("run-one"),
        error: `Bearer ${secret}`,
        messages: [{ id: "echo", role: "assistant", text: secret }],
        permissions: [
          {
            id: "permission",
            title: secret,
            input: { [secret]: secret },
            options: [],
            responding: false,
          },
        ],
      },
    ],
  });
  expect(JSON.stringify(publicState).includes(secret)).toBe(false);
  expect(JSON.stringify(f.controller.getSnapshot()).includes(secret)).toBe(
    false,
  );
  expect(f.client.getSnapshot().sessions[0].messages[0].text === secret).toBe(
    true,
  );
  await f.controller.dispose();
});

it.each(["closed", "failed", "lost"])(
  "observes terminal %s and revokes even without a visible-panel subscription",
  async (status) => {
    const f = setup();
    await f.controller.createSession(options, true);
    emitSession(f, status);
    await vi.waitFor(() => expect(f.api.revoke).toHaveBeenCalledOnce());
    expect(f.controller.getStatus().modes["run-one"]).toBe("revoked");
    await f.controller.dispose();
  },
);

it("releases unsupported HTTP capability while keeping the shared chat session available", async () => {
  const f = setup();
  await f.controller.createSession(options, true);
  emitSession(f, "ready", [
    {
      sequence: 1,
      event: {
        type: "diagnostic",
        message:
          "agent does not advertise HTTP MCP support; skipping MCP server setup",
      },
    },
  ]);
  await vi.waitFor(() => expect(f.api.revoke).toHaveBeenCalledOnce());
  expect(f.controller.getStatus().modes["run-one"]).toBe("unsupported");
  expect(f.controller.getStatus().notice).toContain("일반 채팅");
  expect(f.client.closeSession).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().sessions[0].status).toBe("ready");
  await f.controller.dispose();
});

it("does not revoke on transient stream errors or changes within the same generation", async () => {
  const f = setup();
  await f.controller.createSession(options, true);
  f.emit({
    connection: "disconnected",
    disposed: false,
    sessions: [
      { ...readySession("run-one"), streamError: "retrying WebSocket" },
    ],
  });
  f.controller.setGeneration("gen-one");
  expect(f.api.revoke).not.toHaveBeenCalled();
  f.controller.setGeneration("gen-two");
  await vi.waitFor(() => expect(f.api.revoke).toHaveBeenCalledOnce());
  await f.controller.dispose();
});

it.each(["root", "dispose"])(
  "revokes a late native grant after %s and never creates an agent",
  async (reason) => {
    const f = setup();
    let finish!: (value: DocumentMcpGrant) => void;
    vi.mocked(f.api.issue).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.controller.createSession(options, true);
    if (reason === "root") f.controller.setGeneration("gen-two");
    else await f.controller.dispose();
    finish(grant());
    await expect(pending).rejects.toThrow("작업 디렉터리");
    expect(f.api.revoke).toHaveBeenCalledWith(grant().grantId);
    expect(f.client.createSession).not.toHaveBeenCalled();
    await f.controller.dispose();
  },
);

it("ignores a late native issuance failure after a generation rebind", async () => {
  const f = setup();
  let reject!: (cause: Error) => void;
  vi.mocked(f.api.issue).mockImplementationOnce(
    () =>
      new Promise((_, failure) => {
        reject = failure;
      }),
  );
  const pending = f.controller.createSession(options, true);
  f.controller.setGeneration("gen-two");
  await f.controller.createSession({ ...options, runId: "new-run" }, true);
  reject(new Error("old workspace failed"));
  await expect(pending).rejects.toThrow("작업 디렉터리");
  expect(f.controller.getStatus().notice).toBeNull();
  expect(f.controller.getStatus().modes["new-run"]).toBe("enabled");
  await f.controller.dispose();
});

it("revokes an in-flight create on generation change and ignores its late success", async () => {
  const f = setup();
  let finish!: (
    value: Awaited<ReturnType<typeof f.client.createSession>>,
  ) => void;
  vi.mocked(f.client.createSession).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.controller.createSession(options, true);
  await vi.waitFor(() => expect(f.client.createSession).toHaveBeenCalledOnce());
  f.controller.setGeneration("gen-two");
  finish({ kind: "ok", output: { id: "run-one" }, revision: undefined });
  await expect(pending).rejects.toThrow("작업 디렉터리");
  expect(f.api.revoke).toHaveBeenCalledOnce();
  await f.controller.dispose();
});

it("keeps failed revocations pending, reports a fixed notice, and safely retries cleanup", async () => {
  const f = setup();
  await f.controller.createSession(options, true);
  vi.mocked(f.api.revoke).mockRejectedValueOnce(
    new Error(`private cleanup ${secret}`),
  );
  await f.controller.closeSession("run-one");
  expect(f.client.closeSession).toHaveBeenCalledWith("run-one");
  expect(f.controller.getStatus().cleanupPending).toBe(true);
  expect(JSON.stringify(f.controller.getStatus()).includes(secret)).toBe(false);
  await f.controller.retryCleanup();
  expect(f.api.revoke).toHaveBeenCalledTimes(2);
  expect(f.controller.getStatus().cleanupPending).toBe(false);
  expect(f.controller.getStatus().notice).toBeNull();
  await f.controller.dispose();
});

it("releases a fault result and removes credential echoes from the public outcome", async () => {
  const f = setup();
  vi.mocked(f.client.createSession).mockResolvedValue({
    kind: "fault",
    fault: {
      code: "internal",
      message: `failed ${secret}`,
      retryable: false,
      outcome: "notApplied",
      requestId: "request",
    },
  });
  const result = await f.controller.createSession(options, true);
  expect(result.kind).toBe("fault");
  expect(JSON.stringify(result).includes(secret)).toBe(false);
  expect(f.api.revoke).toHaveBeenCalledOnce();
  await f.controller.dispose();
});

it("rejects a concurrent duplicate during native grant preparation without touching the first lease", async () => {
  const f = setup();
  let finish!: (value: DocumentMcpGrant) => void;
  vi.mocked(f.api.issue).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = f.controller.createSession(options, true);
  await expect(f.controller.createSession(options, true)).rejects.toThrow(
    "이미 사용한 세션",
  );
  expect(f.api.issue).toHaveBeenCalledOnce();
  expect(f.api.revoke).not.toHaveBeenCalled();
  finish(grant());
  await first;
  expect(f.client.createSession).toHaveBeenCalledOnce();
  expect(f.api.revoke).not.toHaveBeenCalled();
  await f.controller.dispose();
});
