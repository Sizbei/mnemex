import { NextResponse } from "next/server";
import { runQuery } from "../../../../../dist/src/graph/driver.js";

export const dynamic = "force-dynamic";

// Every node and edge that makes up memory, shaped for a force layout.
const NODES = `
MATCH (n)
WHERE n:Person OR n:Claim OR n:Decision OR n:Topic OR n:Session
RETURN n.id AS id,
       labels(n)[0] AS label,
       coalesce(n.name, n.statement, n.text, n.title, n.id) AS title,
       n.status AS status`;

const LINKS = `
MATCH (a)-[r]->(b)
WHERE (a:Person OR a:Claim OR a:Decision OR a:Topic OR a:Session)
  AND (b:Person OR b:Claim OR b:Decision OR b:Topic OR b:Session)
RETURN a.id AS source, b.id AS target, type(r) AS type`;

export async function GET() {
  try {
    const [nodes, links] = await Promise.all([
      runQuery<{ id: string; label: string; title: string; status: string | null }>(NODES),
      runQuery<{ source: string; target: string; type: string }>(LINKS),
    ]);
    return NextResponse.json({ ok: true, nodes, links });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
