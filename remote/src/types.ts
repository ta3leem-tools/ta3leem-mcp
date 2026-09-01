/**
 * Shared contract between the transport (mcp.ts) and the two tool modules
 * (openproject.ts, gitea.ts). Both upstreams sit behind Cloudflare Access, so
 * every outbound request needs the service-token headers in addition to the
 * per-user API credential.
 */

/** Behaviour hints from the MCP tools spec. Every tool here issues GET only. */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export interface ToolCtx {
  /** e.g. https://pm.ta3leem.dev (no trailing slash) */
  openprojectUrl: string;
  /** e.g. https://gitea.ta3leem.dev (no trailing slash) */
  giteaUrl: string;
  /** This user's own OpenProject API key, from the decrypted grant props. */
  openprojectKey: string;
  /** This user's own Gitea personal access token, from the decrypted grant props. */
  giteaToken: string;
  /**
   * Cloudflare Access headers for OpenProject. The Access JWT carries a
   * per-application `aud`, so a token minted for OpenProject is not valid for
   * Gitea and the two cannot share one map.
   */
  openprojectAccessHeaders: Record<string, string>;
  /** Cloudflare Access headers for Gitea. Separate for the same reason. */
  giteaAccessHeaders: Record<string, string>;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  /** Omit to inherit READ_ONLY. */
  annotations?: Record<string, boolean>;
  run(args: Record<string, any>, ctx: ToolCtx): Promise<unknown>;
}

/** API returns UTC; the team works in IST, so every timestamp is converted. */
export function ist(iso: string | null | undefined): string | null {
  if (!iso) { return null; }
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).replace(",", "") + " IST";
}

/** Workers have no Buffer under some configs; base64 without it. */
export function b64(input: string): string {
  return btoa(input);
}
