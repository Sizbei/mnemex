import { z } from "zod";
import { runQuery } from "../graph/driver.js";
import { TIMELINE_BY_TOPIC } from "../graph/queries.js";

export const TimelineSchema = z.object({ topic: z.string().min(1) });
export type TimelineInput = z.infer<typeof TimelineSchema>;

export interface TimelineEntry {
  statement: string;
  status: "current" | "superseded" | "open";
  decidedAt: string;
  supersedes: string | null;
  dissenters: string[];
}

export interface TimelineResult { topic: string; entries: TimelineEntry[]; degraded: string[] }

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function timeline(raw: TimelineInput): Promise<TimelineResult> {
  const input = TimelineSchema.parse(raw);
  const rows = await runQuery<TimelineEntry & { dissenters: (string | null)[] }>(TIMELINE_BY_TOPIC, {
    slug: slug(input.topic),
  });
  return {
    topic: input.topic,
    entries: rows.map((r) => ({ ...r, dissenters: r.dissenters.filter((d): d is string => d !== null) })),
    degraded: [],
  };
}
