import { execFileSync } from "node:child_process";
import { copyFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
  .split("\n")
  .find((line) => line.startsWith("host: "))
  ?.slice(6);
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || host;
if (!triple || !/^[a-zA-Z0-9_-]+$/.test(triple))
  throw new Error("A Rust target triple is required.");
const debug =
  process.argv.includes("--debug") ||
  process.env.TAURI_ENV_DEBUG === "true" ||
  process.env.TAURI_ENV_DEBUG === "1";
const args = [
  "build",
  "--manifest-path",
  resolve(root, "vendor/agentic-workspace/Cargo.toml"),
  "-p",
  "agentic-workbench-server",
  "--target-dir",
  resolve(root, "target"),
];
if (!debug) args.push("--release");
if (triple !== host) args.push("--target", triple);
execFileSync("cargo", args, { cwd: root, stdio: "inherit" });
const profile = debug ? "debug" : "release";
const extension = triple.includes("windows") ? ".exe" : "";
const built = resolve(
  root,
  "target",
  ...(triple === host ? [] : [triple]),
  profile,
  `agentic-workbench-server${extension}`,
);
const bundled = resolve(
  root,
  "apps/box-desktop/src-tauri/binaries",
  `agentic-workbench-server-${triple}${extension}`,
);
mkdirSync(dirname(bundled), { recursive: true });
copyFileSync(built, bundled);
if (!extension) chmodSync(bundled, 0o755);
console.log(`Workbench server prepared for ${triple} (${profile}).`);
