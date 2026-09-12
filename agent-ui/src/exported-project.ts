import type { AgentFrontendProject } from "./schema/agentuxConfig";

// Snapshot of what was composed in AgentCanvas. Edit by hand to tweak the export.
export const project = {
  "id": "mnemex-agent-ui",
  "name": "mnemex",
  "product": {
    "surface": {
      "mode": "agentcanvas"
    },
    "brand": {
      "displayName": "mnemex",
      "mark": {
        "kind": "builtin",
        "id": "sparkles"
      },
      "accent": {
        "kind": "theme"
      },
      "corners": "theme",
      "showPoweredBy": true
    },
    "welcome": {
      "headline": "Ask what we decided, and who disagreed.",
      "supportingText": "This assistant has persistent graph memory. Watch it call recall before it answers.",
      "suggestedPrompts": [
        "What did we decide about the storage engine, and who disagreed?",
        "Show me the decision history for the storage engine.",
        "I think we should move the merge planner off Daytona and run it in process."
      ],
      "showSuggestedPrompts": true
    },
    "design": {},
    "extensions": {
      "stylesheets": []
    }
  },
  "template": "tool-heavy",
  "runtime": {
    "transport": "sse",
    "harness": "custom"
  },
  "providers": {
    "defaultProviderId": "custom-provider",
    "settingsLauncher": false,
    "connections": [
      {
        "id": "custom-provider",
        "kind": "custom",
        "label": "Nosana",
        "description": "Qwen2.5-7B-Instruct on Nosana, served OpenAI-compatible by vLLM.",
        "protocol": "openai-compatible",
        "baseUrl": "env:NOSANA_CHAT_ENDPOINT",
        "auth": {
          "mode": "none"
        },
        "defaultModel": "chat",
        "models": [
          "chat"
        ],
        "enabled": true
      }
    ]
  },
  "layout": {
    "regions": [
      "sidebar",
      "main",
      "composer",
      "right-panel",
      "bottom-dock",
      "overlay"
    ],
    "mainSize": 68,
    "rightPanelSize": 32,
    "bottomDockSize": 28,
    "slots": [
      {
        "id": "sessions",
        "region": "sidebar",
        "component": "SessionSidebar",
        "enabled": true
      },
      {
        "id": "chat",
        "region": "main",
        "component": "ChatFrame",
        "enabled": true
      },
      {
        "id": "composer",
        "region": "composer",
        "component": "ComposerFrame",
        "enabled": true
      },
      {
        "id": "output",
        "region": "right-panel",
        "component": "OutputFrame",
        "enabled": true
      },
      {
        "id": "git",
        "region": "right-panel",
        "component": "GitFrame",
        "enabled": false
      },
      {
        "id": "capabilities",
        "region": "bottom-dock",
        "component": "CapabilityTray",
        "enabled": false
      },
      {
        "id": "debug",
        "region": "bottom-dock",
        "component": "DebugDock",
        "enabled": true
      }
    ]
  },
  "theme": {
    "preset": "warm-graphite",
    "stylePreset": "native",
    "density": "compact",
    "radius": 8,
    "motion": {
      "reasoning": "wave",
      "writing": "smooth-stream",
      "toolCall": "card",
      "writingParams": {
        "streamWps": 40,
        "typeCps": 24,
        "chunkSize": 4,
        "chunkIntervalMs": 220
      }
    }
  },
  "composer": {
    "fileUpload": false,
    "mic": false,
    "thinkingBudget": false,
    "modelSwitcher": false,
    "toolToggle": false,
    "promptShortcuts": false
  },
  "conversation": {
    "speakerLabels": true,
    "userAvatar": true,
    "agentAvatar": true,
    "messageActions": {
      "copy": false,
      "regenerate": false,
      "edit": false,
      "userCopy": false,
      "userEdit": false,
      "userTime": false,
      "agentCopy": false,
      "agentRegenerate": false,
      "agentEdit": false,
      "agentTime": false
    },
    "emptyState": "minimal"
  },
  "sidebar": {
    "newButton": true,
    "search": true,
    "grouping": true,
    "footer": true
  },
  "welcome": {
    "greeting": "Ask what we decided, and who disagreed."
  },
  "context": {
    "attachmentChips": true
  },
  "toolCalls": {
    "detail": "full",
    "progress": "status-icon",
    "approval": "inline",
    "timelineRail": true
  },
  "reasoning": {
    "show": "summary",
    "collapse": "summary-first",
    "expandable": true
  },
  "blocks": {
    "codeDiff": true,
    "errorCollapse": false,
    "toolLogTail": false
  },
  "output": {
    "source": "artifact",
    "artifactRenderer": "auto",
    "surface": "right-panel",
    "supportedArtifactRenderers": [
      "code",
      "diff",
      "markdown",
      "preview",
      "data"
    ]
  },
  "mediaGeneration": {
    "imageStyle": "grid",
    "audioStyle": "waveform",
    "videoStyle": "storyboard"
  },
  "git": {
    "showBranchStatus": true,
    "showChangedFiles": true,
    "showDiff": true,
    "suggestCommitMessage": false,
    "allowCommit": false,
    "allowPush": false
  },
  "export": {
    "target": "vite-react",
    "includeFixtures": false,
    "includeHarnessAdapter": true
  }
} as unknown as AgentFrontendProject;

export default project;
