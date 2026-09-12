import { describe, it, expect, vi, afterEach } from "vitest";
import { analyze, containsWrite } from "../../src/tools/analyze.js";

// Mocking globalThis.fetch would not make Daytona unreachable: its SDK uses axios.
// The module itself is what has to fail.
vi.mock("@daytonaio/sdk", () => ({
  Daytona: class {
    create(): never {
      throw new Error("no route to host");
    }
  },
}));

afterEach(() => vi.restoreAllMocks());

describe("containsWrite", () => {
  for (const cypher of [
    "MATCH (n) DELETE n",
    "create (n:Person)",
    "MATCH (n) SET n.x = 1",
    "MERGE (n:Person {id:'x'})",
    "MATCH (n) DETACH DELETE n",
    "MATCH (n) REMOVE n.x",
    "DROP INDEX claim_embedding",
    "MATCH (n) FOREACH (x IN [1] | SET n.x = x)",
    "LOAD CSV FROM 'file:///x.csv' AS row RETURN row",
    "CALL apoc.periodic.iterate('MATCH (n) RETURN n','DELETE n',{})",
  ]) {
    it(`rejects: ${cypher.slice(0, 40)}`, () => expect(containsWrite(cypher)).toBe(true));
  }

  it("allows a plain read", () => {
    expect(containsWrite("MATCH (d:Decision) RETURN d.statement LIMIT 10")).toBe(false);
  });

  it("does not false-positive on a property named createdAt", () => {
    expect(containsWrite("MATCH (n) RETURN n.createdAt")).toBe(false);
  });
});

describe("analyze", () => {
  it("refuses a write query before any sandbox is started", async () => {
    await expect(analyze({ cypher: "MATCH (n) DETACH DELETE n" })).rejects.toThrow(/read-only/i);
  });

  it("reports analyze:disabled rather than running unsandboxed when Daytona is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await analyze({ cypher: "MATCH (d:Decision) RETURN d LIMIT 1" });
    expect(result.degraded).toContain("analyze:disabled");
    expect(result.rows).toEqual([]);
  });
});
