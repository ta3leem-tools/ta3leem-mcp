/**
 * ta3leem remote MCP server: OpenProject + Gitea, read-only, over public HTTPS.
 *
 * This exists so Claude on the hosted surfaces (claude.ai web, mobile, Cowork,
 * Desktop) can reach our PM and code data. Those clients connect from
 * Anthropic's cloud, not from your laptop, so a stdio server cannot serve them.
 *
 * Identity model, which is the whole point of the design:
 *   Anthropic's egress range reaches this Worker. This Worker is its own OAuth
 *   2.1 authorization server. At the consent screen each person pastes their
 *   OWN OpenProject API key and Gitea token, and those land in the grant's
 *   `props`, which the provider encrypts with key material wrapped by the
 *   issued access token. So the stored credential is only decryptable while
 *   that person holds a live token, there is no shared service identity, and
 *   every upstream request is attributed to the real human.
 *
 * The Worker's own secrets hold only a Cloudflare Access SERVICE TOKEN, which
 * gets past the Access edge in front of both upstreams. That is infrastructure
 * reachability, not user identity: what a person can see is still decided by
 * their own API key.
 */

import { OAuthProvider, type OAuthHelpers, type AuthRequest } from "@cloudflare/workers-oauth-provider";
import { handleMcpRequest } from "./mcp";
import { openprojectTools } from "./openproject";
import { giteaTools } from "./gitea";
import { b64, type ToolCtx } from "./types";

interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  OPENPROJECT_URL: string;
  GITEA_URL: string;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
  CF_ACCESS_TOKEN_OPENPROJECT: string;
  CF_ACCESS_TOKEN_GITEA: string;
  ENROLL_PASSPHRASE: string;
}

/** Per-user credentials, encrypted into the grant by the OAuth provider. */
interface Props {
  openprojectKey: string;
  giteaToken: string;
  opUserName: string;
  giteaLogin: string;
}

const ALL_TOOLS = [...openprojectTools, ...giteaTools];

function trimUrl(u: string): string {
  return (u || "").replace(/\/$/, "");
}

/**
 * Cloudflare Access headers for one upstream. Both upstreams sit behind Access,
 * and there are two ways through it.
 *
 * A service token is the right answer: it lasts a year and needs no upkeep. It
 * also needs admin on the Cloudflare account that owns the Access apps, which
 * not everyone has.
 *
 * Failing that, `cloudflared access token` mints a 24h session JWT on a laptop
 * and it can be pushed in here as a secret. It works because the JWT carries no
 * IP binding, but its `aud` is per-application, so OpenProject and Gitea need
 * separate tokens and someone has to refresh them daily. See
 * refresh-access-token.sh.
 */
function cfAccessHeaders(env: Env, app: "openproject" | "gitea"): Record<string, string> {
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    return {
      "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
      "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
    };
  }
  const jwt = app === "openproject" ? env.CF_ACCESS_TOKEN_OPENPROJECT : env.CF_ACCESS_TOKEN_GITEA;
  return jwt ? { "cf-access-token": jwt } : {};
}

// ---- the protected MCP endpoint ----

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as ExecutionContext & { props: Props }).props;
    if (!props?.openprojectKey || !props?.giteaToken) {
      // Reachable only if a grant predates a props shape change. Re-consent fixes it.
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Grant is missing credentials. Remove and re-add the connector." } },
        { status: 500 },
      );
    }

    const toolCtx: ToolCtx = {
      openprojectUrl: trimUrl(env.OPENPROJECT_URL),
      giteaUrl: trimUrl(env.GITEA_URL),
      openprojectKey: props.openprojectKey,
      giteaToken: props.giteaToken,
      openprojectAccessHeaders: cfAccessHeaders(env, "openproject"),
      giteaAccessHeaders: cfAccessHeaders(env, "gitea"),
    };
    return handleMcpRequest(request, ALL_TOOLS, toolCtx);
  },
};

// ---- credential checks, so a broken grant is never stored ----

async function checkOpenProject(env: Env, key: string): Promise<{ id: number; name: string }> {
  const res = await fetch(`${trimUrl(env.OPENPROJECT_URL)}/api/v3/users/me`, {
    method: "GET",
    headers: {
      Authorization: "Basic " + b64("apikey:" + key),
      Accept: "application/json",
      ...cfAccessHeaders(env, "openproject"),
    },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text();
  if (body.trimStart().startsWith("<")) {
    throw new Error("Cloudflare Access blocked the request to OpenProject. The service token is missing or wrong, or the Access policy action is not set to Service Auth.");
  }
  if (!res.ok) {
    throw new Error(`OpenProject rejected that API key (HTTP ${res.status}). Check My Account, Access tokens, API.`);
  }
  const me = JSON.parse(body);
  return { id: me.id, name: me.name || me.login || `user ${me.id}` };
}

async function checkGitea(env: Env, token: string): Promise<{ login: string }> {
  const res = await fetch(`${trimUrl(env.GITEA_URL)}/api/v1/user`, {
    method: "GET",
    headers: {
      Authorization: "token " + token,
      Accept: "application/json",
      ...cfAccessHeaders(env, "gitea"),
    },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text();
  if (body.trimStart().startsWith("<")) {
    throw new Error("Cloudflare Access blocked the request to Gitea. The service token is missing or wrong, or the Access policy action is not set to Service Auth.");
  }
  if (!res.ok) {
    throw new Error(`Gitea rejected that token (HTTP ${res.status}). Check Settings, Applications, Generate Token.`);
  }
  const me = JSON.parse(body);
  return { login: me.login || me.username || "unknown" };
}

// ---- consent screen ----

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function page(title: string, inner: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
 font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
 background:#f6f7f9;color:#16181d}
.card{width:100%;max-width:520px;background:#fff;border:1px solid #e3e6ea;border-radius:14px;padding:28px}
h1{margin:0 0 4px;font-size:19px}
.sub{margin:0 0 20px;color:#5d646e;font-size:13px}
label{display:block;margin:16px 0 6px;font-weight:600;font-size:13px}
.hint{font-weight:400;color:#5d646e;font-size:12px;display:block;margin-top:3px}
input{width:100%;padding:10px 12px;font:inherit;border:1px solid #ccd1d7;border-radius:8px;background:#fff;color:inherit}
input:focus{outline:2px solid #3b6cf0;outline-offset:-1px;border-color:#3b6cf0}
button{width:100%;margin-top:22px;padding:11px;font:inherit;font-weight:600;
 background:#16181d;color:#fff;border:0;border-radius:8px;cursor:pointer}
button:hover{background:#000}
.note{margin-top:18px;padding:12px 14px;background:#f3f5f8;border-radius:8px;font-size:12.5px;color:#41474f}
.err{margin:0 0 18px;padding:12px 14px;background:#fdeeee;border:1px solid #f3c6c6;border-radius:8px;font-size:13px;color:#8a2020}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
a{color:#3b6cf0}
ul{margin:8px 0 0;padding-left:18px}
@media (prefers-color-scheme:dark){
 body{background:#0f1114;color:#e6e8eb}
 .card{background:#171a1f;border-color:#2a2f37}
 input{background:#0f1114;border-color:#343a44;color:#e6e8eb}
 .note{background:#1d2127;color:#aeb5bf}
 .err{background:#2a1414;border-color:#5a2626;color:#f0a9a9}
 .sub,.hint{color:#9aa1ab}
 button{background:#e6e8eb;color:#16181d}
 button:hover{background:#fff}
}
</style></head><body><div class="card">${inner}</div></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function consentForm(auth: AuthRequest, clientName: string, error?: string): Response {
  const blob = btoa(JSON.stringify(auth));
  return page("Connect ta3leem", `
<h1>Connect ta3leem</h1>
<p class="sub">${esc(clientName)} is asking to read OpenProject and Gitea as you.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="POST">
<input type="hidden" name="auth" value="${esc(blob)}">
<label>Team passphrase
<span class="hint">Ask the maintainer. Stops a stranger who finds this URL from enrolling.</span>
<input name="passphrase" type="password" required autocomplete="off"></label>

<label>OpenProject API key
<span class="hint">pm.ta3leem.dev, then My Account, Access tokens, API.</span>
<input name="op_key" type="password" required autocomplete="off"></label>

<label>Gitea access token
<span class="hint">gitea.ta3leem.dev, then Settings, Applications, Generate Token. Read scopes only.</span>
<input name="gitea_token" type="password" required autocomplete="off"></label>

<button type="submit">Verify and connect</button>
</form>
<div class="note">Both credentials are checked against the live APIs before anything is
stored, then encrypted into this grant. They are readable only while your access
token is valid, and they are never shared with anyone else on the team. Every tool
on this server is read-only: nothing can create, edit, comment, merge or approve.</div>`);
}

function landing(env: Env, url: URL): Response {
  const mcpUrl = `${url.origin}/mcp`;
  return page("ta3leem MCP", `
<h1>ta3leem MCP</h1>
<p class="sub">Read-only OpenProject and Gitea for Claude.</p>
<div class="note">Add this as a custom connector in Claude, under Customize then
Connectors then Add custom connector.
<ul>
<li>URL: <code>${esc(mcpUrl)}</code></li>
<li>Authentication: leave the OAuth client fields blank, Claude registers itself</li>
</ul>
You will be asked for the team passphrase and your own two API tokens.
Upstreams: <code>${esc(trimUrl(env.OPENPROJECT_URL))}</code> and <code>${esc(trimUrl(env.GITEA_URL))}</code>.
</div>`);
}

// ---- authorization endpoint (the app side of OAuth) ----

/**
 * Rejects a cross-site form post. Both signals are absent on non-browser
 * clients, which is why absence is allowed rather than treated as hostile.
 */
function isSameOriginPost(request: Request, url: URL): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") { return false; }
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) { return false; }
  return true;
}


const uiHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/authorize" && request.method === "GET") {
      let auth: AuthRequest;
      try {
        auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      } catch (err) {
        return page("Bad request", `<h1>Bad request</h1><p class="sub">${esc(err instanceof Error ? err.message : String(err))}</p>`, 400);
      }
      const client = await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
      return consentForm(auth, client?.clientName || "An MCP client");
    }

    if (url.pathname === "/authorize" && request.method === "POST") {
      // Anyone can self-register a client here, so an attacker can obtain a real
      // consent blob and host a cloned form that posts to this endpoint. The
      // credentials it harvests would be server-validated and immediately usable.
      // A browser sends Origin on cross-origin form posts, so refusing a
      // mismatched one forces a full server-side relay instead of a static clone.
      // Non-browser clients send no Origin and are unaffected.
      if (!isSameOriginPost(request, url)) {
        return page("Blocked", `<h1>Blocked</h1><p class="sub">This form was submitted from another site. Start again from Claude.</p>`, 403);
      }
      const form = await request.formData();
      let auth: AuthRequest;
      try {
        auth = JSON.parse(atob(String(form.get("auth") || "")));
      } catch {
        return page("Bad request", `<h1>Bad request</h1><p class="sub">The authorization request was malformed. Start again from Claude.</p>`, 400);
      }
      const client = await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
      const clientName = client?.clientName || "An MCP client";

      const passphrase = String(form.get("passphrase") || "");
      const opKey = String(form.get("op_key") || "").trim();
      const giteaToken = String(form.get("gitea_token") || "").trim();

      if (!env.ENROLL_PASSPHRASE || passphrase !== env.ENROLL_PASSPHRASE) {
        return consentForm(auth, clientName, "That passphrase is not right.");
      }

      let op: { id: number; name: string };
      let gt: { login: string };
      try {
        // Sequential, not parallel: a wrong OpenProject key is the common case
        // and its message is the more useful one to show first.
        op = await checkOpenProject(env, opKey);
        gt = await checkGitea(env, giteaToken);
      } catch (err) {
        return consentForm(auth, clientName, err instanceof Error ? err.message : String(err));
      }

      const props: Props = {
        openprojectKey: opKey,
        giteaToken,
        opUserName: op.name,
        giteaLogin: gt.login,
      };

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: auth,
        // OpenProject id is the stable identity, so re-consenting replaces the
        // old grant for this person instead of piling up duplicates.
        userId: `op:${op.id}`,
        metadata: { name: op.name, gitea: gt.login },
        scope: auth.scope,
        props,
      });
      return Response.redirect(redirectTo, 302);
    }

    if (url.pathname === "/" || url.pathname === "") {
      return landing(env, url);
    }

    return new Response("Not found", { status: 404 });
  },
};

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler: uiHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  // Claude registers itself dynamically unless an admin supplies a client id,
  // so DCR has to be on for the zero-configuration path to work.
  clientRegistrationEndpoint: "/register",
  // CIMD is what Claude picks in preference to DCR, and preferring it matters:
  // DCR registers a brand new client on every fresh connection, so the KV fills
  // with throwaway clients. Needs the global_fetch_strictly_public flag.
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: ["read"],
});
