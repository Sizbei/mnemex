export interface Candidate { id: string; text: string; embedding: number[]; topicIds?: string[] }
export interface PersonCandidate { id: string; name: string }

export interface MergeInput {
  speaker: string;
  claims: { text: string; embedding: number[] }[];
  decision?: {
    statement: string;
    embedding: number[];
    stance: "supports" | "disagrees" | "proposes";
    topicId?: string | null;
  };
  candidates: { people: PersonCandidate[]; claims: Candidate[]; decisions: Candidate[] };
}

export interface MergePlan {
  personId: string | null;
  duplicateClaimIds: (string | null)[];
  supersedesDecisionId: string | null;
  matchedDecisionId: string | null;
}

/** Near-identical restatement. */
const DUPLICATE_THRESHOLD = 0.97;
/**
 * Fallback only, for turns that carry no topic. Two decisions on the same subject
 * can sit well below this: "Use Postgres as the primary datastore" and "Move the
 * primary datastore to Neo4j" measure 0.75. That is why the topic edge, which the
 * caller states explicitly, is the primary signal and similarity is the backstop.
 */
const SAME_TOPIC_THRESHOLD = 0.7;

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function best(target: number[], pool: Candidate[]): { id: string; score: number } | null {
  let winner: { id: string; score: number } | null = null;
  for (const c of pool) {
    const score = cosine(target, c.embedding);
    if (!winner || score > winner.score) winner = { id: c.id, score };
  }
  return winner;
}

export function planMerge(input: MergeInput): MergePlan {
  const speaker = input.speaker.trim().toLowerCase();
  const person = input.candidates.people.find((p) => p.name.trim().toLowerCase() === speaker);

  const duplicateClaimIds = input.claims.map((claim) => {
    const match = best(claim.embedding, input.candidates.claims);
    return match && match.score >= DUPLICATE_THRESHOLD ? match.id : null;
  });

  let supersedesDecisionId: string | null = null;
  let matchedDecisionId: string | null = null;

  if (input.decision) {
    const decision = input.decision;
    const match = best(decision.embedding, input.candidates.decisions);

    if (match && match.score >= DUPLICATE_THRESHOLD) {
      // A restatement of a decision already on record. Reuse it, never supersede it with itself.
      matchedDecisionId = match.id;
    } else if (decision.stance === "proposes") {
      // A new proposal reverses the standing decision on the same topic. Topic
      // membership is stated by the caller, so prefer it over guessing from vectors.
      const sameTopic = decision.topicId
        ? input.candidates.decisions.filter(
            (d) => d.topicIds?.includes(decision.topicId as string) && d.id !== matchedDecisionId,
          )
        : [];
      const onTopic = sameTopic.length > 0 ? best(decision.embedding, sameTopic) : null;

      if (onTopic && onTopic.score < DUPLICATE_THRESHOLD) {
        supersedesDecisionId = onTopic.id;
      } else if (!decision.topicId && match && match.score >= SAME_TOPIC_THRESHOLD) {
        // No topic supplied: fall back to similarity.
        supersedesDecisionId = match.id;
      }
    }
  }

  return { personId: person?.id ?? null, duplicateClaimIds, supersedesDecisionId, matchedDecisionId };
}
