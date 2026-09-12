import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FIXTURE, CURRENT_DECISION, SUPERSEDED_DECISION, DISSENTER } from "../fixtures/conversation.js";
import { remember } from "../../src/tools/remember.js";
import { recall } from "../../src/tools/recall.js";
import { runQuery, closeDriver } from "../../src/graph/driver.js";

describe("golden: relational recall", () => {
  beforeAll(async () => {
    await runQuery("MATCH (n) WHERE n.testRun = $tag DETACH DELETE n", { tag: "golden" });
    for (const turn of FIXTURE) await remember({ ...turn, testRun: "golden" });
  }, 600_000);

  afterAll(async () => {
    await runQuery("MATCH (n) WHERE n.testRun = $tag DETACH DELETE n", { tag: "golden" });
    await closeDriver();
  });

  it("returns the current decision, not the one that was reversed", async () => {
    const result = await recall({ question: "what did we decide about the storage engine?" });
    const current = result.decisions.filter((d) => d.status === "current").map((d) => d.statement);
    expect(current).toContain(CURRENT_DECISION);
    expect(current).not.toContain(SUPERSEDED_DECISION);
  });

  it("reports the reversed decision as superseded", async () => {
    const result = await recall({ question: "what did we decide about the storage engine?" });
    const superseded = result.decisions.filter((d) => d.status === "superseded").map((d) => d.statement);
    expect(superseded).toContain(SUPERSEDED_DECISION);
  });

  it("names the person who disagreed, which flat vector search cannot do", async () => {
    const result = await recall({ question: "what did we decide about the storage engine, and who disagreed?" });
    const dissenters = result.decisions
      .flatMap((d) => d.positions)
      .filter((p) => p.stance === "DISAGREES_WITH")
      .map((p) => p.person);
    expect(dissenters).toContain(DISSENTER);
  });

  it("attaches the dissenter's actual argument, not just their name", async () => {
    const result = await recall({ question: "who disagreed about the storage engine?" });
    const objection = result.decisions
      .flatMap((d) => d.positions)
      .find((p) => p.person === DISSENTER && p.stance === "DISAGREES_WITH");
    expect(objection?.claim).toMatch(/graph traversal/i);
  });
});
