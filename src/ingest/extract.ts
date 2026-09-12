import { z } from "zod";

/** One thing a person said, the same shape the remember tool takes. */
export const ExtractedTurn = z.object({
  speaker: z.string().min(1),
  claims: z.array(z.string().min(1)).min(1),
  topic: z.string().optional(),
  decision: z
    .object({ statement: z.string().min(1), stance: z.enum(["supports", "disagrees", "proposes"]) })
    .optional(),
});
export type ExtractedTurn = z.infer<typeof ExtractedTurn>;

export interface ExtractResult {
  turns: ExtractedTurn[];
  batches: number;
  rejected: number;
  warnings: string[];
}

const SYSTEM = [
  "You extract structured memory from a meeting transcript. Return ONLY a JSON array, no prose.",
  "",
  "Each element is one thing a person said:",
  '{"speaker": "Name", "claims": ["what they said, in their own words"], "topic": "short subject",',
  ' "decision": {"statement": "the outcome being discussed", "stance": "supports|disagrees|proposes"}}',
  "",
  "Rules.",
  "claims: one short sentence each, quoting their actual argument. Never longer than 40 words.",
  "topic: two or three words, the same string for every turn about the same subject.",
  "decision: include ONLY when the speaker took a position on an outcome. Omit it otherwise.",
  "stance: proposes when they put the outcome forward or reverse an earlier one, disagrees when",
  "they object to it, supports when they back it.",
  "Use the same decision statement string for every speaker discussing that same outcome.",
  "Skip greetings, scheduling and small talk. Extract nothing rather than invent anything.",
].join("\n");

/** A real meeting transcript will not fit the model's 16k window, so send it in pieces. */
export function batchLines(text: string, linesPerBatch = 40): string[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += linesPerBatch) {
    out.push(lines.slice(i, i + linesPerBatch).join("\n"));
  }
  return out;
}

/** Models wrap JSON in prose or fences however firmly you ask them not to. */
export function extractJsonArray(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1) {
    throw new Error(`no JSON array in model output: ${text.slice(0, 160)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function completionsUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/**
 * Extract turns from a raw transcript using the deployed chat model.
 *
 * Never writes anything. Extraction is the least reliable part of this system, so the
 * caller decides what to do with the result. A batch that fails to parse is reported and
 * skipped rather than aborting the whole transcript, and within a batch each turn is
 * validated on its own so one malformed element does not lose its neighbours.
 */
export async function extractTurns(
  transcript: string,
  options: { endpoint: string; model?: string; signal?: AbortSignal } = { endpoint: "" },
): Promise<ExtractResult> {
  if (!options.endpoint) throw new Error("No chat endpoint configured for extraction.");

  const url = completionsUrl(options.endpoint);
  const parts = batchLines(transcript);
  const turns: ExtractedTurn[] = [];
  const warnings: string[] = [];
  let rejected = 0;

  for (const [i, part] of parts.entries()) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model || "chat",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: part },
        ],
        temperature: 0,
        max_tokens: 2048,
      }),
      signal: options.signal,
    });

    if (!res.ok) {
      warnings.push(`Batch ${i + 1} failed: the model returned ${res.status}.`);
      continue;
    }

    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    let raw: unknown;
    try {
      raw = extractJsonArray(body.choices[0].message.content);
    } catch {
      warnings.push(`Batch ${i + 1} produced no readable JSON and was skipped.`);
      continue;
    }

    const elements = Array.isArray(raw) ? raw : [];
    for (const element of elements) {
      const one = ExtractedTurn.safeParse(element);
      if (one.success) turns.push(one.data);
      else rejected += 1;
    }
  }

  if (rejected > 0) {
    warnings.push(`${rejected} extracted turn(s) did not match the expected shape and were dropped.`);
  }
  return { turns, batches: parts.length, rejected, warnings };
}
