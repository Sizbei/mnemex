/**
 * Ported from the Inspector in web/src/app/page.tsx. Same content, same wording; the shadcn
 * Card and Badge it was built on do not exist here, so the markup is plain and the rules live
 * in memory-graph.css.
 */
import type { RawLink, RawNode } from "./GraphCanvas";

export interface Graph { nodes: RawNode[]; links: RawLink[] }

export function Inspector({
  node, graph, failed,
}: {
  node: RawNode | null;
  graph: Graph | null;
  failed: boolean;
}) {
  const edges = node && graph
    ? graph.links
        .filter((l) => l.source === node.id || l.target === node.id)
        .map((l) => {
          const otherId = l.source === node.id ? l.target : l.source;
          const other = graph.nodes.find((n) => n.id === otherId);
          return { type: l.type, outgoing: l.source === node.id, other };
        })
    : [];

  return (
    <section className="mnemex-inspector">
      <div className="mnemex-inspector-head">
        <h3 className="mnemex-inspector-title">Inspector</h3>
      </div>
      {!node ? (
        <div className="mnemex-inspector-empty">
          <p>Click any node to isolate it and everything one hop away.</p>
          <p>
            {graph
              ? `${graph.nodes.length} nodes and ${graph.links.length} edges currently in memory.`
              : failed
                ? "Memory is unreachable, so there is nothing to inspect yet."
                : "Waiting for the graph to load."}
          </p>
        </div>
      ) : (
        <>
          <div>
            <span className="mnemex-inspector-badge">
              {node.label}{node.status ? ` · ${node.status}` : ""}
            </span>
            <p className="mnemex-inspector-statement">{node.title}</p>
          </div>
          <div>
            <p className="mnemex-inspector-subhead">Connections ({edges.length})</p>
            {edges.length === 0 ? (
              <p className="mnemex-inspector-note">
                Nothing points at this node yet. It is in memory but not yet part of an argument.
              </p>
            ) : (
              <ul className="mnemex-inspector-edges">
                {edges.map((e, i) => (
                  <li key={i}>
                    <span className="mnemex-inspector-edge-type" data-dissent={e.type === "DISAGREES_WITH"}>
                      {e.outgoing ? "→" : "←"} {e.type}
                    </span>
                    <span className="mnemex-inspector-edge-other">{e.other?.title ?? e.other?.id}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
