import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "animusystems.task-triage",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Task Triage",
  description:
    "Automatic task complexity assessment, decomposition into subtasks, and failure escalation to manager agents.",
  author: "Animus Systems",
  categories: ["automation"],
  capabilities: [
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write",
    "agents.read",
    "agents.invoke",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.read",
    "issue.comments.create",
    "projects.read",
    "activity.log.write",
    "http.outbound",
    "ui.dashboardWidget.register",
    "ui.detailTab.register",
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        title: "Enable Task Triage",
        default: true,
      },
      complexityThreshold: {
        type: "number",
        title: "Complexity threshold (1-10) for auto-decomposition",
        default: 7,
        description:
          "Issues scoring above this are flagged for decomposition. 1=trivial, 10=massive.",
      },
      autoDecompose: {
        type: "boolean",
        title: "Auto-decompose high-complexity tasks",
        default: false,
        description:
          "When enabled, automatically creates subtasks. When disabled, only comments with suggestions.",
      },
      escalateOnTimeout: {
        type: "boolean",
        title: "Escalate to manager on timeout/failure",
        default: true,
      },
      maxConsecutiveFailures: {
        type: "number",
        title: "Consecutive failures before escalation",
        default: 2,
      },
      llmProvider: {
        type: "string",
        title: "LLM provider URL for complexity assessment",
        default: "https://openrouter.ai/api/v1",
      },
      llmModel: {
        type: "string",
        title: "LLM model for complexity assessment",
        default: "deepseek/deepseek-v3.2",
      },
      llmFallbackModel: {
        type: "string",
        title: "Fallback model (used when primary hits rate limits)",
        default: "google/gemini-2.5-flash",
      },
      llmApiKey: {
        type: "string",
        title: "LLM API key (leave empty to use OPENAI_API_KEY env var)",
        default: "",
      },
      routingRules: {
        type: "array",
        title: "Subtask routing rules (keyword → agent name). Leave empty for defaults.",
        items: {
          type: "object",
          properties: {
            pattern: { type: "string", title: "Regex pattern to match subtask title" },
            agent: { type: "string", title: "Agent name to assign to" },
          },
        },
        default: [],
      },
    },
  },
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: "triage-overview",
        displayName: "Task Triage",
        exportName: "TriageOverviewWidget",
      },
      {
        type: "detailTab",
        id: "triage-issue-tab",
        displayName: "Triage",
        exportName: "TriageIssueTab",
        entityTypes: ["issue"],
        order: 20,
      },
    ],
  },
};

export default manifest;
