# mnemex — speaker notes

Talking points for `mnemex.pdf`, one section per slide. These are prompts, not a
script. Where a sentence is written out in full, it is because the exact phrasing
does work that a bullet would lose. Say those as written, improvise the rest.

Rough total: **9 to 11 minutes** at a normal pace. Times per slide are guides,
not targets. If you are running long, slides 5 and 9 are the ones to compress.

---

## 1 — Title · 30 seconds

- Say the name, then immediately say what it is. Do not open with the tech list.
- **"mnemex is persistent memory for an AI assistant, stored as a knowledge graph instead of a flat chunk index."** That one sentence is the whole pitch.
- Point at the chips only if the audience is technical. Otherwise skip them.
- Do not explain the graph yet. You are two slides away from the payoff.

**Transition:** "To explain why that matters, I need to show you what the normal approach loses."

---

## 2 — The problem · 60 to 75 seconds

This is the slide that earns the rest of the talk. Do not rush it.

- Describe standard RAG in one breath: chop the transcript, embed the chunks, return the nearest neighbours.
- Concede the thing it is good at first. It genuinely answers "what was said about X". You are not attacking retrieval quality.
- Then walk the three failures, one card at a time:
  - **Who held which position.** A chunk that contains an objection does not record who made it.
  - **What is still true.** A reversed decision and the decision that reversed it are two very similar chunks. Similarity returns both and cannot tell you which one survived.
  - **How things connect.** "What did we decide, and who disagreed" is two hops. Top-k tuning never turns it into one.
- Land the kicker as written: **"The failure is not retrieval quality. The storage format threw the relationships away before retrieval ever ran."**

**Transition:** "So the fix is not a better index. It is a different shape."

---

## 3 — The idea · 60 seconds

Let the diagram do the talking. Trace it with your hand, left to right.

- Three people take positions on one decision. Priya proposes it, Dana supports it, Marcus argues against it.
- Stress that **the objection is an edge, not a sentence.** Marcus's disagreement is stored as a typed relationship, so you can ask for it directly.
- Then the reversal on the right. In a later session the decision is overturned, and that reversal is also an edge.
- The point: **"Every label on this diagram is a real edge in Neo4j. Nothing here is inferred at query time."**
- If asked how the structure gets there: the assistant supplies it through the tool schema. mnemex does not scrape it out of raw transcripts. That is a deliberate non-goal.

**Transition:** "That is the data model. Here is the surface an assistant actually talks to."

---

## 4 — What it does · 75 seconds

- Frame it first: this is an MCP server, so any MCP-capable assistant gets all of this by adding one entry to its config.
- Three tools cover the normal path, one is an escape hatch:
  - **remember** — one speaker turn goes in. It resolves who the speaker is, drops claims that restate something already stored, notices when a decision overrides an earlier one, and commits the lot atomically.
  - **recall** — a plain-language question comes in, decisions come back with everyone's position attached and the supersession chain in both directions.
  - **timeline** — a topic's decision history in order.
  - **analyze** — Cypher the assistant wrote itself, for questions the three fixed traversals cannot express. Read-only, and sandboxed.
- Walk the code block briefly. The thing to point at is `stance: "disagrees"`, because that single field is what becomes the edge from slide 3.
- Close on the kicker: every response carries a `degraded` array. Empty means everything ran on the real path. It is never silent about running on a fallback.

**Transition:** "Underneath, that is five kinds of node and eight kinds of edge."

---

## 5 — Graph schema · 45 seconds

Reference slide. Do not read it aloud. Pick three things and move on.

- Point at **DISAGREES_WITH** and say: this is the edge a chunk index cannot represent.
- Point at **SUPERSEDES** and say: this is what makes "what is still true" a query rather than a guess.
- Mention that a decision's status is current, superseded, or open, and that supersession flips it automatically.
- One line on the indexes: two cosine vector indexes at 768 dimensions, created by one bootstrap script. No schema authoring required.

**If you are behind schedule, this is the slide to cut to fifteen seconds.**

---

## 6 — Write path · 75 seconds

- The headline is the argument: **"Untrusted text never plans its own merge."**
- Walk the four steps, but spend your time on step three.
  1. Embed the claims and the decision on a GPU-served model.
  2. Pull the 25 nearest claims and decisions back as a bounded candidate set.
  3. Plan the merge inside a Daytona sandbox, then validate the plan against the candidate set it was handed.
  4. Commit people, claims, stance edges and the supersession edge to Neo4j.
- Why the sandbox: this is the code deciding whether two people are the same person, working on text the model produced. **"Code that decides who said what should not run in the same process as everything else."**
- Why validation after the sandbox: a plan that points at anything outside the candidate set it was given is rejected. Sandboxing is not the same as trusting the output.
- The 0.97 threshold is worth saying out loud: **"Duplicate nodes are recoverable. A wrong merge attributes someone's argument to the wrong person. So the threshold is deliberately conservative."**

**Transition:** "Reading is the mirror image."

---

## 7 — Read path · 60 seconds

- The one-liner is the heading: **"The vector index finds where to start. Cypher collects the answer."**
- Say plainly that this is a hybrid, and that the vector part is doing less work than people assume. It picks entry points. It does not rank the answer.
- The traversal is what produces the result: out to every claim for and against, back to the person behind each claim, and along the supersession chain both ways.
- Ranking rule, in one sentence: decisions that still stand sort first, because what is currently true is what the caller asked for.
- Then point at the screenshot. The current decision and the superseded one are side by side, and Marcus is named as the dissenter with his actual argument attached, not just his name.

**Transition:** "And that is not a mock. Here is the real graph."

---

## 8 — Live memory · 45 seconds

Demo-substitute slide. If the live demo works, skip this. If it does not, this is your safety net.

- Thirteen nodes and thirty edges, from a five-turn seeded conversation across two sessions.
- Click behaviour: selecting a node isolates it and everything one hop away.
- Read two lines off the inspector, no more. **DISAGREES_WITH** and **SUPERSEDES** are the two that make the point.
- The numbers along the bottom are the honest scale of the demo. Say so. It is a fixture, not a production corpus.

---

## 9 — Technology · 75 seconds

Six cards. Do not narrate all six. Group them.

- **Neo4j Aura** is the system of record and has no fallback, because it is the product.
- **Nosana, twice.** This is the part worth dwelling on:
  - The embedding model, which every write and every read depends on.
  - The instruct model, Qwen2.5-7B, with tool calling. **"The assistant calling mnemex is itself running on rented GPU, so the whole loop is on decentralised infrastructure."**
- **Daytona, also twice.** The merge planner on write, and assistant-authored Cypher on read. Different code, same reason.
- **MCP SDK** — worth one line: the Zod schemas are simultaneously the tool contract and the runtime validation, so the two cannot drift apart.
- Skip the demo-surface card unless someone asks about the UI.
- Close on the kicker: the golden test runs end to end against a live database, not a mock.

---

## 10 — Build status · 60 to 75 seconds

This is your credibility slide. The framing is verified, not planned.

- Open with the headline: **"Two of five agents are in, and both landed working infrastructure rather than scaffolding."**
- **analyze is live.** A real analytical query ran generated Cypher in a sandbox against a read-only credential with nothing degraded. Point at the output: that is the full stance breakdown per person, and none of the three fixed traversals can produce that shape.
- Add the guard behaviour: writes are refused in under half a second, without ever spending a sandbox on them.
- The timeout decision is worth one sentence because it shows judgement rather than a default: **"Analyze has no fallback by design, so waiting out a slow sandbox is the only useful response. A write does have a fallback, so it should degrade in process quickly instead of stalling."**
- **The chat model is live.** Stress *verified*: it returned a well-formed tool call for `recall` with parseable arguments, and named the dissenter correctly when the result was fed back. Tool calling was tested, not assumed.
- The corrections are optional. Include them with a technical audience, because admitting what cost you time reads as honesty, not weakness. Skip them if you are short.
- The stat row is your resource story. Credits reserved, both endpoints live, and the a6000 market chosen because every 3090 and 4090 was busy.
- Footer line, said lightly: three agents are still running.

---

## 11 — Run it · 60 seconds

Two halves. Do the left, gesture at the right.

- Left is the failure story, and the heading is the claim: **"Nothing remote is allowed to hang the assistant."**
  - Nosana goes away, embeddings fall back to a local model.
  - Daytona goes away on the write path, merge planning happens in process.
  - Daytona goes away on the read path, `analyze` switches off entirely. **"Model-authored Cypher never runs unsandboxed. Disabled is the only correct degraded state."**
  - Neo4j goes away and the write throws. Say why: memory that silently vanishes is worse than an error.
- Note that each fallback names itself in the `degraded` array, which closes the loop with slide 4.
- Right side: do not read the commands. Say it is four commands to a working graph and one more to give an assistant durable memory.
- The one caveat worth voicing: pass the environment in the MCP config, because the client launches the server from an arbitrary directory.

**Close on the through-line, not the commands:** "The reason any of this works is on slide two. We stored the relationships instead of throwing them away."

---

## Questions you should expect

- **"Why not just use a bigger context window?"** Context is per session. This is cross-session, and it is queryable by relationship rather than by recency.
- **"Who decides what counts as a claim or a decision?"** The assistant does, through the tool schema. Automatic extraction from raw transcripts is an explicit non-goal for this build.
- **"What happens when two people have the same name?"** Entity resolution is conservative by design and will create a duplicate rather than risk a wrong merge. Duplicates are recoverable; misattribution is not.
- **"Is the latency real?"** Be careful here. The 642 ms figure on slide 11 was measured on the local embedding path. A cold run on the Nosana path measured about 2.9 seconds. Neither is a benchmark, and you should say so rather than round in your favour.
- **"Can it modify the graph through analyze?"** No. There is a static write-clause check before a sandbox is ever created, and the database credential is read-only, which is the guarantee that actually matters.
