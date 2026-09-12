"use client";

import { Button } from "@/components/ui/button";

/**
 * The four empty states the design checklist asks for are all the same panel
 * with different copy and a different way out, so they share one component.
 * A blank region reads as a broken build, which on a projector is fatal.
 */
type Tone = "empty" | "error";

export function StatePanel({
  tone = "empty",
  title,
  body,
  detail,
  action,
}: {
  tone?: Tone;
  title: string;
  body: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}) {
  const isError = tone === "error";
  return (
    <div
      role={isError ? "alert" : undefined}
      className={`animate-in fade-in slide-in-from-bottom-2 flex flex-col items-center rounded-xl border px-6 py-14 text-center duration-300 ease-out ${
        isError
          ? "border-amber-900/50 bg-amber-950/15"
          : "border-neutral-800 bg-neutral-900/40"
      }`}
    >
      {isError ? <BrokenEdgeMark /> : <EmptyGraphMark />}
      <p className="mt-6 text-base font-medium text-neutral-100">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-400">{body}</p>
      {detail && (
        <p className="mt-4 max-w-md break-words font-mono text-[11px] leading-relaxed text-neutral-500">
          {detail}
        </p>
      )}
      {action && (
        <Button
          onClick={action.onClick}
          variant="outline"
          className="mt-7 h-10 px-5 text-sm transition-transform duration-100 hover:scale-105 active:scale-95"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** Nodes with nothing joining them: the graph exists but holds no edges yet. */
function EmptyGraphMark() {
  return (
    <svg width="76" height="52" viewBox="0 0 76 52" aria-hidden focusable="false">
      <g stroke="#404040" strokeWidth="1.5" strokeDasharray="4 4" fill="none">
        <path d="M16 36 L38 14 L60 36" />
      </g>
      <circle cx="38" cy="14" r="7" fill="none" stroke="#525252" strokeWidth="1.5" />
      <circle cx="16" cy="36" r="5.5" fill="none" stroke="#525252" strokeWidth="1.5" />
      <circle cx="60" cy="36" r="5.5" fill="none" stroke="#525252" strokeWidth="1.5" />
    </svg>
  );
}

/** The same figure with the edge severed, so the error reads before the copy does. */
function BrokenEdgeMark() {
  return (
    <svg width="76" height="52" viewBox="0 0 76 52" aria-hidden focusable="false">
      <g stroke="#b45309" strokeWidth="1.8" fill="none" strokeLinecap="round">
        <path d="M20 34 L31 20" />
        <path d="M45 20 L56 34" />
      </g>
      <circle cx="16" cy="36" r="5.5" fill="none" stroke="#a16207" strokeWidth="1.6" />
      <circle cx="60" cy="36" r="5.5" fill="none" stroke="#a16207" strokeWidth="1.6" />
      <path d="M38 12 L38 22" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
      <circle cx="38" cy="28" r="1.6" fill="#fbbf24" />
    </svg>
  );
}

/**
 * Errors get typed before they get rendered: a dead fetch and a Cypher failure
 * need different copy, and a raw `Neo4jError: ...` string is not an answer.
 */
export function describeFailure(raw: string): { title: string; body: string } {
  const text = raw.toLowerCase();
  if (text.includes("failed to fetch") || text.includes("networkerror") || text.includes("load failed")) {
    return {
      title: "The demo server stopped responding",
      body: "The page could not reach its own API. The Next dev server is probably restarting.",
    };
  }
  if (text.includes("routing") || text.includes("connection") || text.includes("neo4j") || text.includes("servicunavailable") || text.includes("serviceunavailable")) {
    return {
      title: "Memory is unreachable",
      body: "The Neo4j connection did not answer, so nothing can be recalled or written until it comes back.",
    };
  }
  if (text.includes("question is required")) {
    return { title: "That question was empty", body: "Type a question, or pick one of the presets above." };
  }
  return {
    title: "Recall failed",
    body: "The graph query did not complete. The raw failure is below, in case it is the interesting part.",
  };
}
