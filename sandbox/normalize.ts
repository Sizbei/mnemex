// Executed inside a Daytona sandbox. Pure computation over the payload injected below.
// Deliberately dependency-free so it can be shipped as a single self-contained script.
declare const __MNEMEX_INPUT__: string;

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

const DUPLICATE_THRESHOLD = 0.97;
const SAME_TOPIC_THRESHOLD = 0.7;

const input = JSON.parse(__MNEMEX_INPUT__);
const speaker = String(input.speaker).trim().toLowerCase();
const person = input.candidates.people.find(
  (p: { name: string }) => String(p.name).trim().toLowerCase() === speaker,
);

const best = (target: number[], pool: { id: string; embedding: number[] }[]) => {
  let winner: { id: string; score: number } | null = null;
  for (const c of pool) {
    const score = cosine(target, c.embedding);
    if (!winner || score > winner.score) winner = { id: c.id, score };
  }
  return winner;
};

const duplicateClaimIds = input.claims.map((claim: { embedding: number[] }) => {
  const m = best(claim.embedding, input.candidates.claims);
  return m && m.score >= DUPLICATE_THRESHOLD ? m.id : null;
});

let supersedesDecisionId: string | null = null;
let matchedDecisionId: string | null = null;
if (input.decision) {
  const decision = input.decision;
  const m = best(decision.embedding, input.candidates.decisions);

  if (m && m.score >= DUPLICATE_THRESHOLD) {
    matchedDecisionId = m.id;
  } else if (decision.stance === "proposes") {
    // Topic membership is stated by the caller, so it beats guessing from vectors.
    const sameTopic = decision.topicId
      ? input.candidates.decisions.filter(
          (d: { id: string; topicIds?: string[] }) =>
            d.topicIds && d.topicIds.indexOf(decision.topicId) !== -1 && d.id !== matchedDecisionId,
        )
      : [];
    const onTopic = sameTopic.length > 0 ? best(decision.embedding, sameTopic) : null;

    if (onTopic && onTopic.score < DUPLICATE_THRESHOLD) {
      supersedesDecisionId = onTopic.id;
    } else if (!decision.topicId && m && m.score >= SAME_TOPIC_THRESHOLD) {
      supersedesDecisionId = m.id;
    }
  }
}

console.log(JSON.stringify({
  personId: person ? person.id : null,
  duplicateClaimIds,
  supersedesDecisionId,
  matchedDecisionId,
}));
