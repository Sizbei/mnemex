import path from "node:path";
import { fileURLToPath } from "node:url";
import { EmbeddingModel, FlagEmbedding } from "fastembed";
import type { EmbeddingProvider } from "./types.js";

/** Repo root, whether running from src/ under tsx or dist/src/ after a build. */
const MODEL_CACHE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  import.meta.url.includes("/dist/") ? "../../../.model_cache" : "../../.model_cache",
);

let ready: Promise<FlagEmbedding> | undefined;

function model(): Promise<FlagEmbedding> {
  ready ??= FlagEmbedding.init({
    // BGEBaseENV15, not BGEBaseEN. v1.0 is a different checkpoint from the
    // BAAI/bge-base-en-v1.5 that Nosana serves; both are 768-d but they are
    // not the same vector space.
    model: EmbeddingModel.BGEBaseENV15,
    maxLength: 512,
    // Resolved against this module, never process.cwd(). fastembed's default is
    // the relative path "local_cache", and both an MCP client and a Next.js
    // server launch with an arbitrary cwd, which silently re-downloads 195 MB
    // into random directories.
    cacheDir: MODEL_CACHE,
    showDownloadProgress: false,
  });
  return ready;
}

export function createLocalProvider(): EmbeddingProvider {
  return {
    name: "local",
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const embedder = await model();
      const out: number[][] = [];
      // The type declaration claims number[][]. At runtime embed() yields
      // Array<Float32Array>. Array.from is mandatory: a Float32Array passed to
      // the Neo4j driver or JSON.stringify becomes an object, not a list of floats.
      for await (const batch of embedder.embed(texts, 32)) {
        for (const vector of batch) out.push(Array.from(vector));
      }
      // Vectors arrive L2-normalized at norm 1.0. Do not normalize again.
      return out;
    },
  };
}
