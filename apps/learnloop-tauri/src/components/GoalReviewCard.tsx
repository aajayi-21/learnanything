// Weekly review card for a single active goal that needs a decision. Shown on
// TodayScreen below the banner when the goal's frontier is clear
// (report.atRiskCount === 0), its due date has passed, or it hasn't been touched
// in 7+ days. One card at a time. Actions: keep (session-dismiss), pause,
// complete, expire. Completing with at-risk facets left warns first.

import { useState } from "react";
import { api } from "../api/client";
import type { GoalDto } from "../api/dto";
import { COLOR, Faint, FONT_MONO } from "./term";

export type ReviewReason = "frontier_clear" | "due_passed" | "stale";

const REASON_COPY: Record<ReviewReason, { title: string; body: string; accent: string }> = {
  frontier_clear: {
    title: "frontier clear",
    body: "Every facet in scope is at target — ready to mark this goal complete?",
    accent: COLOR.green
  },
  due_passed: {
    title: "due date passed",
    body: "This goal's deadline has come and gone. Complete it, or expire it?",
    accent: COLOR.pink
  },
  stale: {
    title: "still working toward this?",
    body: "No activity on this goal in over a week. Keep going, pause, or wrap it up?",
    accent: COLOR.amber
  }
};

export function GoalReviewCard({
  goal,
  reason,
  onKeep,
  onChanged,
  onError
}: {
  goal: GoalDto;
  reason: ReviewReason;
  onKeep: (goalId: string) => void;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState<GoalDto["status"] | null>(null);
  const copy = REASON_COPY[reason];
  const atRisk = goal.report?.atRiskCount ?? 0;

  async function setStatus(status: GoalDto["status"]) {
    if (busy) return;
    if (status === "completed" && atRisk > 0) {
      const ok = window.confirm(`${atRisk} ${atRisk === 1 ? "facet is" : "facets are"} not at target — complete anyway?`);
      if (!ok) return;
    }
    setBusy(status);
    try {
      await api.updateGoalStatus(goal.id, status);
      onChanged();
    } catch (e) {
      onError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        margin: "12px 24px 0",
        border: `1px solid ${COLOR.border}`,
        borderLeft: `3px solid ${copy.accent}`,
        background: COLOR.bgElev,
        padding: "12px 16px",
        display: "flex",
        alignItems: "flex-start",
        gap: 16
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: copy.accent, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: FONT_MONO, fontWeight: 700 }}>
          weekly review · {copy.title}
        </div>
        <div style={{ marginTop: 5, fontSize: 13, color: COLOR.text }}>
          <span style={{ fontWeight: 600 }}>{goal.title}</span> <Faint style={{ fontSize: 12 }}>— {copy.body}</Faint>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <ActionBtn label="keep" color={COLOR.textDim} onClick={() => onKeep(goal.id)} disabled={busy != null} />
        <ActionBtn label={busy === "paused" ? "pausing…" : "pause"} color={COLOR.amber} onClick={() => setStatus("paused")} disabled={busy != null} />
        <ActionBtn label={busy === "completed" ? "completing…" : "complete"} color={COLOR.green} onClick={() => setStatus("completed")} disabled={busy != null} />
        <ActionBtn label={busy === "expired" ? "expiring…" : "expire"} color={COLOR.pink} onClick={() => setStatus("expired")} disabled={busy != null} />
      </div>
    </div>
  );
}

function ActionBtn({ label, color, onClick, disabled }: { label: string; color: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 12px",
        border: `1px solid ${color}`,
        background: "transparent",
        color,
        fontFamily: FONT_MONO,
        fontSize: 11,
        fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap"
      }}
    >
      {label}
    </button>
  );
}
