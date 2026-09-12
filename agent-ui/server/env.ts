import { config } from "dotenv";
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

/** Unset is the expected state before the chat model is deployed, not an error. */
export const chatEndpoint = (process.env.NOSANA_CHAT_ENDPOINT ?? "").trim();

/** vLLM is started with `--served-model-name chat`, so that is the id the API expects. */
export const chatModel = (process.env.NOSANA_CHAT_MODEL ?? "").trim() || "chat";

export const port = Number(process.env.MNEMEX_UI_PORT ?? 8787);

/** Milliseconds to wait for the model's response headers. The stream itself is unbounded. */
export const connectTimeoutMs = Number(process.env.MNEMEX_CHAT_CONNECT_TIMEOUT_MS ?? 30_000);

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
