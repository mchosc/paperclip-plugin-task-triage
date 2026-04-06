import type { PluginWidgetProps, PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginData, usePluginAction, useHostContext } from "@paperclipai/plugin-sdk/ui";
import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────

interface TriageRecord {
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  assessedAt: string;
  complexityScore: number;
  reasoning: string;
  estimatedTurns: number;
  action: "none" | "flagged" | "decomposed" | "escalated";
  subtasksCreated: string[];
}

interface FailureRecord {
  issueId: string;
  issueIdentifier: string;
  agentId: string;
  agentName: string;
  failedAt: string;
  error: string;
  consecutiveCount: number;
  escalated: boolean;
}

interface TriageState {
  triageHistory: TriageRecord[];
  failureTracking: Record<string, FailureRecord>;
  stats: {
    totalAssessed: number;
    totalDecomposed: number;
    totalEscalated: number;
    totalFlagged: number;
  };
}

// ── Styles ────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  padding: 16,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--card)",
};

const statBox: React.CSSProperties = {
  textAlign: "center" as const,
  padding: "8px 0",
};

const statNumber: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: "var(--foreground)",
  lineHeight: 1,
};

const statLabel: React.CSSProperties = {
  fontSize: 11,
  color: "var(--muted-foreground)",
  marginTop: 4,
};

const badge = (color: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "2px 6px",
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  background: `${color}20`,
  color,
});

const ACTION_COLORS: Record<string, string> = {
  none: "#9ca3af",
  flagged: "#f59e0b",
  decomposed: "#22c55e",
  escalated: "#ef4444",
};

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 8 ? "#ef4444" : score >= 6 ? "#f59e0b" : score >= 4 ? "#3b82f6" : "#22c55e";
  return <span style={badge(color)}>{score}/10</span>;
}

function ActionBadge({ action }: { action: string }) {
  return <span style={badge(ACTION_COLORS[action] ?? "#9ca3af")}>{action}</span>;
}

function TimeAgo({ date }: { date: string }) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return <span>{mins}m ago</span>;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return <span>{hours}h ago</span>;
  return <span>{Math.floor(hours / 24)}d ago</span>;
}

// ── Dashboard Widget ──────────────────────────────────────────────────

export function TriageOverviewWidget() {
  const context = useHostContext();
  const { data, loading } = usePluginData<TriageState>("triage-overview", {
    companyId: context.companyId,
  });

  if (loading || !data) {
    return <div style={{ padding: 16, opacity: 0.5, fontSize: 13 }}>Loading triage data...</div>;
  }

  const activeFailures = Object.values(data.failureTracking).filter((f) => f.consecutiveCount >= 2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        <div style={statBox}>
          <div style={statNumber}>{data.stats.totalAssessed}</div>
          <div style={statLabel}>Assessed</div>
        </div>
        <div style={statBox}>
          <div style={{ ...statNumber, color: "#f59e0b" }}>{data.stats.totalFlagged}</div>
          <div style={statLabel}>Flagged</div>
        </div>
        <div style={statBox}>
          <div style={{ ...statNumber, color: "#22c55e" }}>{data.stats.totalDecomposed}</div>
          <div style={statLabel}>Decomposed</div>
        </div>
        <div style={statBox}>
          <div style={{ ...statNumber, color: "#ef4444" }}>{data.stats.totalEscalated}</div>
          <div style={statLabel}>Escalated</div>
        </div>
      </div>

      {/* Active failures */}
      {activeFailures.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#ef4444" }}>
            Active Failure Escalations
          </div>
          {activeFailures.map((f) => (
            <div
              key={f.issueId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 0",
                fontSize: 12,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div>
                <strong>{f.issueIdentifier}</strong> — {f.agentName}
              </div>
              <div style={{ color: "#ef4444", fontSize: 11 }}>
                {f.consecutiveCount}x failed {f.escalated ? "(escalated)" : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent triage */}
      {data.triageHistory.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--foreground)" }}>
            Recent Assessments
          </div>
          {data.triageHistory.slice(0, 5).map((r) => (
            <div
              key={r.issueId + r.assessedAt}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 0",
                fontSize: 12,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <ScoreBadge score={r.complexityScore} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <strong>{r.issueIdentifier}</strong> {r.issueTitle}
              </span>
              <ActionBadge action={r.action} />
              <span style={{ fontSize: 11, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
                <TimeAgo date={r.assessedAt} />
              </span>
            </div>
          ))}
        </div>
      )}

      {data.triageHistory.length === 0 && activeFailures.length === 0 && (
        <div style={{ textAlign: "center", padding: 12, color: "var(--muted-foreground)", fontSize: 13 }}>
          No triage activity yet. Issues will be assessed when assigned to agents.
        </div>
      )}
    </div>
  );
}

// ── Issue Detail Tab ──────────────────────────────────────────────────

export function TriageIssueTab({ context }: PluginDetailTabProps) {
  const { data, loading } = usePluginData<{
    triageRecord: TriageRecord | null;
    failureRecord: FailureRecord | null;
  }>("triage-issue", {
    companyId: context.companyId,
    entityId: context.entityId,
  });

  const triageNow = usePluginAction("triage-now");
  const [triaging, setTriaging] = useState(false);
  const [result, setResult] = useState<TriageRecord | null>(null);

  const handleTriage = async () => {
    setTriaging(true);
    try {
      const res = await triageNow({
        companyId: context.companyId,
        issueId: context.entityId,
      });
      setResult(res as TriageRecord);
    } catch (err) {
      console.error("Triage failed:", err);
    } finally {
      setTriaging(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 16, opacity: 0.5, fontSize: 13 }}>Loading...</div>;
  }

  const triageRecord = result ?? data?.triageRecord;
  const failureRecord = data?.failureRecord;

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Triage assessment */}
      {triageRecord ? (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Complexity Assessment</span>
            <ScoreBadge score={triageRecord.complexityScore} />
            <ActionBadge action={triageRecord.action} />
          </div>
          <p style={{ fontSize: 13, color: "var(--foreground)", margin: "0 0 8px", lineHeight: 1.5 }}>
            {triageRecord.reasoning}
          </p>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
            Estimated turns: {triageRecord.estimatedTurns} | Assessed: <TimeAgo date={triageRecord.assessedAt} />
          </div>
          {triageRecord.subtasksCreated.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#22c55e" }}>
              {triageRecord.subtasksCreated.length} subtask(s) created
            </div>
          )}
        </div>
      ) : (
        <div style={card}>
          <p style={{ fontSize: 13, color: "var(--muted-foreground)", margin: "0 0 12px" }}>
            This issue has not been triaged yet.
          </p>
          <button
            onClick={handleTriage}
            disabled={triaging}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              cursor: triaging ? "wait" : "pointer",
              opacity: triaging ? 0.6 : 1,
            }}
          >
            {triaging ? "Assessing..." : "Assess Complexity"}
          </button>
        </div>
      )}

      {/* Failure tracking */}
      {failureRecord && (
        <div style={{ ...card, borderColor: "#ef4444" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#ef4444", marginBottom: 8 }}>
            Failure Tracking
          </div>
          <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
            <div>
              <strong>Agent:</strong> {failureRecord.agentName}
            </div>
            <div>
              <strong>Consecutive failures:</strong> {failureRecord.consecutiveCount}
            </div>
            <div>
              <strong>Last error:</strong> {failureRecord.error}
            </div>
            <div>
              <strong>Last failure:</strong> <TimeAgo date={failureRecord.failedAt} />
            </div>
            {failureRecord.escalated && (
              <div style={{ color: "#f59e0b" }}>Escalated to manager</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
