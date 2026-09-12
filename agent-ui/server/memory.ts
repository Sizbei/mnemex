// Same import style as tools.ts: the compiled build, not src/, so this route reads the graph
// through exactly the driver the MCP server uses. runQuery is what picks Bolt or the HTTPS
// query API from NEO4J_TRANSPORT, which is the only reason this works inside a Daytona
// sandbox, where 7687 is unreachable.
import { runQuery } from "../../dist/src/graph/driver.js";

export interface GraphNode {
  id: string;
  label: string;
  title: string;
  status: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
}

// Copied verbatim from web/src/app/api/memory/route.ts. Two readers of one graph should not
// disagree about what "the whole graph" means.
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

export async function memoryGraph(): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> {
  const [nodes, links] = await Promise.all([
    runQuery<GraphNode>(NODES),
    runQuery<GraphLink>(LINKS),
  ]);
  return { nodes, links };
}
