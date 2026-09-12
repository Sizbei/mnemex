import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { chatCompletionsUrl, chatEndpoint, chatModel, host, MISSING_ENDPOINT_MESSAGE, port, repoRoot } from "./env.js";
import { runTurn, type ChatMessage } from "./chat.js";
import { TurnStream } from "./events.js";
import { memoryGraph } from "./memory.js";
import { MISSING_BUILD_MESSAGE, serveStatic } from "./static.js";
import { toolDefinitions } from "./tools.js";

/**
 * The backend for the generated AgentCanvas app.
 *
 * The exported client ships a runtime seam at this prefix: five endpoints, the important one
 * being POST /prompt, which streams one turn back as newline-delimited AgentUX events. The
 * scaffold's own implementation of that seam is its bundled Pi agent; this replaces it with
 * the mnemex tool loop, which is the whole point of the demo.
 *
 * It runs as its own process rather than inside Vite because it imports the compiled mnemex
 * tools, which resolve neo4j-driver, zod and dotenv from the repository root.
 */
const API_PREFIX = "/__agentcanvas/pi";

/** Per-conversation transcript. A new conversation starts empty; the graph does not. */
const conversations = new Map<string, ChatMessage[]>();

/** Pi exposes a single "abort the current run" control, so every live run answers to it. */
const activeRuns = new Set<AbortController>();

interface RuntimeState {
  available: boolean;
  cwd: string;
  sessionId?: string;
  sessionName?: string;
  running: boolean;
  provider?: string;
  model?: string;
  models: { provider: string; id: string; name: string; available: boolean }[];
  tools: string[];
  error?: string;
}

function runtimeState(input: { provider?: string; model?: string; conversationId?: string } = {}): RuntimeState {
  const provider = input.provider ?? "custom-provider";
  // Echoed rather than chosen: the client refuses a runtime that did not activate the model
  // it asked for, and this deployment serves exactly one.
  const model = input.model ?? chatModel;
  const available = Boolean(chatCompletionsUrl());
  return {
    available,
    cwd: repoRoot,
    sessionId: input.conversationId,
    sessionName: input.conversationId,
    running: activeRuns.size > 0,
    provider,
    model,
    models: [{ provider, id: model, name: `${model} (Nosana)`, available }],
    tools: toolDefinitions.map((tool) => tool.function.name),
    ...(available ? {} : { error: MISSING_ENDPOINT_MESSAGE }),
  };
}

const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    console.error("[mnemex-ui] request failed:", error);
    if (!response.headersSent) json(response, 500, { error: String(error) });
    else response.end();
  });
});

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = request.url ?? "/";

  if (url === "/health") {
    json(response, 200, {
      ok: true,
      chatEndpointConfigured: Boolean(chatEndpoint),
      model: chatModel,
      tools: toolDefinitions.map((tool) => tool.function.name),
    });
    return;
  }

  // Everything that is not the runtime seam is the frontend. Under `npm run dev` Vite owns
  // that half and only proxies the seam here, so this branch is the deployed path.
  if (!url.startsWith(API_PREFIX)) {
    if (!(await serveStatic(request, response))) json(response, 404, { error: MISSING_BUILD_MESSAGE });
    return;
  }

  const route = url.slice(API_PREFIX.length);

  if (route === "/state") {
    json(response, 200, runtimeState());
    return;
  }

  if (route === "/config") {
    const body = await readJson(request);
    json(response, 200, runtimeState(body));
    return;
  }

  if (route === "/session/new") {
    const body = await readJson(request);
    if (body.conversationId) conversations.delete(body.conversationId);
    json(response, 200, runtimeState(body));
    return;
  }

  if (route === "/abort") {
    for (const controller of activeRuns) controller.abort(new Error("aborted by client"));
    json(response, 200, {});
    return;
  }

  if (route === "/approval") {
    // No tool here needs approval: all three act only on this project's own graph, and the
    // backend never emits tool.call.awaiting_approval, so nothing can be waiting.
    json(response, 200, {});
    return;
  }

  if (route === "/memory") {
    // Not part of the AgentCanvas runtime seam: it rides on the same prefix so the Vite dev
    // proxy and the single-port deployment both reach it without a second rule.
    try {
      json(response, 200, { ok: true, ...(await memoryGraph()) });
    } catch (error) {
      json(response, 500, { ok: false, error: String(error) });
    }
    return;
  }

  if (route === "/prompt") {
    await handlePrompt(request, response);
    return;
  }

  json(response, 404, { error: `Unknown route ${route}` });
}

async function handlePrompt(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson(request);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    json(response, 400, { error: "prompt is required" });
    return;
  }

  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "default";
  const history = conversations.get(conversationId) ?? [];
  conversations.set(conversationId, history);

  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  const controller = new AbortController();
  activeRuns.add(controller);
  request.on("close", () => controller.abort(new Error("client disconnected")));

  const stream = new TurnStream(response, `mnemex_${Date.now().toString(36)}`);
  try {
    await runTurn({ stream, history, prompt, sessionId: conversationId, signal: controller.signal });
  } finally {
    activeRuns.delete(controller);
    // A stream that ends without a terminal event reads as a transport failure on the
    // client, which is the correct outcome for an unexpected throw.
    if (!stream.isClosed) response.end();
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, any>;
  } catch {
    return {};
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(payload);
}

// Loopback by default: the graph credentials live in this process, and a laptop copy has no
// reason to be reachable from another machine. A deployment sets MNEMEX_UI_HOST=0.0.0.0,
// because the Daytona preview proxy connects from outside the container.
server.listen(port, host, () => {
  console.log(`[mnemex-ui] backend on http://${host}:${port}${API_PREFIX}`);
  console.log(`[mnemex-ui] tools: ${toolDefinitions.map((tool) => tool.function.name).join(", ")}`);
  console.log(
    chatEndpoint
      ? `[mnemex-ui] chat model "${chatModel}" at ${chatCompletionsUrl()}`
      : "[mnemex-ui] NOSANA_CHAT_ENDPOINT is unset; the UI will say so instead of hanging",
  );
});
