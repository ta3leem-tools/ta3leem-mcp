#!/usr/bin/env node
/**
 * End-to-end check against a running remote MCP Worker.
 *
 * Drives the same path Claude drives: dynamic client registration, an
 * authorization request with S256 PKCE, the consent POST, the token exchange,
 * then real MCP calls. Nothing here is mocked, so a pass means the deployed
 * Worker genuinely works.
 *
 *   BASE=http://localhost:8787 \
 *   ENROLL_PASSPHRASE=... OPENPROJECT_API_KEY=... GITEA_TOKEN=... \
 *   node selftest-remote.mjs
 */

import { createHash, randomBytes } from "node:crypto";

const BASE = (process.env.BASE || "http://localhost:8787").replace(/\/$/, "");
const PASS = process.env.ENROLL_PASSPHRASE || "";
const OP_KEY = process.env.OPENPROJECT_API_KEY || "";
const GT_TOKEN = process.env.GITEA_TOKEN || "";
const REDIRECT = "http://localhost:9999/cb";

let failures = 0;
function step(name) { process.stdout.write(`  ${name} ... `); }
function pass(extra = "") { console.log(`OK ${extra}`); }
function fail(msg) { console.log(`FAIL\n      ${msg}`); failures++; }

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main() {
  console.log(`\nRemote MCP selftest against ${BASE}\n`);

  // 1. Discovery. Claude cannot connect without these two documents.
  step("GET /.well-known/oauth-protected-resource");
  let prm;
  try {
    const r = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
    prm = await r.json();
    if (!r.ok) { throw new Error(`HTTP ${r.status}`); }
    if (!Array.isArray(prm.authorization_servers) || !prm.authorization_servers.length) {
      throw new Error("no authorization_servers");
    }
    pass(`resource=${prm.resource}`);
  } catch (e) { fail(e.message); }

  step("GET /.well-known/oauth-authorization-server");
  let asm;
  try {
    const r = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    asm = await r.json();
    if (!r.ok) { throw new Error(`HTTP ${r.status}`); }
    if (!asm.registration_endpoint) { throw new Error("no registration_endpoint, DCR is off"); }
    if (!(asm.code_challenge_methods_supported || []).includes("S256")) {
      throw new Error("S256 not advertised, Claude requires it");
    }
    pass("DCR + S256 advertised");
  } catch (e) { fail(e.message); }

  // 2. Unauthenticated MCP must 401 with the resource_metadata pointer, or
  //    Claude never learns where the authorization server is.
  step("POST /mcp unauthenticated returns 401 + WWW-Authenticate");
  try {
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    if (r.status !== 401) { throw new Error(`got HTTP ${r.status}, want 401`); }
    const wa = r.headers.get("www-authenticate") || "";
    if (!/resource_metadata=/.test(wa)) { throw new Error(`WWW-Authenticate lacks resource_metadata: ${wa || "(absent)"}`); }
    pass();
  } catch (e) { fail(e.message); }

  if (!PASS || !OP_KEY || !GT_TOKEN) {
    console.log("\nProtocol checks done. Set ENROLL_PASSPHRASE, OPENPROJECT_API_KEY and");
    console.log("GITEA_TOKEN to also run the full OAuth dance and real tool calls.\n");
    process.exit(failures ? 1 : 0);
  }

  // 3. Dynamic client registration.
  step("POST /register (DCR)");
  let clientId;
  try {
    const r = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "ta3leem selftest",
        redirect_uris: [REDIRECT],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    const j = await r.json();
    if (!r.ok) { throw new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`); }
    clientId = j.client_id;
    if (!clientId) { throw new Error("no client_id returned"); }
    pass(`client_id=${clientId.slice(0, 12)}...`);
  } catch (e) { fail(e.message); process.exit(1); }

  // 4. Authorization request with PKCE.
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(12));

  step("GET /authorize renders the consent form");
  let authBlob;
  try {
    const u = new URL(`${BASE}/authorize`);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", clientId);
    u.searchParams.set("redirect_uri", REDIRECT);
    u.searchParams.set("scope", "read");
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    const r = await fetch(u);
    const html = await r.text();
    if (!r.ok) { throw new Error(`HTTP ${r.status}: ${html.slice(0, 200)}`); }
    const m = html.match(/name="auth" value="([^"]+)"/);
    if (!m) { throw new Error("no auth blob in the form"); }
    authBlob = m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    pass();
  } catch (e) { fail(e.message); process.exit(1); }

  step("POST /authorize with a wrong passphrase is refused");
  try {
    const body = new URLSearchParams({
      auth: authBlob, passphrase: "definitely-not-it", op_key: OP_KEY, gitea_token: GT_TOKEN,
    });
    const r = await fetch(`${BASE}/authorize`, { method: "POST", body, redirect: "manual" });
    const html = await r.text();
    if (r.status === 302) { throw new Error("a wrong passphrase was accepted"); }
    if (!/passphrase is not right/.test(html)) { throw new Error(`unexpected response: ${html.slice(0, 200)}`); }
    pass();
  } catch (e) { fail(e.message); }

  step("POST /authorize verifies both credentials and issues a code");
  let code;
  try {
    const body = new URLSearchParams({
      auth: authBlob, passphrase: PASS, op_key: OP_KEY, gitea_token: GT_TOKEN,
    });
    const r = await fetch(`${BASE}/authorize`, { method: "POST", body, redirect: "manual" });
    if (r.status !== 302) {
      const html = await r.text();
      const err = (html.match(/class="err">([^<]+)</) || [, html.slice(0, 300)])[1];
      throw new Error(`no redirect (HTTP ${r.status}): ${err}`);
    }
    const loc = new URL(r.headers.get("location"));
    code = loc.searchParams.get("code");
    if (loc.searchParams.get("state") !== state) { throw new Error("state did not round-trip"); }
    if (!code) { throw new Error(`no code in ${loc}`); }
    pass();
  } catch (e) { fail(e.message); process.exit(1); }

  step("POST /token exchanges the code (PKCE S256)");
  let token;
  try {
    const r = await fetch(`${BASE}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier,
      }),
    });
    const j = await r.json();
    if (!r.ok) { throw new Error(`HTTP ${r.status}: ${JSON.stringify(j)}`); }
    token = j.access_token;
    if (!token) { throw new Error("no access_token"); }
    pass(`expires_in=${j.expires_in}`);
  } catch (e) { fail(e.message); process.exit(1); }

  step("POST /token with a wrong code_verifier is refused");
  try {
    const r = await fetch(`${BASE}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: b64url(randomBytes(48)),
      }),
    });
    if (r.ok) { throw new Error("a replayed code with a bad verifier was accepted"); }
    pass(`HTTP ${r.status}`);
  } catch (e) { fail(e.message); }

  // 5. Real MCP traffic.
  const rpc = async (method, params) => {
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    const j = await r.json();
    if (j.error) { throw new Error(`${method}: ${j.error.message}`); }
    return j.result;
  };

  step("initialize");
  try {
    const res = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "selftest", version: "1" } });
    if (!res.protocolVersion) { throw new Error("no protocolVersion"); }
    pass(`${res.serverInfo?.name} speaks ${res.protocolVersion}`);
  } catch (e) { fail(e.message); }

  step("tools/list");
  let tools = [];
  try {
    const res = await rpc("tools/list");
    tools = res.tools || [];
    const noSchema = tools.filter((t) => !t.inputSchema);
    if (noSchema.length) { throw new Error(`tools without inputSchema: ${noSchema.map((t) => t.name)}`); }
    const noAnn = tools.filter((t) => !t.annotations);
    if (noAnn.length) { throw new Error(`tools without annotations: ${noAnn.map((t) => t.name)}`); }
    pass(`${tools.length} tools`);
  } catch (e) { fail(e.message); }

  step("tools/call list_projects (real OpenProject read)");
  try {
    const res = await rpc("tools/call", { name: "list_projects", arguments: {} });
    if (res.isError) { throw new Error(res.content?.[0]?.text || "isError"); }
    if (!res.structuredContent) { throw new Error("no structuredContent"); }
    pass(`${res.structuredContent.length} projects`);
  } catch (e) { fail(e.message); }

  step("tools/call get_me (real Gitea read)");
  try {
    const res = await rpc("tools/call", { name: "get_me", arguments: {} });
    if (res.isError) { throw new Error(res.content?.[0]?.text || "isError"); }
    pass(JSON.stringify(res.structuredContent).slice(0, 60));
  } catch (e) { fail(e.message); }

  step("an unknown tool comes back as a tool error, not a protocol error");
  try {
    const res = await rpc("tools/call", { name: "definitely_not_a_tool", arguments: {} });
    if (!res.isError) { throw new Error("expected isError"); }
    pass();
  } catch (e) { fail(e.message); }

  console.log(`\n${failures ? `${failures} check(s) FAILED` : "All checks passed"}\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(`\nselftest crashed: ${e.message}\n`); process.exit(1); });
