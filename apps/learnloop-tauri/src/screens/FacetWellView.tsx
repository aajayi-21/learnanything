import { useMemo } from "react";
import type { FacetMasteryFacet } from "../api/dto";
import { COLOR, FONT_MONO } from "../components/term";
import { masteryTone } from "../app/algoConfig";
import { depthFade, polyPath, project, useOrbitCamera, type Projected } from "./wire3d";

// 3D "gravity well" rendering of evidence-facet mastery — the toggle
// counterpart of the 2D radar. The fabric is a polar sheet (rim radius 1,
// z up) displaced downward where mastery is high: each facet is a radial
// wire at its radar angle, the angular mastery field m(θ) interpolates
// between facet masteries, and the sheet depth is
//
//   z(θ, r) = -DEPTH · m_eff(θ, r) · (1 - r)^1.55
//
// with m_eff blending toward the mean mastery near the center so the well
// bottom is single-valued. Well-mastered sectors plunge; unexplored sectors
// stay flat fabric — the frontier is where the equipotential contours bunch.
// Overlays mirror the 2D radar: a bright masteryTone segment along each wire
// out to r = mastery with a bead vertex, an uncertainty sleeve (the 3D analog
// of the variance annulus), item dots / probe diamonds sitting on the fabric
// at r = difficulty, and the amber mastery loop connecting beads.

const W = 860;
const H = 640;
const CX = W / 2;
const CY = H / 2 - 42;
const SCALE = 235;
const DEPTH = 0.85;
const CENTER_BLEND = 0.28;
const PROFILE_POW = 1.55;
const RING_RS = [0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 1];
const CONTOUR_QS = [0.12, 0.24, 0.36, 0.48, 0.6, 0.72]; // fractions of DEPTH
const SPOKE_STEPS = 26;
const EASE = "stroke 0.22s ease, fill 0.22s ease, opacity 0.22s ease, stroke-width 0.22s ease";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (t: number) => t * t * (3 - 2 * t);

type V3 = { x: number; y: number; z: number };

// Same underscore line-breaking as the 2D radar labels (kept local to avoid a
// circular import with FacetRadarScreen).
function labelLines(facetId: string, maxChars = 20): string[] {
  const words = facetId.split("_");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current}_${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(`${current}_`);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

interface WellGeometry {
  rings: V3[][];
  spokes: V3[][]; // one per facet, index-aligned with facets
  midSpokes: V3[][];
  contours: V3[][][]; // per level, list of contiguous runs
  masteryWires: V3[][];
  sleeves: Array<V3[] | null>;
  beads: V3[];
  loop: V3[]; // mastery polygon vertices (the beads, in facet order)
  labels: V3[];
  items: Array<{
    facetIndex: number;
    id: string;
    title: string;
    isProbe: boolean;
    queued: boolean;
    weight: number | null;
    difficulty: number | null;
    pos: V3;
  }>;
}

function buildGeometry(facets: FacetMasteryFacet[], itemFilter: "queue" | "all"): WellGeometry {
  const N = facets.length;
  const angleOf = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const meanM = facets.reduce((sum, f) => sum + f.mastery, 0) / N;

  // Angular mastery field: cosine interpolation between adjacent facets.
  const masteryAt = (theta: number): number => {
    const u = (((theta + Math.PI / 2) / (2 * Math.PI)) * N) % N;
    const uu = u < 0 ? u + N : u;
    const i0 = Math.floor(uu) % N;
    const t = uu - Math.floor(uu);
    const m0 = facets[i0].mastery;
    const m1 = facets[(i0 + 1) % N].mastery;
    const s = (1 - Math.cos(t * Math.PI)) / 2;
    return m0 + (m1 - m0) * s;
  };

  const surfaceZ = (theta: number, r: number): number => {
    const blend = smooth(clamp01(r / CENTER_BLEND));
    const m = meanM + (masteryAt(theta) - meanM) * blend;
    return -DEPTH * m * Math.pow(1 - clamp01(r), PROFILE_POW);
  };

  const polar = (theta: number, r: number, lift = 0): V3 => ({
    x: r * Math.cos(theta),
    y: r * Math.sin(theta),
    z: surfaceZ(theta, r) + lift
  });

  const ASAMP = Math.max(96, Math.min(168, N * 12));
  const thetaAt = (s: number) => -Math.PI / 2 + (s * 2 * Math.PI) / ASAMP;

  const rings = RING_RS.map((r) => {
    const pts: V3[] = [];
    for (let s = 0; s <= ASAMP; s += 1) pts.push(polar(thetaAt(s), r));
    return pts;
  });

  const spokeAt = (theta: number): V3[] => {
    const pts: V3[] = [];
    for (let s = 0; s <= SPOKE_STEPS; s += 1) pts.push(polar(theta, 0.02 + (s / SPOKE_STEPS) * 0.98));
    return pts;
  };
  const spokes = facets.map((_, i) => spokeAt(angleOf(i)));
  const midSpokes = N <= 12 ? facets.map((_, i) => spokeAt(angleOf(i) + Math.PI / N)) : [];

  // Equipotential contours: for each iso-depth level, radially scan each
  // angular sample from the rim inward for the outermost crossing. Sectors
  // shallower than the level produce pen-up gaps (contiguous runs).
  const RFINE = 110;
  const contours = CONTOUR_QS.map((q) => {
    const zL = -DEPTH * q;
    const runs: V3[][] = [];
    let run: V3[] = [];
    for (let s = 0; s <= ASAMP; s += 1) {
      const theta = thetaAt(s);
      let hit: number | null = null;
      let prevR = 1;
      let prevZ = surfaceZ(theta, 1);
      for (let f = 1; f <= RFINE; f += 1) {
        const r = 1 - f / RFINE;
        const z = surfaceZ(theta, r);
        if (z <= zL) {
          const t = prevZ === z ? 0.5 : (zL - prevZ) / (z - prevZ);
          hit = prevR + (r - prevR) * t;
          break;
        }
        prevR = r;
        prevZ = z;
      }
      if (hit == null) {
        if (run.length > 1) runs.push(run);
        run = [];
      } else {
        run.push({ x: hit * Math.cos(theta), y: hit * Math.sin(theta), z: zL });
      }
    }
    if (run.length > 1) runs.push(run);
    return runs;
  });

  const masteryWires = facets.map((facet, i) => {
    const theta = angleOf(i);
    const rEnd = Math.max(0.02, facet.mastery);
    const pts: V3[] = [];
    const steps = 14;
    for (let s = 0; s <= steps; s += 1) pts.push(polar(theta, 0.02 + (s / steps) * (rEnd - 0.02), 0.008));
    return pts;
  });

  const sleeves = facets.map((facet, i) => {
    if (facet.uncertainty <= 0.001) return null;
    const theta = angleOf(i);
    const r0 = Math.max(0.02, clamp01(facet.mastery - facet.uncertainty));
    const r1 = Math.min(1, clamp01(facet.mastery + facet.uncertainty));
    if (r1 - r0 < 0.005) return null;
    const pts: V3[] = [];
    const steps = 10;
    for (let s = 0; s <= steps; s += 1) pts.push(polar(theta, r0 + (s / steps) * (r1 - r0), 0.006));
    return pts;
  });

  const beads = facets.map((facet, i) => polar(angleOf(i), Math.max(0.02, facet.mastery), 0.012));
  const labels = facets.map((_, i) => polar(angleOf(i), 1.16));

  const items: WellGeometry["items"] = [];
  facets.forEach((facet, i) => {
    const theta = angleOf(i);
    const shown = facet.practiceItems.filter((item) => itemFilter === "all" || item.queued);
    shown.forEach((item, itemIndex) => {
      const r = Math.max(0.03, clamp01(item.difficulty ?? 0.5));
      const off = (itemIndex - (shown.length - 1) / 2) * 0.032;
      items.push({
        facetIndex: i,
        id: item.id,
        title: item.title,
        isProbe: item.isProbe,
        queued: item.queued,
        weight: item.weight ?? null,
        difficulty: item.difficulty ?? null,
        pos: {
          x: r * Math.cos(theta) - off * Math.sin(theta),
          y: r * Math.sin(theta) + off * Math.cos(theta),
          z: surfaceZ(theta, r) + 0.02
        }
      });
    });
  });

  return { rings, spokes, midSpokes, contours, masteryWires, sleeves, beads, loop: beads, labels, items };
}

// Split a projected polyline into contiguous runs of similar depth so far
// fabric fades and near fabric stays bright (per-path SVG opacity can't vary
// along the stroke).
function depthRuns(points: Projected[]): Array<{ d: string; opacity: number }> {
  const bucketOf = (depth: number) => Math.max(0, Math.min(2, Math.floor(depthFade(depth, 0, 1) * 3)));
  const runs: Array<{ d: string; opacity: number }> = [];
  let start = 0;
  let bucket = points.length > 1 ? bucketOf((points[0].depth + points[1].depth) / 2) : 0;
  for (let i = 1; i < points.length; i += 1) {
    const b = i + 1 < points.length ? bucketOf((points[i].depth + points[i + 1].depth) / 2) : bucket;
    if (b !== bucket || i === points.length - 1) {
      runs.push({ d: polyPath(points.slice(start, i + 1)), opacity: 0.35 + 0.28 * bucket });
      start = i;
      bucket = b;
    }
  }
  return runs;
}

export function FacetWellView({
  facets,
  selected,
  hoveredItem,
  itemFilter,
  onSelect,
  onHoverItem,
  onInspect,
  lockedFacets,
  onInspectFacet
}: {
  facets: FacetMasteryFacet[];
  selected: string | null;
  hoveredItem: string | null;
  itemFilter: "queue" | "all";
  onSelect: (id: string) => void;
  onHoverItem: (id: string) => void;
  onInspect: (id: string) => void;
  /** Canonical ids of locked facets (§3.4) → padlock ring on the bead. */
  lockedFacets?: Set<string>;
  /** Open the FacetInspector for a facet (bead / wire / label click). */
  onInspectFacet?: (facetId: string) => void;
}) {
  const { cam, onMouseDown, pauseDrift, dragging } = useOrbitCamera({ yaw: -0.5, pitch: 0.98 });
  const geometry = useMemo(() => buildGeometry(facets, itemFilter), [facets, itemFilter]);

  const view = { cx: CX, cy: CY, scale: SCALE, persp: 5.2 };
  const proj = (p: V3) => project(p.x, p.y, p.z, cam, view);

  // Depth-sorted markers (painter order: far first) — beads and item dots.
  const markers = useMemo(() => {
    const beadMarkers = geometry.beads.map((pos, i) => ({ kind: "bead" as const, index: i, p: proj(pos) }));
    const itemMarkers = geometry.items.map((item, i) => ({ kind: "item" as const, index: i, p: proj(item.pos) }));
    return [...beadMarkers, ...itemMarkers].sort((a, b) => a.p.depth - b.p.depth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, cam.yaw, cam.pitch]);

  return (
    <svg
      className="noselect-canvas"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      onMouseDown={onMouseDown}
      style={{
        fontFamily: FONT_MONO,
        maxWidth: "100%",
        height: "auto",
        overflow: "visible",
        cursor: dragging ? "grabbing" : "grab",
        userSelect: "none",
        WebkitUserSelect: "none"
      }}
    >
      {/* equipotential contour rings (iso-depth) — bunch where the well wall
          is steep, i.e. at the frontier between known and unknown sectors */}
      {geometry.contours.map((runs, level) =>
        runs.map((run, ri) => (
          <path
            key={`contour-${level}-${ri}`}
            d={polyPath(run.map(proj))}
            fill="none"
            stroke={COLOR.amber}
            strokeWidth={0.7}
            strokeDasharray="3 3"
            opacity={0.3}
          />
        ))
      )}

      {/* geodesic mesh: distorted rings, depth-faded per run */}
      {geometry.rings.map((ring, ri) => {
        const isRim = RING_RS[ri] === 1;
        return depthRuns(ring.map(proj)).map((run, si) => (
          <path
            key={`ring-${ri}-${si}`}
            d={run.d}
            fill="none"
            stroke={isRim ? COLOR.borderStrong : COLOR.border}
            strokeWidth={isRim ? 1.2 : 0.8}
            opacity={run.opacity * (isRim ? 1.5 : 1)}
          />
        ));
      })}

      {/* fainter mid-sector spokes to densify the fabric */}
      {geometry.midSpokes.map((spoke, i) => (
        <path key={`midspoke-${i}`} d={polyPath(spoke.map(proj))} fill="none" stroke={COLOR.border} strokeWidth={0.7} opacity={0.35} />
      ))}

      {/* facet wires */}
      {geometry.spokes.map((spoke, i) => {
        const facet = facets[i];
        const isActive = facet.facetId === selected;
        return (
          <g key={`spoke-${facet.facetId}`}>
            <path
              d={polyPath(spoke.map(proj))}
              fill="none"
              stroke={isActive ? COLOR.amber : COLOR.borderStrong}
              strokeWidth={isActive ? 1.4 : 0.85}
              opacity={isActive ? 0.95 : 0.7}
              style={{ transition: EASE }}
            />
            {/* invisible wide hit path so the whole wire is hoverable */}
            <path
              d={polyPath(spoke.map(proj))}
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => {
                onSelect(facet.facetId);
                pauseDrift();
              }}
              onClick={() => {
                onSelect(facet.facetId);
                onInspectFacet?.(facet.facetId);
              }}
            />
          </g>
        );
      })}

      {/* mastery loop — the 3D counterpart of the radar polygon */}
      <path
        d={polyPath(geometry.loop.map(proj), true)}
        fill="rgba(227, 160, 99, 0.10)"
        stroke={COLOR.amber}
        strokeWidth={1.3}
        opacity={0.85}
      />

      {/* uncertainty sleeves along each wire */}
      {geometry.sleeves.map((sleeve, i) =>
        sleeve ? (
          <path
            key={`sleeve-${facets[i].facetId}`}
            d={polyPath(sleeve.map(proj))}
            fill="none"
            stroke={COLOR.amber}
            strokeWidth={6}
            strokeLinecap="round"
            opacity={facets[i].facetId === selected ? 0.28 : 0.15}
            style={{ transition: EASE }}
          />
        ) : null
      )}

      {/* bright mastery segment along each wire (center → r = mastery) */}
      {geometry.masteryWires.map((wire, i) => {
        const facet = facets[i];
        const tone = masteryTone(facet.mastery, COLOR);
        const isActive = facet.facetId === selected;
        return (
          <path
            key={`mwire-${facet.facetId}`}
            d={polyPath(wire.map(proj))}
            fill="none"
            stroke={tone}
            strokeWidth={isActive ? 2.6 : 1.9}
            strokeLinecap="round"
            opacity={isActive ? 1 : 0.85}
            style={{ transition: EASE, filter: isActive ? `drop-shadow(0 0 5px ${tone})` : undefined }}
          />
        );
      })}

      {/* labels at the rim */}
      {geometry.labels.map((pos, i) => {
        const facet = facets[i];
        const p = proj(pos);
        const isActive = facet.facetId === selected;
        const hasGap = facet.stateCounts.knownGap > 0;
        const locked = lockedFacets?.has(facet.facetId) ?? false;
        const anchor = Math.abs(p.x - CX) < 14 ? "middle" : p.x > CX ? "start" : "end";
        const lines = labelLines(facet.facetId);
        const LINE_H = 12;
        const blockShift = p.y > CY + 10 ? 4 : -((lines.length - 1) * LINE_H) / 2;
        const fade = depthFade(p.depth, 0.55, 1);
        return (
          <g
            key={`label-${facet.facetId}`}
            style={{ cursor: "pointer" }}
            opacity={fade}
            onMouseEnter={() => {
              onSelect(facet.facetId);
              pauseDrift();
            }}
            onClick={() => {
              onSelect(facet.facetId);
              onInspectFacet?.(facet.facetId);
            }}
          >
            <text
              x={p.x}
              y={p.y + blockShift}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={10.5}
              fill={isActive ? COLOR.amber : hasGap ? COLOR.red : COLOR.textDim}
              style={{ transition: EASE }}
            >
              {lines.map((line, lineIndex) => (
                <tspan key={lineIndex} x={p.x} dy={lineIndex === 0 ? 0 : LINE_H}>
                  {line}
                </tspan>
              ))}
            </text>
            <text
              x={p.x}
              y={p.y + blockShift + lines.length * LINE_H}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={9.5}
              fill={isActive ? masteryTone(facet.mastery, COLOR) : COLOR.textFaint}
              style={{ transition: EASE }}
            >
              {facet.mastery.toFixed(2)}{locked ? " 🔒" : ""}
            </text>
          </g>
        );
      })}

      {/* depth-sorted markers: mastery beads + item dots / probe diamonds */}
      {markers.map((marker) => {
        if (marker.kind === "bead") {
          const facet = facets[marker.index];
          const tone = masteryTone(facet.mastery, COLOR);
          const isActive = facet.facetId === selected;
          const locked = lockedFacets?.has(facet.facetId) ?? false;
          const size = (isActive ? 5 : 3.6) * marker.p.k;
          return (
            <g
              key={`bead-${facet.facetId}`}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => {
                onSelect(facet.facetId);
                pauseDrift();
              }}
              onClick={() => {
                onSelect(facet.facetId);
                onInspectFacet?.(facet.facetId);
              }}
            >
              {locked ? (
                <circle
                  cx={marker.p.x}
                  cy={marker.p.y}
                  r={size + 3}
                  fill="none"
                  stroke={COLOR.amber}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  opacity={isActive ? 1 : 0.75}
                />
              ) : null}
              <circle
                cx={marker.p.x}
                cy={marker.p.y}
                r={size}
                fill={tone}
                stroke={isActive ? COLOR.text : "transparent"}
                strokeWidth={1}
                opacity={depthFade(marker.p.depth, 0.65, 1)}
                style={{ transition: EASE }}
              >
                <title>{`${facet.facetId} · mastery ${facet.mastery.toFixed(2)} · ${facet.practiceItems.length} practice item${facet.practiceItems.length === 1 ? "" : "s"}${locked ? "\n🔒 locked facet" : ""}`}</title>
              </circle>
            </g>
          );
        }
        const item = geometry.items[marker.index];
        const facet = facets[item.facetIndex];
        const isHovered = hoveredItem === item.id;
        const opacity = (0.4 + 0.55 * clamp01(item.weight ?? 1)) * depthFade(marker.p.depth, 0.6, 1);
        const size = (item.queued ? 4 : 3.2) * marker.p.k;
        const tooltip = `${item.title}\ndifficulty ${(item.difficulty ?? 0.5).toFixed(2)}${item.difficulty == null ? " (default)" : ""}${item.isProbe ? " · probe" : ""}${item.queued ? " · queued" : ""}`;
        return (
          <g
            key={`item-${facet.facetId}-${item.id}`}
            style={{ cursor: "pointer" }}
            opacity={isHovered ? 1 : opacity}
            onMouseEnter={() => {
              onSelect(facet.facetId);
              onHoverItem(item.id);
              pauseDrift();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onInspect(item.id);
            }}
          >
            <circle cx={marker.p.x} cy={marker.p.y} r={9} fill="transparent" />
            {item.isProbe ? (
              <path
                d={`M ${marker.p.x} ${marker.p.y - (size + 1.4)} L ${marker.p.x + size + 1.4} ${marker.p.y} L ${marker.p.x} ${marker.p.y + (size + 1.4)} L ${marker.p.x - (size + 1.4)} ${marker.p.y} Z`}
                fill={COLOR.red}
                stroke={isHovered ? COLOR.text : "transparent"}
                strokeWidth={1}
                style={{ transition: EASE }}
              />
            ) : (
              <circle
                cx={marker.p.x}
                cy={marker.p.y}
                r={size}
                fill={COLOR.cyan}
                stroke={isHovered ? COLOR.text : "transparent"}
                strokeWidth={1}
                style={{ transition: EASE }}
              />
            )}
            {item.queued ? (
              <circle
                cx={marker.p.x}
                cy={marker.p.y}
                r={size + 3}
                fill="none"
                stroke={item.isProbe ? COLOR.red : COLOR.cyan}
                strokeWidth={0.8}
                opacity={0.8}
                style={{ transition: EASE }}
              />
            ) : null}
            <title>{tooltip}</title>
          </g>
        );
      })}
    </svg>
  );
}
