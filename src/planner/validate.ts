import type { MergeInput, MergePlan } from "./merge.js";

/**
 * Thrown when a merge plan references data it was never given. Typed rather than
 * string-matched so the sandbox fallback path can re-throw it instead of
 * swallowing the one failure that guard exists to catch.
 */
export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

/**
 * The plan may be computed in an isolated sandbox, but the server still refuses
 * to act on one that reaches outside the data it was handed.
 */
export function validatePlan(plan: MergePlan, input: MergeInput): void {
  const peopleIds = new Set(input.candidates.people.map((p) => p.id));
  const claimIds = new Set(input.candidates.claims.map((c) => c.id));
  const decisionIds = new Set(input.candidates.decisions.map((d) => d.id));

  if (plan.personId !== null && !peopleIds.has(plan.personId)) {
    throw new PlanValidationError(`plan.personId "${plan.personId}" was not among the supplied candidates`);
  }
  if (plan.duplicateClaimIds.length !== input.claims.length) {
    throw new PlanValidationError(
      `plan.duplicateClaimIds has ${plan.duplicateClaimIds.length} entries, expected ${input.claims.length}`,
    );
  }
  for (const id of plan.duplicateClaimIds) {
    if (id !== null && !claimIds.has(id)) {
      throw new PlanValidationError(`plan.duplicateClaimIds contains unknown id "${id}"`);
    }
  }
  for (const [field, id] of [
    ["supersedesDecisionId", plan.supersedesDecisionId],
    ["matchedDecisionId", plan.matchedDecisionId],
  ] as const) {
    if (id !== null && !decisionIds.has(id)) {
      throw new PlanValidationError(`plan.${field} contains unknown id "${id}"`);
    }
  }
}
