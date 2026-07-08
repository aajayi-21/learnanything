// Motivating goal banner for the top of TodayScreen. Renders immediately from the
// goalsList summary (report is embedded on GoalDto) and streams in the trajectory
// chart (get_goal_report_series) + at-risk facet titles (get_goal_report, lazy on
// expand). Three motivational elements: trajectory dots, dotted forecast to the
// due date, and a "▲ +N this week" delta. Degrades quietly: series/report errors
// render as small dim text, never crash the banner.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { ExamStatusSnapshot, GoalAtRiskFacetDto, GoalDto, GoalSeriesPointDto } from "../api/dto";
import { GoalTrajectoryChart } from "./GoalTrajectoryChart";
import { BlockBar, COLOR, Faint, FONT_MONO, Pill } from "./term";

function daysUntil(dueAt: string | null): number | null {
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return null;
  return Math.ceil((due - Date.now()) / 86_400_000);
}

function dueLabel(dueAt: string | null): string {
  const d = daysUntil(dueAt);
  if (d == null) return "open-ended";
  if (d < 0) return `${-d}d overdue`;
  if (d === 0) return "due today";
  return `due in ${d}d`;
}

function statusOf(fraction: number | null): { label: string; color: string } {
  const f = fraction ?? 0;
  if (f >= 0.85) return { label: "ON TRACK", color: COLOR.green };
  if (f >= 0.5) return { label: "ON PACE", color: COLOR.amber };
  return { label: "BEHIND", color: COLOR.pink };
}

export function GoalBanner({
  goals,
  onError,
  onPracticeAtRisk,
  onTakeExam,
  onNewGoal
}: {
  goals: GoalDto[]; // active goals, primary first
  onError: (message: string) => void;
  onPracticeAtRisk: () => void;
  onTakeExam?: (goalId: string) => void;
  onNewGoal: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(goals[0]?.id ?? "");
  const goal = useMemo(() => goals.find((g) => g.id === selectedId) ?? goals[0], [goals, selectedId]);

  const [series, setSeries] = useState<GoalSeriesPointDto[] | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState(false);
  const [atRisk, setAtRisk] = useState<GoalAtRiskFacetDto[] | null>(null);
  const [atRiskError, setAtRiskError] = useState<string | null>(null);

  const [exam, setExam] = useState<ExamStatusSnapshot | null>(null);

  const goalId = goal?.id;

  // Keep selection valid if the active-goal set changes underneath us.
  useEffect(() => {
    if (goalId && !goals.some((g) => g.id === selectedId)) setSelectedId(goalId);
  }, [goals, goalId, selectedId]);

  // Stream in the trajectory series (may take a couple seconds).
  useEffect(() => {
    if (!goalId) return;
    let cancelled = false;
    setSeries(null);
    setSeriesError(null);
    setSeriesLoading(true);
    api
      .getGoalReportSeries(goalId)
      .then((snap) => {
        if (!cancelled) setSeries(snap.series);
      })
      .catch((e) => {
        if (!cancelled) setSeriesError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setSeriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [goalId]);

  // Exam availability (only when the goal opted into a held-out exam).
  useEffect(() => {
    if (!goalId || !goal?.exam.enabled) {
      setExam(null);
      return;
    }
    let cancelled = false;
    api
      .getExamStatus(goalId)
      .then((snap) => {
        if (!cancelled) setExam(snap);
      })
      .catch(() => {
        if (!cancelled) setExam(null);
      });
    return () => {
      cancelled = true;
    };
  }, [goalId, goal?.exam.enabled]);

  // Lazily load at-risk facet titles when the learner expands the list.
  useEffect(() => {
    if (!expanded || !goalId || atRisk != null) return;
    let cancelled = false;
    api
      .getGoalReport(goalId)
      .then((snap) => {
        if (!cancelled) setAtRisk(snap.report.atRisk);
      })
      .catch((e) => {
        if (!cancelled) setAtRiskError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, goalId, atRisk]);

  // Reset lazy/streamed state when switching goals.
  useEffect(() => {
    setExpanded(false);
    setAtRisk(null);
    setAtRiskError(null);
  }, [goalId]);

  if (!goal) return null;

  const report = goal.report;
  const fraction = report?.onTrackFraction ?? null;
  const status = statusOf(fraction);
  const pct = fraction != null ? Math.round(fraction * 100) : null;
  const targetPct = Math.round(goal.targetRecall * 100);

  // Delta from the last two series points (on-track facet count).
  const delta = series && series.length >= 2 ? series[series.length - 1].onTrackCount - series[series.length - 2].onTrackCount : null;

  const atRiskCount = report?.atRiskCount ?? 0;
  const showExamButton = Boolean(onTakeExam && goal.exam.enabled && exam && exam.poolItemCount > 0);

  return (
    <div
      style={{
        margin: "16px 24px 0",
        border: `1px solid ${COLOR.borderStrong}`,
        borderLeft: `3px solid ${status.color}`,
        background: COLOR.bgElev
      }}
    >
      {/* ── header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: `1px solid ${COLOR.border}` }}>
        <span style={{ fontSize: 10, color: COLOR.textFaint, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: FONT_MONO }}>
          goal
        </span>
        <span style={{ fontSize: 14, color: COLOR.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {goal.title}
        </span>
        {goals.length > 1 ? (
          <span style={{ display: "inline-flex", gap: 4, marginLeft: 4 }}>
            {goals.map((g) => (
              <span
                key={g.id}
                onClick={() => setSelectedId(g.id)}
                title={g.title}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  cursor: "pointer",
                  background: g.id === goal.id ? COLOR.amber : COLOR.borderStrong
                }}
              />
            ))}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: (daysUntil(goal.dueAt) ?? 99) < 0 ? COLOR.pink : COLOR.textDim }}>
          {dueLabel(goal.dueAt)}
        </span>
      </div>

      {/* ── body ── */}
      <div style={{ display: "flex", gap: 24, padding: "14px 16px", flexWrap: "wrap" }}>
        {/* left: status + progress + at-risk */}
        <div style={{ flex: "1 1 320px", minWidth: 260 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: status.color,
                border: `1px solid ${status.color}`,
                padding: "2px 8px"
              }}
            >
              {status.label}
            </span>
            <span style={{ fontSize: 13, color: COLOR.text }}>
              {report ? `${report.onTrackCount}/${report.total} facets ≥ ${targetPct}%` : "no report yet"}
            </span>
            {delta != null && delta !== 0 ? (
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: delta > 0 ? COLOR.green : COLOR.pink }}>
                {delta > 0 ? "▲" : "▼"} {delta > 0 ? "+" : ""}
                {delta} this week
              </span>
            ) : null}
          </div>

          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <BlockBar value={fraction ?? 0} width={28} color={status.color} />
            <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: COLOR.text }}>{pct != null ? `${pct}%` : "—"}</span>
          </div>

          {/* at-risk facets (lazy on expand) */}
          {atRiskCount > 0 ? (
            <div style={{ marginTop: 12 }}>
              <span
                onClick={() => setExpanded((v) => !v)}
                style={{ fontSize: 12, color: COLOR.amberLink, cursor: "pointer", fontFamily: FONT_MONO }}
              >
                {expanded ? "▾" : "▸"} at risk: {atRiskCount} {atRiskCount === 1 ? "facet" : "facets"}
              </span>
              {expanded ? (
                <div style={{ marginTop: 6, fontSize: 12, color: COLOR.textDim, lineHeight: 1.6 }}>
                  {atRiskError ? (
                    <Faint style={{ color: COLOR.red }}>{atRiskError}</Faint>
                  ) : atRisk == null ? (
                    <Faint>loading…</Faint>
                  ) : atRisk.length === 0 ? (
                    <Faint>none</Faint>
                  ) : (
                    atRisk.slice(0, 6).map((f) => (
                      <div key={`${f.learningObjectId}:${f.facetId}`} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                          {f.learningObjectTitle}
                        </span>
                        <Faint style={{ fontFamily: FONT_MONO, fontSize: 11 }}>
                          {f.currentRecall != null ? `${Math.round(f.currentRecall * 100)}%` : f.label}
                        </Faint>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* actions */}
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onPracticeAtRisk}
              title="goal items are floored in your normal queue — practicing now covers them"
              style={btnStyle(COLOR.amber)}
            >
              practice at-risk facets ↵
            </button>
            {showExamButton ? (
              <button type="button" onClick={() => onTakeExam?.(goal.id)} style={btnStyle(COLOR.cyan)}>
                take practice exam
              </button>
            ) : null}
            <span style={{ flex: 1 }} />
            <span onClick={onNewGoal} style={{ fontSize: 12, color: COLOR.textFaint, cursor: "pointer", alignSelf: "center", fontFamily: FONT_MONO }}>
              + new goal
            </span>
          </div>
        </div>

        {/* right: trajectory chart */}
        <div style={{ flex: "0 0 auto", minWidth: 260 }}>
          <div style={{ fontSize: 10, color: COLOR.textFaint, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: FONT_MONO, marginBottom: 4 }}>
            trajectory
          </div>
          {seriesError ? (
            <Faint style={{ color: COLOR.red, fontSize: 11 }}>{seriesError}</Faint>
          ) : seriesLoading || series == null ? (
            <div style={{ fontSize: 11, color: COLOR.textFaint, fontFamily: FONT_MONO, padding: "8px 0" }}>loading trajectory…</div>
          ) : (
            <GoalTrajectoryChart series={series} dueAt={goal.dueAt} targetRecall={goal.targetRecall} />
          )}
        </div>
      </div>
    </div>
  );
}

function btnStyle(color: string) {
  return {
    padding: "6px 14px",
    border: `1px solid ${color}`,
    background: "transparent",
    color,
    fontFamily: FONT_MONO,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap" as const
  };
}
