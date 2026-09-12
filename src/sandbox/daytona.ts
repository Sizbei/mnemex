import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Daytona, type Sandbox } from "@daytonaio/sdk";
import { loadConfig } from "../config.js";
import { planMerge, type MergeInput, type MergePlan } from "../planner/merge.js";
import { validatePlan, PlanValidationError } from "../planner/validate.js";

/**
 * Resolved at runtime, not with `new URL(literal, import.meta.url)`. Bundlers
 * statically analyse that form and fail the build when the target is not part
 * of the module graph, which this file deliberately is not: it is source text
 * shipped into a sandbox, never imported.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const NORMALIZE_PATH = path.resolve(
  HERE,
  HERE.includes(`${path.sep}dist${path.sep}`) ? "../../../sandbox/normalize.ts" : "../../sandbox/normalize.ts",
);

// A fresh sandbox prints an npm update notice AFTER your stdout on its first run.
// These suppress it. We still parse defensively: never trust the last line.
const QUIET_NPM = { NPM_CONFIG_UPDATE_NOTIFIER: "false", NO_UPDATE_NOTIFIER: "1" };

/** Scan backwards for the last JSON-parseable line. Trailing noise is routine here. */
export function lastJsonLine(output: string): string {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[[{]/.test(lines[i])) return lines[i];
  }
  throw new Error(`no JSON in sandbox output: ${output.slice(0, 200)}`);
}

export interface SandboxedPlan { plan: MergePlan; degraded: string[] }

export async function planMergeSandboxed(input: MergeInput): Promise<SandboxedPlan> {
  const { daytona, daytonaTimeoutMs } = loadConfig();
  const timeoutSec = Math.ceil(daytonaTimeoutMs / 1000);

  let sandbox: Sandbox | undefined;
  try {
    const source = await readFile(NORMALIZE_PATH, "utf8");
    const code = source.replace(
      "declare const __MNEMEX_INPUT__: string;",
      `const __MNEMEX_INPUT__ = ${JSON.stringify(JSON.stringify(input))};`,
    );

    const client = new Daytona({ apiKey: daytona.apiKey, apiUrl: daytona.apiUrl });
    sandbox = await client.create({ language: "typescript", envVars: QUIET_NPM }, { timeout: timeoutSec });

    // codeRun's own timeout is in seconds and terminates the process server-side,
    // unlike a Promise.race which would orphan it.
    const execution = await sandbox.process.codeRun(code, undefined, timeoutSec);
    if (execution.exitCode !== 0) {
      throw new Error(`sandbox exit ${execution.exitCode}: ${execution.result.slice(0, 500)}`);
    }
    const plan = JSON.parse(lastJsonLine(execution.result)) as MergePlan;
    validatePlan(plan, input);
    return { plan, degraded: [] };
  } catch (err) {
    // A plan that reaches outside its candidate set is never acceptable, sandboxed or not.
    if (err instanceof PlanValidationError) throw err;
    console.error(`[mnemex] Daytona sandbox unavailable, normalizing in process: ${String(err)}`);
    const plan = planMerge(input);
    validatePlan(plan, input);
    return { plan, degraded: ["normalizer:inprocess"] };
  } finally {
    await sandbox?.delete().catch(() => {});
  }
}
