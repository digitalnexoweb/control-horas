/**
 * Cloudflare Worker entry point
 * - Routes /api/* to the Express backend via serverless-http
 * - Serves static assets from the frontend/ directory
 * - Falls back to index.html for unknown paths (SPA routing)
 */

const serverless = require("serverless-http");
const { app } = require("../backend/server");

const handler = serverless(app, { basePath: "/api" });

module.exports = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Route all /api/* requests to the Express backend
    if (url.pathname.startsWith("/api/")) {
      return handler(request);
    }

    // Serve static assets; the ASSETS binding handles SPA fallback
    // via not_found_handling: "single-page-application" in wrangler.jsonc
    return env.ASSETS.fetch(request);
  }
};
