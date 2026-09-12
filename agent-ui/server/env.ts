import { config } from "dotenv";
import { z } from "zod";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Anchored on this file rather than on the cwd, so the backend behaves the same whether it
 * is started from the repository root or from agent-ui/.
 */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The compiled mnemex tools read Neo4j, Nosana and Daytona settings out of process.env via
// src/config.ts, which loads .env relative to the cwd. Loading the repo root file here means
// both this server and the tools it calls see the same values from any cwd.
config({ path: join(repoRoot, ".env") });

/**
 * These four belong to this backend, not to the MCP server, which is why they are validated
 * here rather than in src/config.ts. Unvalidated `Number(...)` coercion was silently turning
 * a typo into NaN, which then read as an immediate timeout.
 */
const Schema = z.object({
  /** Unset is the expected state before the chat model is deployed, not an error. */
  NOSANA_CHAT_ENDPOINT: z.string().trim().default(""),
  /** vLLM is started with `--served-model-name chat`, so that is the id the API expects. */
  NOSANA_CHAT_MODEL: z.string().trim().min(1).default("chat"),
  MNEMEX_UI_PORT: z.coerce.number().int().positive().max(65535).default(8787),
  /** Loopback unless a deployment opens it. See the listen() call in index.ts. */
  MNEMEX_UI_HOST: z.string().trim().min(1).default("127.0.0.1"),
  /** Milliseconds to wait for the model's response headers. The stream itself is unbounded. */
  MNEMEX_CHAT_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  const bad = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid chat backend environment: ${bad}`);
}

export const chatEndpoint = parsed.data.NOSANA_CHAT_ENDPOINT;
export const chatModel = parsed.data.NOSANA_CHAT_MODEL;
export const port = parsed.data.MNEMEX_UI_PORT;
export const host = parsed.data.MNEMEX_UI_HOST;
export const connectTimeoutMs = parsed.data.MNEMEX_CHAT_CONNECT_TIMEOUT_MS;

/**
 * The deployment prints a bare host, but an OpenAI-compatible client needs the /v1 route.
 * Accept either form so a pasted endpoint works without editing.
 */
export function chatCompletionsUrl(): string | null {
  if (!chatEndpoint) return null;
  const base = chatEndpoint.replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

export const MISSING_ENDPOINT_MESSAGE =
  "NOSANA_CHAT_ENDPOINT is not set in the repository root .env, so there is no chat model to " +
  "answer with. The mnemex graph tools are still live. Set the variable to the deployed " +
  "OpenAI-compatible endpoint and restart the backend.";
