#!/usr/bin/env node
// CI smoke test: starts one server through launch.sh with dummy credentials and
// checks its tools/list offline. No network, no real tokens.
// Usage: node scripts/ci-smoke.mjs openproject|gitea
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const which = process.argv[2];
const allowlist = readFileSync(join(root, "launch.sh"), "utf8").match(/^GITEA_TOOLS="([^"]+)"/m)[1].split(",");

const expect = {
  openproject: {
    names: ["find_user", "list_projects", "search_work_packages", "get_work_package",
      "get_work_package_activities", "get_work_package_attachments", "download_attachment"],
    withMeta: ["search_work_packages", "get_work_package", "get_work_package_activities"],
  },
  gitea: { names: allowlist, withMeta: [] },
}[which];
if (!expect) { console.error("Usage: ci-smoke.mjs openproject|gitea"); process.exit(64); }

// TA3LEEM_PLUGIN=1 skips the clone self-update, which has no place in CI.
const p = spawn("bash", [join(root, "launch.sh"), which], {
  env: { ...process.env, TA3LEEM_PLUGIN: "1" },
  stdio: ["pipe", "pipe", "inherit"],
});
const fail = (msg) => { console.error(`FAIL ${which}: ${msg}`); p.kill(); process.exit(1); };
const timer = setTimeout(() => fail("no tools/list reply within 20 s"), 20000);

let buf = "";
p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { fail(`stdout is not JSON-RPC: ${line.slice(0, 80)}`); }
    if (msg.id !== 2) continue;
    clearTimeout(timer);
    const tools = msg.result?.tools ?? fail("tools/list returned no tools");
    const got = tools.map((t) => t.name).sort();
    const want = [...expect.names].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) fail(`tools ${got.join(",")} != expected ${want.join(",")}`);
    const writable = tools.filter((t) => t.annotations?.readOnlyHint === false && t.name !== "download_attachment");
    if (writable.length) fail(`non read-only tools exposed: ${writable.map((t) => t.name).join(",")}`);
    const meta = tools.filter((t) => t._meta?.["anthropic/maxResultSizeChars"]).map((t) => t.name).sort();
    if (JSON.stringify(meta) !== JSON.stringify([...expect.withMeta].sort())) fail(`maxResultSizeChars on ${meta.join(",") || "none"}`);
    console.log(`OK ${which}: ${got.length} tools, read-only, output limits as expected`);
    p.kill();
    process.exit(0);
  }
});
p.on("exit", (code) => fail(`server exited early with code ${code}`));

const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ci", version: "1" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
