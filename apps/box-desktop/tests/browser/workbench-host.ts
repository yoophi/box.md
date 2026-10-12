import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HostInfo } from "@yoophi/workbench-client/test-host";

const root = fileURLToPath(new URL("../../../../vendor/agentic-workspace/", import.meta.url));
export function buildBrowserHost() {
  execFileSync("cargo", ["build", "-p", "workbench-host", "--example", "http_test_host", "--features", "test-hooks"], {
    cwd: root, stdio: "inherit", env: { ...process.env, CARGO_INCREMENTAL: "0" },
  });
}
/** Same AW test host/production router, with a Playwright ESM-compatible process wrapper. */
export async function startBrowserHost(env: Record<string, string>) {
  const ownedDir = mkdtempSync(resolve(tmpdir(), "box-panels-"));
  const child = spawn(resolve(root, "target/debug/examples/http_test_host"), [], {
    env: { ...process.env, ...env, HOST_DATA_DIR: ownedDir },
  });
  const exited = new Promise<void>(done => child.once("close", () => done()));
  const stop = async () => {
    if (child.exitCode === null) child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGTERM"), 10_000);
    try { await exited; } finally { clearTimeout(timer); rmSync(ownedDir, { recursive: true, force: true }); }
  };
  try {
    const info = await new Promise<HostInfo>((resolveInfo, reject) => {
      let output = "";
      const timer = setTimeout(() => { reject(new Error("AW browser test host did not become ready")); }, 10_000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("AW browser test host exited before readiness")); });
      child.stdout.on("data", chunk => {
        output += chunk.toString("utf8");
        if (!output.includes("\n")) return;
        clearTimeout(timer);
        try { resolveInfo(JSON.parse(output.slice(0, output.indexOf("\n")))); }
        catch { reject(new Error("AW browser test host returned invalid readiness data")); }
      });
    });
    return { ...info, stop };
  } catch (error) { await stop(); throw error; }
}
