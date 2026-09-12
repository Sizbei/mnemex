"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { describeFailure } from "@/components/states";

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
    if (busy) return;
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
      if (!data.ok) { setError(data.error ?? "the write did not complete"); return; }
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
        <p className="text-sm leading-relaxed text-neutral-400">
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
              <p id="stance-label" className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
                stance
              </p>
              <div role="group" aria-labelledby="stance-label" className="flex flex-wrap gap-2">
                {STANCES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    title={s.hint}
                    aria-pressed={stance === s.value}
                    onClick={() => setStance(s.value)}
                    className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs transition-colors duration-100 ${
                      stance === s.value
                        ? s.value === "disagrees"
                          ? "border-amber-700 bg-amber-950/50 text-amber-300"
                          : "border-neutral-500 bg-neutral-800 text-neutral-100"
                        : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                    }`}
                  >
                    {/* Selection is a colour change, which some viewers cannot see,
                        so the chosen chip also carries a mark. */}
                    {stance === s.value && (
                      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden focusable="false">
                        <path d="M1.5 6.4 L4.6 9.5 L10.5 2.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="mt-2.5 text-xs text-neutral-400">
                {STANCES.find((s) => s.value === stance)?.hint}
              </p>
            </div>
          )}

          <Button
            type="submit"
            disabled={busy || !claim.trim()}
            className="h-11 w-full text-sm font-medium transition-transform duration-100 hover:scale-[1.02] active:scale-95"
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {busy ? "writing" : "remember"}
          </Button>
        </form>

        {error && <WriteError raw={error} />}

        {written && (
          <div
            role="status"
            className="mt-6 animate-in fade-in slide-in-from-bottom-2 space-y-3 rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-5 duration-300 ease-out"
          >
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-400">
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden focusable="false">
                <path d="M1.5 6.4 L4.6 9.5 L10.5 2.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              written
            </p>
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

/** Inline, because a failed write is recoverable: the form below it still holds the input. */
function WriteError({ raw }: { raw: string }) {
  const { title, body } = describeFailure(raw);
  return (
    <div role="alert" className="mt-5 rounded-lg border border-amber-900/50 bg-amber-950/20 p-5">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-200">
        <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden focusable="false">
          <path d="M6 1 L11.2 10.5 L0.8 10.5 Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M6 4.6 L6 7.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="6" cy="8.9" r="0.65" fill="currentColor" />
        </svg>
        {title}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-neutral-300">{body}</p>
      <p className="mt-3 break-words font-mono text-[11px] leading-relaxed text-neutral-400">{raw}</p>
    </div>
  );
}

const inputCls =
  "border-neutral-800 bg-neutral-950/60 text-neutral-100 placeholder:text-neutral-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
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
