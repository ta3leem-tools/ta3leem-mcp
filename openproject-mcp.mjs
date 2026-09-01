#!/usr/bin/env node
/**
 * OpenProject MCP server — READ-ONLY, zero npm dependencies.
 *
 * Exposes 6 tools over MCP stdio for Claude Code (and any MCP client):
 *   - list_projects
 *   - search_work_packages
 *   - get_work_package
 *   - get_work_package_activities      (comments + journal)
 *   - get_work_package_attachments     (list files/images with download URLs)
 *   - download_attachment              (fetch binary → /tmp/op-attachment-{id}.ext)
 *
 * Every request is HTTP GET. There is no code path that can create, update,
 * comment, or mark anything read in OpenProject.
 *
 * Auth:
 *   OPENPROJECT_URL      e.g. https://pm.ta3leem.dev
 *   OPENPROJECT_API_KEY  My Account -> Access tokens -> API
 *
 * Cloudflare Access (pm.ta3leem.dev sits behind CF Zero Trust):
 *   CF_USE_CLOUDFLARED=1  -> fetches a session JWT via `cloudflared access token`
 *                            (requires one-time `cloudflared access login <url>`,
 *                            session lasts ~24h). Token cached 5 min in-process.
 */

import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

const OP_URL = (process.env.OPENPROJECT_URL || "").replace(/\/$/, "");
const API_KEY = process.env.OPENPROJECT_API_KEY || "";
if (!OP_URL || !API_KEY) {
  console.error("OPENPROJECT_URL and OPENPROJECT_API_KEY are required");
  process.exit(1);
}

let cfToken = null;
let cfTokenAt = 0;
function cfHeaders() {
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    return {
      "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
      "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
    };
  }
  if (process.env.CF_USE_CLOUDFLARED === "1") {
    const now = Date.now();
    if (!cfToken || now - cfTokenAt > 5 * 60 * 1000) {
      try {
        cfToken = execFileSync("cloudflared", ["access", "token", `--app=${OP_URL}`], {
          encoding: "utf8", timeout: 15000,
        }).trim();
        cfTokenAt = now;
      } catch {
        throw new Error(
          `Cloudflare Access session expired. Run: cloudflared access login ${OP_URL}`
        );
      }
    }
    return { "cf-access-token": cfToken };
  }
  return {};
}

async function opGet(path, params = {}) {
  const url = new URL(OP_URL + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: "GET", // read-only by construction
    headers: {
      Authorization: "Basic " + Buffer.from("apikey:" + API_KEY).toString("base64"),
      Accept: "application/json",
      ...cfHeaders(),
    },
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`OpenProject API ${res.status}: ${body.slice(0, 300)}`);
  if (body.trimStart().startsWith("<")) {
    // Cloudflare Access served its login page instead of the API
    throw new Error(
      `Cloudflare Access blocked the request (got HTML, not JSON). ` +
      `Run: cloudflared access login ${OP_URL} — and ensure CF_USE_CLOUDFLARED=1 is set.`
    );
  }
  return JSON.parse(body);
}

/**
 * Activity _links.user carries only an href, never a title, so an activity's
 * author is unresolvable without a second lookup. Report attribution depends
 * on it: "who moved this ticket today" is the difference between counting a
 * ticket as your work and correctly excluding a QA status flip.
 */
const userNameCache = new Map();
async function resolveUser(href) {
  const id = href?.split("/").pop();
  if (!id) { return null; }
  if (!userNameCache.has(id)) {
    try {
      const u = await opGet(`/api/v3/users/${id}`);
      userNameCache.set(id, u.name || u.login || `user ${id}`);
    } catch {
      userNameCache.set(id, `user ${id}`);
    }
  }
  return { id: Number(id), name: userNameCache.get(id) };
}

/**
 * Paginating opGet, for the endpoints that really do page.
 * /principals caps at 100 per page and silently drops the rest, so a broad
 * name search loses matches without any signal. /projects has the same shape.
 * Activities and attachments are NOT paginated and must not use this.
 */
async function opGetAllPages(path, params = {}) {
  const pageSize = 100;
  const out = [];
  let offset = 1;
  for (;;) {
    const data = await opGet(path, { ...params, pageSize, offset });
    const batch = data._embedded?.elements ?? [];
    out.push(...batch);
    const total = data.total ?? out.length;
    if (batch.length === 0 || out.length >= total || out.length >= 5000) { break; }
    offset += 1;
  }
  return out;
}


// ---- tool implementations (compact output — trim HAL noise) ----

// API returns UTC; team works in IST — convert every timestamp.
function ist(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).replace(",", "") + " IST";
}

function wpSummary(wp) {
  return {
    id: wp.id,
    subject: wp.subject,
    type: wp._links?.type?.title,
    status: wp._links?.status?.title,
    assignee: wp._links?.assignee?.title || null,
    author: wp._links?.author?.title,
    project: wp._links?.project?.title,
    priority: wp._links?.priority?.title,
    percentDone: wp.percentageDone,
    createdAt: ist(wp.createdAt),
    updatedAt: ist(wp.updatedAt),
    parent: wpRef(wp._links?.parent),
    description: wp.description?.raw || null,
  };
}

/** {id, subject} from a HAL link, or null. Costs no extra request. */
function wpRef(link) {
  const id = link?.href?.split("/").pop();
  return id ? { id: Number(id), subject: link.title } : null;
}

/**
 * Children and relations of one work package. Two extra GETs, so this runs for
 * get_work_package only, never per row in a search result.
 */
async function wpLinks(id) {
  const kids = await opGet("/api/v3/work_packages", {
    filters: JSON.stringify([{ parent: { operator: "=", values: [String(id)] } }]),
    pageSize: 100,
  });
  const rel = await opGet(`/api/v3/work_packages/${id}/relations`);
  return {
    children: (kids._embedded?.elements ?? []).map((c) => ({
      id: c.id, subject: c.subject, status: c._links?.status?.title,
    })),
    relations: (rel._embedded?.elements ?? []).map((r) => {
      // from/to order is not fixed, so report whichever end is not this ticket.
      const from = Number(r._links?.from?.href?.split("/").pop());
      const to = Number(r._links?.to?.href?.split("/").pop());
      const other = from === Number(id) ? to : from;
      return { type: r.type, workPackage: other, description: r.description || null };
    }),
  };
}

const TOOLS = {
  find_user: {
    description: "Find OpenProject users/groups by (partial) name. Returns id + name.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Partial name, e.g. 'burhan'" } },
      required: ["name"],
      additionalProperties: false,
    },
    async run(a) {
      const filters = JSON.stringify([{ name: { operator: "~", values: [a.name] } }]);
      const elements = await opGetAllPages("/api/v3/principals", { filters });
      return elements.map((p) => ({ id: p.id, name: p.name, type: p._type }));
    },
  },
  list_projects: {
    description: "List visible OpenProject projects (id, identifier, name).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const elements = await opGetAllPages("/api/v3/projects");
      return elements.map((p) => ({
        id: p.id, identifier: p.identifier, name: p.name, active: p.active,
      }));
    },
  },
  search_work_packages: {
    description:
      "Search work packages by free-text subject and/or filters. Returns newest first.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text match on subject" },
        project_id: { type: "number", description: "Limit to one project id" },
        status: { type: "string", enum: ["open", "closed", "all"], description: "Default open" },
        assignee_me: { type: "boolean", description: "Only work packages assigned to me" },
        assignee_name: { type: "string", description: "Assignee by (partial) name, e.g. 'burhan' — resolved via principals lookup" },
        updated_since: { type: "string", description: "Only WPs updated on/after this date (YYYY-MM-DD)" },
        updated_until: { type: "string", description: "Only WPs updated on/before this date (YYYY-MM-DD, inclusive). Default: today" },
        page_size: { type: "number", description: "Max results, default 20" },
        sort: { type: "string", enum: ["newest", "oldest"], description: "Sort by createdAt. Default: newest" },
        offset: { type: "number", description: "1-based page number for pagination (use with page_size to page past the first batch)" },
      },
      additionalProperties: false,
    },
    async run(a) {
      const filters = [];
      if (a.query) filters.push({ subject: { operator: "~", values: [a.query] } });
      const status = a.status || "open";
      if (status !== "all") filters.push({ status: { operator: status === "open" ? "o" : "c", values: [] } });
      if (a.assignee_me) filters.push({ assignee: { operator: "=", values: ["me"] } });
      if (a.assignee_name) {
        const pf = JSON.stringify([{ name: { operator: "~", values: [a.assignee_name] } }]);
        const found = (await opGet("/api/v3/principals", { filters: pf }))._embedded.elements;
        if (!found.length) throw new Error(`No OpenProject user matches "${a.assignee_name}" — try find_user`);
        filters.push({ assignee: { operator: "=", values: [String(found[0].id)] } });
      }
      if (a.updated_since) {
        // Server-TZ trap: "<>d" with today's date as upper bound EXCLUDES today's
        // updates. Always push the upper bound one day past the inclusive end date.
        const end = a.updated_until || ist(new Date().toISOString()).slice(0, 10).split("/").reverse().join("-");
        const d = new Date(end + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        const upper = d.toISOString().slice(0, 10);
        filters.push({ updatedAt: { operator: "<>d", values: [a.updated_since, upper] } });
      }
      const path = a.project_id
        ? `/api/v3/projects/${a.project_id}/work_packages`
        : "/api/v3/work_packages";
      const data = await opGet(path, {
        filters: JSON.stringify(filters),
        sortBy: JSON.stringify(a.sort ? [["createdAt", a.sort === "oldest" ? "asc" : "desc"]] : [["updatedAt", "desc"]]),
        pageSize: a.page_size || 20,
        offset: a.offset || 1,
      });
      return { total: data.total, items: data._embedded.elements.map(wpSummary) };
    },
  },
  get_work_package: {
    description: "Get one work package by id: full description, plus its parent, child tickets and related tickets.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
      additionalProperties: false,
    },
    async run(a) {
      const [wp, links] = await Promise.all([
        opGet(`/api/v3/work_packages/${a.id}`),
        wpLinks(a.id),
      ]);
      return { ...wpSummary(wp), ...links };
    },
  },
  get_work_package_activities: {
    description: "Get comments + change journal for a work package, oldest first. Returns the whole journal. On a very long ticket use limit+offset to pull it in chunks.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        limit: { type: "number", description: "Max activities to return. Omit for all. Use with offset to walk a very long ticket in chunks when the full journal overflows the tool-output limit." },
        offset: { type: "number", description: "0-based index of the first activity to return. Default 0." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async run(a) {
      const data = await opGet(`/api/v3/work_packages/${a.id}/activities`);
      const from = a.offset || 0;
      const all = data._embedded.elements;
      const slice = a.limit ? all.slice(from, from + a.limit) : all.slice(from);
      const authors = await Promise.all(slice.map((act) => resolveUser(act._links?.user?.href)));
      return slice.map((act, i) => ({
        version: act.version,
        user: authors[i]?.name ?? null,
        userId: authors[i]?.id ?? null,
        createdAt: ist(act.createdAt),
        comment: act.comment?.raw || null,
        changes: (act.details || []).map((d) => d.raw),
      }));
    },
  },

  get_work_package_attachments: {
    description: "List attachments (files, images) for a work package. Returns id, filename, contentType, size, createdAt, author, and downloadUrl for each attachment.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Work package ID" } },
      required: ["id"],
      additionalProperties: false,
    },
    async run(a) {
      const data = await opGet(`/api/v3/work_packages/${a.id}/attachments`);
      return data._embedded.elements.map((att) => ({
        id: att.id,
        fileName: att.fileName,
        fileSize: att.fileSize,
        contentType: att.contentType,
        createdAt: ist(att.createdAt),
        author: att._links?.author?.title || null,
        downloadUrl: att._links?.staticDownloadLocation?.href || att._links?.downloadLocation?.href || null,
      }));
    },
  },

  download_attachment: {
    description: "Download an attachment by ID and save it to /tmp. Returns the local file path so Claude Code can Read/view it as an image.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Attachment ID from get_work_package_attachments" },
        filename: { type: "string", description: "Original filename (used for extension)" },
      },
      required: ["id", "filename"],
      additionalProperties: false,
    },
    async run(a) {
      const att = await opGet(`/api/v3/attachments/${a.id}`);
      const downloadUrl = att._links?.staticDownloadLocation?.href || att._links?.downloadLocation?.href;
      if (!downloadUrl) throw new Error("No download URL found for attachment " + a.id);

      // Relative paths come from OpenProject (e.g. /api/v3/attachments/123/content) — make absolute.
      const absoluteUrl = downloadUrl.startsWith("/") ? OP_URL + downloadUrl : downloadUrl;
      const isSameHost = absoluteUrl.startsWith(OP_URL);
      const headers = isSameHost
        ? { Authorization: "Basic " + Buffer.from("apikey:" + API_KEY).toString("base64"), ...cfHeaders() }
        : {};

      const res = await fetch(absoluteUrl, {
        headers,
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Download failed ${res.status}: ${body.slice(0, 300)}`);
      }

      const ext = a.filename.includes(".") ? a.filename.split(".").pop().toLowerCase() : "bin";
      const tmpPath = `/tmp/op-attachment-${a.id}.${ext}`;

      const { writeFile } = await import("node:fs/promises");
      const buffer = Buffer.from(await res.arrayBuffer());
      await writeFile(tmpPath, buffer);

      return { path: tmpPath, size: buffer.length, contentType: att.contentType };
    },
  },
};

// ---- minimal MCP stdio transport (newline-delimited JSON-RPC 2.0) ----

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  line = line.trim();
  if (!line) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (req.id === undefined) return; // notification — nothing to answer

  try {
    if (req.method === "initialize") {
      send({
        jsonrpc: "2.0", id: req.id,
        result: {
          protocolVersion: req.params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "openproject-readonly", version: "1.0.0" },
        },
      });
    } else if (req.method === "tools/list") {
      send({
        jsonrpc: "2.0", id: req.id,
        result: {
          tools: Object.entries(TOOLS).map(([name, t]) => ({
            name, description: t.description, inputSchema: t.inputSchema,
          })),
        },
      });
    } else if (req.method === "tools/call") {
      const tool = TOOLS[req.params?.name];
      if (!tool) throw new Error(`Unknown tool: ${req.params?.name}`);
      const result = await tool.run(req.params?.arguments || {});
      send({
        jsonrpc: "2.0", id: req.id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    } else if (req.method === "ping") {
      send({ jsonrpc: "2.0", id: req.id, result: {} });
    } else {
      send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } });
    }
  } catch (err) {
    if (req.method === "tools/call") {
      send({
        jsonrpc: "2.0", id: req.id,
        result: { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true },
      });
    } else {
      send({ jsonrpc: "2.0", id: req.id, error: { code: -32603, message: err.message } });
    }
  }
});
