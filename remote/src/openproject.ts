/**
 * OpenProject tools, READ-ONLY. Port of the stdio server for the Workers runtime.
 *
 * Every request is an HTTP GET, so there is no code path that can create,
 * update, comment or mark anything read in OpenProject. The per-user API key
 * arrives via ToolCtx from the decrypted OAuth grant, and the Cloudflare Access
 * service-token headers ride along on every call because pm.ta3leem.dev sits
 * behind Access.
 */

import { type Tool, type ToolCtx, ist, b64 } from "./types";

async function opGet(
  ctx: ToolCtx,
  path: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  const url = new URL(ctx.openprojectUrl + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") { url.searchParams.set(k, String(v)); }
  }
  const res = await fetch(url.toString(), {
    method: "GET", // read-only by construction
    headers: {
      Authorization: "Basic " + b64("apikey:" + ctx.openprojectKey),
      Accept: "application/json",
      ...ctx.openprojectAccessHeaders,
    },
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`OpenProject API ${res.status}: ${body.slice(0, 300)}`);
  }
  if (body.trimStart().startsWith("<")) {
    // Access served its login page instead of the API.
    throw new Error(
      "Cloudflare Access blocked the request (got HTML, not JSON). The service " +
      "token is missing or wrong, or the Access policy action is not set to Service Auth.",
    );
  }
  return JSON.parse(body);
}

/**
 * Activity _links.user carries only an href, never a title, so an activity's
 * author is unresolvable without a second lookup. The cache lives on ctx, one
 * per request, never at module scope. Report attribution depends on
 * it: "who moved this ticket today" is the difference between counting a ticket
 * as your own work and correctly excluding a QA status flip.
 */
async function resolveUser(
  ctx: ToolCtx,
  href: string | undefined,
): Promise<{ id: number; name: string } | null> {
  const id = href?.split("/").pop();
  if (!id) { return null; }
  if (!ctx.userNames.has(id)) {
    try {
      const u = await opGet(ctx, `/api/v3/users/${id}`);
      ctx.userNames.set(id, u.name || u.login || `user ${id}`);
    } catch {
      ctx.userNames.set(id, `user ${id}`);
    }
  }
  return { id: Number(id), name: ctx.userNames.get(id) as string };
}

/**
 * Paginating opGet, for the endpoints that really do page. /principals caps at
 * 100 per page and silently drops the rest, so a broad name search loses
 * matches with no signal. /projects has the same shape. Activities and
 * attachments are NOT paginated and must not use this.
 */
async function opGetAllPages(
  ctx: ToolCtx,
  path: string,
  params: Record<string, unknown> = {},
): Promise<any[]> {
  const pageSize = 100;
  const out: any[] = [];
  let offset = 1;
  for (;;) {
    const data = await opGet(ctx, path, { ...params, pageSize, offset });
    const batch = data._embedded?.elements ?? [];
    out.push(...batch);
    const total = data.total ?? out.length;
    if (batch.length === 0 || out.length >= total || out.length >= 5000) { break; }
    offset += 1;
  }
  return out;
}

/** {id, subject} from a HAL link, or null. Costs no extra request. */
function wpRef(link: any): { id: number; subject: string } | null {
  const id = link?.href?.split("/").pop();
  return id ? { id: Number(id), subject: link.title } : null;
}

function wpSummary(wp: any): Record<string, unknown> {
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

/**
 * Children and relations of one work package. Two extra GETs, so this runs for
 * get_work_package only, never per row in a search result.
 */
async function wpLinks(ctx: ToolCtx, id: number): Promise<Record<string, unknown>> {
  const kids = await opGet(ctx, "/api/v3/work_packages", {
    filters: JSON.stringify([{ parent: { operator: "=", values: [String(id)] } }]),
    pageSize: 100,
  });
  const rel = await opGet(ctx, `/api/v3/work_packages/${id}/relations`);
  return {
    children: (kids._embedded?.elements ?? []).map((c: any) => ({
      id: c.id, subject: c.subject, status: c._links?.status?.title,
    })),
    relations: (rel._embedded?.elements ?? []).map((r: any) => {
      // from/to order is not fixed, so report whichever end is not this ticket.
      const from = Number(r._links?.from?.href?.split("/").pop());
      const to = Number(r._links?.to?.href?.split("/").pop());
      const other = from === Number(id) ? to : from;
      return { type: r.type, workPackage: other, description: r.description || null };
    }),
  };
}

/** True only when both URLs share scheme, host and port. Prefix tests do not. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** btoa cannot take a whole megabyte at once, so walk the bytes in chunks. */
function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

export const openprojectTools: Tool[] = [
  {
    name: "find_user",
    title: "Find OpenProject User",
    description: "Find OpenProject users/groups by (partial) name. Returns id + name.",
    outputSchema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          name: { type: "string" },
          type: { type: "string", description: "User or Group" },
        },
        required: ["id", "name"],
      },
    },
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Partial name, e.g. 'burhan'" } },
      required: ["name"],
      additionalProperties: false,
    },
    async run(a, ctx) {
      const filters = JSON.stringify([{ name: { operator: "~", values: [a.name] } }]);
      const elements = await opGetAllPages(ctx, "/api/v3/principals", { filters });
      return elements.map((p: any) => ({ id: p.id, name: p.name, type: p._type }));
    },
  },

  {
    name: "list_projects",
    title: "List Projects",
    description: "List visible OpenProject projects (id, identifier, name).",
    outputSchema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          identifier: { type: "string" },
          name: { type: "string" },
          active: { type: "boolean" },
        },
        required: ["id", "name"],
      },
    },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(_a, ctx) {
      const elements = await opGetAllPages(ctx, "/api/v3/projects");
      return elements.map((p: any) => ({
        id: p.id, identifier: p.identifier, name: p.name, active: p.active,
      }));
    },
  },

  {
    name: "search_work_packages",
    title: "Search Tickets",
    description: "Search work packages by free-text subject and/or filters. Returns newest first.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text match on subject" },
        project_id: { type: "number", description: "Limit to one project id" },
        status: { type: "string", enum: ["open", "closed", "all"], description: "Default open" },
        assignee_me: { type: "boolean", description: "Only work packages assigned to me" },
        assignee_name: { type: "string", description: "Assignee by (partial) name, e.g. 'burhan', resolved via principals lookup" },
        updated_since: { type: "string", description: "Only WPs updated on/after this date (YYYY-MM-DD)" },
        updated_until: { type: "string", description: "Only WPs updated on/before this date (YYYY-MM-DD, inclusive). Default: today" },
        page_size: { type: "number", description: "Max results, default 20" },
        sort: { type: "string", enum: ["newest", "oldest"], description: "Sort by createdAt. Default: newest" },
        offset: { type: "number", description: "1-based page number for pagination (use with page_size to page past the first batch)" },
      },
      additionalProperties: false,
    },
    async run(a, ctx) {
      const filters: unknown[] = [];
      if (a.query) { filters.push({ subject: { operator: "~", values: [a.query] } }); }
      const status = a.status || "open";
      if (status !== "all") {
        filters.push({ status: { operator: status === "open" ? "o" : "c", values: [] } });
      }
      if (a.assignee_me) { filters.push({ assignee: { operator: "=", values: ["me"] } }); }
      if (a.assignee_name) {
        const pf = JSON.stringify([{ name: { operator: "~", values: [a.assignee_name] } }]);
        const found = (await opGet(ctx, "/api/v3/principals", { filters: pf }))._embedded.elements;
        if (!found.length) {
          throw new Error(`No OpenProject user matches "${a.assignee_name}", try find_user`);
        }
        filters.push({ assignee: { operator: "=", values: [String(found[0].id)] } });
      }
      if (a.updated_since) {
        // Server-TZ trap: "<>d" with today's date as the upper bound EXCLUDES
        // today's updates. Always push the upper bound one day past the
        // inclusive end date.
        const end = a.updated_until
          || (ist(new Date().toISOString()) as string).slice(0, 10).split("/").reverse().join("-");
        const d = new Date(end + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        const upper = d.toISOString().slice(0, 10);
        filters.push({ updatedAt: { operator: "<>d", values: [a.updated_since, upper] } });
      }
      const path = a.project_id
        ? `/api/v3/projects/${a.project_id}/work_packages`
        : "/api/v3/work_packages";
      const data = await opGet(ctx, path, {
        filters: JSON.stringify(filters),
        sortBy: JSON.stringify(
          a.sort ? [["createdAt", a.sort === "oldest" ? "asc" : "desc"]] : [["updatedAt", "desc"]],
        ),
        pageSize: a.page_size || 20,
        offset: a.offset || 1,
      });
      return { total: data.total, items: data._embedded.elements.map(wpSummary) };
    },
  },

  {
    name: "get_work_package",
    title: "Read Ticket",
    description: "Get one work package by id: full description, plus its parent, child tickets and related tickets.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
      additionalProperties: false,
    },
    async run(a, ctx) {
      const [wp, links] = await Promise.all([
        opGet(ctx, `/api/v3/work_packages/${a.id}`),
        wpLinks(ctx, a.id),
      ]);
      return { ...wpSummary(wp), ...links };
    },
  },

  {
    name: "get_work_package_activities",
    title: "Read Ticket History",
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
    async run(a, ctx) {
      const data = await opGet(ctx, `/api/v3/work_packages/${a.id}/activities`);
      const from = a.offset || 0;
      const all: any[] = data._embedded.elements;
      const slice = a.limit ? all.slice(from, from + a.limit) : all.slice(from);
      const authors = await Promise.all(slice.map((act) => resolveUser(ctx, act._links?.user?.href)));
      return slice.map((act, i) => ({
        version: act.version,
        user: authors[i]?.name ?? null,
        userId: authors[i]?.id ?? null,
        createdAt: ist(act.createdAt),
        comment: act.comment?.raw || null,
        changes: (act.details || []).map((d: any) => d.raw),
      }));
    },
  },

  {
    name: "get_work_package_attachments",
    title: "List Ticket Attachments",
    description: "List attachments (files, images) for a work package. Returns id, filename, contentType, size, createdAt, author, and downloadUrl for each attachment.",
    outputSchema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          fileName: { type: "string" },
          fileSize: { type: "number" },
          contentType: { type: "string" },
          createdAt: { type: ["string", "null"], description: "DD/MM/YYYY HH:mm IST" },
          author: { type: ["string", "null"] },
          downloadUrl: { type: ["string", "null"] },
        },
        required: ["id", "fileName"],
      },
    },
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Work package ID" } },
      required: ["id"],
      additionalProperties: false,
    },
    async run(a, ctx) {
      const data = await opGet(ctx, `/api/v3/work_packages/${a.id}/attachments`);
      return data._embedded.elements.map((att: any) => ({
        id: att.id,
        fileName: att.fileName,
        fileSize: att.fileSize,
        contentType: att.contentType,
        createdAt: ist(att.createdAt),
        author: att._links?.author?.title || null,
        downloadUrl: att._links?.staticDownloadLocation?.href
          || att._links?.downloadLocation?.href || null,
      }));
    },
  },

  {
    name: "download_attachment",
    title: "Download Attachment",
    // A Worker has no /tmp, so unlike the stdio server this writes nothing and
    // hands the bytes back inline. That makes it a plain read.
    description: "Fetch an attachment by ID and return it inline as base64 (no local file is written). Use it to look at a screenshot or PDF on a ticket. Capped at 4 MB; above that, open the downloadUrl from get_work_package_attachments instead.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Attachment ID from get_work_package_attachments" },
        filename: { type: "string", description: "Original filename (used for the extension)" },
      },
      required: ["id", "filename"],
      additionalProperties: false,
    },
    async run(a, ctx) {
      const att = await opGet(ctx, `/api/v3/attachments/${a.id}`);
      const downloadUrl = att._links?.staticDownloadLocation?.href
        || att._links?.downloadLocation?.href;
      if (!downloadUrl) { throw new Error("No download URL found for attachment " + a.id); }

      // Relative paths come from OpenProject (e.g. /api/v3/attachments/123/content).
      const absoluteUrl = downloadUrl.startsWith("/") ? ctx.openprojectUrl + downloadUrl : downloadUrl;

      // Compare parsed origins, never a string prefix. A prefix test says yes to
      // pm.ta3leem.devil.com, pm.ta3leem.dev.evil.com and pm.ta3leem.dev@evil.com,
      // any of which would receive this user's API key and the Access token.
      // Genuine external object storage correctly falls outside and gets no headers.
      const isSameHost = sameOrigin(absoluteUrl, ctx.openprojectUrl);
      const headers: Record<string, string> = isSameHost
        ? {
            Authorization: "Basic " + b64("apikey:" + ctx.openprojectKey),
            ...ctx.openprojectAccessHeaders,
          }
        : {};

      const res = await fetch(absoluteUrl, { method: "GET", headers, signal: AbortSignal.timeout(60000) });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Download failed ${res.status}: ${body.slice(0, 300)}`);
      }

      const buf = await res.arrayBuffer();
      const MAX = 4 * 1024 * 1024;
      if (buf.byteLength > MAX) {
        throw new Error(
          `Attachment ${a.id} is ${buf.byteLength} bytes, over the 4 MB inline cap. ` +
          "Open its downloadUrl from get_work_package_attachments instead.",
        );
      }
      const ext = a.filename.includes(".")
        ? String(a.filename.split(".").pop()).toLowerCase()
        : "bin";
      return {
        id: a.id,
        fileName: a.filename,
        extension: ext,
        contentType: att.contentType,
        size: buf.byteLength,
        base64: bytesToBase64(new Uint8Array(buf)),
      };
    },
  },
];
