import type { ServerResponse } from "node:http";

/**
 * AgentUX event writer.
 *
 * The exported client reads one turn as newline-delimited JSON, parses each line as an
 * AgentUX event, and refuses to treat a stream that ended without run.finished or run.error
 * as a successful turn. The envelope below is the one in the AgentUX protocol package
 * (protocol, version, id, runId, seq, ts, type, payload); it is written out by hand so the
 * backend stays runnable from the repository root, where the vendored SDK is not installed.
 */
export type AgentUXEvent = {
  protocol: "agent-ux";
  version: "0.1";
  id: string;
  runId: string;
  messageId?: string;
  seq: number;
  ts: number;
  type: string;
  payload: Record<string, unknown>;
};

export class TurnStream {
  private seq = 0;
  private closed = false;

  constructor(
    private readonly response: ServerResponse,
    readonly runId: string,
  ) {}

  emit(type: string, payload: Record<string, unknown> = {}, messageId?: string): void {
    if (this.closed) return;
    this.seq += 1;
    const event: AgentUXEvent = {
      protocol: "agent-ux",
      version: "0.1",
      id: `${this.runId}_${this.seq}`,
      runId: this.runId,
      ...(messageId ? { messageId } : {}),
      seq: this.seq,
      ts: Date.now(),
      type,
      payload,
    };
    this.response.write(`${JSON.stringify(event)}\n`);
  }

  /** One complete text block. Used for the user turn, which arrives already whole. */
  text(role: "user" | "assistant", textId: string, body: string, messageId: string): void {
    this.emit("text.started", { textId, role, format: role === "user" ? "plain" : "markdown" }, messageId);
    this.emit("text.delta", { textId, delta: body }, messageId);
    this.emit("text.finished", { textId }, messageId);
  }

  /** Terminal. Nothing is written after this, so a late failure cannot reopen a closed run. */
  end(type: "run.finished" | "run.error", payload: Record<string, unknown> = {}): void {
    if (this.closed) return;
    this.emit(type, payload);
    this.closed = true;
    this.response.end();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
