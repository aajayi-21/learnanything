import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { KnowledgeMapPoint, KnowledgeMapSnapshot } from "../api/dto";
import { EntityLink } from "../components/ui";
import { COLOR, Dim, Faint, FONT_MONO, KeyBar, Meta, Pill, SectionHeader } from "../components/term";
import { masteryTone } from "../app/algoConfig";

// Knowledge map: a deterministic 2D similarity embedding of every practice
// item (classical MDS over blended facet/concept-graph distances, computed by
// the sidecar). A soft inverse-distance-weighted mastery field shades the
// background — fog (reduced alpha) where local mastery variance is high — and
// an approximate marching-squares frontier is drawn where the interpolated
// field crosses FRONTIER_LEVEL. Interaction mirrors the facet radar: sticky
// hover selection, click to inspect, 0.22s ease transitions.

const W = 860;
const H = 600;
const PAD = 56;
const GRID_X = 48;
const GRID_Y = 32;
const FRONTIER_LEVEL = 0.7;
const EASE = "stroke 0.22s ease, fill 0.22s ease, opacity 0.22s ease, stroke-width 0.22s ease";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function toPx(x: number, y: number): { x: number; y: number } {
  return {
    x: PAD + ((x + 1) / 2) * (W - 2 * PAD),
    y: PAD + ((y + 1) / 2) * (H - 2 * PAD)
  };
}

interface FieldCell {
  mastery: number;
  variance: number;
  presence: number; // 0..1 confidence that any data is near this cell
}

// Inverse-distance-weighted interpolation of mastery/variance over grid nodes
// (GRID_X+1 x GRID_Y+1 corners in embedding space). `presence` decays away
// from the data so empty regions stay unshaded instead of extrapolating.
function computeField(points: KnowledgeMapPoint[]): FieldCell[][] {
  const known = points.filter((p) => p.mastery != null);
  const nodes: FieldCell[][] = [];
  for (let gy = 0; gy <= GRID_Y; gy += 1) {
    const row: FieldCell[] = [];
    const y = -1 + (2 * gy) / GRID_Y;
    for (let gx = 0; gx <= GRID_X; gx += 1) {
      const x = -1 + (2 * gx) / GRID_X;
      let wSum = 0;
      let mSum = 0;
      let vSum = 0;
      for (const p of known) {
        const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
        const w = 1 / (d2 + 0.015);
        wSum += w;
        mSum += w * (p.mastery ?? 0);
        vSum += w * (p.variance ?? 0);
      }
      row.push(
        wSum > 0
          ? { mastery: mSum / wSum, variance: vSum / wSum, presence: clamp01(wSum / (wSum + 25)) }
          : { mastery: 0, variance: 0, presence: 0 }
      );
    }
    nodes.push(row);
  }
  return nodes;
}

// Marching squares over the interpolated field: segments where mastery crosses
// FRONTIER_LEVEL, skipped in low-presence cells (a contour through empty space
// is interpolation noise, not knowledge).
function frontierSegments(nodes: FieldCell[][]): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const nodePx = (gx: number, gy: number) => toPx(-1 + (2 * gx) / GRID_X, -1 + (2 * gy) / GRID_Y);
  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, va: number, vb: number) => {
    const t = va === vb ? 0.5 : (FRONTIER_LEVEL - va) / (vb - va);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  for (let gy = 0; gy < GRID_Y; gy += 1) {
    for (let gx = 0; gx < GRID_X; gx += 1) {
      const c = [nodes[gy][gx], nodes[gy][gx + 1], nodes[gy + 1][gx + 1], nodes[gy + 1][gx]]; // tl tr br bl
      if (Math.min(c[0].presence, c[1].presence, c[2].presence, c[3].presence) < 0.12) continue;
      const p = [nodePx(gx, gy), nodePx(gx + 1, gy), nodePx(gx + 1, gy + 1), nodePx(gx, gy + 1)];
      const v = c.map((cell) => cell.mastery);
      const above = v.map((value) => value >= FRONTIER_LEVEL);
      const edgePoint = (i: number, j: number) => lerp(p[i], p[j], v[i], v[j]);
      const crossings: Array<{ x: number; y: number }> = [];
      const edges: Array<[number, number]> = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0]
      ];
      for (const [i, j] of edges) {
        if (above[i] !== above[j]) crossings.push(edgePoint(i, j));
      }
      // 0, 2 or 4 crossings; pair them in order (the saddle ambiguity is fine
      // for a dashed "approximate frontier").
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        segments.push({ x1: crossings[k].x, y1: crossings[k].y, x2: crossings[k + 1].x, y2: crossings[k + 1].y });
      }
    }
  }
  return segments;
}

export function KnowledgeMapView({ onInspect, onError }: { onInspect: (id: string) => void; onError: (message: string) => void }) {
  const [snapshot, setSnapshot] = useState<KnowledgeMapSnapshot | null>(null);
  // Sticky hover selection, same convention as the facet radar: the last point
  // touched stays selected until another one is hovered/clicked.
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getKnowledgeMap()
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data);
        setSelected((current) => current ?? data.points[0]?.id ?? null);
      })
      .catch((error) => {
        if (!cancelled) onError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const points = snapshot?.points ?? [];
  const field = useMemo(() => computeField(points), [points]);
  const frontier = useMemo(() => frontierSegments(field), [field]);

  if (!snapshot) {
    return <div style={{ padding: 30, color: COLOR.textFaint, fontSize: 13 }}>loading knowledge map…</div>;
  }

  const pointById = new Map(points.map((point) => [point.id, point] as const));
  const active = selected ? pointById.get(selected) ?? null : null;
  const cellW = (W - 2 * PAD) / GRID_X;
  const cellH = (H - 2 * PAD) / GRID_Y;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Canvas */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden", background: COLOR.bg }}>
          {/* Grid backdrop — same treatment as the concept map and radar */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: [
                `linear-gradient(to right, ${COLOR.border} 1px, transparent 1px)`,
                `linear-gradient(to bottom, ${COLOR.border} 1px, transparent 1px)`,
              ].join(", "),
              backgroundSize: "24px 24px",
              opacity: 0.22,
              pointerEvents: "none"
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `radial-gradient(circle at 0 0, ${COLOR.border} 1.5px, transparent 1.5px)`,
              backgroundSize: "24px 24px",
              opacity: 0.5,
              pointerEvents: "none"
            }}
          />
          <div className="ll-scroll" style={{ position: "absolute", inset: 0, overflow: "auto", padding: 24 }}>
            <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ color: COLOR.amber, fontSize: 13 }}>knowledge-map</span>{" "}
                <Meta>
                  {snapshot.counts.items} items · {snapshot.counts.concepts} concepts
                </Meta>
              </div>
              <div style={{ fontSize: 12 }}>
                <Faint>stress {snapshot.stress.toFixed(2)}</Faint>
              </div>
            </div>

            {points.length === 0 ? (
              <div style={{ color: COLOR.textFaint, fontSize: 13, padding: 30 }}>no practice items yet</div>
            ) : (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ fontFamily: FONT_MONO, maxWidth: "100%", height: "auto" }}>
                  {/* Mastery field: IDW-shaded cells, fogged (lower alpha) where
                      local mastery variance is high — bright green regions are
                      confidently known, dim/absent regions are unexplored. */}
                  {field.slice(0, GRID_Y).map((row, gy) =>
                    row.slice(0, GRID_X).map((_, gx) => {
                      // average the four corners for the cell fill
                      const corners = [field[gy][gx], field[gy][gx + 1], field[gy + 1][gx + 1], field[gy + 1][gx]];
                      const mastery = corners.reduce((sum, c) => sum + c.mastery, 0) / 4;
                      const variance = corners.reduce((sum, c) => sum + c.variance, 0) / 4;
                      const presence = corners.reduce((sum, c) => sum + c.presence, 0) / 4;
                      const fog = clamp01(1 / (1 + 14 * variance));
                      const alpha = 0.26 * presence * fog;
                      if (alpha < 0.01) return null;
                      const origin = toPx(-1 + (2 * gx) / GRID_X, -1 + (2 * gy) / GRID_Y);
                      return (
                        <rect
                          key={`cell-${gx}-${gy}`}
                          x={origin.x}
                          y={origin.y}
                          width={cellW + 0.5}
                          height={cellH + 0.5}
                          fill={masteryTone(mastery, COLOR)}
                          opacity={alpha}
                          shapeRendering="crispEdges"
                        />
                      );
                    })
                  )}
                  {/* Approximate mastery frontier (field crosses {FRONTIER_LEVEL}) */}
                  {frontier.map((seg, index) => (
                    <line
                      key={`frontier-${index}`}
                      x1={seg.x1}
                      y1={seg.y1}
                      x2={seg.x2}
                      y2={seg.y2}
                      stroke={COLOR.amber}
                      strokeWidth={1.2}
                      strokeDasharray="5 4"
                      opacity={0.85}
                    />
                  ))}
                  {/* Practice-item markers */}
                  {points.map((point) => {
                    const p = toPx(point.x, point.y);
                    const isActive = point.id === selected;
                    const tone = point.mastery != null ? masteryTone(point.mastery, COLOR) : COLOR.textFaint;
                    const size = isActive ? 6 : 4.5;
                    const tooltip = [
                      point.title,
                      point.learningObjectId,
                      point.mastery != null ? `mastery ${point.mastery.toFixed(2)}` : "mastery —",
                      point.difficulty != null ? `difficulty ${point.difficulty.toFixed(2)}` : null,
                      point.isProbe ? "probe" : null,
                      point.queued ? "queued" : null
                    ]
                      .filter(Boolean)
                      .join("\n");
                    return (
                      <g
                        key={point.id}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => setSelected(point.id)}
                        onClick={() => onInspect(point.id)}
                      >
                        <circle cx={p.x} cy={p.y} r={11} fill="transparent" />
                        {point.isProbe ? (
                          <path
                            d={`M ${p.x} ${p.y - (size + 1.5)} L ${p.x + size + 1.5} ${p.y} L ${p.x} ${p.y + (size + 1.5)} L ${p.x - (size + 1.5)} ${p.y} Z`}
                            fill={COLOR.red}
                            stroke={isActive ? COLOR.text : "transparent"}
                            strokeWidth={1}
                            style={{ transition: EASE }}
                          />
                        ) : (
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={size}
                            fill={tone}
                            stroke={isActive ? COLOR.text : "transparent"}
                            strokeWidth={1}
                            style={{ transition: EASE }}
                          />
                        )}
                        {point.queued ? (
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={size + 3.5}
                            fill="none"
                            stroke={point.isProbe ? COLOR.red : tone}
                            strokeWidth={0.9}
                            opacity={0.85}
                            style={{ transition: EASE }}
                          />
                        ) : null}
                        <title>{tooltip}</title>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </div>
        </div>

        <PointDetail point={active} onInspect={onInspect} />
      </div>

      <div
        style={{
          display: "flex",
          gap: 18,
          padding: "8px 14px",
          borderTop: `1px solid ${COLOR.border}`,
          fontSize: 12,
          color: COLOR.textDim,
          background: COLOR.bg,
          flexShrink: 0,
          flexWrap: "wrap"
        }}
      >
        <Faint>markers:</Faint>
        <span style={{ color: COLOR.green }}>● mastered item</span>
        <span style={{ color: COLOR.red }}>◆ probe</span>
        <span style={{ color: COLOR.textDim }}>◎ queued</span>
        <span style={{ color: COLOR.amber }}>╌╌ frontier ≈ {FRONTIER_LEVEL.toFixed(1)}</span>
        <Dim>shade = mastery field, fog = uncertainty</Dim>
        <span style={{ flex: 1 }} />
        <Faint>similarity map — distances are approximate</Faint>
      </div>

      <KeyBar
        keys={[
          { key: "hover", label: "Select item" },
          { key: "click", label: "Inspect" }
        ]}
        right={{ key: "^p", label: "palette" }}
      />
    </div>
  );
}

function PointDetail({ point, onInspect }: { point: KnowledgeMapPoint | null; onInspect: (id: string) => void }) {
  if (!point) {
    return (
      <div style={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${COLOR.border}`, background: COLOR.bg, padding: "16px 18px", color: COLOR.textFaint, fontSize: 13 }}>
        hover a point
      </div>
    );
  }
  const tone = point.mastery != null ? masteryTone(point.mastery, COLOR) : COLOR.textFaint;
  const stat = (label: string, value: string | null, color?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontSize: 12 }}>
      <Faint>{label}</Faint>
      <span style={{ color: color ?? COLOR.text, fontFamily: FONT_MONO }}>{value ?? "—"}</span>
    </div>
  );
  return (
    <div className="ll-scroll" style={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${COLOR.border}`, background: COLOR.bg, overflowY: "auto", padding: "16px 18px", fontSize: 13 }}>
      <div style={{ fontSize: 11, color: COLOR.textFaint, marginBottom: 4 }}>practice item</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: COLOR.text }}>{point.title}</div>
      <div style={{ marginTop: 6 }}>
        <EntityLink id={point.id} onInspect={onInspect}>
          <Meta>{point.id}</Meta>
        </EntityLink>
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {point.isProbe ? <Pill color="red">probe</Pill> : null}
        {point.queued ? <Pill color="cyan">queued</Pill> : null}
      </div>

      <SectionHeader>Belief</SectionHeader>
      {stat("mastery (LO)", point.mastery != null ? point.mastery.toFixed(2) : null, tone)}
      {stat("variance", point.variance != null ? point.variance.toFixed(3) : null)}
      {stat("p(correct)", point.predictedCorrect != null ? point.predictedCorrect.toFixed(2) : null)}
      {stat("difficulty", point.difficulty != null ? point.difficulty.toFixed(2) : null)}

      <SectionHeader>Location</SectionHeader>
      <div style={{ fontSize: 12, padding: "3px 0" }}>
        <Faint>learning object</Faint>
        <div>
          <EntityLink id={point.learningObjectId} onInspect={onInspect}>
            <Meta>{point.learningObjectId}</Meta>
          </EntityLink>
        </div>
      </div>
      {point.conceptId ? (
        <div style={{ fontSize: 12, padding: "3px 0" }}>
          <Faint>concept</Faint>
          <div>
            <EntityLink id={point.conceptId} onInspect={onInspect}>
              <Meta>{point.conceptId}</Meta>
            </EntityLink>
          </div>
        </div>
      ) : null}

      <SectionHeader>Top facets</SectionHeader>
      {point.facets.length === 0 ? <Faint>none declared</Faint> : null}
      {point.facets.map((facet) => (
        <div key={facet} style={{ fontSize: 12, padding: "2px 0", color: COLOR.textDim, overflowWrap: "anywhere" }}>
          {facet}
        </div>
      ))}
    </div>
  );
}
