#!/usr/bin/env node
/**
 * Post-install self-test: speaks MCP stdio to one server, lists its tools,
 * and runs one real read call to prove the token works.
 * Usage: node selftest.mjs <label> <tool> <argsJson> -- <cmd> [args...]
 */
import { spawn } from "node:child_process";

const sep = process.argv.indexOf("--");
const [label, tool, argsJson] = process.argv.slice(2, sep);
const [cmd, ...cmdArgs] = process.argv.slice(sep + 1);

const p = spawn(cmd, cmdArgs, { stdio: ["pipe", "pipe", "pipe"] });
const seen = new Map();
let buf = "";
p.stdout.on("data", (d) => {
  buf += d;
  const lines = buf.split("\n");
  buf = lines.pop();
  for (const l of lines) {
    if (!l.trim()) continue;
    try { const m = JSON.parse(l); if (m.id != null) seen.set(m.id, m); } catch {}
  }
});
let stderr = "";
p.stderr.on("data", (d) => { stderr += d; });

const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

send({ jsonrpc: "2.0", id: 1, method: "initialize",
       params: { protocolVersion: "2024-11-05", capabilities: {},
                 clientInfo: { name: "selftest", version: "1" } } });
await wait(2500);
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
await wait(2500);
send({ jsonrpc: "2.0", id: 3, method: "tools/call",
       params: { name: tool, arguments: JSON.parse(argsJson) } });
await wait(12000);
p.kill();

const fail = (msg) => {
  console.log(`  FAIL ${label}: ${msg}`);
  if (stderr.trim()) console.log(`       stderr: ${stderr.trim().split("\n")[0].slice(0, 160)}`);
  process.exit(1);
};

if (!seen.has(1)) fail("server did not start or did not answer initialize");
const tools = seen.get(2)?.result?.tools ?? [];
if (!tools.length) fail("server exposed no tools");

const r = seen.get(3);
if (!r) fail(`no answer from '${tool}'`);
if (r.error) fail(`${tool} -> ${JSON.stringify(r.error).slice(0, 200)}`);
const text = (r.result?.content ?? []).map((c) => c.text ?? "").join("");
if (/error|expired|unauthor|forbidden|invalid/i.test(text.slice(0, 300))) {
  fail(text.trim().replace(/\s+/g, " ").slice(0, 220));
}
console.log(`  OK   ${label}: ${tools.length} tools, '${tool}' returned live data`);
