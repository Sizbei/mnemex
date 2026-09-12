import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

import { repoRoot } from "./env.js";

/**
 * Serving the Vite build from this process is what makes a single-port deployment possible.
 * A Daytona preview link exposes exactly one port, so the frontend and the agent loop have
 * to answer on the same origin. Locally nothing changes: `npm run dev` still runs Vite on
 * 5173 and proxies /__agentcanvas/pi here, and this path is simply never reached.
 */
const ROOT = join(repoRoot, "agent-ui", "dist");

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function fileAt(path: string): Promise<string | null> {
  try {
    return (await stat(path)).isFile() ? path : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a request path inside the build directory, or null if it escapes it.
 * A URL-encoded `..` is the case a naive join() lets through.
 */
function resolveInRoot(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const target = normalize(join(ROOT, decoded));
  return target === ROOT || target.startsWith(ROOT + sep) ? target : null;
}

/**
 * Answer a non-API request from the built frontend. Returns false when there is no build to
 * serve, so the caller can say that rather than returning a bare 404 for every path.
 */
export async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const index = await fileAt(join(ROOT, "index.html"));
  if (!index) return false;

  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const resolved = resolveInRoot(pathname);
  if (!resolved) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return true;
  }

  // The client routes in the browser, so an unknown path is a deep link, not a miss. Hashed
  // asset requests are the exception: falling back to HTML there hides a broken build behind
  // a confusing MIME error in the console.
  const candidate = (await fileAt(resolved)) ?? (await fileAt(join(resolved, "index.html")));
  const file = candidate ?? (extname(pathname) ? null : index);
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return true;
  }

  const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  response.writeHead(200, {
    "content-type": type,
    // Asset filenames carry a content hash; index.html must not be cached or a redeploy
    // keeps pointing at bundles that are no longer there.
    "cache-control": file === index ? "no-store" : "public, max-age=31536000, immutable",
  });

  if (request.method === "HEAD") {
    response.end();
    return true;
  }

  createReadStream(file).pipe(response);
  return true;
}

export const MISSING_BUILD_MESSAGE =
  `No frontend build at ${ROOT}. Run \`npm --prefix agent-ui run build\`, or use the Vite dev ` +
  "server on 5173, which proxies the API here.";
