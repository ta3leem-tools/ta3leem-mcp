/**
 * Stateless Streamable HTTP transport for MCP, JSON-RPC 2.0 over POST.
 *
 * Stateless on purpose: no session id, no SSE stream, no Durable Object. Every
 * POST carries its own auth and is answered from a single request, which is all
 * Claude's hosted surfaces need and which keeps the Worker on the free tier.
 */

import type { Tool, ToolCtx } from "./types";
import { READ_ONLY } from "./types";

/**
 * The one spec revision this transport implements. 2025-06-18 is the revision
 * that adds structuredContent, which is why every result carries both a text
 * block and the parsed value: a client on an older revision reads the text and
 * behaves as it always did. Never echo the client's requested version back,
 * that claims support for features this transport does not have.
 */
const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "ta3leem-mcp-remote", version: "1.0.0" };

type Json = Record<string, any>;

function ok(id: unknown, result: Json): Json {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: unknown, code: number, message: string): Json {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleOne(req: Json, tools: Tool[], ctx: ToolCtx): Promise<Json | null> {
  // A notification has no id and gets no reply.
  if (req.id === undefined) { return null; }

  try {
    switch (req.method) {
      case "initialize":
        return ok(req.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });

      case "tools/list":
        return ok(req.id, {
          tools: tools.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
            annotations: t.annotations ?? READ_ONLY,
          })),
        });

      case "tools/call": {
        const tool = tools.find((t) => t.name === req.params?.name);
        if (!tool) { throw new Error(`Unknown tool: ${req.params?.name}`); }
        const result = await tool.run(req.params?.arguments || {}, ctx);
        return ok(req.id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      }

      case "ping":
        return ok(req.id, {});

      default:
        return fail(req.id, -32601, `Method not found: ${req.method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A tool that fails is a tool result, not a protocol error. Anything else is.
    if (req.method === "tools/call") {
      return ok(req.id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true });
    }
    return fail(req.id, -32603, message);
  }
}

/** Answers one MCP HTTP request. Auth is already resolved into ctx by the caller. */
export async function handleMcpRequest(
  request: Request,
  tools: Tool[],
  ctx: ToolCtx,
): Promise<Response> {
  if (request.method === "GET") {
    // No server-initiated stream, so there is nothing to open here.
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400 });
  }

  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handleOne(m as Json, tools, ctx))))
      .filter((r): r is Json => r !== null);
    // An all-notification batch gets an empty 202, per the transport spec.
    return replies.length === 0
      ? new Response(null, { status: 202 })
      : Response.json(replies);
  }

  const reply = await handleOne(body as Json, tools, ctx);
  return reply === null ? new Response(null, { status: 202 }) : Response.json(reply);
}
