# Task Triage Plugin for Paperclip

Automatic task complexity assessment, decomposition into subtasks, and failure escalation for [Paperclip](https://github.com/paperclipai/paperclip) agent teams.

## What it does

When a new issue is created or assigned to an agent, this plugin:

1. **Blocks the issue** immediately to prevent the agent from starting prematurely
2. **Assesses complexity** (1-10) using an LLM (any OpenAI-compatible API)
3. If score < threshold: **unblocks** the issue for the agent to work on
4. If score >= threshold: **auto-decomposes** into 2-5 subtasks with smart assignee routing based on your org structure
5. On agent failures: **tracks consecutive failures** and escalates to the agent's manager after N failures

## Features

- **Complexity scoring** — LLM-based 1-10 assessment with reasoning
- **Auto-decomposition** — creates proper parent-child subtasks with assignees
- **Smart routing** — reads your org chart dynamically, assigns subtasks to the right specialist (not managers)
- **Pre-assessment blocking** — prevents race conditions where agents start before decomposition completes
- **Failure escalation** — tracks timeouts/failures per issue, notifies managers after consecutive failures
- **Dashboard widget** — shows assessment history, active escalations, stats
- **Issue detail tab** — shows complexity score and failure tracking per issue
- **Manual triage** — "Assess Complexity" button on any issue

## Installation

```bash
cd /path/to/paperclip/.paperclip/plugins
npm install @animusystems/paperclip-plugin-task-triage
```

## Configuration

In the Paperclip UI, go to the plugin settings and configure:

| Setting | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enable/disable the plugin |
| `complexityThreshold` | `7` | Score threshold for auto-decomposition (1-10) |
| `autoDecompose` | `false` | Auto-create subtasks for high-complexity issues |
| `escalateOnTimeout` | `true` | Escalate to manager on consecutive failures |
| `maxConsecutiveFailures` | `2` | Failures before escalation |
| `llmProvider` | `https://openrouter.ai/api/v1` | OpenAI-compatible API endpoint |
| `llmModel` | `deepseek/deepseek-v3.2` | Model for complexity assessment |
| `llmApiKey` | (empty) | API key (falls back to OPENAI_API_KEY env var) |

## How decomposition works

```
Issue created → Plugin blocks issue → LLM assesses complexity
                                          ↓
                              Score < 7: unblock, agent works normally
                              Score >= 7: create subtasks → assign to specialists → parent stays in_progress
                                          ↓
                              Subtask agents do the work
                                          ↓
                              All subtasks done → parent agent marks parent done
```

## Required capabilities

```
events.subscribe, plugin.state.read, plugin.state.write,
agents.read, agents.invoke, issues.read, issues.create,
issues.update, issue.comments.read, issue.comments.create,
projects.read, activity.log.write, http.outbound
```

## License

MIT
