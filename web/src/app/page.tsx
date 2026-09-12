"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GraphCanvas, type RawNode, type RawLink } from "@/components/graph-canvas";
import { WriteMemory } from "@/components/write-memory";
import { UploadTranscript } from "@/components/upload-transcript";
import { StatePanel, describeFailure } from "@/components/states";
import { useDelayed } from "@/lib/use-delayed";

interface Position { person: string; stance: "SUPPORTS" | "DISAGREES_WITH"; claim: string }
interface Decision {
  id: string; statement: string; status: "current" | "superseded" | "open";
  positions: Position[]; supersedes: string[]; supersededBy: string[];
}
interface TimelineEntry {
  statement: string; status: string; decidedAt: string;
  supersedes: string | null; dissenters: string[];
}
interface Answer {
  ok: boolean; question: string; latencyMs: number; degraded: string[];
  decisions: Decision[]; timeline: TimelineEntry[]; error?: string;
}
type Graph = { nodes: RawNode[]; links: RawLink[] };

const PRESETS = [
  "what did we decide about the storage engine, and who disagreed?",
  "who objected to using Postgres?",
  "what is the current decision about the datastore?",
];

const DEFAULT_TOPIC = "storage engine";

export default function Home() {
  const [question, setQuestion] = useState(PRESETS[0]);
  const [topic, setTopic] = useState(DEFAULT_TOPIC);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("answer");

  const [graph, setGraph] = useState<Graph | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RawNode | null>(null);

  const ask = useCallback(async (q: string, t: string) => {
    setAsking(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, topic: t }),
      });
      const data: Answer = await res.json();
      if (data.ok) {
        setAnswer(data);
      } else {
        setAnswer(null);
        setError(data.error ?? "the recall query did not complete");
      }
    } catch (e) {
      setAnswer(null);
      setError(String(e));
    } finally {
      setAsking(false);
    }
  }, []);

  const loadGraph = useCallback(async () => {
    setGraphError(null);
    try {
      const res = await fetch("/api/memory");
      const d = await res.json();
      if (!d.ok) { setGraph(null); setGraphError(d.error ?? "the graph query did not complete"); return; }
      setGraph({ nodes: d.nodes, links: d.links });
    } catch (e) {
      setGraph(null);
      setGraphError(String(e));
    }
  }, []);

  useEffect(() => { void ask(PRESETS[0], DEFAULT_TOPIC); void loadGraph(); }, [ask, loadGraph]);

  // Nothing under 300ms: a skeleton that flashes for one frame reads as a bug.
  const showAnswerSkeleton = useDelayed(asking);
  const showGraphSkeleton = useDelayed(graph === null && graphError === null);

  const retry = () => { void ask(question, topic); void loadGraph(); };

  const graphPanel = (
    <GraphPanel
      graph={graph}
      error={graphError}
      showSkeleton={showGraphSkeleton}
      selectedId={selected?.id ?? null}
      onSelect={setSelected}
      onRetry={loadGraph}
      onWrite={() => setTab("write")}
    />
  );

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 antialiased">
      <div className="mx-auto max-w-7xl px-6 py-14 md:px-10 md:py-20">
        <Header degraded={answer?.degraded} />

        <form
          className="mt-12 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => { e.preventDefault(); void ask(question, topic); }}
        >
          <label className="flex-1">
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
              question
            </span>
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask memory a question"
              className="h-12 w-full border-neutral-800 bg-neutral-900/60 text-base text-neutral-100 placeholder:text-neutral-500"
            />
          </label>
          <label className="sm:w-52">
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
              topic
            </span>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="storage engine"
              className="h-12 w-full border-neutral-800 bg-neutral-900/60 text-base text-neutral-100 placeholder:text-neutral-500"
            />
          </label>
          <Button
            type="submit"
            disabled={asking}
            className="h-12 px-7 text-sm font-medium transition-transform duration-100 hover:scale-105 active:scale-95"
          >
            {asking && <Loader2 className="animate-spin" aria-hidden />}
            {asking ? "recalling" : "recall"}
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              title={p}
              onClick={() => { setQuestion(p); void ask(p, topic); }}
              className="rounded-full border border-neutral-800 px-3.5 py-1.5 text-xs text-neutral-400 transition-colors duration-100 hover:border-neutral-700 hover:text-neutral-200"
            >
              {p.length > 46 ? `${p.slice(0, 45)}…` : p}
            </button>
          ))}
        </div>

        <Separator className="my-12 bg-neutral-800" />

        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <TabsList className="border border-neutral-800 bg-neutral-900/60">
              <TabsTrigger value="answer">Answer</TabsTrigger>
              <TabsTrigger value="graph">Memory graph</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="write">Write</TabsTrigger>
            </TabsList>
            <p role="status" className="font-mono text-xs text-neutral-400">
              {asking
                ? "recalling…"
                : answer
                  ? `${answer.decisions.length} decisions · ${answer.latencyMs} ms`
                  : ""}
            </p>
          </div>

          <TabsContent value="answer" className="mt-8 focus-visible:outline-none" aria-busy={asking}>
            {error ? (
              <FailurePanel raw={error} onRetry={retry} />
            ) : showAnswerSkeleton ? (
              <AnswerSkeleton />
            ) : !answer ? null : answer.decisions.length === 0 ? (
              <StatePanel
                title="Nothing in memory answers that yet"
                body="The traversal found no decision connected to that question. Try the benchmark question, or write the memory first from the Write tab."
                action={{
                  label: "Ask the benchmark question",
                  onClick: () => { setQuestion(PRESETS[0]); void ask(PRESETS[0], topic); },
                }}
              />
            ) : (
              <AnswerView answer={answer} />
            )}
          </TabsContent>

          <TabsContent value="graph" className="mt-8 focus-visible:outline-none">
            <div className="grid gap-8 xl:grid-cols-[1.618fr_1fr]">
              {graphPanel}
              <Inspector node={selected} graph={graph} failed={graphError !== null} onRefresh={loadGraph} />
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-8 focus-visible:outline-none" aria-busy={asking}>
            {error ? (
              <FailurePanel raw={error} onRetry={retry} />
            ) : showAnswerSkeleton ? (
              <TimelineSkeleton />
            ) : !answer ? null : answer.timeline.length ? (
              <Timeline entries={answer.timeline} />
            ) : (
              <StatePanel
                title={`No decision history for "${topic}"`}
                body="History is filtered by topic, and nothing in memory is filed under that one. The seeded conversation lives under storage engine."
                action={{
                  label: "Show storage engine",
                  onClick: () => { setTopic(DEFAULT_TOPIC); void ask(question, DEFAULT_TOPIC); },
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="write" className="mt-8 focus-visible:outline-none">
            <div className="grid gap-8 xl:grid-cols-[1fr_1.618fr]">
              <div className="space-y-8">
                <UploadTranscript
                  onImported={() => { void loadGraph(); void ask(question, topic); }}
                />
                <WriteMemory
                  onWritten={() => { void loadGraph(); void ask(question, topic); }}
                />
              </div>
              {graphPanel}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function Header({ degraded }: { degraded?: string[] }) {
  return (
    <header className="animate-in fade-in slide-in-from-bottom-3 duration-300 ease-out">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-50 md:text-5xl">mnemex</h1>
        {degraded?.length ? (
          degraded.map((d) => (
            <Badge key={d} className="border-amber-800/60 bg-amber-950/50 font-mono text-[11px] text-amber-300 hover:bg-amber-950/50">
              degraded: {d}
            </Badge>
          ))
        ) : degraded ? (
          <Badge className="border-emerald-800/60 bg-emerald-950/50 font-mono text-[11px] text-emerald-300 hover:bg-emerald-950/50">
            all systems nominal
          </Badge>
        ) : null}
      </div>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-neutral-400">
        Persistent memory for an AI assistant, stored as a knowledge graph rather than flat vector
        chunks. A chunk index can find the text of an objection. It cannot tell you who made it, or
        which of two contradictory decisions still stands. Both are edges.
      </p>
      <p className="mt-4 font-mono text-xs text-neutral-400">
        Neo4j Aura · Nosana GPU inference · Daytona sandboxed execution · Model Context Protocol
      </p>
    </header>
  );
}

/** One failure surface for every tab, so a dead Neo4j never renders as blankness. */
function FailurePanel({ raw, onRetry }: { raw: string; onRetry: () => void }) {
  const { title, body } = describeFailure(raw);
  return (
    <StatePanel
      tone="error"
      title={title}
      body={body}
      detail={raw}
      action={{ label: "Try again", onClick: onRetry }}
    />
  );
}

function GraphPanel({
  graph, error, showSkeleton, selectedId, onSelect, onRetry, onWrite,
}: {
  graph: Graph | null;
  error: string | null;
  showSkeleton: boolean;
  selectedId: string | null;
  onSelect: (n: RawNode | null) => void;
  onRetry: () => void;
  onWrite: () => void;
}) {
  if (error) return <FailurePanel raw={error} onRetry={onRetry} />;
  if (!graph) {
    // Reserves exactly the box the canvas will take, so nothing jumps on arrival.
    return showSkeleton
      ? <Skeleton className="aspect-[760/500] w-full rounded-xl bg-neutral-900 sm:aspect-auto sm:h-[560px]" />
      : <div className="aspect-[760/500] w-full sm:aspect-auto sm:h-[560px]" aria-hidden />;
  }
  if (!graph.nodes.length) {
    return (
      <StatePanel
        title="Memory is empty"
        body="No conversation has been written yet. Record one claim and a decision, and the nodes and edges appear here as soon as the write lands."
        action={{ label: "Write the first memory", onClick: onWrite }}
      />
    );
  }
  return (
    <div className="graph-shell" role="group" aria-label="Memory graph">
      <p className="sr-only">{summarise(graph)}</p>
      <GraphCanvas
        nodes={graph.nodes}
        links={graph.links}
        onSelect={onSelect}
        selectedId={selectedId}
      />
    </div>
  );
}

/** The force layout is unreadable to a screen reader, so state its contents in words. */
function summarise(graph: Graph): string {
  const byLabel = new Map<string, number>();
  for (const n of graph.nodes) byLabel.set(n.label, (byLabel.get(n.label) ?? 0) + 1);
  const parts = [...byLabel].map(([label, n]) => `${n} ${label.toLowerCase()}`).join(", ");
  const dissent = graph.links.filter((l) => l.type === "DISAGREES_WITH").length;
  const superseded = graph.links.filter((l) => l.type === "SUPERSEDES").length;
  return `Force directed diagram of memory: ${graph.nodes.length} nodes (${parts}) and ${graph.links.length} edges, including ${dissent} disagreement edges and ${superseded} supersession edges. Every node and edge is also listed as text in the Answer and History tabs.`;
}

function AnswerView({ answer }: { answer: Answer }) {
  const ordered = [
    ...answer.decisions.filter((d) => d.status === "current"),
    ...answer.decisions.filter((d) => d.status !== "current"),
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {ordered.map((d, i) => <DecisionCard key={d.id} decision={d} index={i} />)}
    </div>
  );
}

function DecisionCard({ decision, index }: { decision: Decision; index: number }) {
  const isCurrent = decision.status === "current";
  const supporters = decision.positions.filter((p) => p.stance === "SUPPORTS");
  const objectors = decision.positions.filter((p) => p.stance === "DISAGREES_WITH");

  return (
    <Card
      className="animate-in fade-in slide-in-from-bottom-4 border-neutral-800 bg-neutral-900/60 shadow-lg shadow-black/40 duration-300 ease-out fill-mode-backwards"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <CardHeader className="gap-3">
        <div className="flex items-center gap-3">
          <span className={`h-2 w-2 rounded-full ${isCurrent ? "bg-emerald-400" : "bg-neutral-600"}`} aria-hidden />
          <Badge
            variant="outline"
            className={isCurrent
              ? "border-emerald-800/70 bg-emerald-950/40 font-mono text-[11px] tracking-wider text-emerald-300"
              : "border-neutral-700 bg-neutral-900 font-mono text-[11px] tracking-wider text-neutral-400"}
          >
            {decision.status.toUpperCase()}
          </Badge>
        </div>
        <CardTitle className="text-xl font-medium leading-snug text-neutral-100">
          {decision.statement}
        </CardTitle>
        {decision.supersedes.map((s) => (
          <p key={s} className="text-xs text-neutral-300"><span className="text-neutral-400">overrules</span> {s}</p>
        ))}
        {decision.supersededBy.map((s) => (
          <p key={s} className="text-xs text-amber-500/90"><span className="text-neutral-400">overruled by</span> {s}</p>
        ))}
      </CardHeader>

      <CardContent className="space-y-5">
        {objectors.length > 0 && (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-5">
            {/* The mark carries the same meaning as the amber: red and green
                dissent cues are indistinguishable to about 8% of men. */}
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-400">
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden focusable="false">
                <path d="M6 1 L11.2 10.5 L0.8 10.5 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M6 4.6 L6 7.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <circle cx="6" cy="8.9" r="0.7" fill="currentColor" />
              </svg>
              Dissent
            </p>
            <div className="mt-4 space-y-4">
              {objectors.map((p) => (
                <div key={p.claim}>
                  <p className="text-sm font-medium text-amber-200">{p.person}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">{p.claim}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {supporters.length > 0 && (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden focusable="false">
                <path d="M1.5 6.4 L4.6 9.5 L10.5 2.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Support
            </p>
            {supporters.map((p) => (
              <div key={p.claim}>
                <p className="text-sm font-medium text-neutral-300">{p.person}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">{p.claim}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Inspector({
  node, graph, failed, onRefresh,
}: {
  node: RawNode | null;
  graph: Graph | null;
  failed: boolean;
  onRefresh: () => void;
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
    <Card className="border-neutral-800 bg-neutral-900/60">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium uppercase tracking-[0.14em] text-neutral-400">
            Inspector
          </CardTitle>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-md px-1 text-xs text-neutral-400 transition-colors duration-100 hover:text-neutral-100"
          >
            refresh
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {!node ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-neutral-400">
              Click any node to isolate it and everything one hop away.
            </p>
            <p className="text-sm leading-relaxed text-neutral-400">
              {graph
                ? `${graph.nodes.length} nodes and ${graph.links.length} edges currently in memory.`
                : failed
                  ? "Memory is unreachable, so there is nothing to inspect yet."
                  : "Waiting for the graph to load."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <Badge variant="outline" className="border-neutral-700 font-mono text-[11px] text-neutral-300">
                {node.label}{node.status ? ` · ${node.status}` : ""}
              </Badge>
              <p className="mt-3 text-base leading-relaxed text-neutral-100">{node.title}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
                Connections ({edges.length})
              </p>
              {edges.length === 0 ? (
                <p className="mt-3 text-sm leading-relaxed text-neutral-400">
                  Nothing points at this node yet. It is in memory but not yet part of an argument.
                </p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {edges.map((e, i) => (
                    <li key={i} className="text-sm">
                      <span className={`font-mono text-[11px] ${e.type === "DISAGREES_WITH" ? "text-amber-400" : "text-neutral-400"}`}>
                        {e.outgoing ? "→" : "←"} {e.type}
                      </span>
                      <span className="ml-2 text-neutral-300">{e.other?.title ?? e.other?.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="relative max-w-3xl space-y-9 border-l border-neutral-800 pl-8">
      {entries.map((e, i) => (
        <li
          key={e.statement}
          className="animate-in fade-in slide-in-from-left-2 duration-300 ease-out fill-mode-backwards"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <span
            className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-neutral-950 ${
              e.status === "current" ? "bg-emerald-400" : "bg-neutral-600"
            }`}
            aria-hidden
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <time className="font-mono text-[11px] text-neutral-400">
              {e.decidedAt.slice(0, 16).replace("T", " ")}
            </time>
            {/* The dot alone cannot carry status, so the word is there too. */}
            <span className={`font-mono text-[11px] tracking-wider ${
              e.status === "current" ? "text-emerald-300" : "text-neutral-400"
            }`}>
              {e.status.toUpperCase()}
            </span>
          </div>
          <p className="mt-1.5 text-base leading-relaxed text-neutral-100">{e.statement}</p>
          {e.supersedes && <p className="mt-1.5 text-xs text-neutral-400">replaced: {e.supersedes}</p>}
          {e.dissenters.length > 0 && (
            <p className="mt-2 text-xs text-amber-500/90">objection from {e.dissenters.join(", ")}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

function AnswerSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {[0, 1].map((i) => (
        <Card key={i} className="border-neutral-800 bg-neutral-900/60">
          <CardHeader className="gap-3">
            <Skeleton className="h-5 w-24 bg-neutral-800" />
            <Skeleton className="h-7 w-3/4 bg-neutral-800" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-1/3 bg-neutral-800" />
            <Skeleton className="h-4 w-full bg-neutral-800" />
            <Skeleton className="h-4 w-5/6 bg-neutral-800" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Shaped like the timeline it replaces: a date, a statement, a trailing note. */
function TimelineSkeleton() {
  return (
    <div className="relative max-w-3xl space-y-9 border-l border-neutral-800 pl-8">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-32 bg-neutral-800" />
          <Skeleton className="h-5 w-2/3 bg-neutral-800" />
          <Skeleton className="h-3 w-1/2 bg-neutral-800" />
        </div>
      ))}
    </div>
  );
}
