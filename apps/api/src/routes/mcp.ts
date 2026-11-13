import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { loadSiteConfig } from "@traiblazer/marketing";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { buildPublicMcpServer } from "../mcp/server.js";

/** Calls per address per minute. An assistant answering one question makes a handful. */
const MCP_PER_MINUTE = 60;

/**
 * Public MCP endpoint (`/mcp`, streamable HTTP): AI assistants connect here to look up what
 * Traiblazer is, its prices and where it works. See `mcp/server.ts` for the tools.
 *
 * - No sign-in and no sessions: each request is answered on its own by a fresh server, so it works
 *   the same behind any number of API servers.
 * - Read-only and public: the tools never read the session cookie or any business's data, which is
 *   why any website may call it (`Access-Control-Allow-Origin: *`). Nothing here is worth protecting
 *   from another origin.
 * - Rate-limited per address, on top of the API-wide limit.
 */
export async function mcpRoutes(app: FastifyInstance, { config, platform }: AppContext) {
  const site = loadSiteConfig(
    {
      SITE_URL: config.SITE_URL,
      MCP_PUBLIC_URL: config.MCP_PUBLIC_URL,
      BUSINESS_LEGAL_NAME: config.BUSINESS_LEGAL_NAME,
      BUSINESS_EMAIL: config.BUSINESS_EMAIL,
      BUSINESS_PHONE: config.BUSINESS_PHONE,
      BUSINESS_STREET: config.BUSINESS_STREET,
      BUSINESS_CITY: config.BUSINESS_CITY,
      BUSINESS_REGION: config.BUSINESS_REGION,
      BUSINESS_POSTAL_CODE: config.BUSINESS_POSTAL_CODE,
      BUSINESS_COUNTRY: config.BUSINESS_COUNTRY,
    },
    config.ADMIN_ORIGIN,
  );

  const handler = createMcpHandler(
    () =>
      buildPublicMcpServer({
        site,
        // The same active plans the pricing page shows (GET /v1/catalog/plans).
        plans: async () => (await platform!.plans()).filter((plan) => plan.active),
      }),
    {
      // One JSON answer per call: the tools are instant, so there is nothing to stream.
      responseMode: "json",
      // Tool calls are small; refuse anything large before reading it.
      maxRequestBodySize: 64 * 1024,
      onerror: (error) => app.log.warn({ err: error }, "mcp request failed"),
    },
  );
  app.addHook("onClose", async () => {
    await handler.close();
  });

  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers":
      "content-type, accept, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id",
    "access-control-expose-headers": "mcp-protocol-version",
    "access-control-max-age": "86400",
  };

  // Browser-based clients ask permission first (CORS preflight).
  app.options("/mcp", async (_request, reply) => reply.code(204).headers(cors).send());

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    config: { rateLimit: { max: MCP_PER_MINUTE, timeWindow: "1 minute" } },
    bodyLimit: 64 * 1024,
    handler: async (request, reply) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        // The tools are public: never pass the session cookie or credentials on.
        if (name === "cookie" || name === "authorization" || value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const webRequest = new Request(new URL(request.url, config.PUBLIC_URL), {
        method: request.method,
        headers,
      });
      // The handler answers GET and DELETE with 405 itself: there are no sessions to open or close.
      const response = await handler.fetch(webRequest, { parsedBody: request.body });

      reply.code(response.status).headers(cors);
      response.headers.forEach((value, name) => {
        reply.header(name, value);
      });
      return reply.send(response.body ? Readable.fromWeb(response.body as NodeReadableStream) : null);
    },
  });
}
