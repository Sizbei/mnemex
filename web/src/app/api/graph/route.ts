import { NextResponse } from "next/server";
// Imports the COMPILED mnemex package, not a reimplementation: this page shows
// the same code path the MCP server uses. Run `npm run build` at the repo root
// after changing anything under src/.
import { recall } from "../../../../../dist/src/tools/recall.js";
import { timeline } from "../../../../../dist/src/tools/timeline.js";
import { runQuery } from "../../../../../dist/src/graph/driver.js";

export const dynamic = "force-dynamic";

const GRAPH = `
MATCH (d:Decision)
OPTIONAL MATCH (c:Claim)-[r:SUPPORTS|DISAGREES_WITH]->(d)
OPTIONAL MATCH (c)-[:STATED_BY]->(p:Person)
OPTIONAL MATCH (d)-[:SUPERSEDES]->(old:Decision)
RETURN d.id AS id, d.statement AS statement, coalesce(d.status,'open') AS status,
       old.id AS supersedesId,
       collect(DISTINCT CASE WHEN c IS NULL THEN NULL ELSE
         {id: c.id, text: c.text, person: p.name, stance: type(r)} END) AS positions`;

export async function GET(request: Request) {
  const question =
    new URL(request.url).searchParams.get("q") ??
    "what did we decide about the storage engine, and who disagreed?";

  const started = Date.now();
  try {
    const [result, history, graph] = await Promise.all([
      recall({ question }),
      timeline({ topic: "storage engine" }),
      runQuery(GRAPH),
    ]);
    return NextResponse.json({
      ok: true,
      question,
      latencyMs: Date.now() - started,
      degraded: result.degraded,
      decisions: result.decisions,
      timeline: history.entries,
      graph,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
