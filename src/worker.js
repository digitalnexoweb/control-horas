/**
 * Cloudflare Worker entry point (ES Module format)
 *
 * Uses static ESM imports so esbuild bundles Express + Supabase
 * and all dependencies directly into the Worker script.
 * createRequire is NOT used — it leaves deps as runtime requires
 * which fail in Workers (no node_modules at runtime).
 */
import serverless from "serverless-http";
import serverModule from "../backend/server.js";

const { app } = serverModule;
const handler = serverless(app, { basePath: "/api" });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Route all /api/* requests to Express backend
    if (url.pathname.startsWith("/api/")) {
      return handler(request);
    }

    // Serve static frontend (SPA fallback via not_found_handling in wrangler.jsonc)
    return env.ASSETS.fetch(request);
  }
};
