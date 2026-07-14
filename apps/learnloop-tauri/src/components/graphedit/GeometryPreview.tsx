// Inline geometry-preview overlay. Renders the item-map MDS displacement the
// pending semantic edges would cause: baseline points, arrows to their new
// positions (for points that move more than a small epsilon), and the old→new
// stress. Pure read — driven by api.previewKnowledgeMap's result.

import { useMemo } from "react";
import type { KnowledgeMapPreviewDto } from "../../api/dto";
import { COLOR, FONT_MONO } from "../term";

const PANEL_W = 320;
const PLOT = 240;
const EPS = 0.012; // fraction-of-span movement below which a point is "unmoved"

export function GeometryPreview({
  preview,
  loading,
  error,
  onClose
}: {
  preview: KnowledgeMapPreviewDto | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  // Fit both baseline and proposed points into a shared [0,1] frame so the arrows
  // are drawn in the same coordinate space.
  const frame = useMemo(() => {
    if (!preview) return null;
    const all = [...preview.baseline.points, ...preview.points];
    if (all.length === 0) return null;
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const span = Math.max(spanX, spanY);
    const norm = (x: number, y: number) => ({
      nx: (x - minX) / span,
      ny: (y - minY) / span
    });
    const newById = new Map(preview.points.map((p) => [p.id, p] as const));
    const moves = preview.baseline.points
      .map((base) => {
        const next = newById.get(base.id);
        if (!next) return null;
        const b = norm(base.x, base.y);
        const n = norm(next.x, next.y);
        const dist = Math.hypot(n.nx - b.nx, n.ny - b.ny);
        return { id: base.id, b, n, moved: dist > EPS };
      })
      .filter((m): m is NonNullable<typeof m> => m != null);
    return { moves, movedCount: moves.filter((m) => m.moved).length };
  }, [preview]);

  const px = (v: number) => 12 + v * PLOT;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: PANEL_W,
        zIndex: 15,
        background: COLOR.bgElev,
        border: `1px solid ${COLOR.borderStrong}`,
        boxShadow: "0 6px 20px rgba(0,0,0,0.55)",
        padding: 12,
        fontFamily: FONT_MONO,
        fontSize: 12,
        color: COLOR.text
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: COLOR.amber }}>geometry preview</span>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: COLOR.textDim, cursor: "pointer", font: "inherit" }}
        >
          ✕
        </button>
      </div>
      {loading ? (
        <div style={{ color: COLOR.textFaint, padding: "20px 0" }}>recomputing map…</div>
      ) : error ? (
        <div style={{ color: COLOR.red }}>{error}</div>
      ) : !preview || !frame ? (
        <div style={{ color: COLOR.textFaint }}>no geometry to preview.</div>
      ) : (
        <>
          <svg width={PLOT + 24} height={PLOT + 24} style={{ display: "block", background: COLOR.bg, border: `1px solid ${COLOR.border}` }}>
            <defs>
              <marker id="geo-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={COLOR.amber} />
              </marker>
            </defs>
            {/* baseline points */}
            {frame.moves.map((m) => (
              <circle key={`b-${m.id}`} cx={px(m.b.nx)} cy={px(m.b.ny)} r={2} fill={COLOR.textFaint} />
            ))}
            {/* displacement arrows for moved points */}
            {frame.moves
              .filter((m) => m.moved)
              .map((m) => (
                <g key={`m-${m.id}`}>
                  <line
                    x1={px(m.b.nx)}
                    y1={px(m.b.ny)}
                    x2={px(m.n.nx)}
                    y2={px(m.n.ny)}
                    stroke={COLOR.amber}
                    strokeWidth={1}
                    opacity={0.8}
                    markerEnd="url(#geo-arrow)"
                  />
                  <circle cx={px(m.n.nx)} cy={px(m.n.ny)} r={2.5} fill={COLOR.amber} />
                </g>
              ))}
          </svg>
          <div style={{ marginTop: 8, display: "grid", gap: 3 }}>
            <div>
              <span style={{ color: COLOR.textFaint }}>stress:</span>{" "}
              <span style={{ color: COLOR.textDim }}>{preview.baseline.stress.toFixed(4)}</span>{" "}
              <span style={{ color: COLOR.textFaint }}>→</span>{" "}
              <span style={{ color: preview.stress > preview.baseline.stress ? COLOR.red : COLOR.green }}>
                {preview.stress.toFixed(4)}
              </span>
            </div>
            <div>
              <span style={{ color: COLOR.textFaint }}>points moved:</span>{" "}
              <span style={{ color: COLOR.amber }}>{frame.movedCount}</span>{" "}
              <span style={{ color: COLOR.textFaint }}>/ {frame.moves.length}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
