import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createAgentChatClient } from "@yoophi/workbench-agent-client";
import { startHost } from "@yoophi/workbench-client/test-host";

const cleanup = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

// Explicit local audit: CI does not require provider accounts or installed agent binaries.
it.runIf(process.env.BOX_TEST_INSTALLED_ACP === "1").each([
  ["codex", "codex-acp", []],
  ["claude-code", "claude-agent-acp", []],
  ["opencode", "opencode", ["acp"]],
])(
  "creates and closes an idle installed %s session over HTTP/WS without sending a prompt",
  async (agentId, binary, args) => {
    const located = spawnSync("which", [binary], { encoding: "utf8" });
    expect(
      located.status,
      `${binary} must be installed for this opt-in audit`,
    ).toBe(0);
    const command = [located.stdout.trim(), ...args]
      .map((arg) => `'${arg.replaceAll("'", "'\\''")}'`)
      .join(" ");
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
        incarnation: "inc-1",
      }),
    });
    cleanup.push(() => client.dispose());
    expect((await client.connect()).kind).toBe("ok");
    expect(
      (
        await client.createSession({
          agentId,
          agentCommand: command,
          runId: randomUUID(),
          permissionMode: "default",
        })
      ).kind,
    ).toBe("ok");
    const session = () => client.getSnapshot().sessions[0];
    await vi.waitFor(
      () => {
        expect(
          session().status,
          session().error ?? "waiting for installed ACP initialization",
        ).toBe("ready");
      },
      { timeout: 40_000 },
    );
    expect(session().messages).toHaveLength(0);
    expect(
      session().events.some(
        ({ event }) =>
          event.type === "lifecycle" && event.status === "promptSent",
      ),
    ).toBe(false);
    expect((await client.closeSession(session().id)).kind).toBe("ok");
    await vi.waitFor(() => expect(session().status).toBe("closed"), {
      timeout: 10_000,
    });
  },
);
