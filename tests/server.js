/**
 * Test server - lightweight Bun.serve() that routes requests to _functions handlers.
 * Mimics bunpaas-server's function loading for local testing.
 */

import * as tokensHandler from "../src/_functions/_tokens.js";
import * as usersHandler from "../src/_functions/_users.js";
import * as userByIdHandler from "../src/_functions/_users/[id].js";
import * as signinHandler from "../src/_functions/_signin.js";
import * as collectionHandler from "../src/_functions/[collection].js";
import * as collectionItemHandler from "../src/_functions/[collection]/[id].js";

function route(path) {
  if (path === "/_tokens") return { handler: tokensHandler, params: {} };
  if (path === "/_users") return { handler: usersHandler, params: {} };
  if (path === "/_signin") return { handler: signinHandler, params: {} };

  const userMatch = path.match(/^\/_users\/([^/]+)$/);
  if (userMatch) return { handler: userByIdHandler, params: { id: userMatch[1] } };

  const itemMatch = path.match(/^\/([^_][^/]*)\/([^/]+)$/);
  if (itemMatch) return { handler: collectionItemHandler, params: { collection: itemMatch[1], id: itemMatch[2] } };

  const collMatch = path.match(/^\/([^_][^/]*)$/);
  if (collMatch) return { handler: collectionHandler, params: { collection: collMatch[1] } };

  return null;
}

export function startTestServer(port = 0) {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const match = route(url.pathname);

      if (!match) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }

      let body = null;
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        try { body = await req.json(); } catch {}
      }

      const funcReq = {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: Object.fromEntries(req.headers),
        body,
        params: match.params,
        env: {},
      };

      const methodName = req.method.toLowerCase();
      const fn = match.handler[methodName]
        || (methodName === "delete" ? match.handler.del : null)
        || match.handler.default;

      if (!fn) {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
      }

      try {
        const result = await fn(funcReq);

        if (!result) return new Response(null, { status: 204 });

        const status = result.status || 200;
        const headers = new Headers(result.headers || {});

        if (result.body === null || result.body === undefined) {
          return new Response(null, { status, headers });
        }

        if (typeof result.body === "object") {
          headers.set("Content-Type", "application/json");
          return new Response(JSON.stringify(result.body), { status, headers });
        }

        return new Response(String(result.body), { status, headers });
      } catch (err) {
        console.error("Function error:", err);
        return Response.json({ error: "Internal error" }, { status: 500 });
      }
    },
  });

  return server;
}
