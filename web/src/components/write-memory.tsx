"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Stance = "supports" | "disagrees" | "proposes";

interface Written {
  claimIds: string[];
  decisionId: string | null;
  merged: { claims: number; person: boolean };
  degraded: string[];
  latencyMs: number;
}

const STANCES: { value: Stance; label: string; hint: string }[] = [
  { value: "proposes", label: "proposes", hint: "reverses the standing decision on this topic" },
  { value: "supports", label: "supports", hint: "agrees with the decision" },
  { value: "disagrees", label: "disagrees", hint: "objects, and is recorded as the dissenter" },
];

export function WriteMemory({ onWritten }: { onWritten: () => void }) {
  const [speaker, setSpeaker] = useState("Dana");
  const [claim, setClaim] = useState("");
  const [topic, setTopic] = useState("storage engine");
  const [statement, setStatement] = useState("");
  const [stance, setStance] = useState<Stance>("disagrees");
  const [sessionId, setSessionId] = useState("s3");
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState<Written | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setWritten(null);
    try {
      const res = await fetch("/api/remember", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          sessionTitle: `Live session ${sessionId}`,
          speaker,
          claims: [claim],
          topic: topic || undefined,
          decision: statement ? { statement, stance } : undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "write failed"); return; }
      setWritten(data);
      setClaim("");
      setStatement("");
      onWritten();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-neutral-800 bg-neutral-900/60">
      <CardHeader className="gap-2">
        <CardTitle className="text-sm font-medium uppercase tracking-[0.14em] text-neutral-400">
          Write to memory
        </CardTitle>
        <p className="text-sm leading-relaxed text-neutral-500">
          This is what the assistant calls. Embedding runs on Nosana, entity resolution runs in a
          Daytona sandbox, and the graph updates live.
        </p>
      </CardHeader>

      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="speaker">
              <Input value={speaker} onChange={(e) => setSpeaker(e.target.value)} className={inputCls} required />
            </Field>
            <Field label="topic">
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} className={inputCls} />
            </Field>
            <Field label="session">
              <Input value={sessionId} onChange={(e) => setSessionId(e.target.value)} className={inputCls} required />
            </Field>
          </div>

          <Field label="what they said">
            <Textarea
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              placeholder="Neo4j is the wrong call, our write volume will outgrow it."
              className={`${inputCls} min-h-20 resize-none`}
              required
            />
          </Field>

          <Field label="decision they took a position on (optional)">
            <Input
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="Move the primary datastore back to Postgres"
              className={inputCls}
            />
          </Field>

          {statement && (
            <div>
              <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">stance</p>
              <div className="flex flex-wrap gap-2">
                {STANCES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    title={s.hint}
                    onClick={() => setStance(s.value)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs transition-colors duration-100 ${
                      stance === s.value
                        ? s.value === "disagrees"
                          ? "border-amber-700 bg-amber-950/50 text-amber-300"
                          : "border-neutral-500 bg-neutral-800 text-neutral-100"
                        : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="mt-2.5 text-xs text-neutral-500">
                {STANCES.find((s) => s.value === stance)?.hint}
              </p>
            </div>
          )}

          <Button
            type="submit"
            disabled={busy || !claim.trim()}
            className="h-11 w-full text-sm font-medium transition-transform duration-100 hover:scale-[1.02] active:scale-95"
          >
            {busy ? "writing…" : "remember"}
          </Button>
        </form>

        {error && (
          <p className="mt-5 rounded-md border border-red-900/60 bg-red-950/40 p-4 font-mono text-xs text-red-300">
            {error}
          </p>
        )}

        {written && (
          <div className="mt-6 animate-in fade-in slide-in-from-bottom-2 space-y-3 rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-5 duration-300 ease-out">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-400">written</p>
            <dl className="space-y-2 text-sm">
              <Row k="claims created" v={String(written.claimIds.length)} />
              <Row k="decision" v={written.decisionId ? "linked" : "none"} />
              <Row k="speaker matched to existing" v={written.merged.person ? "yes" : "no, created"} />
              <Row k="duplicate claims merged" v={String(written.merged.claims)} />
              <Row k="latency" v={`${written.latencyMs} ms`} />
            </dl>
            <div className="flex flex-wrap gap-2 pt-1">
              {written.degraded.length === 0 ? (
                <Badge className="border-emerald-800/60 bg-emerald-950/50 font-mono text-[11px] text-emerald-300 hover:bg-emerald-950/50">
                  Nosana and Daytona both live
                </Badge>
              ) : (
                written.degraded.map((d) => (
                  <Badge key={d} className="border-amber-800/60 bg-amber-950/50 font-mono text-[11px] text-amber-300 hover:bg-amber-950/50">
                    degraded: {d}
                  </Badge>
                ))
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const inputCls =
  "border-neutral-800 bg-neutral-950/60 text-neutral-100 placeholder:text-neutral-600";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-neutral-400">{k}</dt>
      <dd className="font-mono text-neutral-100">{v}</dd>
    </div>
  );
}
