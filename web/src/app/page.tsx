"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Position { person: string; stance: "SUPPORTS" | "DISAGREES_WITH"; claim: string }
interface Decision {
  id: string; statement: string; status: "current" | "superseded" | "open";
  positions: Position[]; supersedes: string[]; supersededBy: string[];
}
interface TimelineEntry {
  statement: string; status: string; decidedAt: string;
  supersedes: string | null; dissenters: string[];
}
interface Payload {
  ok: boolean; question: string; latencyMs: number; degraded: string[];
  decisions: Decision[]; timeline: TimelineEntry[]; error?: string;
}

const QUESTION = "what did we decide about the storage engine, and who disagreed?";

export default function Home() {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/graph?q=${encodeURIComponent(QUESTION)}`)
      .then((r) => r.json())
      .then((d: Payload) => (d.ok ? setData(d) : setFailed(d.error ?? "unknown error")))
      .catch((e) => setFailed(String(e)));
  }, []);

  const current = data?.decisions.filter((d) => d.status === "current") ?? [];
  const superseded = data?.decisions.filter((d) => d.status !== "current") ?? [];
  const dissenters = new Set(
    data?.decisions.flatMap((d) => d.positions).filter((p) => p.stance === "DISAGREES_WITH").map((p) => p.person),
  );

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 antialiased">
      <div className="mx-auto max-w-6xl px-6 py-16 md:px-10 md:py-24">
        <Header degraded={data?.degraded} latency={data?.latencyMs} />

        <section className="mt-14">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
            The question flat vector search cannot answer
          </p>
          <h2 className="mt-4 text-2xl font-medium leading-snug text-neutral-100 md:text-3xl">
            &ldquo;{QUESTION}&rdquo;
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-neutral-400">
            A chunk index can find the text of an objection. It cannot tell you who made it,
            or which of two contradictory decisions still stands. Both are edges, and chunking
            throws edges away before retrieval ever runs.
          </p>
        </section>

        <Separator className="my-14 bg-neutral-800" />

        {failed && (
          <Alert variant="destructive" className="border-red-900/60 bg-red-950/40">
            <AlertDescription className="font-mono text-xs">{failed}</AlertDescription>
          </Alert>
        )}

        {!data && !failed && <LoadingState />}

        {data && (
          <div className="grid gap-14 lg:grid-cols-[1.618fr_1fr]">
            <div>
              <SectionLabel>What mnemex returns</SectionLabel>
              <div className="mt-7 space-y-6">
                {current.map((d, i) => <DecisionCard key={d.id} decision={d} index={i} />)}
                {superseded.map((d, i) => (
                  <DecisionCard key={d.id} decision={d} index={current.length + i} />
                ))}
              </div>
            </div>

            <div className="space-y-12">
              <div>
                <SectionLabel>Decision history</SectionLabel>
                <Timeline entries={data.timeline} />
              </div>
              <div>
                <SectionLabel>Graph shape</SectionLabel>
                <Stats
                  decisions={data.decisions.length}
                  positions={data.decisions.reduce((n, d) => n + d.positions.length, 0)}
                  dissenters={dissenters.size}
                  latency={data.latencyMs}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Header({ degraded, latency }: { degraded?: string[]; latency?: number }) {
  return (
    <header className="animate-in fade-in slide-in-from-bottom-3 duration-500 ease-out">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-50 md:text-5xl">mnemex</h1>
        <div className="flex flex-wrap gap-2">
          {degraded?.length
            ? degraded.map((d) => (
                <Badge key={d} className="border-amber-800/60 bg-amber-950/50 font-mono text-[11px] text-amber-300 hover:bg-amber-950/50">
                  degraded: {d}
                </Badge>
              ))
            : latency !== undefined && (
                <Badge className="border-emerald-800/60 bg-emerald-950/50 font-mono text-[11px] text-emerald-300 hover:bg-emerald-950/50">
                  all systems nominal
                </Badge>
              )}
        </div>
      </div>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-neutral-400">
        Persistent memory for an AI assistant, stored as a knowledge graph rather than flat
        vector chunks, so retrieval respects relationships.
      </p>
      <p className="mt-4 font-mono text-xs text-neutral-500">
        Neo4j Aura · Nosana GPU inference · Daytona sandboxed execution · Model Context Protocol
      </p>
    </header>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">{children}</p>
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
          <span
            className={`h-2 w-2 rounded-full ${isCurrent ? "bg-emerald-400" : "bg-neutral-600"}`}
            aria-hidden
          />
          <Badge
            variant="outline"
            className={
              isCurrent
                ? "border-emerald-800/70 bg-emerald-950/40 font-mono text-[11px] tracking-wider text-emerald-300"
                : "border-neutral-700 bg-neutral-900 font-mono text-[11px] tracking-wider text-neutral-400"
            }
          >
            {decision.status.toUpperCase()}
          </Badge>
        </div>
        <CardTitle className="text-xl font-medium leading-snug text-neutral-100">
          {decision.statement}
        </CardTitle>
        {decision.supersedes.map((s) => (
          <p key={s} className="text-xs text-neutral-400">
            <span className="text-neutral-500">overrules</span> {s}
          </p>
        ))}
        {decision.supersededBy.map((s) => (
          <p key={s} className="text-xs text-amber-500/80">
            <span className="text-neutral-500">overruled by</span> {s}
          </p>
        ))}
      </CardHeader>

      <CardContent className="space-y-5">
        {objectors.length > 0 && (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-500/90">
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
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
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

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <div className="mt-7">
      <ol className="relative space-y-8 border-l border-neutral-800 pl-7">
        {entries.map((e, i) => (
          <li
            key={e.statement}
            className="animate-in fade-in slide-in-from-left-2 duration-500 ease-out fill-mode-backwards"
            style={{ animationDelay: `${150 + i * 50}ms` }}
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
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-200">{e.statement}</p>
            {e.dissenters.length > 0 && (
              <p className="mt-2 text-xs text-amber-500/80">
                objection from {e.dissenters.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Stats(props: { decisions: number; positions: number; dissenters: number; latency: number }) {
  const rows: [string, string][] = [
    ["decisions recalled", String(props.decisions)],
    ["attributed positions", String(props.positions)],
    ["named dissenters", String(props.dissenters)],
    ["recall latency", `${props.latency} ms`],
  ];
  return (
    <dl className="mt-7 space-y-4">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-neutral-400">{label}</dt>
          <dd className="font-mono text-sm text-neutral-200">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-14 lg:grid-cols-[1.618fr_1fr]">
      <div className="space-y-6">
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
      <div className="space-y-4">
        <Skeleton className="h-4 w-32 bg-neutral-800" />
        <Skeleton className="h-4 w-full bg-neutral-800" />
        <Skeleton className="h-4 w-2/3 bg-neutral-800" />
      </div>
    </div>
  );
}
