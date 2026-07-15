// KM3b §9.6 provenance UI: attempt trace, unresolved-cause card, capability
// grid, recipe tree, and the facet evidence drawer (Demonstrated timeline).
// Terminal aesthetic — inline styles over term.tsx primitives.
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type {
  AttemptTraceDto,
  CapabilityGridResult,
  ComponentReadinessDto,
  DemonstratedTimelinePointDto,
  FacetEvidenceTimelineDto,
  LoReadinessDto,
  ObservationDerivationDto,
  ReadyDerivationDto,
  TraceCriterionDto,
  UnresolvedCauseDto,
} from "../api/dto";
import { BlockBar, COLOR, Dim, Faint, FONT_MONO, Pill, SectionHeader, type PillColor } from "./term";

const pct = (value: number | null | undefined): string =>
  value == null ? "—" : `${Math.round(value * 100)}%`;

const shortFacet = (facetId: string): string => facetId.replace(/^facet_/, "");

// -- Attempt trace view (criterion DAG per attempt) ---------------------------

const STATUS_META: Record<TraceCriterionDto["status"], { glyph: string; label: string; color: string; pill: PillColor }> = {
  demonstrated: { glyph: "✓", label: "demonstrated", color: COLOR.green, pill: "green" },
  first_error: { glyph: "✗", label: "first error", color: COLOR.red, pill: "red" },
  not_judged: { glyph: "○", label: "not judged", color: COLOR.textFaint, pill: "slate" },
  partial: { glyph: "◐", label: "partial", color: COLOR.yellow, pill: "amber" },
};

function TraceCriterionRow({ row }: { row: TraceCriterionDto }) {
  const meta = STATUS_META[row.status];
  return (
    <div style={{ padding: "6px 0", borderBottom: `1px solid ${COLOR.border}` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ color: meta.color, width: 14, textAlign: "center" }}>{meta.glyph}</span>
        <span style={{ color: COLOR.text, flex: 1 }}>{row.description}</span>
        <Pill color={meta.pill}>{meta.label}</Pill>
        <span style={{ color: COLOR.textDim, minWidth: 44, textAlign: "right" }}>
          {row.pointsAwarded == null ? "—" : row.pointsAwarded}/{row.pointsPossible}
        </span>
      </div>
      <div style={{ marginLeft: 22, marginTop: 2, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline" }}>
        {row.targets.map((t, i) => (
          <Pill key={`${t.facet}:${t.capability}:${i}`} color="slate">
            {shortFacet(t.facet)} · {t.capability}
          </Pill>
        ))}
        {row.dependsOn.length > 0 && <Faint>depends on {row.dependsOn.join(", ")}</Faint>}
        {row.status === "not_judged" && <Faint>downstream of an earlier error — not judged, not wrong</Faint>}
      </div>
    </div>
  );
}

export function AttemptTraceView({ trace }: { trace: AttemptTraceDto }) {
  if (!trace.criteria.length) return null;
  return (
    <div style={{ fontFamily: FONT_MONO }}>
      <div style={{ marginBottom: 6 }}>
        <Pill color="green">{trace.demonstratedCount} demonstrated</Pill>{" "}
        {trace.firstErrorCount > 0 && <Pill color="red">{trace.firstErrorCount} first error</Pill>}{" "}
        {trace.notJudgedCount > 0 && <Pill color="slate">{trace.notJudgedCount} not judged</Pill>}
      </div>
      {trace.criteria.map((row) => (
        <TraceCriterionRow key={row.criterionId} row={row} />
      ))}
    </div>
  );
}

// -- Unresolved-cause diagnostic card -----------------------------------------

export function UnresolvedCauseCard({
  causes,
  onRunDiagnostic,
}: {
  causes: UnresolvedCauseDto[];
  onRunDiagnostic?: () => void;
}) {
  if (!causes.length) return null;
  // The candidate set is the union across factors (each is one ambiguous failure).
  const candidates = new Map<string, { facet: string; capability: string }>();
  for (const factor of causes) {
    for (const cause of factor.candidateCauses) {
      candidates.set(`${cause.facet}:${cause.capability}`, cause);
    }
  }
  const list = Array.from(candidates.values());
  return (
    <div
      style={{
        border: `1px solid ${COLOR.amber}`,
        borderRadius: 4,
        padding: 10,
        fontFamily: FONT_MONO,
        background: COLOR.bgElev,
      }}
    >
      <div style={{ color: COLOR.amber, marginBottom: 4 }}>
        This failure is consistent with {list.length} cause{list.length === 1 ? "" : "s"}
      </div>
      <Dim>The evidence can't yet tell these apart — each implies a different repair.</Dim>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        {list.map((cause) => (
          <Pill key={`${cause.facet}:${cause.capability}`} color="amber">
            {shortFacet(cause.facet)} · {cause.capability}
          </Pill>
        ))}
      </div>
      {onRunDiagnostic && (
        <button
          type="button"
          onClick={onRunDiagnostic}
          style={{
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: COLOR.bg,
            background: COLOR.amber,
            border: "none",
            borderRadius: 3,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          ▸ run a short diagnostic
        </button>
      )}
    </div>
  );
}

// -- Recipe tree ("why not ready") --------------------------------------------

function ComponentRow({ c, bottleneck }: { c: ComponentReadinessDto; bottleneck: boolean }) {
  const marker = bottleneck ? "◆" : c.gating ? "●" : "○";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "14px minmax(0, 1fr) 92px 42px",
        alignItems: "center",
        gap: 8,
        padding: "4px 0",
        fontSize: 11
      }}
    >
      <span aria-hidden style={{ color: bottleneck ? COLOR.red : c.gating ? COLOR.cyan : COLOR.textFaint }}>
        {marker}
      </span>
      <span style={{ color: bottleneck ? COLOR.red : COLOR.text, minWidth: 0, overflowWrap: "anywhere" }}>
        {shortFacet(c.facet)} · {c.capability}
        {!c.gating && <Faint> · facilitating</Faint>}
      </span>
      <BlockBar value={c.predictedRecall} width={8} color={bottleneck ? COLOR.red : COLOR.cyan} />
      <span style={{ textAlign: "right", color: bottleneck ? COLOR.red : COLOR.textDim }}>{pct(c.predictedRecall)}</span>
    </div>
  );
}

export function RecipeTree({ readiness }: { readiness: LoReadinessDto }) {
  if (!readiness.hasBlueprints) return <Faint>No authored blueprints for this objective.</Faint>;
  const bottleneckKey = readiness.bottleneck
    ? `${readiness.bottleneck.facet}:${readiness.bottleneck.capability}`
    : null;
  return (
    <div style={{ fontFamily: FONT_MONO }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <Pill color="cyan">Ready {pct(readiness.readiness)}</Pill>
        {readiness.bottleneck && (
          <span style={{ fontSize: 11 }}>
            <Faint>bottleneck</Faint>{" "}
            <span style={{ color: COLOR.red }}>
              ◆ {shortFacet(readiness.bottleneck.facet)} · {readiness.bottleneck.capability}
            </span>
          </span>
        )}
      </div>
      {readiness.blueprints.map((bp) => (
        <div key={bp.blueprintId} style={{ marginBottom: 10, border: `1px solid ${COLOR.border}`, background: COLOR.bgInput }}>
          <div
            style={{
              padding: "7px 10px",
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              flexWrap: "wrap",
              fontSize: 11
            }}
          >
            <Faint>blueprint</Faint>
            <span style={{ color: COLOR.amber, overflowWrap: "anywhere" }}>{bp.blueprintId}</span>
            <span style={{ flex: 1 }} />
            <Faint>weight</Faint> <Dim>{bp.weight}</Dim>
            <Faint>P(success)</Faint> <span style={{ color: COLOR.cyan }}>{pct(bp.successProbability)}</span>
          </div>
          {bp.recipes.map((recipe) => {
            const isBest = recipe.recipeId === bp.bestRecipeId;
            return (
              <div
                key={recipe.recipeId}
                style={{
                  padding: "8px 10px",
                  borderTop: `1px solid ${COLOR.border}`,
                  borderLeft: `2px solid ${isBest ? COLOR.cyan : "transparent"}`
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 11 }}>
                  <span style={{ color: COLOR.text }}>
                    {recipe.composition === "conjunctive" ? "AND" : recipe.composition.toUpperCase()}
                  </span>
                  <Faint>recipe</Faint>
                  <span style={{ color: COLOR.textDim, overflowWrap: "anywhere" }}>{recipe.recipeId}</span>
                  {isBest && <Pill color="cyan">best path</Pill>}
                  <span style={{ marginLeft: "auto", color: COLOR.cyan }}>{pct(recipe.successProbability)}</span>
                </div>
                <div style={{ marginTop: 4 }}>
                  {recipe.components.map((c, i) => (
                    <ComponentRow
                      key={`${c.facet}:${c.capability}:${i}`}
                      c={c}
                      bottleneck={`${c.facet}:${c.capability}` === bottleneckKey}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// -- Capability grid (facet × capability heatmap) -----------------------------

function GridCell({ demonstrated, ready, tested }: { demonstrated: boolean; ready: number; tested: boolean }) {
  const marker = demonstrated ? "●" : tested ? "◌" : "·";
  const label = demonstrated ? "demonstrated" : tested ? "tested" : "untested";
  const tone = demonstrated ? COLOR.green : tested ? COLOR.cyan : COLOR.textFaint;
  return (
    <td
      style={{
        borderTop: `1px solid ${COLOR.border}`,
        borderRight: `1px solid ${COLOR.border}`,
        padding: "6px 8px",
        background: demonstrated ? "#152018" : COLOR.bgInput,
        minWidth: 104
      }}
    >
      <div style={{ color: tone, fontSize: 10, whiteSpace: "nowrap" }}>
        <span aria-hidden>{marker}</span> {label}
      </div>
      <div style={{ marginTop: 3, display: "flex", alignItems: "center", gap: 6, color: COLOR.textDim, fontSize: 10 }}>
        <BlockBar value={ready} width={5} color={COLOR.cyan} />
        <span>{pct(ready)}</span>
      </div>
    </td>
  );
}

export function CapabilityGridView({ result }: { result: CapabilityGridResult }) {
  const { grid, readiness } = result;
  if (!grid.supported) {
    return <Faint>Capability grid is available for mvp-0.7 vaults; this vault keeps the facet radar.</Faint>;
  }
  const cellOf = new Map(grid.cells.map((c) => [`${c.facetId}:${c.capability}`, c]));
  return (
    <div style={{ fontFamily: FONT_MONO }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, border: `1px solid ${COLOR.border}`, fontSize: 11, minWidth: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px", color: COLOR.textFaint, background: COLOR.bgElev, fontWeight: 400 }}>
                facet / capability
              </th>
              {grid.capabilities.map((cap) => (
                <th
                  key={cap}
                  style={{
                    padding: "6px 8px",
                    color: COLOR.amber,
                    background: COLOR.bgElev,
                    borderLeft: `1px solid ${COLOR.border}`,
                    fontSize: 10,
                    fontWeight: 400,
                    overflowWrap: "anywhere"
                  }}
                >
                  {cap}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.facets.map((facet) => (
              <tr key={facet}>
                <td style={{ padding: "6px 8px", color: COLOR.text, whiteSpace: "nowrap", borderTop: `1px solid ${COLOR.border}`, background: COLOR.bgElev }}>
                  {shortFacet(facet)}
                </td>
                {grid.capabilities.map((cap) => {
                  const cell = cellOf.get(`${facet}:${cap}`);
                  if (!cell || !cell.required) {
                    return (
                      <td
                        key={cap}
                        style={{
                          borderTop: `1px solid ${COLOR.border}`,
                          borderRight: `1px solid ${COLOR.border}`,
                          textAlign: "center",
                          color: COLOR.textFaint,
                          background: COLOR.bgInput
                        }}
                      >
                        ·
                      </td>
                    );
                  }
                  return <GridCell key={cap} demonstrated={cell.demonstrated} ready={cell.ready} tested={cell.tested} />;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 7, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 10 }}>
        <span style={{ color: COLOR.green }}>● demonstrated</span>
        <span style={{ color: COLOR.cyan }}>◌ tested</span>
        <span style={{ color: COLOR.textFaint }}>· untested / not required</span>
        <Faint>bar = pooled Ready prediction</Faint>
      </div>
      {readiness && (
        <div style={{ marginTop: 10 }}>
          <SectionHeader>Why not ready</SectionHeader>
          <RecipeTree readiness={readiness} />
        </div>
      )}
    </div>
  );
}

// -- Facet evidence drawer (Demonstrated timeline + §5.1 receipt) -------------

// Channel glyphs are never color-only (§4.13): each carries a glyph AND a label.
const CHANNEL_META: Record<
  "direct" | "embedded" | "assisted" | "pooled",
  { glyph: string; label: string; color: string; pill: PillColor }
> = {
  direct: { glyph: "●", label: "direct", color: COLOR.green, pill: "green" },
  embedded: { glyph: "◑", label: "embedded", color: COLOR.cyan, pill: "cyan" },
  assisted: { glyph: "○", label: "assisted (no credit)", color: COLOR.textFaint, pill: "slate" },
  pooled: { glyph: "◇", label: "pooled", color: COLOR.yellow, pill: "amber" },
};

function pointChannel(p: DemonstratedTimelinePointDto): "direct" | "embedded" | "assisted" {
  if (p.assisted) return "assisted";
  const channels = (p.derivation ?? []).map((d) => d.channel);
  if (channels.length > 0 && channels.every((c) => c === "embedded")) return "embedded";
  return "direct";
}

const round3 = (v: number): string => (Math.round(v * 1000) / 1000).toString();

const BOUND_LABEL: Record<string, string> = {
  group_budget: "correlation-group budget",
  attempt_ceiling: "attempt-wide ceiling",
};

// The §5.1 Ready-derivation sentence, template-rendered from ledger ingredients.
function ReadyDerivationLine({ ready }: { ready: ReadyDerivationDto }) {
  const n = ready.directObservationCount;
  const u = ready.unassistedObservationCount;
  const slices = ready.pooledCapabilities.length;
  const days = ready.daysSinceLastEvidence;
  return (
    <div style={{ margin: "8px 0", padding: 8, border: `1px solid ${COLOR.border}`, borderRadius: 4 }}>
      <div style={{ marginBottom: 4 }}>
        <Pill color="amber">ready (pooled recall) {pct(ready.pooledRecallMean)}</Pill>
      </div>
      <div style={{ color: COLOR.text }}>
        {n} direct observation{n === 1 ? "" : "s"} ({u} unassisted)
        {slices > 0 && (
          <>
            , pooled across {slices} capability slice{slices === 1 ? "" : "s"} (
            {ready.pooledCapabilities.map((s) => s.capability).join(", ")})
          </>
        )}
        {days != null && (
          <>
            , last evidence {days} day{days === 1 ? "" : "s"} ago
          </>
        )}
      </div>
      <div style={{ marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
        <Faint>
          β({round3(ready.recallAlpha)}, {round3(ready.recallBeta)}) · independent evidence mass{" "}
          {round3(ready.independentEvidenceMass)}
        </Faint>
      </div>
      {ready.notes.map((note, i) => (
        <div key={i} style={{ marginTop: 2 }}>
          <Faint>· {note}</Faint>
        </div>
      ))}
    </div>
  );
}

// One observation's per-cell derivation (raw vs capped credit + binding rule).
function ObservationDetail({ point }: { point: DemonstratedTimelinePointDto }) {
  const rows = point.derivation ?? [];
  return (
    <div style={{ marginTop: 6, padding: 8, border: `1px solid ${COLOR.borderStrong}`, borderRadius: 4 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ color: COLOR.textDim }}>{point.t}</span>
        {point.isCorrection && <Pill color="red">correction ({point.delta >= 0 ? "+" : ""}{pct(point.delta)})</Pill>}
        {point.primed && <Pill color="amber">primed</Pill>}
        <Faint>attempt {point.attemptId}</Faint>
      </div>
      {rows.length === 0 ? (
        <Faint>{point.assisted ? "assisted — certifies no credit (§5.4)" : "no direct credit this observation"}</Faint>
      ) : (
        rows.map((d, i) => {
          const meta = CHANNEL_META[d.channel];
          return (
            <div
              key={`${d.capability}:${i}`}
              style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline", padding: "2px 0", fontVariantNumeric: "tabular-nums" }}
            >
              <span style={{ color: meta.color, width: 14, textAlign: "center" }}>{meta.glyph}</span>
              <Pill color="slate">{d.capability}</Pill>
              <Pill color={meta.pill}>{meta.label}</Pill>
              <span style={{ color: COLOR.textDim }}>
                credit {round3(d.cappedCredit)}
                {d.rawCredit !== d.cappedCredit && (
                  <span style={{ color: COLOR.textFaint }}> (staged {round3(d.rawCredit)})</span>
                )}
              </span>
              {d.boundBy.length > 0 && (
                <Faint>bound by {d.boundBy.map((b) => BOUND_LABEL[b] ?? b).join(" + ")}</Faint>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// The evidence scrubber (§5.1): each observation a keyboard-reachable tick.
function EvidenceScrubber({
  points,
  selected,
  onSelect,
}: {
  points: DemonstratedTimelinePointDto[];
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  if (!points.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "6px 0" }} role="group" aria-label="Evidence observations">
      {points.map((p, i) => {
        const channel = pointChannel(p);
        const meta = CHANNEL_META[channel];
        const isSel = selected === i;
        const label = `${p.t}, ${meta.label}${p.isCorrection ? ", correction" : ""}${p.primed ? ", primed" : ""}`;
        return (
          <button
            key={`${p.attemptId}:${p.t}:${i}`}
            type="button"
            onClick={() => onSelect(i)}
            aria-pressed={isSel}
            aria-label={label}
            title={label}
            style={{
              fontFamily: FONT_MONO,
              cursor: "pointer",
              background: isSel ? COLOR.bgElev : "transparent",
              border: `1px solid ${isSel ? COLOR.borderStrong : COLOR.border}`,
              borderRadius: 3,
              padding: "1px 5px",
              color: meta.color,
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <span>{meta.glyph}</span>
            {p.isCorrection && <span style={{ color: COLOR.red }}>▲</span>}
          </button>
        );
      })}
    </div>
  );
}

function ScrubberLegend() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "2px 0 6px" }}>
      {(["direct", "embedded", "assisted"] as const).map((c) => (
        <span key={c} style={{ display: "inline-flex", gap: 4, alignItems: "baseline" }}>
          <span style={{ color: CHANNEL_META[c].color }}>{CHANNEL_META[c].glyph}</span>
          <Faint>{CHANNEL_META[c].label}</Faint>
        </span>
      ))}
      <span style={{ display: "inline-flex", gap: 4, alignItems: "baseline" }}>
        <span style={{ color: COLOR.red }}>▲</span>
        <Faint>correction</Faint>
      </span>
    </div>
  );
}

function DemonstratedCurve({ timeline }: { timeline: FacetEvidenceTimelineDto }) {
  const points = timeline.points;
  if (!points.length) return <Faint>No demonstrated evidence yet.</Faint>;
  const w = 320;
  const h = 70;
  const pad = 6;
  const maxV = Math.max(1e-6, ...points.map((p) => p.demonstrated));
  const xs = (i: number) => (points.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (points.length - 1));
  const ys = (v: number) => h - pad - (v / maxV) * (h - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(p.demonstrated).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }} role="img" aria-label="Demonstrated curve">
      <path d={path} fill="none" stroke={COLOR.green} strokeWidth={1.5} />
      {points.map((p, i) => (
        <circle
          key={`${p.attemptId}:${p.t}:${i}`}
          cx={xs(i)}
          cy={ys(p.demonstrated)}
          r={p.isCorrection ? 3.5 : 2}
          fill={p.isCorrection ? COLOR.red : COLOR.green}
        >
          <title>
            {p.t} · demonstrated {pct(p.demonstrated)}
            {p.isCorrection ? ` · correction (${p.delta >= 0 ? "+" : ""}${pct(p.delta)})` : ""}
            {p.assisted ? " · assisted (no credit)" : ""}
          </title>
        </circle>
      ))}
    </svg>
  );
}

export function FacetEvidenceReceipt({ facetId }: { facetId: string }) {
  const [timeline, setTimeline] = useState<FacetEvidenceTimelineDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setTimeline(null);
    setError(null);
    setSelected(null);
    api
      .getFacetEvidenceTimeline(facetId)
      .then((t) => alive && setTimeline(t))
      .catch((e) => alive && setError(e?.message ?? "failed to load timeline"));
    return () => {
      alive = false;
    };
  }, [facetId]);

  const corrections = timeline?.points.filter((p) => p.isCorrection) ?? [];
  const latestCaps = timeline?.points.length
    ? timeline.points[timeline.points.length - 1].demonstratedCapabilities
    : [];

  return (
    <div style={{ fontFamily: FONT_MONO }}>
      {error && <Dim>{error}</Dim>}
      {timeline && (
        <>
          <div style={{ margin: "6px 0" }}>
            <Pill color="green">demonstrated {pct(timeline.demonstrated)}</Pill>{" "}
            {corrections.length > 0 && <Pill color="red">{corrections.length} correction{corrections.length === 1 ? "" : "s"}</Pill>}{" "}
            {!timeline.supported && <Faint>legacy vault — no capability ledger</Faint>}
          </div>
          {timeline.ready && <ReadyDerivationLine ready={timeline.ready} />}
          <Dim>
            Demonstrated curve (an exact fold over the immutable evidence ledger; corrections step
            it and may go down)
          </Dim>
          <div style={{ margin: "6px 0" }}>
            <DemonstratedCurve timeline={timeline} />
          </div>
          {timeline.points.length > 0 && (
            <div>
              <Faint>evidence (tap an observation for its derivation):</Faint>
              <ScrubberLegend />
              <EvidenceScrubber
                points={timeline.points}
                selected={selected}
                onSelect={(i) => setSelected((prev) => (prev === i ? null : i))}
              />
              {selected != null && timeline.points[selected] && (
                <ObservationDetail point={timeline.points[selected]} />
              )}
            </div>
          )}
          {latestCaps.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              <Faint>capabilities:</Faint>
              {latestCaps.map((cap) => (
                <Pill key={cap} color="cyan">
                  {cap}
                </Pill>
              ))}
            </div>
          )}
          {timeline.countedToward.length > 0 && (
            <div>
              <Faint>also counted toward:</Faint>{" "}
              {timeline.countedToward.map((lo, i) => (
                <span key={lo.learningObjectId} style={{ color: COLOR.amberLink }}>
                  {lo.learningObjectTitle}
                  {i < timeline.countedToward.length - 1 ? ", " : ""}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function FacetEvidenceDrawer({ facetId, onClose }: { facetId: string; onClose: () => void }) {
  return (
    <div
      style={{
        border: `1px solid ${COLOR.borderStrong}`,
        borderRadius: 4,
        padding: 12,
        fontFamily: FONT_MONO,
        background: COLOR.bgElev,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <SectionHeader>Evidence · {shortFacet(facetId)}</SectionHeader>
        <button
          type="button"
          onClick={onClose}
          style={{ fontFamily: FONT_MONO, background: "transparent", border: "none", color: COLOR.textDim, cursor: "pointer" }}
        >
          ✕ close
        </button>
      </div>
      <FacetEvidenceReceipt facetId={facetId} />
    </div>
  );
}
