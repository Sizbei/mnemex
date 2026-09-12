export interface FixtureTurn {
  sessionId: string;
  sessionTitle: string;
  speaker: string;
  claims: string[];
  topic: string;
  decision?: { statement: string; stance: "supports" | "disagrees" | "proposes" };
}

export const FIXTURE: FixtureTurn[] = [
  {
    sessionId: "s1",
    sessionTitle: "Storage layer review",
    speaker: "Priya",
    topic: "storage engine",
    claims: ["Postgres gives us transactional guarantees we already understand."],
    decision: { statement: "Use Postgres as the primary datastore", stance: "proposes" },
  },
  {
    sessionId: "s1",
    sessionTitle: "Storage layer review",
    speaker: "Marcus",
    topic: "storage engine",
    claims: ["Our access pattern is almost entirely graph traversal, and Postgres will make that painful."],
    decision: { statement: "Use Postgres as the primary datastore", stance: "disagrees" },
  },
  {
    sessionId: "s1",
    sessionTitle: "Storage layer review",
    speaker: "Dana",
    topic: "storage engine",
    claims: ["Operationally Postgres is the thing we can actually run on call."],
    decision: { statement: "Use Postgres as the primary datastore", stance: "supports" },
  },
  {
    sessionId: "s2",
    sessionTitle: "Storage layer, revisited",
    speaker: "Marcus",
    topic: "storage engine",
    claims: ["The traversal queries are now eight joins deep and the latency is unacceptable."],
    decision: { statement: "Move the primary datastore to Neo4j", stance: "proposes" },
  },
  {
    sessionId: "s2",
    sessionTitle: "Storage layer, revisited",
    speaker: "Priya",
    topic: "storage engine",
    claims: ["The join depth argument is convincing, I withdraw my earlier position."],
    decision: { statement: "Move the primary datastore to Neo4j", stance: "supports" },
  },
];

/** The decision that must come back as current. */
export const CURRENT_DECISION = "Move the primary datastore to Neo4j";
/** The decision that must come back marked superseded. */
export const SUPERSEDED_DECISION = "Use Postgres as the primary datastore";
/** The person who must be named as having objected to the superseded decision. */
export const DISSENTER = "Marcus";
