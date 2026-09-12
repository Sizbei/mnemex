import neo4j, { type Driver } from "neo4j-driver";
import { loadConfig } from "../config.js";

let driver: Driver | undefined;

export function getDriver(): Driver {
  if (driver) return driver;
  const { neo4j: cfg } = loadConfig();
  driver = neo4j.driver(cfg.uri, neo4j.auth.basic(cfg.username, cfg.password), {
    // Counts and scores sit well inside Number's safe range; native numbers keep call sites plain.
    disableLosslessIntegers: true,
    connectionTimeout: 10_000,
    connectionAcquisitionTimeout: 10_000,
  });
  return driver;
}

/** neo4j+s://<id>.databases.neo4j.io becomes https://<id>.databases.neo4j.io/db/<name>/query/v2 */
function queryApiUrl(): string {
  const { neo4j: cfg } = loadConfig();
  const host = cfg.uri.replace(/^[a-z0-9+.-]+:\/\//i, "").split("/")[0].split(":")[0];
  return `https://${host}/db/${cfg.database}/query/v2`;
}

/**
 * Same contract as the Bolt path: one row object per record.
 *
 * Used when NEO4J_TRANSPORT is "http". Daytona sandboxes egress on 80 and 443
 * only, so a deployed copy of this app cannot open a Bolt connection and has to
 * go through Aura's query API instead.
 */
async function runOverHttp<T>(cypher: string, params: Record<string, unknown>): Promise<T[]> {
  const { neo4j: cfg } = loadConfig();
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");

  const res = await fetch(queryApiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ statement: cypher, parameters: params }),
  });

  const body = (await res.json()) as {
    data?: { fields: string[]; values: unknown[][] };
    errors?: { message: string; code: string }[];
  };
  if (body.errors?.length) {
    throw new Error(`${body.errors[0].code}: ${body.errors[0].message}`);
  }
  if (!res.ok || !body.data) {
    throw new Error(`Neo4j query API returned ${res.status}`);
  }

  const { fields, values } = body.data;
  return values.map((row) => Object.fromEntries(fields.map((f, i) => [f, row[i]])) as T);
}

/** Run one query. Failures throw: a memory write that silently vanishes is worse than an error. */
export async function runQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const { neo4j: cfg } = loadConfig();
  if (cfg.transport === "http") return runOverHttp<T>(cypher, params);

  const session = getDriver().session({ database: cfg.database });
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

export async function closeDriver(): Promise<void> {
  const d = driver;
  driver = undefined;
  await d?.close();
}
