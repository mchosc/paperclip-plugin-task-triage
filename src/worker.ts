import { definePlugin, startWorkerRpcHost } from "@paperclipai/plugin-sdk";
import type { Issue, Agent } from "@paperclipai/shared";
import { assessComplexity, type ComplexityAssessment } from "./worker/complexity.js";
import {
  type TriageState,
  type TriageRecord,
  type FailureRecord,
  emptyState,
  addTriageRecord,
} from "./worker/state.js";

interface PluginConfig {
  enabled: boolean;
  complexityThreshold: number;
  autoDecompose: boolean;
  escalateOnTimeout: boolean;
  maxConsecutiveFailures: number;
  llmProvider: string;
  llmModel: string;
  llmApiKey: string;
}

const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  complexityThreshold: 7,
  autoDecompose: false,
  escalateOnTimeout: true,
  maxConsecutiveFailures: 2,
  llmProvider: "https://openrouter.ai/api/v1",
  llmModel: "deepseek/deepseek-v3.2",
  llmApiKey: "",
};

function resolveConfig(raw: Record<string, unknown> | null): PluginConfig {
  return { ...DEFAULT_CONFIG, ...raw } as PluginConfig;
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("task-triage plugin setup");

    // ── Helper: load/save state ───────────────────────────────────────

    function stateKey(companyId: string) {
      return { scopeKind: "company" as const, scopeId: companyId, stateKey: "triage-state" };
    }

    async function loadState(companyId: string): Promise<TriageState> {
      try {
        const raw = await ctx.state.get(stateKey(companyId));
        return (raw as TriageState) ?? emptyState();
      } catch {
        return emptyState();
      }
    }

    async function saveState(companyId: string, state: TriageState): Promise<void> {
      await ctx.state.set(stateKey(companyId), state);
    }

    // ── Helper: find manager for an agent ─────────────────────────────

    async function findManager(
      agentId: string,
      companyId: string,
    ): Promise<Agent | null> {
      const agent = await ctx.agents.get(agentId, companyId);
      if (!agent?.reportsTo) return null;
      return ctx.agents.get(agent.reportsTo, companyId);
    }

    // ── Helper: get agent max turns ───────────────────────────────────

    function getMaxTurns(agent: Agent): number {
      const config = agent.adapterConfig as Record<string, unknown> | null;
      const turns = config?.maxTurns;
      return typeof turns === "number" ? turns : 30;
    }

    // ── Helper: resolve LLM API key ───────────────────────────────────

    function resolveLlmKey(config: PluginConfig): string {
      if (config.llmApiKey) return config.llmApiKey;
      return process.env.OPENAI_API_KEY ?? "";
    }

    // ── Triage an issue ───────────────────────────────────────────────

    async function triageIssue(
      issue: Issue,
      agent: Agent,
      companyId: string,
      config: PluginConfig,
    ): Promise<TriageRecord | null> {
      const apiKey = resolveLlmKey(config);
      if (!apiKey) {
        ctx.logger.warn("No LLM API key configured, skipping triage");
        return null;
      }

      // Block the issue BEFORE calling the LLM to prevent the agent from starting
      // If score is low, we'll unblock immediately after assessment
      try {
        await ctx.issues.update(issue.id, { status: "blocked" }, companyId);
        ctx.logger.info("Blocked issue for triage assessment", { issue: issue.identifier });
      } catch {
        // If block fails (e.g. already checked out), continue anyway
      }

      let assessment: ComplexityAssessment;
      try {
        assessment = await assessComplexity(
          ctx.http.fetch.bind(ctx.http),
          { llmProvider: config.llmProvider, llmModel: config.llmModel, llmApiKey: apiKey },
          { title: issue.title, description: issue.description },
          { agentName: agent.name, maxTurns: getMaxTurns(agent) },
        );
      } catch (err) {
        ctx.logger.error("Complexity assessment failed", {
          issueId: issue.id,
          error: err instanceof Error ? err.message : String(err),
        });
        // Unblock on failure so the agent can work
        try { await ctx.issues.update(issue.id, { status: "todo" }, companyId); } catch { /* best effort */ }
        return null;
      }

      ctx.logger.info("Complexity assessed", {
        issue: issue.identifier,
        score: assessment.score,
        estimatedTurns: assessment.estimatedTurns,
        threshold: config.complexityThreshold,
      });

      let action: TriageRecord["action"] = "none";
      const subtasksCreated: string[] = [];

      if (assessment.score < config.complexityThreshold) {
        // Score is low — unblock so the agent can work
        try {
          await ctx.issues.update(issue.id, { status: "todo" }, companyId);
        } catch { /* best effort */ }
      }

      if (assessment.score >= config.complexityThreshold) {
        if (config.autoDecompose && assessment.suggestedSubtasks.length > 0) {
          // Issue is already blocked (from pre-assessment block above)

          // Resolve agents for keyword routing
          const allAgents = await ctx.agents.list({ companyId });
          const agentByName = new Map(allAgents.map((a) => [a.name.toLowerCase(), a]));

          // Default routing rules — can be overridden via plugin config
          const DEFAULT_ROUTING: Array<{ pattern: string; agent: string }> = [
            { pattern: "security|audit|vulnerab|CVE", agent: "Sentinel" },
            { pattern: "architect|design|system|refactor", agent: "Winston" },
            { pattern: "code|implement|build|feature|bug|fix|engineer", agent: "Amelia" },
            { pattern: "test|QA|regression|coverage", agent: "Murat" },
            { pattern: "UX|UI|wireframe|usability|accessibility", agent: "Sally" },
            { pattern: "prototype|MVP|quick build", agent: "Barry" },
            { pattern: "tax|compliance|filing|IGIC", agent: "Audra" },
            { pattern: "pricing|cost|margin|budget|financial", agent: "CFO - Oro" },
            { pattern: "bookkeep|ledger|transaction", agent: "Malcolm" },
            { pattern: "payroll|salary|RETA|labor", agent: "Nora" },
            { pattern: "SEO|keyword|search.*rank", agent: "Atlas" },
            { pattern: "content|editorial|blog|article", agent: "Iris" },
            { pattern: "brand|visual|logo|design system", agent: "Muse" },
            { pattern: "campaign|paid|ad.*creative", agent: "Dex" },
            { pattern: "competitor|market.*research", agent: "Rex" },
            { pattern: "sales|pitch|proposal", agent: "CMO - Marcus" },
            { pattern: "legal|terms|policy|contract|engagement", agent: "Chaz" },
            { pattern: "document|write|README|spec", agent: "Paige" },
            { pattern: "research|investigate|analyze", agent: "Mary" },
            { pattern: "product|roadmap|prioriti", agent: "John" },
          ];
          const routingRules = Array.isArray(config.routingRules) && config.routingRules.length > 0
            ? config.routingRules as Array<{ pattern: string; agent: string }>
            : DEFAULT_ROUTING;

          // Filter out email/report delivery subtasks
          const EMAIL_PATTERNS = /email|report delivery|send report|compile report|final report|synthesis|consolidat/i;
          const filteredSubtasks = assessment.suggestedSubtasks.filter(
            (sub) => !EMAIL_PATTERNS.test(sub.title),
          );

          // Create subtasks with keyword-based routing
          for (const sub of filteredSubtasks) {
            try {
              // Match subtask title against routing rules
              let assigneeAgent: Agent | undefined;
              for (const rule of routingRules) {
                try {
                  if (new RegExp(rule.pattern, "i").test(sub.title)) {
                    assigneeAgent = agentByName.get(rule.agent.toLowerCase());
                    if (assigneeAgent) break;
                  }
                } catch { /* invalid regex — skip */ }
              }

              const createInput: Record<string, unknown> = {
                companyId,
                parentId: issue.id,
                title: sub.title,
                description: sub.description,
                priority: issue.priority,
                status: "todo",
              };
              if (issue.projectId) createInput.projectId = issue.projectId;
              if (assigneeAgent) {
                createInput.assigneeAgentId = assigneeAgent.id;
              } else if (issue.assigneeAgentId) {
                createInput.assigneeAgentId = issue.assigneeAgentId;
              }
              const created = await ctx.issues.create(createInput as Parameters<typeof ctx.issues.create>[0]);
              // API may ignore status on create — force to todo
              try { await ctx.issues.update(created.id, { status: "todo" }, companyId); } catch { /* best effort */ }
              subtasksCreated.push(created.id);
              ctx.logger.info("Created subtask", {
                title: sub.title,
                assignee: assigneeAgent?.name ?? "parent assignee",
              });
            } catch (err) {
              ctx.logger.error("Failed to create subtask", {
                parent: issue.identifier,
                title: sub.title,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          if (subtasksCreated.length > 0) {
            action = "decomposed";

            // Update parent to in_progress with decomposition note
            try {
              await ctx.issues.update(
                issue.id,
                { status: "in_progress", description: (issue.description ?? "") + "\n\n---\n*This task has been decomposed into subtasks. Complete the subtasks first.*" },
                companyId,
              );
            } catch { /* best effort */ }

            // Comment on parent issue
            const subtaskList = assessment.suggestedSubtasks
              .map((s, i) => `${i + 1}. **${s.title}**${s.assignee ? ` (→ ${s.assignee})` : ""} — ${s.description}`)
              .join("\n");

            await ctx.issues.createComment(
              issue.id,
              `**Task Triage: Auto-decomposed** (complexity: ${assessment.score}/10)\n\n` +
                `${assessment.reasoning}\n\n` +
                `Estimated ${assessment.estimatedTurns} turns (agent limit: ${getMaxTurns(agent)}).\n\n` +
                `Created ${subtasksCreated.length} subtasks:\n${subtaskList}`,
              companyId,
            );
          }
        } else {
          // Flag for manager review — unblock so agent can work
          action = "flagged";
          try { await ctx.issues.update(issue.id, { status: "todo" }, companyId); } catch { /* best effort */ }

          const subtaskSuggestions = assessment.suggestedSubtasks.length > 0
            ? "\n\nSuggested breakdown:\n" +
              assessment.suggestedSubtasks
                .map((s, i) => `${i + 1}. **${s.title}** — ${s.description}`)
                .join("\n")
            : "";

          await ctx.issues.createComment(
            issue.id,
            `**Task Triage: High complexity detected** (score: ${assessment.score}/10)\n\n` +
              `${assessment.reasoning}\n\n` +
              `Estimated ${assessment.estimatedTurns} turns needed (agent limit: ${getMaxTurns(agent)}). ` +
              `Consider breaking this into smaller subtasks before the agent starts work.` +
              subtaskSuggestions,
            companyId,
          );

          // Notify manager if available
          const manager = await findManager(agent.id, companyId);
          if (manager) {
            try {
              await ctx.agents.invoke(manager.id, companyId, {
                prompt:
                  `Issue ${issue.identifier} "${issue.title}" assigned to ${agent.name} has been flagged as high complexity (${assessment.score}/10). ` +
                  `Estimated ${assessment.estimatedTurns} turns needed but agent has ${getMaxTurns(agent)} max turns. ` +
                  `Please review and consider decomposing it into subtasks.`,
                reason: "task-triage-complexity-flag",
              });
            } catch (err) {
              ctx.logger.warn("Failed to invoke manager", {
                managerId: manager.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }

      await ctx.activity.log({
        companyId,
        message: `Task triage: ${issue.identifier} scored ${assessment.score}/10 → ${action}`,
        entityType: "issue",
        entityId: issue.id,
        metadata: { score: assessment.score, action, estimatedTurns: assessment.estimatedTurns },
      });

      return {
        issueId: issue.id,
        issueIdentifier: issue.identifier ?? "",
        issueTitle: issue.title,
        assessedAt: new Date().toISOString(),
        complexityScore: assessment.score,
        reasoning: assessment.reasoning,
        estimatedTurns: assessment.estimatedTurns,
        action,
        subtasksCreated,
      };
    }

    // ── Event: issue.updated (catch new assignments) ──────────────────

    ctx.events.on("issue.updated", async (event) => {
      const rawConfig = await ctx.config.get();
      const config = resolveConfig(rawConfig);
      if (!config.enabled) return;

      const companyId = event.companyId;
      const issueId = event.entityId;
      if (!issueId || !companyId) return;

      // Only triage when an agent is newly assigned
      const payload = event.payload as Record<string, unknown> | undefined;
      const changes = payload?.changes as Record<string, unknown> | undefined;
      if (!changes?.assigneeAgentId) return;

      const issue = await ctx.issues.get(issueId, companyId);
      if (!issue || !issue.assigneeAgentId) return;
      if (issue.status !== "todo" && issue.status !== "in_progress") return;
      if (issue.parentId) return; // Don't triage subtasks

      const agent = await ctx.agents.get(issue.assigneeAgentId, companyId);
      if (!agent) return;

      // Check if already triaged
      const state = await loadState(companyId);
      if (state.triageHistory.some((r) => r.issueId === issueId)) return;

      const record = await triageIssue(issue, agent, companyId, config);
      if (record) {
        await saveState(companyId, addTriageRecord(state, record));
      }
    });

    // ── Event: issue.created (catch issues created with an assignee) ──

    ctx.events.on("issue.created", async (event) => {
      const rawConfig = await ctx.config.get();
      const config = resolveConfig(rawConfig);
      if (!config.enabled) return;

      const companyId = event.companyId;
      const issueId = event.entityId;
      if (!issueId || !companyId) return;

      const issue = await ctx.issues.get(issueId, companyId);
      if (!issue || !issue.assigneeAgentId) return;
      if (issue.parentId) return; // Don't triage subtasks

      const agent = await ctx.agents.get(issue.assigneeAgentId, companyId);
      if (!agent) return;

      const state = await loadState(companyId);
      const record = await triageIssue(issue, agent, companyId, config);
      if (record) {
        await saveState(companyId, addTriageRecord(state, record));
      }
    });

    // ── Event: agent.run.failed — track failures & escalate ───────────

    ctx.events.on("agent.run.failed", async (event) => {
      const rawConfig = await ctx.config.get();
      const config = resolveConfig(rawConfig);
      if (!config.enabled || !config.escalateOnTimeout) return;

      const companyId = event.companyId;
      const agentId = event.entityId;
      if (!agentId || !companyId) return;

      const payload = event.payload as Record<string, unknown> | undefined;
      const errorMsg = (payload?.error as string) ?? "Unknown error";
      const issueId = payload?.issueId as string | undefined;

      if (!issueId) return;

      const agent = await ctx.agents.get(agentId, companyId);
      if (!agent) return;

      const issue = await ctx.issues.get(issueId, companyId);
      if (!issue) return;

      const state = await loadState(companyId);
      const existing = state.failureTracking[issueId];
      const consecutiveCount = existing && existing.agentId === agentId
        ? existing.consecutiveCount + 1
        : 1;

      const record: FailureRecord = {
        issueId,
        issueIdentifier: issue.identifier ?? "",
        agentId,
        agentName: agent.name,
        failedAt: new Date().toISOString(),
        error: errorMsg.slice(0, 500),
        consecutiveCount,
        escalated: false,
        managerId: null,
      };

      if (consecutiveCount >= config.maxConsecutiveFailures) {
        // Escalate to manager
        const manager = await findManager(agentId, companyId);

        const isTimeout = errorMsg.toLowerCase().includes("timeout") ||
          errorMsg.toLowerCase().includes("timed out");

        const escalationMsg = isTimeout
          ? `**Task Triage: Timeout escalation** (${consecutiveCount} consecutive failures)\n\n` +
            `Agent **${agent.name}** timed out ${consecutiveCount} times on this issue.\n` +
            `This task likely exceeds the agent's capacity (${getMaxTurns(agent)} turns / ${Math.round(getMaxTurns(agent) * 30 / 60)} min timeout).\n\n` +
            `**Recommended action:** Break this into smaller subtasks or increase the agent's turn limit.`
          : `**Task Triage: Failure escalation** (${consecutiveCount} consecutive failures)\n\n` +
            `Agent **${agent.name}** failed ${consecutiveCount} times on this issue.\n` +
            `Last error: ${errorMsg}\n\n` +
            `**Recommended action:** Review the error, adjust the task scope, or reassign.`;

        await ctx.issues.createComment(issue.id, escalationMsg, companyId);

        if (manager) {
          record.managerId = manager.id;
          record.escalated = true;

          try {
            await ctx.agents.invoke(manager.id, companyId, {
              prompt:
                `Issue ${issue.identifier} "${issue.title}" has failed ${consecutiveCount} consecutive times ` +
                `for agent ${agent.name}. Error: ${errorMsg.slice(0, 200)}. ` +
                `Please review the issue and decide: decompose into subtasks, increase turn limits, or reassign.`,
              reason: "task-triage-failure-escalation",
            });
            ctx.logger.info("Escalated to manager", {
              manager: manager.name,
              issue: issue.identifier,
            });
          } catch (err) {
            ctx.logger.warn("Failed to invoke manager for escalation", {
              managerId: manager.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        await ctx.activity.log({
          companyId,
          message: `Task triage: ${issue.identifier} escalated after ${consecutiveCount} failures (${agent.name})`,
          entityType: "issue",
          entityId: issue.id,
          metadata: { agentName: agent.name, consecutiveCount, error: errorMsg.slice(0, 200) },
        });

        state.stats.totalEscalated++;
      }

      state.failureTracking[issueId] = record;
      await saveState(companyId, state);
    });

    // ── Event: agent.run.finished — reset failure counter ─────────────

    ctx.events.on("agent.run.finished", async (event) => {
      const companyId = event.companyId;
      const agentId = event.entityId;
      if (!agentId || !companyId) return;

      const payload = event.payload as Record<string, unknown> | undefined;
      const issueId = payload?.issueId as string | undefined;
      if (!issueId) return;

      const state = await loadState(companyId);
      if (state.failureTracking[issueId]) {
        delete state.failureTracking[issueId];
        await saveState(companyId, state);
      }
    });

    // ── Data handlers for UI ──────────────────────────────────────────

    ctx.data.register("triage-overview", async (params: Record<string, unknown>) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      if (!companyId) return emptyState();
      return loadState(companyId);
    });

    ctx.data.register("triage-issue", async (params: Record<string, unknown>) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const issueId = typeof params.entityId === "string" ? params.entityId : "";
      if (!companyId || !issueId) return null;

      const state = await loadState(companyId);
      const triageRecord = state.triageHistory.find((r) => r.issueId === issueId);
      const failureRecord = state.failureTracking[issueId] ?? null;
      return { triageRecord: triageRecord ?? null, failureRecord };
    });

    // ── Actions ───────────────────────────────────────────────────────

    ctx.actions.register("triage-now", async (params: Record<string, unknown>) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const issueId = typeof params.issueId === "string" ? params.issueId : "";
      if (!companyId || !issueId) throw new Error("Missing companyId or issueId");

      const rawConfig = await ctx.config.get();
      const config = resolveConfig(rawConfig);

      const issue = await ctx.issues.get(issueId, companyId);
      if (!issue) throw new Error("Issue not found");
      if (!issue.assigneeAgentId) throw new Error("Issue has no assignee");

      const agent = await ctx.agents.get(issue.assigneeAgentId, companyId);
      if (!agent) throw new Error("Agent not found");

      const state = await loadState(companyId);
      const record = await triageIssue(issue, agent, companyId, config);
      if (record) {
        await saveState(companyId, addTriageRecord(state, record));
      }
      return record;
    });

    ctx.actions.register("clear-data", async (params: Record<string, unknown>) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      if (!companyId) throw new Error("Missing companyId");
      await saveState(companyId, emptyState());
      return { ok: true };
    });
  },

  async onHealth() {
    return { status: "ok", message: "task-triage ready" };
  },
});

export default plugin;
startWorkerRpcHost({ plugin });
