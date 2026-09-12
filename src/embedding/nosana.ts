import { loadConfig } from "../config.js";
import type { EmbeddingProvider } from "./types.js";

export function createNosanaProvider(): EmbeddingProvider {
  const { nosana, remoteTimeoutMs } = loadConfig();
  return {
    name: "nosana",
    async embed(texts: string[]): Promise<number[][]> {
      if (!nosana.endpoint) throw new Error("NOSANA_ENDPOINT is not set");
      const res = await fetch(`${nosana.endpoint}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "embed", input: texts }),
        signal: AbortSignal.timeout(remoteTimeoutMs),
      });
      if (!res.ok) throw new Error(`nosana embeddings failed: ${res.status}`);
      const body = (await res.json()) as { data: { embedding: number[] }[] };
      return body.data.map((d) => d.embedding);
    },
  };
}
