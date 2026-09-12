import { z } from "zod";
import { embedWithFallback } from "../embedding/index.js";
import { runQuery } from "../graph/driver.js";
import { RECALL_TRAVERSAL } from "../graph/queries.js";

export const RecallSchema = z.object({
  question: z.string().min(1),
  topK: z.number().int().positive().max(50).default(8),
});

export type RecallInput = z.input<typeof RecallSchema>;

export interface Position { person: string; stance: "SUPPORTS" | "DISAGREES_WITH"; claim: string }

export interface RecalledDecision {
  id: string;
  statement: string;
  status: "current" | "superseded" | "open";
  positions: Position[];
  supersedes: string[];
  supersededBy: string[];
}

export interface RecallResult { decisions: RecalledDecision[]; degraded: string[] }

interface Row {
  id: string; statement: string; status: RecalledDecision["status"];
  supersedes: (string | null)[]; supersededBy: (string | null)[];
  positions: (Position | null)[];
}

export async function recall(raw: RecallInput): Promise<RecallResult> {
  const input = RecallSchema.parse(raw);
  const { vectors, degraded } = await embedWithFallback([input.question]);

  const rows = await runQuery<Row>(RECALL_TRAVERSAL, { probe: vectors[0], topK: input.topK });

  const decisions: RecalledDecision[] = rows.map((r) => ({
    id: r.id,
    statement: r.statement,
    status: r.status,
    supersedes: r.supersedes.filter((s): s is string => s !== null),
    supersededBy: r.supersededBy.filter((s): s is string => s !== null),
    positions: r.positions.filter((p): p is Position => p !== null && p.person !== null),
  }));

  // Current decisions first: what is still true is what the caller asked for.
  decisions.sort((a, b) => Number(b.status === "current") - Number(a.status === "current"));
  return { decisions, degraded };
}
