import { chatCompletionsUrl, chatModel, connectTimeoutMs, MISSING_ENDPOINT_MESSAGE } from "./env.js";
import type { TurnStream } from "./events.js";
import { systemPrompt } from "./prompt.js";
import { executeTool, isToolName, resultPreview, toolDefinitions, type ToolName } from "./tools.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** A tool call the model is still assembling across streamed deltas. */
interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

/**
 * The model gets no more than this many chances to call tools before it has to answer. A
 * loop that cannot terminate on its own would otherwise burn the context window in silence.
 */
const MAX_ROUNDS = 5;

/** max_model_len is 16384 for this deployment, and a recall result carries every claim text. */
const MAX_TOOL_RESULT_CHARS = 3_000;
const MAX_CLAIM_CHARS = 240;

export async function runTurn(input: {
  stream: TurnStream;
  history: ChatMessage[];
  prompt: string;
  sessionId: string;
  signal: AbortSignal;
}): Promise<void> {
  const { stream, history, prompt, sessionId, signal } = input;

  stream.emit("run.started", { title: "mnemex" });
  const userMessageId = `${stream.runId}_user`;
  stream.text("user", `${userMessageId}_text`, prompt, userMessageId);

  const url = chatCompletionsUrl();
  if (!url) {
    stream.end("run.error", {
      code: "chat_endpoint_unset",
      message: MISSING_ENDPOINT_MESSAGE,
      userMessage: MISSING_ENDPOINT_MESSAGE,
    });
    return;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(sessionId) },
    ...history,
    { role: "user", content: prompt },
  ];

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const last = round === MAX_ROUNDS - 1;
      const completion = await streamCompletion({
        url,
        messages,
        // The final round goes out with no tools so the model has to produce prose.
        tools: last ? undefined : toolDefinitions,
        stream,
        signal,
      });

      messages.push({
        role: "assistant",
        content: completion.text || null,
        ...(completion.toolCalls.length > 0
          ? {
              tool_calls: completion.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.args },
              })),
            }
          : {}),
      });

      if (completion.toolCalls.length === 0) {
        history.push({ role: "user", content: prompt });
        history.push({ role: "assistant", content: completion.text });
        stream.end("run.finished", {});
        return;
      }

      for (const call of completion.toolCalls) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: await runToolCall(call, stream),
        });
      }
    }

    // Reached only if every round asked for tools, which the toolless final round prevents.
    stream.end("run.finished", {});
  } catch (error) {
    if (signal.aborted) {
      stream.end("run.error", { code: "aborted", message: "Run cancelled.", userMessage: "Run cancelled." });
      return;
    }
    const message = describeFailure(error);
    stream.end("run.error", { code: "chat_failed", message, userMessage: message });
  }
}

/**
 * Execute one tool call and report it on the wire.
 *
 * The card gets the whole result because inspecting it is the point of the demo. The model
 * gets a compacted copy, because a recall answer with every claim in full can be several
 * thousand tokens and the window is 16k.
 */
async function runToolCall(call: PendingToolCall, stream: TurnStream): Promise<string> {
  const reasoningId = `${call.id}_reasoning`;

  if (!isToolName(call.name)) {
    const message = `Unknown tool: ${call.name}`;
    stream.emit("tool.call.error", { toolCallId: call.id, error: { message } });
    stream.emit("tool.call.finished", { toolCallId: call.id, status: "error" });
    return JSON.stringify({ error: message });
  }
  const name: ToolName = call.name;

  let args: unknown;
  try {
    args = call.args.trim() ? JSON.parse(call.args) : {};
  } catch {
    const message = `Arguments for ${name} were not valid JSON.`;
    stream.emit("tool.call.error", { toolCallId: call.id, error: { message } });
    stream.emit("tool.call.finished", { toolCallId: call.id, status: "error" });
    return JSON.stringify({ error: message });
  }

  stream.emit("reasoning.status", { reasoningId, status: "checking", label: `Querying graph memory: ${name}` });
  stream.emit("tool.call.running", { toolCallId: call.id, args });

  try {
    const result = await executeTool(name, args);
    stream.emit("tool.call.result", {
      toolCallId: call.id,
      result,
      resultPreview: resultPreview(name, result),
    });
    stream.emit("tool.call.finished", { toolCallId: call.id, status: "success" });
    stream.emit("reasoning.finished", { reasoningId });
    return compactForModel(name, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stream.emit("tool.call.error", { toolCallId: call.id, error: { message } });
    stream.emit("tool.call.finished", { toolCallId: call.id, status: "error" });
    stream.emit("reasoning.finished", { reasoningId });
    // Handed back as the tool result rather than thrown: the model can tell the user the
    // memory is unreachable, which is more useful than a dead turn.
    return JSON.stringify({ error: message });
  }
}

/** Trim long claim text, then hard-cap, so one large result cannot eat the whole window. */
function compactForModel(name: ToolName, result: unknown): string {
  const trimmed = JSON.stringify(shapeForModel(name, result), (key, value) =>
    typeof value === "string" && value.length > MAX_CLAIM_CHARS
      ? `${value.slice(0, MAX_CLAIM_CHARS)}…`
      : value,
  );
  if (trimmed.length <= MAX_TOOL_RESULT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated]`;
}

/**
 * recall reports supersession as arrays of decision ids. A model handed raw uuids cannot say
 * which decision replaced which, and a 7B model asked to guess will state the reversal
 * backwards. Dereference the ids against the same payload and drop them; the card keeps the
 * untouched result either way.
 */
function shapeForModel(name: ToolName, result: unknown): unknown {
  if (name !== "recall") return result;
  const value = result as { decisions?: any[]; degraded?: string[] };
  const statements = new Map<string, string>(
    (value.decisions ?? []).map((decision) => [decision.id, decision.statement]),
  );
  const resolve = (ids: string[] = []) => ids.map((id) => statements.get(id) ?? id);
  return {
    decisions: (value.decisions ?? []).map((decision) => ({
      statement: decision.statement,
      status: decision.status,
      overrules: resolve(decision.supersedes),
      overruledBy: resolve(decision.supersededBy),
      positions: decision.positions,
    })),
    degraded: value.degraded,
  };
}

interface CompletionResult {
  text: string;
  toolCalls: PendingToolCall[];
}

/**
 * One OpenAI-compatible streaming completion, translated to AgentUX events as it arrives.
 *
 * Assistant tokens become text deltas, and the arguments the model is still typing become
 * tool.call.args.delta, so the tool card fills in live rather than appearing complete.
 */
async function streamCompletion(input: {
  url: string;
  messages: ChatMessage[];
  tools?: typeof toolDefinitions;
  stream: TurnStream;
  signal: AbortSignal;
}): Promise<CompletionResult> {
  const { url, messages, tools, stream, signal } = input;

  const response = await fetchWithConnectTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      messages,
      stream: true,
      temperature: 0.2,
      ...(tools ? { tools, tool_choice: "auto" } : {}),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Chat endpoint returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const messageId = `${stream.runId}_assistant_${Date.now().toString(36)}`;
  const textId = `${messageId}_text`;
  let textOpen = false;
  let text = "";
  const toolCalls: PendingToolCall[] = [];
  const started = new Set<string>();

  for await (const chunk of sseChunks(response.body)) {
    const delta = chunk?.choices?.[0]?.delta;
    if (!delta) continue;

    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (!textOpen) {
        stream.emit("text.started", { textId, role: "assistant", format: "markdown" }, messageId);
        textOpen = true;
      }
      text += delta.content;
      stream.emit("text.delta", { textId, delta: delta.content }, messageId);
    }

    for (const partial of delta.tool_calls ?? []) {
      const index: number = partial.index ?? 0;
      const call = (toolCalls[index] ??= { id: "", name: "", args: "" });
      if (partial.id) call.id = partial.id;
      if (partial.function?.name) call.name += partial.function.name;
      // The id can arrive after the name, so announce the call only once both are known.
      if (call.id && call.name && !started.has(call.id)) {
        started.add(call.id);
        stream.emit("tool.call.started", {
          toolCallId: call.id,
          name: call.name,
          title: `${call.name} · mnemex graph memory`,
        });
      }
      const fragment: string | undefined = partial.function?.arguments;
      if (fragment) {
        call.args += fragment;
        if (call.id) {
          stream.emit("tool.call.args.delta", {
            toolCallId: call.id,
            delta: fragment,
            format: "json-fragment",
          });
        }
      }
    }
  }

  if (textOpen) stream.emit("text.finished", { textId }, messageId);

  return {
    text,
    // A call the model never finished naming cannot be executed.
    toolCalls: toolCalls.filter((call) => call && call.id && call.name),
  };
}

/**
 * Guard only the handshake. A timeout across the whole request would kill a long answer
 * mid-sentence, and a tool loop is legitimately slow.
 */
async function fetchWithConnectTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const caller = init.signal;
  const abort = () => controller.abort(caller?.reason);
  caller?.addEventListener("abort", abort);
  const timer = setTimeout(() => controller.abort(new Error("connect timeout")), connectTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", abort);
  }
}

async function* sseChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          yield JSON.parse(data);
        } catch {
          // A partial frame split across reads is handled by the buffer above; anything
          // else on this line is a comment or keep-alive.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function describeFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/connect timeout|fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(detail)) {
    return (
      `The chat endpoint at NOSANA_CHAT_ENDPOINT did not answer (${detail}). The mnemex graph ` +
      "tools are unaffected; check that the deployment is still serving /v1/models."
    );
  }
  return detail;
}
