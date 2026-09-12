"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GraphCanvas, type RawNode, type RawLink } from "@/components/graph-canvas";
import { WriteMemory } from "@/components/write-memory";

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

const PRESETS = [
  "what did we decide about the storage engine, and who disagreed?",
  "who objected to using Postgres?",
  "what is the current decision about the datastore?",
];

export default function Home() {
  const [question, setQuestion] = useState(PRESETS[0]);
  const [topic, setTopic] = useState("storage engine");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [graph, setGraph] = useState<{ nodes: RawNode[]; links: RawLink[] } | null>(null);
  const [selected, setSelected] = useState<RawNode | null>(null);

  const ask = useCallback(async (q: string) => {
    setAsking(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, topic }),
      });
      const data: Answer = await res.json();
      data.ok ? setAnswer(data) : setError(data.error ?? "unknown error");
    } catch (e) {
      setError(String(e));
    } finally {
      setAsking(false);
    }
  }, [topic]);

  const loadGraph = useCallback(async () => {
    const res = await fetch("/api/memory");
    const d = await res.json();
    if (d.ok) setGraph({ nodes: d.nodes, links: d.links });
  }, []);

  useEffect(() => { void ask(PRESETS[0]); void loadGraph(); }, [ask, loadGraph]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 antialiased">
      <div className="mx-auto max-w-7xl px-6 py-14 md:px-10 md:py-20">
        <Header degraded={answer?.degraded} />

        <form
          className="mt-12 flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => { e.preventDefault(); void ask(question); }}
        >
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask memory a question"
            className="h-12 flex-1 border-neutral-800 bg-neutral-900/60 text-base text-neutral-100 placeholder:text-neutral-600"
          />
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="topic"
            className="h-12 border-neutral-800 bg-neutral-900/60 text-base text-neutral-100 placeholder:text-neutral-600 sm:w-52"
          />
          <Button
            type="submit"
            disabled={asking}
            className="h-12 px-7 text-sm font-medium transition-transform duration-100 hover:scale-105 active:scale-95"
          >
            {asking ? "recalling…" : "recall"}
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => { setQuestion(p); void ask(p); }}
              className="rounded-full border border-neutral-800 px-3.5 py-1.5 text-xs text-neutral-400 transition-colors duration-100 hover:border-neutral-700 hover:text-neutral-200"
            >
              {p.length > 46 ? `${p.slice(0, 45)}…` : p}
            </button>
          ))}
        </div>

        {error && (
          <Alert variant="destructive" className="mt-8 border-red-900/60 bg-red-950/40">
            <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
          </Alert>
        )}

        <Separator className="my-12 bg-neutral-800" />

        <Tabs defaultValue="answer">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <TabsList className="border border-neutral-800 bg-neutral-900/60">
              <TabsTrigger value="answer">Answer</TabsTrigger>
              <TabsTrigger value="graph">Memory graph</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="write">Write</TabsTrigger>
            </TabsList>
            {answer && (
              <p className="font-mono text-xs text-neutral-500">
                {answer.decisions.length} decisions · {answer.latencyMs} ms
              </p>
            )}
          </div>

          <TabsContent value="answer" className="mt-8 focus-visible:outline-none">
            {asking && !answer ? <AnswerSkeleton /> : answer ? <AnswerView answer={answer} /> : null}
          </TabsContent>

          <TabsContent value="graph" className="mt-8 focus-visible:outline-none">
            <div className="grid gap-8 lg:grid-cols-[1.618fr_1fr]">
              {graph ? (
                <GraphCanvas
                  nodes={graph.nodes}
                  links={graph.links}
                  onSelect={setSelected}
                  selectedId={selected?.id ?? null}
                />
              ) : (
                <Skeleton className="h-[560px] w-full rounded-xl bg-neutral-900" />
              )}
              <Inspector node={selected} graph={graph} onRefresh={loadGraph} />
            </div>
          </TabsContent>

          <TabsContent value="write" className="mt-8 focus-visible:outline-none">
            <div className="grid gap-8 lg:grid-cols-[1fr_1.618fr]">
              <WriteMemory
                onWritten={() => { void loadGraph(); void ask(question); }}
              />
              {graph ? (
                <GraphCanvas
                  nodes={graph.nodes}
                  links={graph.links}
                  onSelect={setSelected}
                  selectedId={selected?.id ?? null}
                />
              ) : (
                <Skeleton className="h-[560px] w-full rounded-xl bg-neutral-900" />
              )}
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-8 focus-visible:outline-none">
            {answer?.timeline.length ? (
              <Timeline entries={answer.timeline} />
            ) : (
              <p className="text-sm text-neutral-500">
                No decision history for the topic &ldquo;{topic}&rdquo;. Try &ldquo;storage engine&rdquo;.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function Header({ degraded }: { degraded?: string[] }) {
  return (
    <header className="animate-in fade-in slide-in-from-bottom-3 duration-500 ease-out">
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
      <p className="mt-4 font-mono text-xs text-neutral-500">
        Neo4j Aura · Nosana GPU inference · Daytona sandboxed execution · Model Context Protocol
      </p>
    </header>
  );
}

function AnswerView({ answer }: { answer: Answer }) {
  const ordered = [
    ...answer.decisions.filter((d) => d.status === "current"),
    ...answer.decisions.filter((d) => d.status !== "current"),
  ];
  if (!ordered.length) {
    return <p className="text-sm text-neutral-500">Nothing in memory matches that question yet.</p>;
  }
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
      className="animate-in fade-in slide-in-from-bottom-4 border-neutral-800 bg-neutral-900/60 shadow-lg shadow-black/40 duration-500 ease-out fill-mode-backwards"
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
          <p key={s} className="text-xs text-neutral-400"><span className="text-neutral-500">overrules</span> {s}</p>
        ))}
        {decision.supersededBy.map((s) => (
          <p key={s} className="text-xs text-amber-500/80"><span className="text-neutral-500">overruled by</span> {s}</p>
        ))}
      </CardHeader>

      <CardContent className="space-y-5">
        {objectors.length > 0 && (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-500/90">Dissent</p>
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
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">Support</p>
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
  node, graph, onRefresh,
}: {
  node: RawNode | null;
  graph: { nodes: RawNode[]; links: RawLink[] } | null;
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
            onClick={onRefresh}
            className="text-xs text-neutral-500 transition-colors duration-100 hover:text-neutral-200"
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
            <p className="text-sm leading-relaxed text-neutral-500">
              {graph ? `${graph.nodes.length} nodes and ${graph.links.length} edges currently in memory.` : "Loading memory…"}
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
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
                Connections ({edges.length})
              </p>
              <ul className="mt-3 space-y-2.5">
                {edges.map((e, i) => (
                  <li key={i} className="text-sm">
                    <span className={`font-mono text-[11px] ${e.type === "DISAGREES_WITH" ? "text-amber-400" : "text-neutral-500"}`}>
                      {e.outgoing ? "→" : "←"} {e.type}
                    </span>
                    <span className="ml-2 text-neutral-300">{e.other?.title ?? e.other?.id}</span>
                  </li>
                ))}
              </ul>
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
          className="animate-in fade-in slide-in-from-left-2 duration-500 ease-out fill-mode-backwards"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <span
            className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-neutral-950 ${
              e.status === "current" ? "bg-emerald-400" : "bg-neutral-600"
            }`}
            aria-hidden
          />
          <time className="font-mono text-[11px] text-neutral-500">
            {e.decidedAt.slice(0, 16).replace("T", " ")}
          </time>
          <p className="mt-1.5 text-base leading-relaxed text-neutral-100">{e.statement}</p>
          {e.supersedes && <p className="mt-1.5 text-xs text-neutral-500">replaced: {e.supersedes}</p>}
          {e.dissenters.length > 0 && (
            <p className="mt-2 text-xs text-amber-500/80">objection from {e.dissenters.join(", ")}</p>
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
