/**
 * Cloudflare Worker entry point (ES Module format)
 *
 * Uses serverless-http to bridge Express to the Workers runtime.
 * Static imports ensure esbuild bundles all dependencies.
 * nodejs_compat injects process.env (vars + secrets) before module load.
 */
import serverless from "serverless-http";
import serverModule from "../backend/server.js";

const { app } = serverModule;
const handler = serverless(app, { basePath: "/api" });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API routes → Express backend
    if (url.pathname.startsWith("/api/")) {
      return handler(request);
    }

    // Static frontend (SPA fallback via not_found_handling in wrangler.jsonc)
    return env.ASSETS.fetch(request);
  }
};
