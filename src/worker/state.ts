/**
 * Plugin state types and helpers for tracking triage history.
 */

export interface TriageRecord {
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  assessedAt: string;
  complexityScore: number;
  reasoning: string;
  estimatedTurns: number;
  action: "none" | "flagged" | "decomposed" | "escalated";
  subtasksCreated: string[]; // issue IDs of created subtasks
}

export interface FailureRecord {
  issueId: string;
  issueIdentifier: string;
  agentId: string;
  agentName: string;
  failedAt: string;
  error: string;
  consecutiveCount: number;
  escalated: boolean;
  managerId: string | null;
}

export interface TriageState {
  triageHistory: TriageRecord[];
  failureTracking: Record<string, FailureRecord>; // keyed by issueId
  stats: {
    totalAssessed: number;
    totalDecomposed: number;
    totalEscalated: number;
    totalFlagged: number;
  };
}

export function emptyState(): TriageState {
  return {
    triageHistory: [],
    failureTracking: {},
    stats: {
      totalAssessed: 0,
      totalDecomposed: 0,
      totalEscalated: 0,
      totalFlagged: 0,
    },
  };
}

const MAX_HISTORY = 200;

export function addTriageRecord(state: TriageState, record: TriageRecord): TriageState {
  const history = [record, ...state.triageHistory].slice(0, MAX_HISTORY);
  const stats = { ...state.stats, totalAssessed: state.stats.totalAssessed + 1 };
  if (record.action === "decomposed") stats.totalDecomposed++;
  if (record.action === "escalated") stats.totalEscalated++;
  if (record.action === "flagged") stats.totalFlagged++;
  return { ...state, triageHistory: history, stats };
}
