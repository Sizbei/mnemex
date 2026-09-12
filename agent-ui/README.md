# mnemex agent UI

The demo chat frontend for [mnemex](../README.md): an assistant with persistent graph
memory that calls `recall` before answering questions about past decisions.

The React app in here is **generated**, not hand-written. It is the standalone project
exported by [AgentCanvas](https://github.com/raytone-lab/agentcanvas) (MIT, © Raytone-Lab),
driven through its programmatic export API by `../scripts/generate-agent-ui.ts`. The
AgentUX SDK it renders through is vendored under `vendor/` by that same export.

## Layout

| Path | Origin |
| --- | --- |
| `src/`, `vendor/`, `public/`, `index.html`, `vite.config.ts`, `package.json`, `tsconfig.json`, `AGENTS.md`, this file | generated, listed in `.generated.json` |
| `server/` | hand-written: the model loop, the mnemex tool bridge, the event stream |

Regenerating overwrites everything in `.generated.json` and leaves everything else alone:

```bash
AGENTCANVAS_DIR=/path/to/agentcanvas npx tsx scripts/generate-agent-ui.ts
```

## Running it

The backend runs from the repository root, because it imports the compiled mnemex tools out
of `dist/` and needs the root `.env` for Neo4j and Nosana.

```bash
npm run build                      # at the repo root, refreshes dist/
node --import tsx agent-ui/server/index.ts
```

In a second terminal:

```bash
cd agent-ui
npm install
npm run dev
```

Open the URL Vite prints. The dev server proxies `/__agentcanvas/pi` to the backend on
port 8787.

## What the backend does

`server/index.ts` answers the five endpoints the exported client calls. The one that
matters is `POST /__agentcanvas/pi/prompt`, which streams one turn back as
newline-delimited AgentUX events while it runs:

1. Sends the conversation plus the three mnemex tools to an OpenAI-compatible chat endpoint.
2. When the model answers with `tool_calls`, executes the real `remember`, `recall` or
   `timeline` against Neo4j, appends the result, and asks the model again.
3. Repeats until the model returns a final message, streaming assistant tokens and every
   tool-call lifecycle event as they happen.

The tool definitions are generated from the zod schemas in `../src/tools/` at startup, so
they cannot drift from what the functions actually accept.

`NOSANA_CHAT_ENDPOINT` in the repo root `.env` points at the model. If it is unset or
unreachable the app still loads, and the first thing on screen says so.

## License

mnemex code in `server/` follows the mnemex repository license. The generated project is
AgentCanvas output and carries AgentCanvas's MIT license and copyright; see
<https://github.com/raytone-lab/agentcanvas/blob/main/LICENSE>.
