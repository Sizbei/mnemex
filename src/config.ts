import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const Schema = z.object({
  NEO4J_URI: z.string().min(1),
  NEO4J_USERNAME: z.string().min(1),
  NEO4J_PASSWORD: z.string().min(1),
  NEO4J_DATABASE: z.string().min(1),
  NOSANA_API_KEY: z.string().min(1),
  NOSANA_API_URL: z.string().url(),
  NOSANA_MARKET: z.string().min(1),
  NOSANA_ENDPOINT: z.string().optional(),
  DAYTONA_API_KEY: z.string().min(1),
  DAYTONA_API_URL: z.string().url(),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  REMOTE_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  DAYTONA_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  ANALYZE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
});

export interface Config {
  neo4j: { uri: string; username: string; password: string; database: string };
  nosana: { apiKey: string; apiUrl: string; market: string; endpoint: string | null };
  daytona: { apiKey: string; apiUrl: string };
  embeddingDimensions: number;
  remoteTimeoutMs: number;
  /** Daytona needs its own budget: sandbox create alone ranges 0.9 to 6.3 seconds. */
  daytonaTimeoutMs: number;
  /**
   * analyze gets a longer budget than the write path. Measured 3.4 to 5 seconds
   * typical with a 13.4 second outlier, because domainAllowList adds proxy setup
   * to create. The write path must keep the short budget: it falls back in
   * process, so a slow sandbox should degrade quickly rather than stall a write.
   * analyze has no fallback by design, so waiting is the only useful option.
   */
  analyzeTimeoutMs: number;
}

export function loadConfig(): Config {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${missing}`);
  }
  const e = parsed.data;
  return {
    neo4j: {
      uri: e.NEO4J_URI,
      username: e.NEO4J_USERNAME,
      password: e.NEO4J_PASSWORD,
      database: e.NEO4J_DATABASE,
    },
    nosana: {
      apiKey: e.NOSANA_API_KEY,
      apiUrl: e.NOSANA_API_URL,
      market: e.NOSANA_MARKET,
      endpoint: e.NOSANA_ENDPOINT && e.NOSANA_ENDPOINT.length > 0 ? e.NOSANA_ENDPOINT : null,
    },
    daytona: { apiKey: e.DAYTONA_API_KEY, apiUrl: e.DAYTONA_API_URL },
    embeddingDimensions: e.EMBEDDING_DIMENSIONS,
    remoteTimeoutMs: e.REMOTE_TIMEOUT_MS,
    daytonaTimeoutMs: e.DAYTONA_TIMEOUT_MS,
    analyzeTimeoutMs: e.ANALYZE_TIMEOUT_MS,
  };
}
