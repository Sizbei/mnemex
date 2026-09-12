import { readFile } from "node:fs/promises";
import { Daytona, type Sandbox } from "@daytonaio/sdk";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { lastJsonLine, sandboxSourcePath, QUIET_NPM } from "../sandbox/daytona.js";

const QUERY_PATH = sandboxSourcePath("query.ts");

/** The sandbox program stamps this on a Neo4j error so it is not mistaken for an outage. */
const ERROR_MARKER = "MNEMEX_QUERY_ERROR:";

export const AnalyzeSchema = z.object({
  cypher: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});

export type AnalyzeInput = z.input<typeof AnalyzeSchema>;
export interface AnalyzeResult { rows: unknown[]; degraded: string[] }

// `\b` after each keyword is what keeps a property named `createdAt` out of the net.
const WRITE_CLAUSES =
  /\b(create|merge|delete|set|remove|drop|detach|foreach|load\s+csv|call\s+apoc\.periodic)\b/i;

/**
 * Cheap static guard. It only approximates read-only; the real control is the
 * `accessMode: "READ"` Neo4j enforces server-side. This runs first so an obvious
 * write is refused without spending a sandbox.
 */
export function containsWrite(cypher: string): boolean {
  return WRITE_CLAUSES.test(cypher);
}

/** Aura hands out `neo4j+s://<id>.databases.neo4j.io`; the Query API lives on 443 at the same host. */
function queryApi(uri: string, database: string): { url: string; host: string } {
  const host = new URL(uri).hostname;
  if (!host) throw new Error(`cannot derive a Query API host from NEO4J_URI: ${uri}`);
  return { url: `https://${host}/db/${database}/query/v2`, host };
}

/** A query Neo4j itself rejected: a syntax error, or a write caught by accessMode. */
class QueryRejected extends Error {}

export async function analyze(raw: AnalyzeInput): Promise<AnalyzeResult> {
  const input = AnalyzeSchema.parse(raw);
  if (containsWrite(input.cypher)) {
    throw new Error("analyze accepts read-only Cypher; this query contains a write clause");
  }

  const { daytona, neo4j, analyzeTimeoutMs } = loadConfig();
  const timeoutSec = Math.ceil(analyzeTimeoutMs / 1000);
  const { url, host } = queryApi(neo4j.uri, neo4j.database);

  let sandbox: Sandbox | undefined;
  try {
    const source = await readFile(QUERY_PATH, "utf8");
    const payload = {
      url,
      auth: Buffer.from(`${neo4j.username}:${neo4j.password}`).toString("base64"),
      statement: input.cypher,
      parameters: input.params,
    };
    const code = source.replace(
      "declare const __MNEMEX_QUERY__: string;",
      `const __MNEMEX_QUERY__ = ${JSON.stringify(JSON.stringify(payload))};`,
    );

    const client = new Daytona({ apiKey: daytona.apiKey, apiUrl: daytona.apiUrl });
    // Sandboxes egress through an allow list. Naming the Aura host injects the
    // HTTP(S)_PROXY that opens it, and nothing else.
    sandbox = await client.create(
      { language: "typescript", envVars: QUIET_NPM, domainAllowList: host },
      { timeout: timeoutSec },
    );

    // codeRun's own timeout is in seconds and terminates the process server-side,
    // unlike a Promise.race which would orphan it.
    const execution = await sandbox.process.codeRun(code, undefined, timeoutSec);
    if (execution.exitCode !== 0) {
      const marked = execution.result.split("\n").find((l) => l.includes(ERROR_MARKER));
      // A rejected query is the caller's problem, so say so rather than blaming the sandbox.
      if (marked) throw new QueryRejected(marked.slice(marked.indexOf(ERROR_MARKER) + ERROR_MARKER.length).trim());
      throw new Error(`sandbox exit ${execution.exitCode}: ${execution.result.slice(0, 500)}`);
    }
    return { rows: JSON.parse(lastJsonLine(execution.result)) as unknown[], degraded: [] };
  } catch (err) {
    if (err instanceof QueryRejected) throw new Error(`Neo4j refused the query: ${err.message}`);
    // Never run model-authored Cypher unsandboxed. The write path degrades to an
    // in-process normalizer because that code is ours; this code is not, so disabled
    // is the only correct degraded state.
    console.error(`[mnemex] analyze disabled, sandbox unavailable: ${String(err)}`);
    return { rows: [], degraded: ["analyze:disabled"] };
  } finally {
    await sandbox?.delete().catch(() => {});
  }
}
