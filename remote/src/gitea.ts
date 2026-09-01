/**
 * Read-only reimplementation of the 13 gitea-mcp (Go binary) tools as direct
 * calls to the Gitea REST API v1, for the Cloudflare Workers runtime (the Go
 * binary cannot run there).
 */

import { READ_ONLY, ToolCtx, Tool, ist } from "./types";

interface GiteaUser {
  login: string;
  full_name?: string;
  email?: string;
}

interface GiteaLabel {
  name: string;
}

interface GiteaMilestone {
  title: string;
}

interface GiteaRepo {
  full_name: string;
  private: boolean;
  fork: boolean;
  html_url: string;
  description?: string;
  default_branch?: string;
  stars_count?: number;
  updated_at?: string;
}

interface GiteaPull {
  number: number;
  title: string;
  state: string;
  user?: GiteaUser;
  base?: { ref: string };
  head?: { ref: string };
  html_url: string;
  mergeable?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  comments?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  body?: string;
  labels?: GiteaLabel[];
  milestone?: GiteaMilestone;
}

interface GiteaIssue {
  number: number;
  title: string;
  state: string;
  user?: GiteaUser;
  html_url: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  comments?: number;
  body?: string;
  labels?: GiteaLabel[];
  milestone?: GiteaMilestone;
  pull_request?: unknown;
}

interface GiteaComment {
  id: number;
  user?: GiteaUser;
  body: string;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}

interface GiteaChangedFile {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
  changes?: number;
}

interface GiteaBranch {
  name: string;
  commit?: { id: string; message?: string; timestamp?: string };
  protected?: boolean;
}

interface GiteaCommitListItem {
  sha: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string };
    committer?: { name?: string; email?: string; date?: string };
  };
  author?: GiteaUser | null;
  stats?: { additions?: number; deletions?: number; total?: number };
}

interface GiteaGitCommit {
  sha: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string };
    committer?: { name?: string; email?: string; date?: string };
  };
  parents?: { sha: string }[];
  stats?: { additions?: number; deletions?: number; total?: number };
  files?: GiteaChangedFile[];
}

interface GiteaContentsEntry {
  name: string;
  path: string;
  sha: string;
  type: string;
  size?: number;
  content?: string;
  encoding?: string;
  html_url?: string;
  download_url?: string;
}

interface GiteaNotificationThread {
  id: number;
  unread: boolean;
  pinned: boolean;
  updated_at?: string;
  url?: string;
  repository?: { full_name?: string };
  subject?: {
    title?: string;
    url?: string;
    html_url?: string;
    type?: string;
    state?: string;
  };
}

/** Single fetch helper: hardcodes GET so no code path in this file can mutate anything upstream. */
async function giteaGet(ctx: ToolCtx, path: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
  const url = new URL(ctx.giteaUrl + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: "token " + ctx.giteaToken,
      Accept: "application/json",
      ...ctx.giteaAccessHeaders,
    },
    signal: AbortSignal.timeout(30000),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    // Cloudflare Access returns its own HTML login/error page (starts with "<"), not JSON,
    // when the service token headers are missing or the Access policy isn't Service Auth.
    if (bodyText.trimStart().startsWith("<")) {
      throw new Error(
        "Cloudflare Access blocked the request to Gitea. The service token is missing, wrong, or the Access policy action is not set to Service Auth."
      );
    }
    throw new Error(`Gitea API ${res.status}: ${bodyText.slice(0, 300)}`);
  }
  return bodyText.length ? JSON.parse(bodyText) : null;
}

/**
 * A raw diff is the one genuinely unbounded body here: a PR touching hundreds
 * of files can run to megabytes, and a Worker has 128 MB total. Read it in
 * chunks and stop at the cap rather than buffering whatever arrives.
 */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** Fetch a non-JSON text response (diff/patch) with the same auth and error handling as giteaGet. */
async function giteaGetText(ctx: ToolCtx, path: string): Promise<string> {
  const res = await fetch(ctx.giteaUrl + path, {
    method: "GET",
    headers: {
      Authorization: "token " + ctx.giteaToken,
      Accept: "text/plain",
      ...ctx.giteaAccessHeaders,
    },
    signal: AbortSignal.timeout(30000),
  });
  const bodyText = await readCapped(res);
  if (!res.ok) {
    if (bodyText.trimStart().startsWith("<")) {
      throw new Error(
        "Cloudflare Access blocked the request to Gitea. The service token is missing, wrong, or the Access policy action is not set to Service Auth."
      );
    }
    throw new Error(`Gitea API ${res.status}: ${bodyText.slice(0, 300)}`);
  }
  return bodyText;
}

/** Reads at most MAX_TEXT_BYTES, appending a marker when the body was longer. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) { return ""; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) { break; }
    bytes += value.byteLength;
    if (bytes > MAX_TEXT_BYTES) {
      truncated = true;
      await reader.cancel();
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  if (truncated) {
    out += `\n\n[truncated at ${MAX_TEXT_BYTES} bytes. Page through list_files with an explicit per-page instead of reading the whole diff.]`;
  }
  return out;
}

/**
 * Every paginated tool below passes page/limit straight through to Gitea and reports
 * hasMore instead of returning a bare array. This is load-bearing: the upstream Go
 * binary silently capped file lists at 30 and diffs at 65/299 files with no warning,
 * so a caller that trusts an unpaginated array here would silently miss data again.
 */
function pageInfo(page: number, limit: number, returned: number): { page: number; limit: number; returned: number; hasMore: boolean } {
  return { page, limit, returned, hasMore: returned === limit };
}

function trimUser(u: GiteaUser | null | undefined): { login: string } | null {
  return u ? { login: u.login } : null;
}

function trimPull(p: GiteaPull) {
  return {
    number: p.number,
    title: p.title,
    state: p.state,
    author: trimUser(p.user),
    base: p.base?.ref ?? null,
    head: p.head?.ref ?? null,
    url: p.html_url,
    mergeable: p.mergeable ?? null,
    merged: p.merged ?? false,
    merged_at: ist(p.merged_at),
    created_at: ist(p.created_at),
    updated_at: ist(p.updated_at),
    closed_at: ist(p.closed_at),
    comments: p.comments ?? 0,
    additions: p.additions ?? null,
    deletions: p.deletions ?? null,
    changed_files: p.changed_files ?? null,
    labels: (p.labels ?? []).map((l) => l.name),
    milestone: p.milestone?.title ?? null,
  };
}

function trimIssue(i: GiteaIssue) {
  return {
    number: i.number,
    title: i.title,
    state: i.state,
    author: trimUser(i.user),
    url: i.html_url,
    created_at: ist(i.created_at),
    updated_at: ist(i.updated_at),
    closed_at: ist(i.closed_at),
    comments: i.comments ?? 0,
    labels: (i.labels ?? []).map((l) => l.name),
    milestone: i.milestone?.title ?? null,
    is_pull_request: i.pull_request != null,
  };
}

function trimComment(c: GiteaComment) {
  return {
    id: c.id,
    author: trimUser(c.user),
    body: c.body,
    created_at: ist(c.created_at),
    updated_at: ist(c.updated_at),
    url: c.html_url ?? null,
  };
}

function trimChangedFile(f: GiteaChangedFile) {
  return {
    filename: f.filename,
    status: f.status,
    additions: f.additions ?? null,
    deletions: f.deletions ?? null,
    changes: f.changes ?? null,
  };
}

const repoParams = {
  owner: { type: "string", description: "Repository owner (user or org login)" },
  repo: { type: "string", description: "Repository name" },
} as const;

const pageParams = {
  page: { type: "integer", description: "Page number, 1-based. Defaults to 1." },
  limit: { type: "integer", description: "Page size. Defaults to 20." },
} as const;

function pg(args: Record<string, any>): { page: number; limit: number } {
  return { page: Number(args.page) || 1, limit: Number(args.limit) || 20 };
}

export const giteaTools: Tool[] = [
  {
    name: "get_me",
    title: "Get current Gitea user",
    description: "Return the authenticated Gitea user's profile.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    async run(_args, ctx) {
      const me = (await giteaGet(ctx, "/api/v1/user")) as GiteaUser;
      return { login: me.login, full_name: me.full_name ?? null, email: me.email ?? null };
    },
  },

  {
    name: "list_my_repos",
    title: "List my repositories",
    description: "List repositories owned by the authenticated user. Paginated.",
    inputSchema: {
      type: "object",
      properties: { ...pageParams },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    async run(args, ctx) {
      const { page, limit } = pg(args);
      const repos = (await giteaGet(ctx, "/api/v1/user/repos", { page, limit })) as GiteaRepo[];
      return {
        ...pageInfo(page, limit, repos.length),
        repos: repos.map((r) => ({
          full_name: r.full_name,
          private: r.private,
          fork: r.fork,
          url: r.html_url,
          description: r.description ?? null,
          default_branch: r.default_branch ?? null,
          stars: r.stars_count ?? 0,
          updated_at: ist(r.updated_at),
        })),
      };
    },
  },

  {
    name: "search_repos",
    title: "Search repositories",
    description: "Search repositories by keyword across the Gitea instance. Paginated.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search keyword" },
        ...pageParams,
      },
      additionalProperties: false,
      required: ["q"],
    },
    annotations: READ_ONLY,
    async run(args, ctx) {
      const { page, limit } = pg(args);
      const result = (await giteaGet(ctx, "/api/v1/repos/search", { q: args.q, page, limit })) as { data: GiteaRepo[] };
      const repos = result.data ?? [];
      return {
        ...pageInfo(page, limit, repos.length),
        repos: repos.map((r) => ({
          full_name: r.full_name,
          private: r.private,
          fork: r.fork,
          url: r.html_url,
          description: r.description ?? null,
        })),
      };
    },
  },

  {
    name: "list_pull_requests",
    title: "List pull requests",
    description: "List pull requests in a repository. Paginated.",
    inputSchema: {
      type: "object",
      properties: {
        ...repoParams,
        state: { type: "string", enum: ["open", "closed", "all"], description: "Defaults to open." },
        ...pageParams,
      },
      additionalProperties: false,
      required: ["owner", "repo"],
    },
    annotations: READ_ONLY,
    async run(args, ctx) {
      const { page, limit } = pg(args);
      const pulls = (await giteaGet(ctx, `/api/v1/repos/${args.owner}/${args.repo}/pulls`, {
        state: args.state,
        page,
        limit,
      })) as GiteaPull[];
      return { ...pageInfo(page, limit, pulls.length), pulls: pulls.map(trimPull) };
    },
  },

  {
    name: "pull_request_read",
    title: "Read a pull request",
    description:
      "Read one pull request. `action` selects: get (metadata), get_diff (unified diff text), get_comments (discussion), list_files (changed files, paginated).",
    inputSchema: {
      type: "object",
      properties: {
        ...repoParams,
        index: { type: "integer", description: "Pull request number" },
        action: { type: "string", enum: ["get", "get_diff", "get_comments", "list_files"] },
        ...pageParams,
      },
      additionalProperties: false,
      required: ["owner", "repo", "index", "action"],
    },
    annotations: READ_ONLY,
    async run(args, ctx) {
      const base = `/api/v1/repos/${args.owner}/${args.repo}`;
      if (args.action === "get") {
        const pull = (await giteaGet(ctx, `${base}/pulls/${args.index}`)) as GiteaPull;
        return trimPull(pull);
      }
      if (args.action === "get_diff") {
        const diff = await giteaGetText(ctx, `${base}/pulls/${args.index}.diff`);
        return { diff };
      }
      if (args.action === "list_files") {
        const { page, limit } = pg(args);
        const files = (await giteaGet(ctx, `${base}/pulls/${args.index}/files`, { page, limit })) as GiteaChangedFile[];
        return { ...pageInfo(page, limit, files.length), files: files.map(trimChangedFile) };
      }
      if (args.action === "get_comments") {
        // This instance keeps review discussion in the issue-comments thread, not the
        // /pulls/{index}/reviews endpoint, which comes back near-empty here. A PR shares
        // its numbering with the issues endpoint, so /issues/{index}/comments is correct.
        const { page, limit } = pg(args);
        const comments = (await giteaGet(ctx, `${base}/issues/${args.index}/comments`, { page, limit })) as GiteaComment[];
        return { ...pageInfo(page, limit, comments.length), comments: comments.map(trimComment) };
      }
      throw new Error(`Unknown action: ${args.action}`);
    },
  },

  {
    name: "list_issues",
    title: "List issues",
    description: "List issues in a repository. Paginated.",
    inputSchema: {
      type: "object",
      properties: {
        ...repoParams,
        state: { type: "string", enum: ["open", "closed", "all"], description: "Defaults to open." },
        q: { type: "string", description: "Search string" },
        labels: { type: "string", description: "Comma-separated label names" },
        ...pageParams,
      },
      additionalProperties: false,
      required: ["owner", "repo"],
    },
    annotations: READ_ONLY,
    async run(args, ctx) {
      const { page, limit } = pg(args);
      const issues = (await giteaGet(ctx, `/api/v1/repos/${args.owner}/${args.repo}/issues`, {
        state: args.state,
        q: args.q,
        labels: args.labels,
        // Gitea's issues endpoint also returns pull requests unless filtered; keep those out
        // since list_pull_requests is the dedicated tool for that shape.
        type: "issues",
        page,
        limit,
      })) as GiteaIssue[];
      return { ...pageInfo(page, limit, issues.length), issues: issues.map(trimIssue) };
    },
  },

  {
    name: "issue_read",
    title: "Read an issue",
    description: "Read one issue. `action` selects: get (metadata) or get_comments (discussion, paginated).",
    inputSchema: {
      type: "object",
      properties: {
        ...repoParams,
        index: { type: "integer", description: "Issue number" },
        action: { type: "string", enum: ["get", "get_comments"] },
        ...pageParams,
      },
      additionalProperties: false,
      required: ["owner", "repo", "index", "action"],
    },
    annotations: READ_ONLY,
    async run(args, ctx) {
      const base = `/api/v1/repos/${args.owner}/${args.repo}`;
      if (args.action === "get") {
        const issue = (await giteaGet(ctx, `${base}/issues/${args.index}`)) as GiteaIssue;
        return { ...trimIssue(issue), body: issue.body ?? null };
      }
      if (args.action === "get_comments") {
        const { page, limit } = pg(args);
        const comments = (await giteaGet(ctx, `${base}/issues/${args.index}/comments`, { page, limit })) as GiteaComment[];
        return { ...pageInfo(page, limit, comments.length), comments: comments.map(trimComment) };
      }
      throw new Error(`Unknown action: ${args.action}`);
    },
  },

  {
    name: "search_issues",
    title: "Search issues across repositories",
    description: "Search issues and pull requests across every repository visible to the token. Paginated.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search string" },
        state: { type: "string", enum: ["open", "closed", "all"] },
        type: { type: "string", enum: ["issues", "pulls"] },
        owner: { type: "string", description: "Filter by repo owner login" },
        ...pageParams,
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    async run(args, ctx) {
      const { page, limit } = pg(args);
      const results = (await giteaGet(ctx, "/api/v1/repos/issues/search", {
        q: args.q,
        state: args.state,
        type: args.type,
        owner: args.owner,
        page,
        limit,
      })) as GiteaIssue[];
      return { ...pageInfo(page, limit, results.length), results: results.map(trimIssue) };
    },
  },

  {
    name: "get_file_contents",
    title: "Get file contents",
    description: "Read a file's contents (decoded to text) or list a directory's entries at a given ref.",
    inputSchema: {
      type: "object",
      properties: {
        ...repoParams,
        path: { type: "string", description: "File or directory path within the repository" },
        ref: { type: "string", description: "Branch, tag, or commit SHA. Defaults to the repo's default branch." },
      },
      additionalProperties: false,
      required: ["owner", "repo", "path"],
    },
    annotations: READ_ONLY,
    async run(args, ctx) {
      const encodedPath = String(args.path)
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const entry = await giteaGet(ctx, `/api/v1/repos/${args.owner}/${args.repo}/contents/${encodedPath}`, { ref: args.ref });
      if (Array.isArray(entry)) {
        return {
          type: "dir",
          entries: (entry as GiteaContentsEntry[]).map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size ?? null })),
        };
      }
      const file = entry as GiteaContentsEntry;
      // Content comes back base64 from Gitea; decode to text here so callers don't each reimplement it.
      const text = file.encoding === "base64" && file.content ? atob(file.content) : (file.content ?? null);
      return {
        type: "file",
        name: file.name,
        path: file.path,
        sha: file.sha,
        size: file.size ?? null,
        content: text,
        url: file.html_url ?? null,
      };
    },
  },

  {
    name: "list_branches",
    title: "List branches",
    description: "List branches in a repository. Paginated.",
    inputSchema: {
      type: "object",
      properties: { ...repoParams, ...pageParams },
      additionalProperties: false,
      required: ["owner", "repo"],
    },
    annotations: READ_ONLY,
    async run(args, ctx) {
      const { page, limit } = pg(args);
      const branches = (await giteaGet(ctx, `/api/v1/repos/${args.owner}/${args.repo}/branches`, { page, limit })) as GiteaBranch[];
      return {
        ...pageInfo(page, limit, branches.length),
        branches: branches.map((b) => ({
          name: b.name,
          protected: b.protected ?? false,
          commit_sha: b.commit?.id ?? null,
          commit_message: b.commit?.message ?? null,
        })),
      };
    },
  },

  {
    name: "list_commits",
    title: "List commits",
    description: "List commits on a branch or path. Paginated.",
    inputSchema: {
      type: "object",
      properties: {
        ...repoParams,
        sha: { type: "string", description: "Branch or commit SHA to start from" },
        path: { type: "string", description: "Restrict to commits touching this file path" },
        ...pageParams,
      },
      additionalProperties: false,
      required: ["owner", "repo"],
    },
    annotations: READ_ONLY,
    async run(args, ctx) {
      const { page, limit } = pg(args);
      const commits = (await giteaGet(ctx, `/api/v1/repos/${args.owner}/${args.repo}/commits`, {
        sha: args.sha,
        path: args.path,
        page,
        limit,
      })) as GiteaCommitListItem[];
      return {
        ...pageInfo(page, limit, commits.length),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.commit?.message ?? null,
          author: c.author ? trimUser(c.author) : { login: c.commit?.author?.name ?? null },
          date: ist(c.commit?.author?.date),
          url: c.html_url ?? null,
          additions: c.stats?.additions ?? null,
          deletions: c.stats?.deletions ?? null,
        })),
      };
    },
  },

  {
    name: "get_commit",
    title: "Get a commit",
    description: "Read one commit's metadata, stats, and changed files.",
    inputSchema: {
      type: "object",
      properties: { ...repoParams, sha: { type: "string", description: "Commit SHA" } },
      additionalProperties: false,
      required: ["owner", "repo", "sha"],
    },
    annotations: READ_ONLY,
    async run(args, ctx) {
      const commit = (await giteaGet(ctx, `/api/v1/repos/${args.owner}/${args.repo}/git/commits/${args.sha}`)) as GiteaGitCommit;
      return {
        sha: commit.sha,
        message: commit.commit?.message ?? null,
        author: commit.commit?.author?.name ?? null,
        date: ist(commit.commit?.author?.date),
        parents: (commit.parents ?? []).map((p) => p.sha),
        additions: commit.stats?.additions ?? null,
        deletions: commit.stats?.deletions ?? null,
        files: (commit.files ?? []).map(trimChangedFile),
        url: commit.html_url ?? null,
      };
    },
  },

  {
    name: "notification_read",
    title: "List notifications",
    description: "List the authenticated user's notification threads. Read-only listing; does not mark anything read. Paginated.",
    inputSchema: {
      type: "object",
      properties: {
        all: { type: "boolean", description: "Include already-read notifications too" },
        ...pageParams,
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    async run(args, ctx) {
      const { page, limit } = pg(args);
      const threads = (await giteaGet(ctx, "/api/v1/notifications", { all: args.all, page, limit })) as GiteaNotificationThread[];
      return {
        ...pageInfo(page, limit, threads.length),
        notifications: threads.map((t) => ({
          id: t.id,
          unread: t.unread,
          pinned: t.pinned,
          updated_at: ist(t.updated_at),
          repo: t.repository?.full_name ?? null,
          title: t.subject?.title ?? null,
          type: t.subject?.type ?? null,
          state: t.subject?.state ?? null,
          url: t.subject?.html_url ?? null,
        })),
      };
    },
  },
];
