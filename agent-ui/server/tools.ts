// The compiled build is imported the same way web/ imports it, rather than through src/,
// so this server runs against exactly the code the MCP server runs.
import { analyze, AnalyzeSchema } from "../../dist/src/tools/analyze.js";
import { recall, RecallSchema } from "../../dist/src/tools/recall.js";
import { remember, RememberSchema } from "../../dist/src/tools/remember.js";
import { timeline, TimelineSchema } from "../../dist/src/tools/timeline.js";
// Bare "zod" resolves past agent-ui/node_modules to the repository root copy, which is the
// instance those schemas were built with. Adding zod to agent-ui/package.json would give
// this file a second copy and z.toJSONSchema would be handed foreign schema objects.
import { z } from "zod";

export type ToolName = "recall" | "remember" | "timeline" | "analyze";

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
  {
    type: "function",
    function: {
      name: "analyze",
      // The model cannot write Cypher against a schema it has never seen, so the schema is
      // part of the description. Without it the model invents labels and every query fails.
      description: [
        "Run a read-only Cypher query against the memory graph for analytical questions that",
        "recall and timeline cannot answer, such as counts, rankings, aggregates or",
        "cross-topic comparisons. Prefer recall and timeline; reach for this only when they",
        "cannot express the question.",
        "",
        "The query runs in an isolated sandbox under a read-only credential. Writes are",
        "refused, so use only MATCH, WHERE, RETURN, ORDER BY, LIMIT and aggregation.",
        "",
        "Schema. Nodes: Person {name}, Claim {text}, Decision {statement, status}, Topic",
        "{name, slug}, Session {title}. Relationships, and the arrow direction matters:",
        "(Claim)-[:STATED_BY]->(Person), (Claim)-[:SUPPORTS|DISAGREES_WITH]->(Decision),",
        "(Decision)-[:SUPERSEDES]->(Decision), (Claim|Decision)-[:ABOUT]->(Topic),",
        "(Claim)-[:IN_SESSION]->(Session), (Decision)-[:DECIDED_IN]->(Session),",
        "(Person)-[:PARTICIPATED_IN]->(Session). Decision.status is current, superseded or open.",
        "Every edge points away from the Claim or Decision, never away from the Person, so a",
        "person is always on the right of STATED_BY. Always alias returned values.",
        "",
        // Worked examples, because a small model reads direction far more reliably from a
        // query it can pattern-match than from a prose description of the schema.
        "Examples.",
        "Claims per person, most first:",
        "MATCH (c:Claim)-[:STATED_BY]->(p:Person)",
        "RETURN p.name AS person, count(c) AS claims ORDER BY claims DESC",
        "Who objected most:",
        "MATCH (c:Claim)-[:DISAGREES_WITH]->(:Decision) MATCH (c)-[:STATED_BY]->(p:Person)",
        "RETURN p.name AS person, count(c) AS objections ORDER BY objections DESC",
        "Decisions per topic that are still current:",
        "MATCH (d:Decision)-[:ABOUT]->(t:Topic) WHERE d.status = 'current'",
        "RETURN t.name AS topic, count(d) AS decisions ORDER BY decisions DESC",
      ].join(" "),
      parameters: parametersFor(AnalyzeSchema),
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
  if (name === "analyze") return analyze(input as never);
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
  if (name === "analyze") {
    const rows: unknown[] = value?.rows ?? [];
    const disabled = (value?.degraded ?? []).includes("analyze:disabled");
    return disabled ? "sandbox unavailable, query not run" : `${rows.length} row(s)`;
  }
  return `${(value?.claimIds ?? []).length} claim(s) written${value?.decisionId ? ", decision linked" : ""}`;
}
