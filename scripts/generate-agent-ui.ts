/**
 * Generate `agent-ui/` from the AgentCanvas scaffold export API.
 *
 * AgentCanvas (https://github.com/raytone-lab/agentcanvas, MIT) is a configurator whose
 * real output is a standalone React project. Its export API lives in
 * `src/export/scaffoldManifest.ts` and is driven here directly, so the demo UI is produced
 * by a committed script rather than by clicking through a GUI.
 *
 * The export API is not plain Node: it reads its own source tree through Vite's
 * `import.meta.glob(..., { query: "?raw" })`. So this script boots Vite programmatically
 * against the AgentCanvas checkout and loads the module through the SSR pipeline, which is
 * the same path AgentCanvas's own vitest smoke test uses.
 *
 * Re-runnable by design. Every file it writes is recorded in `agent-ui/.generated.json`;
 * a later run overwrites exactly those files and deletes the ones it no longer produces.
 * Anything not in that list is hand-written and is never touched, which is why all of the
 * mnemex backend lives under `agent-ui/server/`.
 *
 *   AGENTCANVAS_DIR=/path/to/agentcanvas npx tsx scripts/generate-agent-ui.ts
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(repoRoot, "agent-ui");
const manifestPath = join(outDir, ".generated.json");

const agentcanvasDir = resolveAgentcanvasDir();

/** The scaffold's client talks to this prefix; our backend answers it. See agent-ui/server. */
const RUNTIME_API_PREFIX = "/__agentcanvas/pi";
const BACKEND_PORT = 8787;

function resolveAgentcanvasDir(): string {
  const candidates = [
    process.env.AGENTCANVAS_DIR,
    join(repoRoot, "..", "agentcanvas"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "src/export/scaffoldManifest.ts"))) return resolve(candidate);
  }
  throw new Error(
    "AgentCanvas checkout not found. Clone https://github.com/raytone-lab/agentcanvas, run " +
      "`npm install && npm run packages:build` in it, then set AGENTCANVAS_DIR to its path.",
  );
}

// ---------------------------------------------------------------------------
// The project configuration this product exports.
// ---------------------------------------------------------------------------

interface ExportModule {
  createScaffoldExportSnapshot(project: unknown): {
    packageJson: Record<string, unknown>;
    agentuxConfig: unknown;
    files: string[];
    fileContents: Record<string, string>;
  };
  loadScaffoldAssets(): Promise<Record<string, Uint8Array>>;
}

type Project = Record<string, any>;

function mnemexProject(defaultProject: Project): Project {
  return {
    ...defaultProject,
    id: "mnemex-agent-ui",
    name: "mnemex",
    product: {
      ...defaultProject.product,
      brand: { ...defaultProject.product.brand, displayName: "mnemex" },
      welcome: {
        ...defaultProject.product.welcome,
        headline: "Ask what we decided, and who disagreed.",
        supportingText:
          "This assistant has persistent graph memory. Watch it call recall before it answers.",
        showSuggestedPrompts: true,
        suggestedPrompts: [
          "What did we decide about the storage engine, and who disagreed?",
          "Show me the decision history for the storage engine.",
          "I think we should move the merge planner off Daytona and run it in process.",
        ],
      },
    },
    // Tool calls are the argument of this product, not an implementation detail, so the
    // template that keeps them first-class is the one to export.
    template: "tool-heavy",
    // "sse" is what turns off the bundled offline replay: the scaffold treats any other
    // transport as fixture mode and never opens a live connection.
    runtime: { transport: "sse", harness: "custom" },
    providers: {
      defaultProviderId: "custom-provider",
      settingsLauncher: false,
      connections: [
        {
          id: "custom-provider",
          kind: "custom",
          label: "Nosana",
          description: "Qwen2.5-7B-Instruct on Nosana, served OpenAI-compatible by vLLM.",
          protocol: "openai-compatible",
          // The real URL is read from the repo root .env by the backend. Writing it here
          // would bake a deployment address into a committed project file.
          baseUrl: "env:NOSANA_CHAT_ENDPOINT",
          auth: { mode: "none" },
          defaultModel: "chat",
          models: ["chat"],
          enabled: true,
        },
      ],
    },
    layout: {
      ...defaultProject.layout,
      slots: [
        { id: "sessions", region: "sidebar", component: "SessionSidebar", enabled: true },
        { id: "chat", region: "main", component: "ChatFrame", enabled: true },
        { id: "composer", region: "composer", component: "ComposerFrame", enabled: true },
        // Off, for the same reason GitFrame is: this agent produces no artifacts, so the panel
        // had nothing to show. It also owns the right edge — its collapsed rail button floats
        // over whatever is there — and the memory graph is what belongs on that edge here.
        { id: "output", region: "right-panel", component: "OutputFrame", enabled: false },
        // No repository behind this agent, so the Git panel has nothing to report.
        { id: "git", region: "right-panel", component: "GitFrame", enabled: false },
        { id: "capabilities", region: "bottom-dock", component: "CapabilityTray", enabled: false },
        // Keeps the raw event stream one click away, which is how a sceptic checks that the
        // tool cards came from a real tool call.
        { id: "debug", region: "bottom-dock", component: "DebugDock", enabled: true },
      ],
    },
    theme: {
      ...defaultProject.theme,
      preset: "warm-graphite",
      stylePreset: "native",
    },
    // The greeting above the composer is the only welcome copy the exported shell reads.
    welcome: { greeting: "Ask what we decided, and who disagreed." },
    // "suggested-prompts" renders AgentCanvas's own fixed coding-agent prompts rather than
    // the ones configured on the project, and none of them mean anything here.
    conversation: { ...defaultProject.conversation, emptyState: "minimal" },
    composer: {
      ...defaultProject.composer,
      fileUpload: false,
      thinkingBudget: false,
      modelSwitcher: false,
      toolToggle: false,
    },
    // Watching the model call recall is the demo, so the card shows the arguments it sent
    // and the rows that came back, not a one-line summary.
    toolCalls: { detail: "full", progress: "status-icon", approval: "inline", timelineRail: true },
    // The backend discloses what it is doing (status labels tied to real tool calls) and
    // never invents thinking text, so "summary" is the level it can honestly fill.
    reasoning: { show: "summary", collapse: "summary-first", expandable: true },
    git: {
      ...defaultProject.git,
      allowCommit: false,
      allowPush: false,
      suggestCommitMessage: false,
    },
    export: { target: "vite-react", includeFixtures: false, includeHarnessAdapter: true },
  };
}

// ---------------------------------------------------------------------------
// Deliberate edits to generated files.
// ---------------------------------------------------------------------------
// These are declared here rather than hand-applied afterwards so a regeneration reproduces
// them. Every other generated file ships exactly as AgentCanvas emitted it.

function viteConfig(): string {
  return `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Generated by scripts/generate-agent-ui.ts in the mnemex repo.
//
// AgentCanvas ships this file wired to its bundled Pi agent runtime, which mounts itself
// into the dev server as a Vite plugin. mnemex replaces that runtime wholesale: the agent
// loop lives in ../agent-ui/server and needs the mnemex node_modules to reach Neo4j, so it
// runs as its own process and the dev server proxies to it.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "${RUNTIME_API_PREFIX}": {
        target: "http://127.0.0.1:${BACKEND_PORT}",
        changeOrigin: false,
        // Tool loops outlive the default proxy timeout, and buffering would defeat the
        // point of streaming the tokens in the first place.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  resolve: {
    // The vendored @agent-ux/* packages are linked via \`file:./vendor/...\` and import bare
    // "react"/"react-dom". Without dedupe the bundler may resolve those from the vendor
    // folder, which has no node_modules of its own, and the app dies with
    // \`Cannot read properties of null (reading 'useMemo')\`.
    dedupe: ["react", "react-dom"],
  },
});
`;
}

function readme(): string {
  return `# mnemex agent UI

The demo chat frontend for [mnemex](../README.md): an assistant with persistent graph
memory that calls \`recall\` before answering questions about past decisions.

The React app in here is **generated**, not hand-written. It is the standalone project
exported by [AgentCanvas](https://github.com/raytone-lab/agentcanvas) (MIT, © Raytone-Lab),
driven through its programmatic export API by \`../scripts/generate-agent-ui.ts\`. The
AgentUX SDK it renders through is vendored under \`vendor/\` by that same export.

## Layout

| Path | Origin |
| --- | --- |
| \`src/\`, \`vendor/\`, \`public/\`, \`index.html\`, \`vite.config.ts\`, \`package.json\`, \`tsconfig.json\`, \`AGENTS.md\`, this file | generated, listed in \`.generated.json\` |
| \`server/\` | hand-written: the model loop, the mnemex tool bridge, the event stream |

Regenerating overwrites everything in \`.generated.json\` and leaves everything else alone:

\`\`\`bash
AGENTCANVAS_DIR=/path/to/agentcanvas npx tsx scripts/generate-agent-ui.ts
\`\`\`

## Running it

The backend runs from the repository root, because it imports the compiled mnemex tools out
of \`dist/\` and needs the root \`.env\` for Neo4j and Nosana.

\`\`\`bash
npm run build                      # at the repo root, refreshes dist/
node --import tsx agent-ui/server/index.ts
\`\`\`

In a second terminal:

\`\`\`bash
cd agent-ui
npm install
npm run dev
\`\`\`

Open the URL Vite prints. The dev server proxies \`${RUNTIME_API_PREFIX}\` to the backend on
port ${BACKEND_PORT}.

## What the backend does

\`server/index.ts\` answers the five endpoints the exported client calls. The one that
matters is \`POST ${RUNTIME_API_PREFIX}/prompt\`, which streams one turn back as
newline-delimited AgentUX events while it runs:

1. Sends the conversation plus the three mnemex tools to an OpenAI-compatible chat endpoint.
2. When the model answers with \`tool_calls\`, executes the real \`remember\`, \`recall\` or
   \`timeline\` against Neo4j, appends the result, and asks the model again.
3. Repeats until the model returns a final message, streaming assistant tokens and every
   tool-call lifecycle event as they happen.

The tool definitions are generated from the zod schemas in \`../src/tools/\` at startup, so
they cannot drift from what the functions actually accept.

\`GET ${RUNTIME_API_PREFIX}/memory\` is the other hand-written route. It returns every node and
edge as \`{nodes, links}\`, running the same Cypher as the Next.js app in \`../web\`, and it is
what the memory graph panel down the right-hand side of the chat reads. The panel refetches
when a turn ends, so a \`remember\` call shows up in the graph without a reload. Its canvas and
inspector are ported from \`../web\` and live in \`src/components/memory-graph/\`, which the
generator does not own.

\`NOSANA_CHAT_ENDPOINT\` in the repo root \`.env\` points at the model. If it is unset or
unreachable the app still loads, and the first thing on screen says so.

## License

mnemex code in \`server/\` follows the mnemex repository license. The generated project is
AgentCanvas output and carries AgentCanvas's MIT license and copyright; see
<https://github.com/raytone-lab/agentcanvas/blob/main/LICENSE>.
`;
}

function patchPackageJson(packageJson: Record<string, any>): Record<string, any> {
  return {
    ...packageJson,
    name: "mnemex-agent-ui",
    // The ported graph canvas (src/components/memory-graph/) is hand-written and therefore
    // never regenerated, but the manifest that has to resolve its imports is.
    dependencies: {
      ...packageJson.dependencies,
      "d3-force": "^3.0.0",
      "d3-selection": "^3.0.0",
      "d3-zoom": "^3.0.0",
    },
    devDependencies: {
      ...packageJson.devDependencies,
      "@types/d3-force": "^3.0.10",
      "@types/d3-selection": "^3.0.11",
      "@types/d3-zoom": "^3.0.8",
    },
    scripts: {
      ...packageJson.scripts,
      // Convenience alias. The backend has to run from the repo root to resolve dist/ and
      // the root .env, so this cannot simply be `tsx server/index.ts`.
      backend: "cd .. && node --import tsx agent-ui/server/index.ts",
    },
  };
}

/**
 * The product name is carried by `product.brand.displayName`, but the exported shell never
 * reads it: the conversation header and the sidebar brand come from the i18n copy tables,
 * which still say "Coding Agent" and "My Agent". Renamed in every locale, because a product
 * name is not translated.
 */
function brandName(generated: string): string {
  return generated
    .replaceAll('title: "Coding Agent"', 'title: "mnemex"')
    .replaceAll('brandName: "My Agent"', 'brandName: "mnemex"')
    .replaceAll('brandName: "我的Agent"', 'brandName: "mnemex"');
}

/**
 * The exported entry mounts LocaleProvider with no locale, and the provider defaults to
 * Chinese, so an untouched export opens in Chinese whatever the project says. This product
 * is English, so the entry says so.
 */
function englishLocale(generated: string): string {
  return generated.replace("<LocaleProvider>", '<LocaleProvider initialLocale="en">');
}

/**
 * Mount the memory graph beside the conversation.
 *
 * The shell already has a right panel, but it belongs to the artifact surface: it is gated on
 * `!isWelcome` and opens when someone clicks an artifact, so a graph mounted there would be
 * missing exactly when a visitor first arrives, and mnemex produces no artifacts to open it
 * with. Adding a slot instead would mean teaching the generated schema, the slot registry and
 * the exported project about a component AgentCanvas does not have. `.preview-frame` is a flex
 * row, so the panel is appended as a final column of it and manages its own collapse.
 */
function memoryGraphPanel(generated: string): string {
  return generated
    .replace(
      'import { project } from "./exported-project";',
      'import { project } from "./exported-project";\n' +
        'import { MemoryGraphPanel } from "./components/memory-graph/MemoryGraphPanel";',
    )
    .replace(
      "        </div>\n        {previewOverlaySlots.length > 0 ? (",
      "          <MemoryGraphPanel isRunning={piRunning} />\n" +
        "        </div>\n        {previewOverlaySlots.length > 0 ? (",
    );
}

const PATCHED_FILES: Record<string, (generated: string) => string> = {
  "vite.config.ts": viteConfig,
  "README.md": readme,
  "src/main.tsx": englishLocale,
  "src/agent-shell.tsx": memoryGraphPanel,
  "src/i18n/copy/chat.ts": brandName,
  "src/i18n/copy/workspace.ts": brandName,
  // The turn stream arrives through the runtime seam in src/pi/piClient.ts, not through this
  // ambient GET subscription, so the generated placeholder warning is misleading here.
  "src/adapters/backendAdapter.ts": (generated: string) =>
    generated.replace(
      "export function liveEventSource(): LiveEventSource | null {",
      [
        "/**",
        " * mnemex leaves this null on purpose. The scaffold has two live seams: this ambient",
        " * GET subscription, and the per-turn stream the composer drives. A chat turn is",
        " * request/response, so mnemex implements the second one, in agent-ui/server.",
        " */",
        "export function liveEventSource(): LiveEventSource | null {",
      ].join("\n"),
    ),
};

// ---------------------------------------------------------------------------
// Write.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const vite = await import(
    pathToFileURL(join(agentcanvasDir, "node_modules/vite/dist/node/index.js")).href
  );
  const server = await vite.createServer({
    root: agentcanvasDir,
    // The project's own config loads the React plugin and a Remotion entry we do not need,
    // and loading it costs a second for nothing: the export API is plain TypeScript.
    configFile: false,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
  });

  let snapshot;
  let assets: Record<string, Uint8Array>;
  try {
    const schema = (await server.ssrLoadModule("/src/schema/agentuxConfig.ts")) as {
      defaultCodingAgentProject: Project;
    };
    const exportApi = (await server.ssrLoadModule("/src/export/scaffoldManifest.ts")) as ExportModule;

    snapshot = exportApi.createScaffoldExportSnapshot(mnemexProject(schema.defaultCodingAgentProject));
    assets = await exportApi.loadScaffoldAssets();
  } finally {
    await server.close();
  }

  const packageJson = patchPackageJson(snapshot.packageJson);
  const contents: Record<string, string> = {
    ...snapshot.fileContents,
    "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
  };
  for (const [file, replace] of Object.entries(PATCHED_FILES)) {
    contents[file] = replace(contents[file] ?? "");
  }

  const written: string[] = [];
  for (const [file, content] of Object.entries(contents)) {
    writeOut(file, content);
    written.push(file);
  }
  for (const [file, bytes] of Object.entries(assets)) {
    writeOut(file, bytes);
    written.push(file);
  }

  removeStale(written);
  written.sort();
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ generator: "scripts/generate-agent-ui.ts", files: written }, null, 2)}\n`,
  );

  console.log(`wrote ${written.length} generated files to agent-ui/`);
  console.log(`patched: ${Object.keys(PATCHED_FILES).concat("package.json").join(", ")}`);
}

function writeOut(file: string, content: string | Uint8Array): void {
  const target = join(outDir, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/**
 * Delete what the previous run generated and this one did not. Scoped to the recorded
 * manifest so a hand-written file can never be caught by it.
 */
function removeStale(written: readonly string[]): void {
  if (!existsSync(manifestPath)) return;
  const previous = JSON.parse(readFileSync(manifestPath, "utf8")) as { files?: string[] };
  const current = new Set(written);
  for (const file of previous.files ?? []) {
    if (current.has(file)) continue;
    const target = join(outDir, file);
    if (existsSync(target)) rmSync(target);
  }
}

await main();
