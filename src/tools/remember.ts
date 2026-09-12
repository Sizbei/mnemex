import { randomUUID } from "node:crypto";
import { z } from "zod";
import { embedWithFallback } from "../embedding/index.js";
import { planMergeSandboxed } from "../sandbox/daytona.js";
import type { MergeInput } from "../planner/merge.js";
import { runQuery } from "../graph/driver.js";
import { FETCH_CANDIDATES, APPLY_PLAN, UPSERT_DECISION, LINK_STANCE } from "../graph/queries.js";

export const RememberSchema = z.object({
  sessionId: z.string().min(1),
  sessionTitle: z.string().optional(),
  speaker: z.string().min(1),
  claims: z.array(z.string().min(1)).min(1, "claims must contain at least one statement"),
  topic: z.string().optional(),
  decision: z
    .object({ statement: z.string().min(1), stance: z.enum(["supports", "disagrees", "proposes"]) })
    .optional(),
  testRun: z.string().optional(),
});

export type RememberInput = z.infer<typeof RememberSchema>;

export interface RememberResult {
  personId: string;
  sessionId: string;
  claimIds: string[];
  decisionId: string | null;
  merged: { claims: number; person: boolean };
  degraded: string[];
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function remember(raw: RememberInput): Promise<RememberResult> {
  const input = RememberSchema.parse(raw);

  const texts = [...input.claims, ...(input.decision ? [input.decision.statement] : [])];
  const { vectors, degraded } = await embedWithFallback(texts);
  const claimVectors = vectors.slice(0, input.claims.length);
  const decisionVector = input.decision ? vectors[vectors.length - 1] : undefined;

  const [candidates] = await runQuery<MergeInput["candidates"]>(FETCH_CANDIDATES, {
    probe: decisionVector ?? claimVectors[0],
  });

  const mergeInput: MergeInput = {
    speaker: input.speaker,
    claims: input.claims.map((text, i) => ({ text, embedding: claimVectors[i] })),
    decision:
      input.decision && decisionVector
        ? {
            statement: input.decision.statement,
            embedding: decisionVector,
            stance: input.decision.stance,
            topicId: input.topic ? `topic:${slug(input.topic)}` : null,
          }
        : undefined,
    candidates,
  };

  const { plan, degraded: planDegraded } = await planMergeSandboxed(mergeInput);

  const newPersonId = randomUUID();
  const topicId = input.topic ? `topic:${slug(input.topic)}` : null;

  const newClaims = input.claims
    .map((text, i) => ({ text, embedding: claimVectors[i], dupe: plan.duplicateClaimIds[i] }))
    .filter((c) => c.dupe === null)
    .map((c) => ({ id: randomUUID(), text: c.text, embedding: c.embedding }));

  const [applied] = await runQuery<{ created: string[] }>(APPLY_PLAN, {
    sessionId: input.sessionId,
    sessionTitle: input.sessionTitle ?? input.sessionId,
    personId: plan.personId,
    newPersonId,
    speaker: input.speaker,
    topic: input.topic ?? null,
    topicId,
    topicSlug: input.topic ? slug(input.topic) : null,
    newClaims,
    testRun: input.testRun ?? null,
  });

  const claimIds = [
    ...applied.created,
    ...plan.duplicateClaimIds.filter((id): id is string => id !== null),
  ];

  let decisionId: string | null = null;
  if (input.decision && decisionVector) {
    decisionId = plan.matchedDecisionId ?? randomUUID();
    await runQuery(UPSERT_DECISION, {
      sessionId: input.sessionId,
      decisionId,
      statement: input.decision.statement,
      embedding: decisionVector,
      topicId,
      supersedesId: plan.supersedesDecisionId,
      testRun: input.testRun ?? null,
    });
    await runQuery(LINK_STANCE, { decisionId, claimIds, stance: input.decision.stance });
  }

  return {
    personId: plan.personId ?? newPersonId,
    sessionId: input.sessionId,
    claimIds,
    decisionId,
    merged: {
      claims: plan.duplicateClaimIds.filter((id) => id !== null).length,
      person: plan.personId !== null,
    },
    degraded: [...degraded, ...planDegraded],
  };
}
