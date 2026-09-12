import path from "node:path";
import { EmbeddingModel, FlagEmbedding } from "fastembed";
import type { EmbeddingProvider } from "./types.js";

let ready: Promise<FlagEmbedding> | undefined;

function model(): Promise<FlagEmbedding> {
  ready ??= FlagEmbedding.init({
    // BGEBaseENV15, not BGEBaseEN. v1.0 is a different checkpoint from the
    // BAAI/bge-base-en-v1.5 that Nosana serves; both are 768-d but they are
    // not the same vector space.
    model: EmbeddingModel.BGEBaseENV15,
    maxLength: 512,
    // Defaults to the relative path "local_cache" against process.cwd().
    // An MCP client launches this server with an arbitrary cwd, so a relative
    // path silently re-downloads 195 MB into random directories.
    cacheDir: path.resolve(process.cwd(), ".model_cache"),
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
