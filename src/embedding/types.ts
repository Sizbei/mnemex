export interface EmbeddingProvider {
  /** "nosana" or "local". Callers use this to populate the degraded field. */
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}
