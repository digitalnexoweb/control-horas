/**
 * Cloudflare Worker entry point.
 *
 * Static assets are served by Workers Assets. API requests are routed to the
 * existing Express backend through Cloudflare's Node HTTP bridge.
 */
import { createServer } from "node:http";
import { handleAsNodeRequest } from "cloudflare:node";

const API_PORT = 8080;
let serverPromise;

function populateProcessEnv(env) {
  if (!globalThis.process) {
    return;
  }

  globalThis.process.env = globalThis.process.env || {};

  Object.entries(env || {}).forEach(([key, value]) => {
    if (typeof value === "string") {
      globalThis.process.env[key] = value;
    }
  });
}

async function createApiServer(env) {
  populateProcessEnv(env);

  const processVersions = globalThis.process && globalThis.process.versions;
  const originalNodeVersion = processVersions && processVersions.node;

  if (processVersions) {
    try {
      Object.defineProperty(processVersions, "node", {
        value: undefined,
        configurable: true
      });
    } catch (error) {
      processVersions.node = undefined;
    }
  }

  const serverModule = await import("../backend/server.js");

  if (processVersions && originalNodeVersion) {
    try {
      Object.defineProperty(processVersions, "node", {
        value: originalNodeVersion,
        configurable: true
      });
    } catch (error) {
      processVersions.node = originalNodeVersion;
    }
  }

  const { app } = serverModule.default || serverModule;
  const server = createServer(app);
  server.listen(API_PORT);

  return server;
}

function getApiServer(env) {
  if (!serverPromise) {
    serverPromise = createApiServer(env);
  }

  return serverPromise;
}

function stripApiPrefix(request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  return new Request(url.toString(), request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      await getApiServer(env);
      return handleAsNodeRequest(API_PORT, stripApiPrefix(request));
    }

    return env.ASSETS.fetch(request);
  }
};
