# mnemex — Product Requirements Document

**Status:** approved for build
**Date:** 2026-09-12
**Context:** 48-hour hackathon submission
**Owner:** Sizbei

---

## 1. Problem

AI assistants forget. The standard fix is retrieval-augmented generation over a
vector store: chop transcripts into chunks, embed them, and pull back the
nearest neighbours at query time.

That works for "what was said about X" and fails for everything that depends on
structure:

- **Who held which position.** A chunk containing an objection does not record
  who made it. Attribution is lost the moment the text is flattened.
- **What is still true.** A reversed decision and the decision that reversed it
  are two similar chunks. Similarity search returns both, with no signal about
  which one survived.
- **How things connect.** "What did we decide about the schema, and who
  disagreed" is a two-hop traversal. No amount of top-k tuning turns it into one.

The failure is not retrieval quality. It is that the storage format threw the
relationships away before retrieval ever ran.

## 2. Product

mnemex is a persistent memory layer that writes conversations into a Neo4j
knowledge graph instead of a flat chunk index. Claims, the people who made them,
the decisions they support or oppose, and the decisions that later supersede
them are all first-class nodes and edges.

It ships as an MCP server, so any MCP-capable assistant gains durable,
relationship-aware memory by adding one entry to its config.

Recall is hybrid. A vector index finds where in the graph to start. Cypher
traversal from that seed collects what actually answers the question.

## 3. Users

**Primary:** a developer using an MCP-capable assistant across many sessions who
needs continuity of decisions, not a transcript search box.

**Secondary:** a team whose decisions are made across several conversations and
several people, where the record of who objected and what got reversed matters
more than what was literally said.

## 4. Goals

- **G1.** Recall answers relational questions that flat vector RAG cannot.
  The benchmark query is "what did we decide about X, and who disagreed".
- **G2.** Memory survives across sessions with no manual export or re-priming.
- **G3.** Sub-second recall during live chat.
- **G4.** Zero-config adoption. One MCP config entry, no schema authoring.
- **G5.** Graceful degradation. No remote dependency can hang the assistant.

## 5. Non-goals

Explicitly out of scope for this build:

- A chat UI. The assistant is the client.
- Multi-tenancy, accounts, or billing.
- Automatic extraction from raw unstructured transcripts. The assistant supplies
  structure through the tool schema.
- Replacing vector RAG for document search. mnemex stores conversational
  memory, not a corpus.
- Real-time collaborative editing of the graph.

## 6. Functional requirements

### FR1 — Write memory
The assistant calls `remember` with a session, a speaker, one or more claims,
and optionally a decision plus the speaker's stance toward it. The system
resolves the speaker against known people, deduplicates claims that restate
existing ones, detects when a decision supersedes an earlier one, and commits
the result as a single atomic transaction.

### FR2 — Recall memory
The assistant calls `recall` with a natural-language question. The system embeds
it, finds seed nodes through the vector index, and traverses the graph to
collect the current decision, the decisions it superseded, and every person who
supported or objected, with their claims attached.

### FR3 — Decision timeline
The assistant calls `timeline` with a topic and receives that topic's decision
history in order, showing what superseded what and who dissented at each step.

### FR4 — Analytical queries
For open-ended questions that the fixed traversals do not cover, the assistant
may supply Cypher directly. It executes inside an isolated sandbox against a
read-only credential and can never mutate the graph.

### FR5 — Direct graph access
The official Neo4j MCP server is configured alongside mnemex so the graph can be
inspected and demonstrated directly.

### FR6 — Degraded operation
Every tool response carries a `degraded` flag naming any subsystem currently
running on a fallback path.

## 7. Non-functional requirements

| Requirement | Target |
|---|---|
| Recall latency, warm path | under 1 second end to end |
| Write latency, warm path | under 2 seconds end to end |
| Remote call timeout before fallback | 3 seconds |
| Test coverage | 80 percent, per project standard |
| Secrets in version control | none, enforced by gitignore |

## 8. Platform requirements

Each platform is on the critical path by design, and each has a defined fallback.

**Neo4j Aura** is the system of record. Nodes, edges, and the vector index all
live there. No fallback: it is the product.

**Nosana** serves the embedding model that every write and every recall depends
on, deployed as vLLM on the NVIDIA 3070 market at roughly $0.07 per hour.
Fallback: a local embedding model, with `degraded` set.

**Daytona** provides isolated execution twice. On write it runs the
normalization worker that processes untrusted conversation text and produces the
merge plan. On read it executes assistant-generated Cypher. Model-authored code
that touches a user's memory graph should not run unsandboxed, and this is the
boundary that enforces it. Fallback: in-process normalization, with `degraded`
set, and analytical queries disabled entirely rather than run unsandboxed.

## 9. Success criteria

The build succeeds if all of the following hold:

1. A seeded multi-party conversation is queryable by the benchmark question, and
   the response names the correct dissenter and the correct current decision.
2. A decision written in one assistant session is recalled in a later session
   started from a clean context.
3. A reversed decision is reported as superseded, and the superseding decision is
   returned as current.
4. Every write embeds through Nosana and normalizes through Daytona on the
   happy path, demonstrably, not as a mock.
5. Killing either remote dependency degrades the system visibly without hanging
   or crashing the assistant.
6. The golden end-to-end test passes from a clean checkout.

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Nosana GPU market has no available node | Blocks the hot path | Local embedding fallback; deploy early in block 6-10, not on demo day |
| Daytona sandbox cold start inflates write latency | Demo feels sluggish | Pre-warm a sandbox before the demo; measure and publish real numbers |
| Entity resolution merges two distinct people | Wrong attribution, visible on stage | Conservative similarity threshold; prefer duplicates over false merges |
| Credit exhaustion mid-demo | Total Nosana failure | 130 hours of runway at current rates; monitor balance; fallback exists |
| Scope creep into extraction | Nothing finishes | Automatic extraction is an explicit non-goal for this build |

## 11. Demo narrative

1. Show an empty graph in Neo4j Browser.
2. Seed a multi-party engineering conversation in which a decision is made over
   one participant's objection.
3. Watch the graph populate live, with the objection edge visible.
4. Ask the benchmark question. Get back the decision and the named dissenter.
5. Reverse the decision in a new session. Show the supersession edge appear.
6. Ask again from a clean session. Get the new decision, correctly marked as
   superseding the old one.
7. Kill the Nosana endpoint. Ask again. It still answers, flagged as degraded.
