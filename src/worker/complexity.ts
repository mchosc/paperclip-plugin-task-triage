/**
 * Complexity assessment via LLM. Scores 1-10 and suggests subtask breakdown.
 * Agent routing is handled by keyword matching in the worker, not by the LLM.
 */

export interface ComplexityAssessment {
  score: number; // 1-10
  reasoning: string;
  suggestedSubtasks: Array<{ title: string; description: string; assignee?: string }>;
  estimatedTurns: number;
}

function isQuotaError(msg: string): boolean {
  return /429|rate.?limit|quota|resource.?exhausted|capacity|overloaded|too many requests/i.test(msg);
}

export async function assessComplexity(
  httpFetch: (url: string, init?: RequestInit) => Promise<Response>,
  config: { llmProvider: string; llmModel: string; llmApiKey: string; llmFallbackModel?: string },
  issue: { title: string; description: string | null },
  agentContext: { agentName: string; maxTurns: number },
): Promise<ComplexityAssessment> {
  const prompt = `You are a task complexity assessor. Respond with ONLY valid JSON (no markdown, no code fences):

Task: ${issue.title}
Description: ${issue.description ?? "(no description)"}

Assigned agent has max ${agentContext.maxTurns} turns per run.

Rate complexity 1-10:
- 1-3: Simple (single file, config, small fix)
- 4-6: Medium (multi-file, new feature, moderate refactor)
- 7-8: Complex (cross-module, new architecture)
- 9-10: Very complex (system-wide, multi-service)

If complexity >= 7, suggest 2-5 subtasks to break it down.
Do NOT include email delivery or report compilation as subtasks.

JSON format:
{
  "score": <1-10>,
  "reasoning": "<one paragraph>",
  "suggestedSubtasks": [{"title": "<title>", "description": "<brief>"}],
  "estimatedTurns": <number>
}`;

  let content: string | undefined;
  const modelsToTry = [config.llmModel];
  if (config.llmFallbackModel && config.llmFallbackModel !== config.llmModel) {
    modelsToTry.push(config.llmFallbackModel);
  }

  const MAX_RETRIES = 2;
  for (const model of modelsToTry) {
    let succeeded = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await httpFetch(`${config.llmProvider}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.llmApiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            max_tokens: 1024,
          }),
        });

        if (!response.ok) {
          const errText = `LLM API error: ${response.status} ${response.statusText}`;
          if (isQuotaError(errText)) throw new Error(errText);
          throw new Error(errText);
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };

        content = data.choices?.[0]?.message?.content?.trim();
        if (!content) throw new Error("Empty LLM response");
        succeeded = true;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isQuotaError(msg) && modelsToTry.indexOf(model) < modelsToTry.length - 1) break; // try next model
        if (attempt === MAX_RETRIES) {
          if (modelsToTry.indexOf(model) < modelsToTry.length - 1) break; // try next model
          throw err;
        }
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
    if (succeeded) break;
  }

  if (!content) throw new Error("LLM assessment failed after retries");

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
