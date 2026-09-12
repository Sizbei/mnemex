import { loadConfig } from "../config.js";
import { createLocalProvider } from "./local.js";
import { createNosanaProvider } from "./nosana.js";

export interface EmbedResult {
  vectors: number[][];
  degraded: string[];
}

export async function embedWithFallback(texts: string[]): Promise<EmbedResult> {
  if (texts.length === 0) return { vectors: [], degraded: [] };

  const { nosana } = loadConfig();
  if (nosana.endpoint) {
    try {
      const vectors = await createNosanaProvider().embed(texts);
      return { vectors, degraded: [] };
    } catch (err) {
      console.error(`[mnemex] Nosana embeddings unavailable, falling back to local: ${String(err)}`);
    }
  }

  const vectors = await createLocalProvider().embed(texts);
  return { vectors, degraded: ["embeddings:local"] };
}
