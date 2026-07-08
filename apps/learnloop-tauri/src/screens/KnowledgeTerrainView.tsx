import { useMemo } from "react";
import type { KnowledgeMapPoint } from "../api/dto";
import { COLOR, FONT_MONO } from "../components/term";
import { masteryBand, masteryTone } from "../app/algoConfig";
import { computeField, frontierSegmentsWorld, sampleField } from "./knowledgeField";
import { depthFade, project, useOrbitCamera } from "./wire3d";

// 3D "mastery terrain" rendering of the knowledge map — the toggle
// counterpart of the 2D shaded embedding. The same IDW mastery field becomes
// a height field (z = HEIGHT · mastery, gated by data presence so empty
// embedding regions stay flat void instead of extrapolated hills), drawn as a
// wireframe surface of row/column polylines colored by mastery band and
// dimmed where the diagnostic posterior is foggy (high variance). The mastery
// frontier is the bold amber contour where the field crosses FRONTIER_LEVEL —
// a level ring around the highlands. Practice items stand on the surface as
// pins: tone-colored heads, red probe diamonds, queued halos.

const W = 860;
const H = 600;
const CX = W / 2;
const CY = H / 2 + 36;
const SCALE = 238;
const HEIGHT = 0.62;
const GX = 40;
const GY = 28;
const FRONTIER_LEVEL = 0.7;
const MIN_PRESENCE = 0.05;
const EASE = "stroke 0.22s ease, fill 0.22s ease, opacity 0.22s ease, stroke-width 0.22s ease";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

// Height ramp on presence: full mastery height only where the field actually
// has nearby data; sparse fringes settle toward the floor.
const presenceRamp = (presence: number) => clamp01((presence - 0.03) / 0.3);

type ToneBand = "strong" | "developing" | "weak";

interface WireSegment {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  band: ToneBand;
  foggy: boolean;
}

interface TerrainGeometry {
  segments: WireSegment[];
  frontier: Array<{ ax: number; ay: number; az: number; bx: number; by: number; bz: number }>;
  items: Array<{ point: KnowledgeMapPoint; x: number; y: number; zBase: number; zTop: number }>;
}

function buildGeometry(points: KnowledgeMapPoint[]): TerrainGeometry {
  const field = computeField(points, GX, GY);
  const world = (gx: number, gy: number) => ({ x: -1 + (2 * gx) / GX, y: -1 + (2 * gy) / GY });
  const heightOf = (gx: number, gy: number) => {
    const cell = field[gy][gx];
    return HEIGHT * cell.mastery * presenceRamp(cell.presence);
  };

  const segments: WireSegment[] = [];
  const pushSegment = (gx0: number, gy0: number, gx1: number, gy1: number) => {
    const a = field[gy0][gx0];
    const b = field[gy1][gx1];
    if (Math.min(a.presence, b.presence) < MIN_PRESENCE) return;
    const pa = world(gx0, gy0);
    const pb = world(gx1, gy1);
    const midMastery = (a.mastery + b.mastery) / 2;
    const midVariance = (a.variance + b.variance) / 2;
    segments.push({
      ax: pa.x,
      ay: pa.y,
      az: heightOf(gx0, gy0),
      bx: pb.x,
      by: pb.y,
      bz: heightOf(gx1, gy1),
      band: masteryBand(midMastery),
      foggy: 1 / (1 + 14 * midVariance) < 0.55
    });
  };
  for (let gy = 0; gy <= GY; gy += 1) for (let gx = 0; gx < GX; gx += 1) pushSegment(gx, gy, gx + 1, gy);
  for (let gx = 0; gx <= GX; gx += 1) for (let gy = 0; gy < GY; gy += 1) pushSegment(gx, gy, gx, gy + 1);

  const frontier = frontierSegmentsWorld(field, GX, GY, FRONTIER_LEVEL).map((seg) => {
    const za = HEIGHT * FRONTIER_LEVEL * presenceRamp(sampleField(field, GX, GY, seg.x1, seg.y1).presence);
    const zb = HEIGHT * FRONTIER_LEVEL * presenceRamp(sampleField(field, GX, GY, seg.x2, seg.y2).presence);
    return { ax: seg.x1, ay: seg.y1, az: za + 0.004, bx: seg.x2, by: seg.y2, bz: zb + 0.004 };
  });

  const items = points.map((point) => {
    const cell = sampleField(field, GX, GY, point.x, point.y);
    const zBase = HEIGHT * cell.mastery * presenceRamp(cell.presence);
    return { point, x: point.x, y: point.y, zBase, zTop: zBase + 0.09 };
  });

  return { segments, frontier, items };
}

const TONE_COLOR: Record<ToneBand, string> = {
  strong: COLOR.green,
  developing: COLOR.amber,
  weak: COLOR.red
};

export function KnowledgeTerrainView({
  points,
  selected,
  onSelect,
  onInspect
}: {
  points: KnowledgeMapPoint[];
  selected: string | null;
  onSelect: (id: string) => void;
  onInspect: (id: string) => void;
}) {
  const { cam, onMouseDown, pauseDrift, dragging } = useOrbitCamera({ yaw: -0.62, pitch: 1.02 });
  const geometry = useMemo(() => buildGeometry(points), [points]);

  const view = { cx: CX, cy: CY, scale: SCALE, persp: 5.6 };
  const proj = (x: number, y: number, z: number) => project(x, y, z, cam, view);

  // Group wire segments into a handful of <path> elements — keyed by mastery
  // band, fog and a coarse depth bucket — so React reconciles ~18 paths per
  // frame instead of thousands of lines.
  const wireGroups = useMemo(() => {
    const groups = new Map<string, { color: string; opacity: number; d: string[] }>();
    for (const seg of geometry.segments) {
      const a = proj(seg.ax, seg.ay, seg.az);
      const b = proj(seg.bx, seg.by, seg.bz);
      const midDepth = (a.depth + b.depth) / 2;
      const depthBucket = Math.max(0, Math.min(2, Math.floor(depthFade(midDepth, 0, 1) * 3)));
      const key = `${seg.band}|${seg.foggy ? "fog" : "clear"}|${depthBucket}`;
      let group = groups.get(key);
      if (!group) {
        const base = seg.foggy ? 0.16 : 0.42;
        group = { color: TONE_COLOR[seg.band], opacity: base * (0.55 + 0.28 * depthBucket), d: [] };
        groups.set(key, group);
      }
      group.d.push(`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
    }
    return [...groups.entries()].map(([key, group]) => ({ key, ...group, d: group.d.join(" ") }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, cam.yaw, cam.pitch]);

  const frontierPath = geometry.frontier
    .map((seg) => {
      const a = proj(seg.ax, seg.ay, seg.az);
      const b = proj(seg.bx, seg.by, seg.bz);
      return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    })
    .join(" ");

  // Floor border: the [-1, 1] embedding plane at z = 0, for orientation.
  const floorCorners = [
    proj(-1, -1, 0),
    proj(1, -1, 0),
    proj(1, 1, 0),
    proj(-1, 1, 0)
  ];
  const floorPath = `M ${floorCorners.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")} Z`;

  // Painter-sorted item pins (far first).
  const pins = useMemo(() => {
    return geometry.items
      .map((item) => ({
        item,
        base: proj(item.x, item.y, item.zBase),
        top: proj(item.x, item.y, item.zTop)
      }))
      .sort((a, b) => a.top.depth - b.top.depth);
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
      <path d={floorPath} fill="none" stroke={COLOR.borderStrong} strokeWidth={1} strokeDasharray="2 5" opacity={0.5} />

      {wireGroups.map((group) => (
        <path key={group.key} d={group.d} fill="none" stroke={group.color} strokeWidth={0.8} opacity={group.opacity} />
      ))}

      {/* mastery frontier — the level ring where the field crosses FRONTIER_LEVEL */}
      {frontierPath ? (
        <path d={frontierPath} fill="none" stroke={COLOR.amber} strokeWidth={1.6} strokeDasharray="6 4" opacity={0.9} />
      ) : null}

      {/* practice-item pins standing on the terrain */}
      {pins.map(({ item, base, top }) => {
        const point = item.point;
        const isActive = point.id === selected;
        const tone = point.mastery != null ? masteryTone(point.mastery, COLOR) : COLOR.textFaint;
        const fade = depthFade(top.depth, 0.55, 1);
        const size = (isActive ? 5.5 : 4.2) * top.k;
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
            opacity={isActive ? 1 : fade}
            onMouseEnter={() => {
              onSelect(point.id);
              pauseDrift();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onInspect(point.id);
            }}
          >
            <line x1={base.x} y1={base.y} x2={top.x} y2={top.y} stroke={tone} strokeWidth={isActive ? 1.2 : 0.8} opacity={0.7} />
            <circle cx={base.x} cy={base.y} r={1.4 * base.k} fill={tone} opacity={0.6} />
            <circle cx={top.x} cy={top.y} r={11} fill="transparent" />
            {point.isProbe ? (
              <path
                d={`M ${top.x} ${top.y - (size + 1.3)} L ${top.x + size + 1.3} ${top.y} L ${top.x} ${top.y + (size + 1.3)} L ${top.x - (size + 1.3)} ${top.y} Z`}
                fill={COLOR.red}
                stroke={isActive ? COLOR.text : "transparent"}
                strokeWidth={1}
                style={{ transition: EASE }}
              />
            ) : (
              <circle
                cx={top.x}
                cy={top.y}
                r={size}
                fill={tone}
                stroke={isActive ? COLOR.text : "transparent"}
                strokeWidth={1}
                style={{ transition: EASE }}
              />
            )}
            {point.queued ? (
              <circle
                cx={top.x}
                cy={top.y}
                r={size + 3.2}
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
  );
}
