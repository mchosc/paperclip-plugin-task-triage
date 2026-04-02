/**
 * Complexity assessment via LLM. Sends the issue title + description to a model
 * and asks it to score complexity 1-10 with reasoning and optional subtask suggestions.
 */

export interface ComplexityAssessment {
  score: number; // 1-10
  reasoning: string;
  suggestedSubtasks: Array<{ title: string; description: string; assignee?: string }>;
  estimatedTurns: number;
}

export interface AgentRoster {
  name: string;
  role: string;
  title: string | null;
  reportsTo: string | null;
}

function buildOrgSection(agents: AgentRoster[]): string {
  if (agents.length === 0) return "No agents available for assignment.";

  const managers = agents.filter(a => ["ceo", "cto", "cfo", "cmo"].includes(a.role));
  const ics = agents.filter(a => !["ceo", "cto", "cfo", "cmo"].includes(a.role));

  // Group ICs by their manager
  const managerNames = new Map(managers.map(m => [m.name, m]));
  const groups = new Map<string, AgentRoster[]>();

  for (const ic of ics) {
    const managerName = ic.reportsTo
      ? agents.find(a => a.name === ic.reportsTo)?.name ?? "Unassigned"
      : "Unassigned";
    if (!groups.has(managerName)) groups.set(managerName, []);
    groups.get(managerName)!.push(ic);
  }

  const lines: string[] = [];

  for (const [managerName, reports] of groups) {
    const manager = managerNames.get(managerName);
    lines.push(`\n${manager ? `${managerName} (${manager.role.toUpperCase()})` : managerName} team:`);
    for (const r of reports) {
      lines.push(`- ${r.name}: ${r.title ?? r.role}`);
    }
  }

  if (managers.length > 0) {
    lines.push(`\nMANAGERS (delegate, don't do IC work): ${managers.map(m => m.name).join(", ")}`);
  }

  lines.push("\nAssign subtasks to the most specific IC agent, NOT to managers unless it requires strategic decisions.");

  return lines.join("\n");
}

export async function assessComplexity(
  httpFetch: (url: string, init?: RequestInit) => Promise<Response>,
  config: { llmProvider: string; llmModel: string; llmApiKey: string },
  issue: { title: string; description: string | null },
  agentContext: { agentName: string; maxTurns: number },
  orgRoster?: AgentRoster[],
): Promise<ComplexityAssessment> {
  const orgSection = orgRoster ? buildOrgSection(orgRoster) : "";

  const prompt = `You are a task complexity assessor for an AI agent team.

Evaluate this task and respond with ONLY valid JSON (no markdown, no code fences):

Task: ${issue.title}
Description: ${issue.description ?? "(no description)"}

Assigned agent: ${agentContext.agentName} (max ${agentContext.maxTurns} turns per run)

Rate complexity 1-10 where:
- 1-3: Simple (single file change, config update, small bug fix)
- 4-6: Medium (multi-file changes, new feature in existing pattern, moderate refactor)
- 7-8: Complex (cross-module changes, new architecture, significant refactor)
- 9-10: Very complex (system-wide changes, migrations, multi-service coordination)

If complexity >= 7, suggest how to break it into 2-5 smaller subtasks.
${orgSection ? `For each subtask, suggest the best agent to handle it from this org:\n${orgSection}` : "For each subtask, suggest an assignee role (e.g. 'engineer', 'designer', 'analyst')."}
Do NOT include email delivery, report compilation, or final synthesis as subtasks — the parent agent handles that after all subtasks complete.
Estimate how many LLM tool-loop turns this would take.

JSON format:
{
  "score": <number 1-10>,
  "reasoning": "<one paragraph explaining the assessment>",
  "suggestedSubtasks": [{"title": "<subtask title>", "description": "<brief description>", "assignee": "<agent name or role>"}],
  "estimatedTurns": <number>
}`;

  let content: string | undefined;
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await httpFetch(`${config.llmProvider}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.llmApiKey}`,
        },
        body: JSON.stringify({
          model: config.llmModel,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 1024,
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      content = data.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("Empty LLM response");
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }

  if (!content) throw new Error("LLM assessment failed after retries");

  // Strip markdown code fences if present
  const cleaned = content.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as ComplexityAssessment;
    return {
      score: Math.max(1, Math.min(10, Math.round(parsed.score))),
      reasoning: parsed.reasoning || "No reasoning provided",
      suggestedSubtasks: Array.isArray(parsed.suggestedSubtasks)
        ? parsed.suggestedSubtasks.slice(0, 5)
        : [],
      estimatedTurns: parsed.estimatedTurns || 0,
    };
  } catch {
    throw new Error(`Failed to parse LLM response as JSON: ${cleaned.slice(0, 200)}`);
  }
}
