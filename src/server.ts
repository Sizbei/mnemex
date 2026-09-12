import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { remember, RememberSchema } from "./tools/remember.js";
import { recall, RecallSchema } from "./tools/recall.js";
import { timeline, TimelineSchema } from "./tools/timeline.js";

const server = new McpServer({ name: "mnemex", version: "0.1.0" }, { capabilities: { tools: {} } });

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

server.registerTool(
  "remember",
  {
    title: "Remember",
    description:
      "Write one speaker turn into persistent graph memory. Supply the claims the speaker made and, " +
      "if they took a position on an outcome, the decision and their stance toward it. Call this " +
      "whenever a decision is reached, revised, or argued about.",
    inputSchema: RememberSchema.shape,
  },
  async (args) => json(await remember(args)),
);

server.registerTool(
  "recall",
  {
    title: "Recall",
    description:
      "Search persistent memory and return decisions with who supported and who objected. " +
      "Answers relational questions such as what was decided about a topic and who disagreed, " +
      "and reports which decisions have since been superseded.",
    inputSchema: RecallSchema.shape,
  },
  async (args) => json(await recall(args)),
);

server.registerTool(
  "timeline",
  {
    title: "Timeline",
    description:
      "Return a topic's decision history in order, showing what superseded what and who dissented at each step.",
    inputSchema: TimelineSchema.shape,
  },
  async (args) => json(await timeline(args)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
