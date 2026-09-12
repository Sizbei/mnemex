"use client";

import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Stance = "supports" | "disagrees" | "proposes";

interface Turn {
  speaker: string;
  claims: string[];
  topic?: string;
  decision?: { statement: string; stance: Stance };
}

interface Extracted {
  turns: Turn[];
  batches: number;
  rejected: number;
  warnings: string[];
  latencyMs: number;
}

interface Imported {
  turns: number;
  claims: number;
  decisions: number;
  degraded: string[];
}

const STANCE_STYLE: Record<Stance, string> = {
  disagrees: "border-amber-800/60 bg-amber-950/40 text-amber-300",
  supports: "border-emerald-900/60 bg-emerald-950/40 text-emerald-300",
  proposes: "border-neutral-700 bg-neutral-900 text-neutral-300",
};

export function UploadTranscript({ onImported }: { onImported: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<"idle" | "reading" | "writing">("idle");
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [imported, setImported] = useState<Imported | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickFile = async (file: File) => {
    setText(await file.text());
    setTitle(file.name.replace(/\.[^.]+$/, ""));
    setExtracted(null);
    setImported(null);
  };

  const read = async () => {
    setBusy("reading");
    setError(null);
    setImported(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });
      const data = await res.json();
      data.ok ? setExtracted(data) : setError(data.error ?? "extraction failed");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("idle");
    }
  };

  const commit = async () => {
    if (!extracted) return;
    setBusy("writing");
    setError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: extracted.turns, sessionTitle: title || "Uploaded transcript" }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "import failed"); return; }
      setImported(data);
      setExtracted(null);
      setText("");
      onImported();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("idle");
    }
  };

  const drop = (turnIndex: number) => {
    if (!extracted) return;
    setExtracted({ ...extracted, turns: extracted.turns.filter((_, i) => i !== turnIndex) });
  };

  return (
    <Card className="border-neutral-800 bg-neutral-900/60">
      <CardHeader className="gap-2">
        <CardTitle className="text-sm font-medium uppercase tracking-[0.14em] text-neutral-400">
          Upload a transcript
        </CardTitle>
        <p className="text-sm leading-relaxed text-neutral-400">
          The model on Nosana reads the transcript and proposes structured turns. Nothing is
          written until you approve it, because extraction is the least reliable part of the
          system and a wrong claim is worse than a missing one.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".txt,.md,.log,text/plain,text/markdown"
            className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            className="border-neutral-700 text-sm transition-transform duration-100 hover:scale-105"
          >
            Choose a file
          </Button>
          <span className="text-xs text-neutral-500">or paste below. Plain text or markdown.</span>
        </div>

        <label className="block">
          <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
            transcript
          </span>
          <Textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setExtracted(null); }}
            placeholder={"Priya: I think we should move the limiter to Redis.\nMarcus: Shared state in the request path worries me."}
            className="min-h-44 resize-y border-neutral-800 bg-neutral-950/60 font-mono text-xs leading-relaxed text-neutral-100 placeholder:text-neutral-600"
          />
        </label>

        <Button
          type="button"
          onClick={read}
          disabled={busy !== "idle" || !text.trim()}
          className="h-11 w-full text-sm font-medium transition-transform duration-100 hover:scale-[1.02] active:scale-95"
        >
          {busy === "reading" ? "reading transcript…" : "read transcript"}
        </Button>

        {error && (
          <p className="rounded-md border border-red-900/60 bg-red-950/40 p-4 font-mono text-xs text-red-300">
            {error}
          </p>
        )}

        {extracted && (
          <div className="space-y-4 rounded-lg border border-neutral-800 bg-neutral-950/40 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
                Review, {extracted.turns.length} turn{extracted.turns.length === 1 ? "" : "s"}
              </p>
              <span className="font-mono text-[11px] text-neutral-500">
                {extracted.batches} batch{extracted.batches === 1 ? "" : "es"} · {extracted.latencyMs} ms
              </span>
            </div>

            {extracted.warnings.map((w) => (
              <p key={w} className="text-xs text-amber-400/90">{w}</p>
            ))}

            <ul className="space-y-3">
              {extracted.turns.map((t, i) => (
                <li key={i} className="rounded-md border border-neutral-800 bg-neutral-900/60 p-4">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-sm font-medium text-neutral-200">{t.speaker}</span>
                    {t.topic && (
                      <Badge variant="outline" className="border-neutral-700 text-[11px] text-neutral-400">
                        {t.topic}
                      </Badge>
                    )}
                    {t.decision && (
                      <Badge variant="outline" className={`text-[11px] ${STANCE_STYLE[t.decision.stance]}`}>
                        {t.decision.stance}
                      </Badge>
                    )}
                    <button
                      onClick={() => drop(i)}
                      className="ml-auto text-xs text-neutral-500 transition-colors duration-100 hover:text-red-400"
                    >
                      discard
                    </button>
                  </div>
                  {t.claims.map((c) => (
                    <p key={c} className="mt-2 text-sm leading-relaxed text-neutral-400">{c}</p>
                  ))}
                  {t.decision && (
                    <p className="mt-2 text-xs text-neutral-500">on: {t.decision.statement}</p>
                  )}
                </li>
              ))}
            </ul>

            <Button
              type="button"
              onClick={commit}
              disabled={busy !== "idle" || extracted.turns.length === 0}
              className="h-11 w-full text-sm font-medium transition-transform duration-100 hover:scale-[1.02] active:scale-95"
            >
              {busy === "writing"
                ? "writing to memory…"
                : `write ${extracted.turns.length} turn${extracted.turns.length === 1 ? "" : "s"} to memory`}
            </Button>
          </div>
        )}

        {imported && (
          <div className="animate-in fade-in slide-in-from-bottom-2 space-y-3 rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-5 duration-300 ease-out">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-400">written</p>
            <dl className="space-y-2 text-sm">
              {([["turns", imported.turns], ["claims", imported.claims], ["decisions", imported.decisions]] as const).map(
                ([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4">
                    <dt className="text-neutral-400">{k}</dt>
                    <dd className="font-mono text-neutral-100">{v}</dd>
                  </div>
                ),
              )}
            </dl>
            {imported.degraded.length > 0 && (
              <p className="font-mono text-[11px] text-amber-300">degraded: {imported.degraded.join(", ")}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
