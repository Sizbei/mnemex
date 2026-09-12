// The compiled build is imported the same way web/ imports it, rather than through src/,
// so this server runs against exactly the code the MCP server runs.
import { recall, RecallSchema } from "../../dist/src/tools/recall.js";
import { remember, RememberSchema } from "../../dist/src/tools/remember.js";
import { timeline, TimelineSchema } from "../../dist/src/tools/timeline.js";
// Bare "zod" resolves past agent-ui/node_modules to the repository root copy, which is the
// instance those schemas were built with. Adding zod to agent-ui/package.json would give
// this file a second copy and z.toJSONSchema would be handed foreign schema objects.
import { z } from "zod";

export type ToolName = "recall" | "remember" | "timeline";

export interface OpenAITool {
  type: "function";
  function: { name: ToolName; description: string; parameters: Record<string, unknown> };
}

/**
 * Derive the wire schema from the zod schema instead of restating it.
 *
 * A hand-copied tool definition drifts the moment someone adds a field, and the failure is
 * silent: the model simply never learns the argument exists.
 */
function parametersFor(schema: z.ZodType, omit: readonly string[] = []): Record<string, unknown> {
  // "input" is the caller's view: optional fields stay optional and defaults are not
  // promoted to required, which is what the model is actually allowed to send.
  const { $schema: _schema, ...json } = z.toJSONSchema(schema, { io: "input" }) as Record<string, any>;
  for (const key of omit) delete json.properties?.[key];
  json.required = ((json.required as string[]) ?? []).filter((key) => !omit.includes(key));
  return json;
}

export const toolDefinitions: OpenAITool[] = [
  {
    type: "function",
    function: {
      name: "recall",
      description:
        "Search persistent graph memory and return decisions with who supported them and who " +
        "objected, and which have since been superseded. Use this for any question about what " +
        "was decided, who argued what, or what changed.",
      parameters: parametersFor(RecallSchema),
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description:
        "Write one speaker turn into persistent graph memory: the claims they made and, if they " +
        "took a position on an outcome, the decision and their stance toward it.",
      // testRun tags nodes so a test can delete its own data. It is a fixture hook, and a
      // model that sets it would quietly mark real memories as disposable.
      parameters: parametersFor(RememberSchema, ["testRun"]),
    },
  },
  {
    type: "function",
    function: {
      name: "timeline",
      description:
        "Return a topic's decision history in order, showing what superseded what and who " +
        "dissented at each step.",
      parameters: parametersFor(TimelineSchema),
    },
  },
];

export function isToolName(name: string): name is ToolName {
  return toolDefinitions.some((tool) => tool.function.name === name);
}

export async function executeTool(name: ToolName, args: unknown): Promise<unknown> {
  const input = (args ?? {}) as Record<string, unknown>;
  if (name === "recall") return recall(input as never);
  if (name === "remember") return remember(input as never);
  return timeline(input as never);
}

/** One line for the tool card's collapsed state. The full result is on the card already. */
export function resultPreview(name: ToolName, result: unknown): string {
  const value = result as Record<string, any>;
  if (name === "recall") {
    const decisions: any[] = value?.decisions ?? [];
    const dissent = decisions.reduce(
      (total, decision) =>
        total + (decision.positions ?? []).filter((p: any) => p.stance === "DISAGREES_WITH").length,
      0,
    );
    return `${decisions.length} decision(s), ${dissent} objection(s)`;
  }
  if (name === "timeline") {
    return `${(value?.entries ?? []).length} entries for ${value?.topic ?? "topic"}`;
  }
  return `${(value?.claimIds ?? []).length} claim(s) written${value?.decisionId ? ", decision linked" : ""}`;
}
