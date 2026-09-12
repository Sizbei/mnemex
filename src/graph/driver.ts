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

/** Run one query. Failures throw: a memory write that silently vanishes is worse than an error. */
export async function runQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const { neo4j: cfg } = loadConfig();
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
