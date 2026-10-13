import Ajv2020 from "ajv/dist/2020.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Capture actual HTTP outputs, then validate them with an independent JSON
// Schema 2020-12 engine instead of the adapter's limited runtime validator.
const directory = mkdtempSync(join(tmpdir(), "box-document-mcp-schema-"));
execFileSync("cargo", ["test", "-p", "box-desktop", "--lib", "inbound::document_mcp", "--locked"], {
  stdio: "inherit",
  env: { ...process.env, BOX_MCP_SCHEMA_EVIDENCE: directory },
});
const ajv = new Ajv2020({ strict: true, allErrors: true });
const tools = new Set();
let count = 0;
for (const file of readdirSync(directory).filter((name) => name.endsWith(".jsonl"))) {
  for (const line of readFileSync(join(directory, file), "utf8").trim().split("\n")) {
    const { tool, schema, output } = JSON.parse(line);
    const validate = ajv.compile(schema);
    if (!validate(output)) throw new Error(`${tool}: ${JSON.stringify(validate.errors)}`);
    tools.add(tool);
    count++;
  }
}
if (tools.size !== 15) throw new Error(`Expected all 15 document tools, observed ${tools.size}`);
console.log(`Validated ${count} actual HTTP outputs for ${tools.size} tools with independent JSON Schema 2020-12.`);
console.log(`Evidence: ${directory}`);
