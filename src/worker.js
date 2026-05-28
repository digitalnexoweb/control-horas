/**
 * Cloudflare Worker entry point (ES Module format)
 * - Routes /api/* to the Express backend via serverless-http
 * - Serves static assets from the frontend/ directory
 * - SPA fallback handled by not_found_handling in wrangler.jsonc
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

const serverless = require("serverless-http");
const { app } = require("../backend/server");

const handler = serverless(app, { basePath: "/api" });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Route all /api/* requests to the Express backend
    if (url.pathname.startsWith("/api/")) {
      return handler(request);
    }

    // Serve static assets (SPA fallback via not_found_handling: single-page-application)
    return env.ASSETS.fetch(request);
  }
};
