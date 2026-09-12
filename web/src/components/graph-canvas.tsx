"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  type Simulation, type SimulationNodeDatum, type SimulationLinkDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";

export interface RawNode { id: string; label: string; title: string; status: string | null }
export interface RawLink { source: string; target: string; type: string }

interface Node extends SimulationNodeDatum, RawNode {}
interface Link extends SimulationLinkDatum<Node> { type: string }

const PALETTE: Record<string, string> = {
  Person: "#a78bfa",
  Claim: "#60a5fa",
  Decision: "#34d399",
  Topic: "#f472b6",
  Session: "#94a3b8",
};
const SUPERSEDED = "#6b7280";
const DISSENT = "#fbbf24";

const RADIUS: Record<string, number> = { Decision: 15, Person: 12, Topic: 11, Claim: 8, Session: 9 };

/** Screen pixels of travel before a press counts as a drag rather than a click. */
const DRAG_SLOP = 4;

/** Superseded decisions go grey. Status is the whole point of this graph. */
const colorOf = (n: RawNode) =>
  n.label === "Decision" && n.status === "superseded" ? SUPERSEDED : PALETTE[n.label] ?? "#94a3b8";

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function GraphCanvas({
  nodes: rawNodes, links: rawLinks, onSelect, selectedId,
}: {
  nodes: RawNode[];
  links: RawLink[];
  onSelect: (n: RawNode | null) => void;
  selectedId: string | null;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const simRef = useRef<Simulation<Node, Link> | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const dragRef = useRef<{ node: Node; x0: number; y0: number; dragging: boolean } | null>(null);
  const [, setTick] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);

  // Clone: the simulation mutates these, and mutating props breaks React.
  const nodes = useMemo<Node[]>(() => rawNodes.map((n) => ({ ...n })), [rawNodes]);
  const links = useMemo<Link[]>(
    () => rawLinks.map((l) => ({ source: l.source, target: l.target, type: l.type })),
    [rawLinks],
  );

  /** Everything one hop from the selection, so clicking a decision reveals its argument. */
  const neighbours = useMemo(() => {
    if (!selectedId) return null;
    const near = new Set<string>([selectedId]);
    for (const l of rawLinks) {
      if (l.source === selectedId) near.add(l.target);
      if (l.target === selectedId) near.add(l.source);
    }
    return near;
  }, [selectedId, rawLinks]);

  useEffect(() => {
    if (!nodes.length) return;
    const sim = forceSimulation<Node>(nodes)
      .force("link", forceLink<Node, Link>(links).id((d) => d.id).distance(130).strength(0.4))
      .force("charge", forceManyBody().strength(-1100))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<Node>().radius((d) => (RADIUS[d.label] ?? 9) + 22))
      .alphaDecay(0.06)
      .velocityDecay(0.45);
    sim.on("tick", () => setTick((t) => t + 1));
    simRef.current = sim;
    return () => void sim.stop();
  }, [nodes, links]);

  /**
   * Pan and zoom on the canvas, but never when the press started on a node:
   * otherwise d3-zoom and node dragging fight over the same pointer and a press
   * on a node pans the whole graph instead of selecting it. The wheel is exempt,
   * because zooming should work wherever the cursor happens to be resting.
   */
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = select(svgRef.current);
    const g = select(gRef.current);
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .filter((e: Event) =>
        !(e as MouseEvent).button &&
        (e.type === "wheel" || !(e.target as Element).closest("[data-node]")))
      .on("zoom", (e) => {
        transformRef.current = e.transform;
        g.attr("transform", e.transform.toString());
      });
    svg.call(z);
    zoomRef.current = z;
    return () => void svg.on(".zoom", null);
  }, []);

  /** Screen pixels to graph units, accounting for the viewBox scale and the zoom transform. */
  const toGraph = useCallback((clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const x = vb.x + ((clientX - rect.left) / rect.width) * vb.width;
    const y = vb.y + ((clientY - rect.top) / rect.height) * vb.height;
    return transformRef.current.invert([x, y]);
  }, []);

  /**
   * A click and a drag start identically, so neither is committed on the press.
   * The gesture is measured from where it began, in screen pixels, which keeps a
   * click a click at every zoom level; accumulating per-move distance instead
   * turned the jitter of a steady hand into a drag and swallowed the selection.
   */
  const onPointerDown = (e: React.PointerEvent<SVGGElement>, node: Node) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { node, x0: e.clientX, y0: e.clientY, dragging: false };
  };

  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.dragging) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_SLOP) return;
      // Reheating on the press made a plain click shove the whole layout around,
      // so the simulation only wakes once the gesture is certainly a drag.
      d.dragging = true;
      simRef.current?.alphaTarget(0.15).restart();
    }
    const [x, y] = toGraph(e.clientX, e.clientY);
    d.node.fx = x;
    d.node.fy = y;
  };

  const onPointerUp = (node: Node) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    simRef.current?.alphaTarget(0);
    if (!d.dragging) onSelect(selectedId === node.id ? null : node);
  };

  /** A cancelled gesture would otherwise leave alphaTarget up and the graph drifting forever. */
  const onPointerCancel = () => {
    dragRef.current = null;
    simRef.current?.alphaTarget(0);
  };

  const resetView = () => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, zoomIdentity);
    for (const n of nodes) { n.fx = null; n.fy = null; }
    simRef.current?.alpha(0.8).restart();
  };

  const dim = (id: string) => neighbours !== null && !neighbours.has(id);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox="-380 -250 760 500"
        role="img"
        aria-label="Force-directed graph of memory. People, claims, decisions, topics and sessions, with edges for dissent and supersession."
        className="h-[560px] w-full cursor-grab rounded-xl border border-neutral-800 bg-neutral-900/40 active:cursor-grabbing"
        onClick={() => onSelect(null)}
      >
        <defs>
          <marker id="arrow" viewBox="0 -5 10 10" refX="22" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,-4L9,0L0,4" fill="#525252" />
          </marker>
          <marker id="arrow-dissent" viewBox="0 -5 10 10" refX="22" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,-4L9,0L0,4" fill={DISSENT} />
          </marker>
        </defs>

        <g ref={gRef}>
          {links.map((l, i) => {
            const s = l.source as Node;
            const t = l.target as Node;
            if (typeof s !== "object" || typeof t !== "object") return null;
            const dissent = l.type === "DISAGREES_WITH";
            const supersede = l.type === "SUPERSEDES";
            const faded = dim(s.id) && dim(t.id);
            return (
              <line
                key={i}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={dissent ? DISSENT : supersede ? "#a3a3a3" : "#404040"}
                strokeWidth={dissent || supersede ? 2 : 1}
                strokeDasharray={supersede ? "6 4" : undefined}
                markerEnd={dissent ? "url(#arrow-dissent)" : "url(#arrow)"}
                opacity={faded ? 0.1 : dissent || supersede ? 0.95 : 0.35}
                style={{ transition: "opacity 200ms cubic-bezier(0.23,1,0.32,1)" }}
              />
            );
          })}

          {nodes.map((n) => {
            const r = RADIUS[n.label] ?? 9;
            const active = selectedId === n.id;
            const faded = dim(n.id);
            const showLabel = active || hovered === n.id || n.label === "Decision" || n.label === "Person";
            return (
              <g
                key={n.id}
                data-node={n.id}
                transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                className="cursor-pointer"
                opacity={faded ? 0.15 : 1}
                style={{ transition: "opacity 200ms cubic-bezier(0.23,1,0.32,1)", touchAction: "none" }}
                onPointerDown={(e) => onPointerDown(e, n)}
                onPointerMove={onPointerMove}
                onPointerUp={() => onPointerUp(n)}
                onPointerCancel={onPointerCancel}
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
              >
                {active && <circle r={r + 9} fill={colorOf(n)} opacity={0.2} />}
                <circle
                  r={r}
                  fill={colorOf(n)}
                  stroke={active ? "#fafafa" : "#0a0a0a"}
                  strokeWidth={active ? 2.5 : 1.5}
                />
                {showLabel && (
                  <text
                    y={r + 15}
                    textAnchor="middle"
                    className="pointer-events-none select-none"
                    fill={active ? "#fafafa" : "#a3a3a3"}
                    fontSize={11}
                  >
                    {truncate(n.title, n.label === "Decision" ? 34 : 22)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute left-5 top-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px]">
        {Object.entries(PALETTE).map(([label, color]) => (
          <span key={label} className="flex items-center gap-2 text-neutral-400">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-2 text-neutral-400">
          <span className="h-0.5 w-5" style={{ background: DISSENT }} />disagrees
        </span>
        <span className="flex items-center gap-2 text-neutral-400">
          <span className="h-0.5 w-5 border-t-2 border-dashed border-neutral-400" />supersedes
        </span>
      </div>

      <button
        onClick={resetView}
        className="absolute bottom-5 right-5 rounded-md border border-neutral-700 bg-neutral-900/90 px-3 py-1.5 text-xs text-neutral-300 transition-all duration-100 hover:scale-105 hover:border-neutral-600 hover:text-neutral-100"
      >
        reset layout
      </button>
      <p className="pointer-events-none absolute bottom-5 left-5 text-[11px] text-neutral-400">
        drag nodes · scroll to zoom · click to isolate
      </p>
    </div>
  );
}
