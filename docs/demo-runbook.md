# mnemex demo runbook

A live script for the demo narrative in [section 11 of the PRD](../PRD.md).

The demo runs on an empty graph and fills it in front of the audience. Every write goes through the real `remember` tool over MCP. Nothing is pre-recorded.

Budget roughly eight minutes. Steps 1 through 6 are the argument. Step 7 is the degradation proof.

---

## Pre-flight

Do all of this before the audience is watching. Every item has a fix that takes longer than the demo slot.

**1. Nosana credit balance is above zero.**

```bash
set -a && . ./.env && set +a
curl -s -H "Authorization: Bearer $NOSANA_API_KEY" "$NOSANA_API_URL/credits/balance"
```

If the balance is zero, the demo still works. It runs on the local fallback and every response is flagged `embeddings:local`. Decide before you go on stage whether you are demoing the Nosana path or narrating the fallback, and do not discover which one at step 4.

**2. The Nosana endpoint answers with a 768-dimensional vector.**

```bash
curl -s "$NOSANA_ENDPOINT/v1/embeddings" -H 'Content-Type: application/json' \
  -d '{"model":"embed","input":["hello"]}' | jq '.data[0].embedding | length'
```

Expected: `768`. Any other number means the served model does not match the vector indexes, and recall will return nothing useful. Rebuilding the indexes at a different dimension is not a live-demo operation.

If `NOSANA_ENDPOINT` is unset or the call fails, mnemex will run degraded for the whole demo. That is a working demo, not a broken one. Say so out loud at step 4 rather than letting someone spot the flag first.

**3. The local embedding model is already downloaded.**

```bash
ls .model_cache/fast-bge-base-en-v1.5/model_optimized.onnx
```

The file must exist. First use downloads roughly 195 MB, and step 7 is the step where that download would happen if you skipped this. Warm it by running `npm run demo` once.

**4. The graph is reachable, bootstrapped, and empty.**

```bash
npm run bootstrap
```

Expected: eight `applied:` lines and `8 statements applied.` The statements all use `IF NOT EXISTS`, so re-running is safe.

Then clear it. This Aura instance holds nothing but mnemex memory, so deleting the five labels is a clean reset.

```cypher
MATCH (n) WHERE n:Person OR n:Claim OR n:Decision OR n:Topic OR n:Session DETACH DELETE n
```

**5. Both MCP servers are connected.**

```bash
npm run build
claude mcp add mnemex -- node "$(pwd)/dist/src/server.js"
set -a && . ./.env && set +a
claude mcp add neo4j -- uvx mcp-neo4j-cypher@latest \
  --db-url "$NEO4J_URI" --username "$NEO4J_USERNAME" --password "$NEO4J_PASSWORD" --database "$NEO4J_DATABASE"
claude mcp list
```

Expected: both `mnemex` and `neo4j` report connected. `mnemex` points at `dist/src/server.js`, not `dist/server.js`. If you changed anything under `src/`, run `npm run build` again before connecting, because the server runs the compiled output.

**6. The web dev server is running.**

```bash
ln -s ../.env web/.env        # once per clone, gitignored
cd web && npm install && npm run dev
```

Open `http://localhost:3000` and leave it on the Memory graph tab. The web app imports the compiled `dist/` build, so it needs `npm run build` at the repo root first, and it needs `web/.env` because Next.js loads `.env` relative to its own working directory.

**7. A rehearsal pass is done and undone.**

Run the whole script once, then clear the graph again with the Cypher in item 4. Do not walk on stage having never seen this instance answer.

---

## Step 1: Show an empty graph

Switch to the browser tab on `http://localhost:3000`, Memory graph tab, and press **refresh** in the Inspector panel.

Expected: an empty canvas, and the Inspector reads `0 nodes and 0 edges currently in memory.`

Say the line: there is no index, no chunk store, no prior state. Memory starts empty.

**Recovery.** If the page shows an error, the Next.js process cannot reach Neo4j. Check `web/.env` resolves, then hard-reload. If it still fails, fall back to the Neo4j MCP server for the rest of the demo and narrate from its output:

```
Using the neo4j server, run: MATCH (n) RETURN count(n)
```

---

## Step 2: Seed the conversation, live

In Claude Code, type these three prompts in order. Each one is a separate speaker turn.

Prompt 1:

```
Remember this in session s1, "Storage layer review". Priya said: "Postgres gives
us transactional guarantees we already understand." Topic is storage engine. She
proposes the decision "Use Postgres as the primary datastore".
```

Prompt 2:

```
Same session. Marcus said: "Our access pattern is almost entirely graph traversal,
and Postgres will make that painful." He disagrees with "Use Postgres as the
primary datastore".
```

Prompt 3:

```
Same session. Dana said: "Operationally Postgres is the thing we can actually run
on call." She supports "Use Postgres as the primary datastore".
```

Expected: three `remember` tool calls. Each returns a `personId`, a `sessionId` of `s1`, one entry in `claimIds`, a non-null `decisionId`, and `degraded`. The second and third calls should return the same `decisionId` as the first, because the merge planner matches the restated decision statement rather than creating a duplicate.

If Nosana is up, `degraded` is `[]` on all three. If it is down, every call carries `embeddings:local` and nothing else changes.

**Recovery.** If the assistant paraphrases instead of calling the tool, say "call the remember tool directly" and repeat the prompt. If a call errors, you have lost the graph state mid-demo. Bail out to the seed script, which writes the same five turns non-interactively, and pick the narrative back up at step 4:

```bash
npm run seed -- --reset
```

Expected from that command: five lines naming each speaker and stance, then `Seeded 5 turns across 2 sessions.` Note that this seeds the reversal as well, so you will have to skip step 5.

---

## Step 3: Watch the objection edge appear

Switch to the browser and press **refresh** in the Inspector.

Expected: a populated graph. One green `Decision` node, three purple `Person` nodes, three blue `Claim` nodes, one pink `Topic`, one grey `Session`.

Click Marcus's claim node. The Inspector lists its connections. One of them reads `→ DISAGREES_WITH` in amber, pointing at "Use Postgres as the primary datastore".

Say the line: that amber edge is the thing a chunk index cannot store. Marcus's objection and Dana's support are two sentences about the same subject in the same vocabulary. Embedded, they sit next to each other. Here they are different edge types.

**Recovery.** If the canvas is empty after refresh, the writes went somewhere else. Confirm the database name with the Neo4j MCP server:

```
Using the neo4j server, run: MATCH (c:Claim)-[:DISAGREES_WITH]->(d:Decision) RETURN c.text, d.statement
```

If that returns the objection, the graph is fine and only the web page is stale. Reload it. If it returns nothing, `NEO4J_DATABASE` differs between the two processes.

---

## Step 4: Ask the benchmark question

In Claude Code:

```
What did we decide about the storage engine, and who disagreed?
```

Expected: a `recall` call returning "Use Postgres as the primary datastore" with `status: "current"`, and a `positions` array naming all three people. Marcus appears with `stance: "DISAGREES_WITH"` and his actual claim text attached. Priya and Dana appear with `stance: "SUPPORTS"`.

Say the line: the answer names the dissenter, not because the model inferred it from retrieved text, but because `STATED_BY` and `DISAGREES_WITH` are edges the traversal walked.

Read the `degraded` field out loud, whatever it says.

**Recovery.** If `decisions` comes back empty, the vector index has no seed above threshold. Retry with the phrasing that is covered by the golden test:

```
Use the recall tool with the question "what did we decide about the storage engine?"
```

If that also returns nothing, the embeddings in the graph were written on a different path from the one reading them. That happens when Nosana wrote and local reads, or the reverse, and it is not recoverable live. Switch to the web UI, which is a second process on the same code path, and if that also returns nothing, move to the Neo4j MCP server and show the graph structure directly.

---

## Step 5: Reverse the decision in a new session

Two more prompts. Note the different session id. This is the point of the demo.

Prompt 1:

```
New session s2, "Storage layer, revisited". Marcus said: "The traversal queries are
now eight joins deep and the latency is unacceptable." Topic is storage engine. He
proposes the decision "Move the primary datastore to Neo4j".
```

Prompt 2:

```
Same session. Priya said: "The join depth argument is convincing, I withdraw my
earlier position." She supports "Move the primary datastore to Neo4j".
```

Expected: the first call returns a new `decisionId`. The merge planner saw a `proposes` stance on a decision already carrying the `storage engine` topic, so the write created a `SUPERSEDES` edge and flipped the Postgres decision's status to `superseded` in the same statement.

Refresh the web graph. The Postgres node is now grey. A `SUPERSEDES` edge runs from the new green decision to it.

Say the line: nothing was deleted. The old decision is still there, still attached to Marcus's original objection. It is marked as no longer standing.

**Recovery.** If the Postgres node stays green, no supersession was detected. Confirm with the Neo4j MCP server:

```
Using the neo4j server, run: MATCH (a:Decision)-[:SUPERSEDES]->(b:Decision) RETURN a.statement, b.statement, b.status
```

Supersession only fires on a `proposes` stance with a matching topic. If the assistant sent `supports`, or dropped the topic, redo prompt 1 and say the word "proposes" explicitly.

---

## Step 6: Ask again from a clean session

Start a fresh Claude Code session. Show that it starts empty, with no prior context. Then:

```
What did we decide about the storage engine, and who disagreed?
```

Expected: "Move the primary datastore to Neo4j" with `status: "current"` and a `supersedes` entry naming the Postgres decision. The Postgres decision also comes back, with `status: "superseded"` and `supersededBy` pointing at the Neo4j one, still carrying Marcus's original objection.

Current decisions sort first, so the standing answer leads.

Optionally show the history view:

```
Show me the timeline for the storage engine topic.
```

Expected: two entries ordered by `decidedAt`. The Postgres entry is `superseded` with `dissenters: ["Marcus"]`. The Neo4j entry is `current` and its `supersedes` names the Postgres statement.

Say the line: that is the whole claim. A flat chunk index would have returned both decisions with no way to rank them, because they are two similar sentences about the same subject, and no way to say who objected to either.

**Recovery.** If the new session cannot see the tools, the MCP config is per-project. Start the fresh session from the same directory. If `recall` returns the Postgres decision as current, step 5 did not commit the supersession; run the Cypher check from step 5's recovery note.

---

## Step 7: Kill Nosana and ask again

Comment out the endpoint:

```bash
sed -i '' 's/^NOSANA_ENDPOINT=/#NOSANA_ENDPOINT=/' .env
```

Restart the mnemex MCP server. The `.env` file is read once when the process starts, so an edit alone changes nothing. Reconnect it from the `/mcp` menu in Claude Code, or restart the session.

Then ask the benchmark question again:

```
What did we decide about the storage engine, and who disagreed?
```

Expected: the same answer, with `degraded: ["embeddings:local"]` in the response. The web UI shows an amber `degraded: embeddings:local` badge next to the title in the header.

Say the line: the remote dependency on the hot path went away. The system did not hang, did not crash, and did not quietly return worse results. It told you which subsystem is on a fallback.

Then say what does not have a fallback. If Neo4j goes away, the tool call throws. That is deliberate. A memory write that silently goes nowhere is worse than an error, because the assistant would report the memory saved and the user would find out several sessions later that it never existed.

**Recovery.** If the answer degrades to nothing rather than to the local model, the local model is not cached and it is downloading 195 MB while everyone watches. That is pre-flight item 3. Restore the endpoint and move on:

```bash
sed -i '' 's/^#NOSANA_ENDPOINT=/NOSANA_ENDPOINT=/' .env
```

---

## Post-demo

Restore the endpoint line in `.env` if step 7's recovery did not already, and reset the graph for the next run:

```cypher
MATCH (n) WHERE n:Person OR n:Claim OR n:Decision OR n:Topic OR n:Session DETACH DELETE n
```

If someone asks to see the test that guards all of this, `tests/golden/recall.test.ts` makes the same four assertions the demo just showed by hand:

```bash
npm test
```
