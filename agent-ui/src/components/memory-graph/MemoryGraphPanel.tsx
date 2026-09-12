/**
 * The memory graph, beside the conversation.
 *
 * The demo moment is watching the model call recall and seeing which nodes the answer came
 * from, so this is a column of the shell rather than a separate page or tab. It reads the
 * same graph the tools write, through the backend route that runs the same Cypher web/ runs.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { PI_API_PREFIX } from "../../pi/piClient";
import { GraphCanvas, type RawNode } from "./GraphCanvas";
import { Inspector, type Graph } from "./Inspector";
import "./memory-graph.css";

type Payload = { ok: boolean; nodes?: RawNode[]; links?: Graph["links"]; error?: string };

export function MemoryGraphPanel({ isRunning }: { isRunning: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<RawNode | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${PI_API_PREFIX}/memory`, { headers: { accept: "application/json" } });
      const body = (await response.json()) as Payload;
      if (!response.ok || !body.ok) throw new Error(body.error ?? `memory route returned ${response.status}`);
      setGraph({ nodes: body.nodes ?? [], links: body.links ?? [] });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A turn ends when the stream is exhausted and the shell drops out of the running state.
  // That is the one moment a remember call can have changed the graph, so it is the only
  // moment worth refetching; nothing here polls.
  const wasRunning = useRef(isRunning);
  useEffect(() => {
    if (wasRunning.current && !isRunning) void load();
    wasRunning.current = isRunning;
  }, [isRunning, load]);

  // A selection that survived a refetch would point at a node the graph may no longer hold.
  useEffect(() => {
    if (!selected || !graph) return;
    if (!graph.nodes.some((node) => node.id === selected.id)) setSelected(null);
  }, [graph, selected]);

  if (collapsed) {
    return (
      <aside className="mnemex-memory-panel" data-collapsed="true">
        <button
          type="button"
          className="mnemex-memory-rail"
          aria-label="Show the memory graph"
          onClick={() => setCollapsed(false)}
        >
          Memory graph
        </button>
      </aside>
    );
  }

  return (
    <aside className="mnemex-memory-panel" data-collapsed="false" aria-label="Memory graph">
      <header className="mnemex-memory-header">
        <h2 className="mnemex-memory-title">
          Memory graph
          {graph ? ` · ${graph.nodes.length} nodes, ${graph.links.length} edges` : ""}
        </h2>
        <button
          type="button"
          className="mnemex-memory-action"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "loading" : "refresh"}
        </button>
        <button
          type="button"
          className="mnemex-memory-action"
          aria-label="Hide the memory graph"
          onClick={() => setCollapsed(true)}
        >
          hide
        </button>
      </header>

      <div className="mnemex-memory-body">
        {error ? (
          <p className="mnemex-memory-message">Memory is unreachable: {error}</p>
        ) : !graph ? (
          <p className="mnemex-memory-message">Loading the graph.</p>
        ) : graph.nodes.length === 0 ? (
          <p className="mnemex-memory-message">
            Memory is empty. Tell the assistant something worth remembering and the nodes appear
            here as soon as the write lands.
          </p>
        ) : (
          <div className="mnemex-memory-graph">
            <p className="mnemex-sr-only">{summarise(graph)}</p>
            <GraphCanvas
              nodes={graph.nodes}
              links={graph.links}
              onSelect={setSelected}
              selectedId={selected?.id ?? null}
            />
          </div>
        )}
        <Inspector node={selected} graph={graph} failed={Boolean(error)} />
      </div>
    </aside>
  );
}

/** The force layout is unreadable to a screen reader, so state its contents in words. */
function summarise(graph: Graph): string {
  const byLabel = new Map<string, number>();
  for (const n of graph.nodes) byLabel.set(n.label, (byLabel.get(n.label) ?? 0) + 1);
  const parts = [...byLabel].map(([label, n]) => `${n} ${label.toLowerCase()}`).join(", ");
  const dissent = graph.links.filter((l) => l.type === "DISAGREES_WITH").length;
  const superseded = graph.links.filter((l) => l.type === "SUPERSEDES").length;
  return `Force directed diagram of memory: ${graph.nodes.length} nodes (${parts}) and ${graph.links.length} edges, including ${dissent} disagreement edges and ${superseded} supersession edges. The inspector below lists the selected node and everything one hop away as text.`;
}
