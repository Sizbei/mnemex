# mnemex — Design Specification

**Date:** 2026-09-12
**Companion document:** [PRD.md](../../../PRD.md)
**Status:** approved

---

## 1. Architecture

Five components. The MCP server is the only thing the assistant talks to.

```
Assistant (Claude Code)
        │  MCP stdio
        ▼
┌───────────────────────┐
│  mnemex MCP server    │  TypeScript, local process
│  remember/recall/     │
│  timeline/analyze     │
└───┬─────────┬─────────┘
    │         │
    │         ├──────────► Nosana  (vLLM, OpenAI-compatible /v1/embeddings)
    │         │             fallback: local embedding model
    │         │
    │         └──────────► Daytona (sandbox: merge planning, generated Cypher)
    │                       fallback: in-process normalizer
    ▼
Neo4j Aura  ◄──────────── Neo4j MCP server (direct Cypher, demo + debugging)
```

The server orchestrates and owns the database transaction. Nothing else writes
to Neo4j. The Daytona sandbox computes a plan and returns it; the server decides
whether to commit it. This keeps a faulty or hostile plan from half-writing the
graph.

**Language:** TypeScript throughout, including the code that runs inside the
Daytona sandbox. Nosana and Daytona both publish first-party TypeScript SDKs and
the MCP SDK is first-class there. One toolchain, one set of types.

## 2. Graph schema

### Node labels

| Label | Purpose | Key properties |
|---|---|---|
| `Session` | One conversation | `id`, `title`, `startedAt` |
| `Person` | A participant | `id`, `name`, `aliases` |
| `Topic` | Subject matter | `id`, `name`, `slug` |
| `Decision` | An outcome reached | `id`, `statement`, `status`, `decidedAt`, `embedding` |
| `Claim` | One atomic thing said | `id`, `text`, `saidAt`, `embedding` |

`Decision.status` is one of `current`, `superseded`, or `open`.

### Relationships

| Edge | Meaning |
|---|---|
| `(Claim)-[:STATED_BY]->(Person)` | Attribution. Every position has an owner. |
| `(Claim)-[:SUPPORTS]->(Decision)` | Agreement with an outcome. |
| `(Claim)-[:DISAGREES_WITH]->(Decision)` | Dissent. The edge flat chunks cannot represent. |
| `(Decision)-[:SUPERSEDES]->(Decision)` | Decision history. Enables "what is still true". |
| `(Claim)-[:ABOUT]->(Topic)` | Subject linkage. |
| `(Decision)-[:ABOUT]->(Topic)` | Subject linkage. |
| `(Claim)-[:IN_SESSION]->(Session)` | Provenance. |
| `(Decision)-[:DECIDED_IN]->(Session)` | Provenance. |
| `(Person)-[:PARTICIPATED_IN]->(Session)` | Roster. |

### Constraints and indexes

```cypher
CREATE CONSTRAINT person_id   IF NOT EXISTS FOR (p:Person)   REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT topic_id    IF NOT EXISTS FOR (t:Topic)    REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT session_id  IF NOT EXISTS FOR (s:Session)  REQUIRE s.id IS UNIQUE;
CREATE CONSTRAINT claim_id    IF NOT EXISTS FOR (c:Claim)    REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (d:Decision) REQUIRE d.id IS UNIQUE;

CREATE INDEX topic_slug IF NOT EXISTS FOR (t:Topic) ON (t.slug);

CREATE VECTOR INDEX claim_embedding IF NOT EXISTS
FOR (c:Claim) ON (c.embedding)
OPTIONS { indexConfig: {
  `vector.dimensions`: 768,
  `vector.similarity_function`: 'cosine'
}};

CREATE VECTOR INDEX decision_embedding IF NOT EXISTS
FOR (d:Decision) ON (d.embedding)
OPTIONS { indexConfig: {
  `vector.dimensions`: 768,
  `vector.similarity_function`: 'cosine'
}};
```

Dimension is fixed at 768 to match the served embedding model. It is read from
config so a model swap does not require a code change, but changing it requires
dropping and rebuilding the indexes.

## 3. MCP tool surface

### `remember`

Writes one speaker turn.

```ts
{
  sessionId: string
  sessionTitle?: string
  speaker: string
  claims: string[]
  topic?: string
  decision?: { statement: string; stance: "supports" | "disagrees" | "proposes" }
}
```

Returns created node ids, any merges applied, and `degraded`.

### `recall`

The primary read. Answers relational questions.

```ts
{ question: string; topK?: number; maxHops?: 1 | 2 }
```

Returns current decisions, superseded decisions, and per-person stances with the
claims that support them, plus `degraded`.

### `timeline`

```ts
{ topic: string }
```

Returns that topic's decisions ordered by time, with supersession links and
dissenters at each step.

### `analyze`

Escape hatch for questions the fixed traversals do not cover. The assistant
supplies Cypher. It runs in a Daytona sandbox under a read-only credential.
Disabled, not silently downgraded, when the sandbox is unavailable.

```ts
{ cypher: string; params?: Record<string, unknown> }
```

## 4. Data flow

### Write path

1. Validate the payload against a schema. Reject early and loudly.
2. Embed every claim text and the decision statement via Nosana.
3. Fetch candidate neighbours from Neo4j: people with similar names, claims and
   decisions near the new embeddings, existing topic nodes.
4. Send the payload, its embeddings, and the candidates to a Daytona sandbox.
   The sandbox runs a pure function and returns a **merge plan**: alias
   resolutions, claim deduplications, and any supersession it detected.
5. Validate the plan. Reject anything referencing an id not in the candidate set.
6. Execute the plan as one Cypher transaction.
7. Return ids, applied merges, and `degraded`.

Step 5 matters. The sandbox is isolated, but the server still refuses to act on
a plan that reaches outside the data it was given.

### Read path

1. Embed the question via Nosana.
2. Query both vector indexes for seed nodes.
3. Run a **fixed, parameterized** traversal from those seeds. This query is
   handwritten and covered by tests. It is never generated at runtime.
4. Assemble a structured answer.

The traversal, in essence:

```cypher
MATCH (d:Decision)
WHERE d.id IN $seedDecisionIds
OPTIONAL MATCH (d)-[:SUPERSEDES*1..3]->(old:Decision)
OPTIONAL MATCH (newer:Decision)-[:SUPERSEDES*1..3]->(d)
OPTIONAL MATCH (c:Claim)-[r:SUPPORTS|DISAGREES_WITH]->(d)
OPTIONAL MATCH (c)-[:STATED_BY]->(p:Person)
RETURN d, collect(DISTINCT old) AS superseded,
       collect(DISTINCT newer) AS supersededBy,
       collect(DISTINCT { person: p.name, stance: type(r), claim: c.text }) AS positions
```

### Analytical path

Assistant-supplied Cypher goes to a Daytona sandbox holding a read-only Neo4j
credential. The sandbox has no write grant, so isolation is defence in depth
rather than the only control.

## 5. Failure handling

Every remote call has a 3-second timeout and a defined fallback.

| Subsystem | On failure | `degraded` value |
|---|---|---|
| Nosana embeddings | Local embedding model | `embeddings:local` |
| Daytona write sandbox | In-process normalizer | `normalizer:inprocess` |
| Daytona read sandbox | `analyze` returns an error | `analyze:disabled` |
| Neo4j write conflict | Retry once, then surface | n/a |
| Neo4j unreachable | Tool call fails loudly | n/a |

Neo4j has no fallback on purpose. Silently accepting writes that go nowhere is
worse than an error.

## 6. Testing strategy

Test-first, per project standard.

**The golden test is written before any implementation.** It seeds a fixture
conversation in which three people discuss a technical choice, a decision is
made over one person's objection, and that decision is later reversed. It then
asserts that `recall` returns the current decision, reports the old one as
superseded, and names the correct dissenter. When this test is green the demo
works, which makes it the single most valuable artifact in the repo.

**Unit tests** cover schema validation, the merge-plan function, which is pure
and needs no sandbox, plan validation including the rejection of out-of-scope
ids, and the fallback switches.

**Integration tests** run the full write and read paths against a scratch Neo4j
database with Nosana and Daytona stubbed, then once more against the live
services as a smoke test.

Coverage target is 80 percent.

## 7. Repository layout

```
mnemex/
├── PRD.md
├── README.md
├── .env.example
├── src/
│   ├── server.ts          MCP server entry, tool registration
│   ├── tools/             one file per tool
│   ├── graph/             driver, schema bootstrap, Cypher queries
│   ├── embedding/         Nosana client, local fallback, common interface
│   ├── sandbox/           Daytona client, plan validation
│   └── config.ts          env loading and validation
├── sandbox/
│   └── normalize.ts       code executed inside the Daytona sandbox
├── tests/
│   ├── golden/            the end-to-end benchmark test
│   ├── unit/
│   └── fixtures/          seeded multi-party conversation
├── scripts/
│   ├── deploy-nosana.ts   create and start the embedding deployment
│   ├── bootstrap-graph.ts constraints and vector indexes
│   └── seed-demo.ts       load the fixture conversation
└── docs/
```

## 8. Configuration

All secrets live in a gitignored `.env`. `.env.example` documents the shape.

```
NEO4J_URI=
NEO4J_USERNAME=
NEO4J_PASSWORD=
NEO4J_DATABASE=neo4j
NOSANA_API_KEY=
NOSANA_API_URL=https://dashboard.k8s.prd.nos.ci/api
NOSANA_MARKET=RXP7JK8MTY4uPJng4UjC9ZJdDDSG6wGr8pvVf3mwgXF
NOSANA_ENDPOINT=
DAYTONA_API_KEY=
DAYTONA_API_URL=https://app.daytona.io/api
EMBEDDING_DIMENSIONS=768
REMOTE_TIMEOUT_MS=3000
```

`NOSANA_MARKET` defaults to the NVIDIA 3070 market. That market enforces an
image allowlist which excludes text-embeddings-inference but includes
`vllm/vllm-openai:v0.10.2`, so the deployment serves an embedding model through
vLLM's OpenAI-compatible route.

## 8a. Neo4j MCP server

The official Neo4j MCP server runs alongside mnemex, pointed at the same Aura
instance. mnemex owns the typed memory operations; the Neo4j server provides raw
Cypher for inspection, debugging, and live demonstration of the graph.

Registered as:

```
claude mcp add neo4j -- uvx mcp-neo4j-cypher@latest \
  --db-url "$NEO4J_URI" --username "$NEO4J_USERNAME" --password "$NEO4J_PASSWORD"
```

This is a deliberate separation. Judges and developers can see that the graph is
real and inspect it directly, without mnemex mediating what they are allowed to
look at. It also gives a fast debugging loop during the build: when a traversal
returns the wrong dissenter, the raw query is one tool call away.

## 9. Open decisions

Deliberately deferred, with a default chosen so nothing blocks:

- **Embedding model.** Default to a 768-dimension general-purpose model served by
  vLLM. Confirm against what the 3070 market's 8GB of VRAM comfortably holds
  when the deployment is created.
- **Alias-merge threshold.** Start conservative. Under-merging produces visible
  duplicates; over-merging produces wrong attribution on stage, which is worse.
- **Sandbox reuse.** Start with one sandbox per write. Move to a pooled warm
  sandbox only if measured latency demands it.
