import type { KnowledgeMapPoint } from "../api/dto";

// Shared field math for the knowledge map views (2D shaded map and 3D
// terrain): inverse-distance-weighted interpolation of mastery/variance over
// a grid in embedding space, plus a marching-squares frontier in world
// coordinates ([-1, 1] plane) that each view maps into its own screen space.

export interface FieldCell {
  mastery: number;
  variance: number;
  presence: number; // 0..1 confidence that any data is near this cell
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

// IDW interpolation over (gridX+1) x (gridY+1) grid corners. `presence`
// decays away from the data so empty regions stay unshaded instead of
// extrapolating.
export function computeField(points: KnowledgeMapPoint[], gridX: number, gridY: number): FieldCell[][] {
  const known = points.filter((p) => p.mastery != null);
  const nodes: FieldCell[][] = [];
  for (let gy = 0; gy <= gridY; gy += 1) {
    const row: FieldCell[] = [];
    const y = -1 + (2 * gy) / gridY;
    for (let gx = 0; gx <= gridX; gx += 1) {
      const x = -1 + (2 * gx) / gridX;
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

export interface WorldSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Marching squares over the interpolated field: segments (in world coords)
// where mastery crosses `level`, skipped in low-presence cells (a contour
// through empty space is interpolation noise, not knowledge).
export function frontierSegmentsWorld(
  nodes: FieldCell[][],
  gridX: number,
  gridY: number,
  level: number,
  minPresence = 0.12
): WorldSegment[] {
  const segments: WorldSegment[] = [];
  const nodeWorld = (gx: number, gy: number) => ({ x: -1 + (2 * gx) / gridX, y: -1 + (2 * gy) / gridY });
  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, va: number, vb: number) => {
    const t = va === vb ? 0.5 : (level - va) / (vb - va);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  for (let gy = 0; gy < gridY; gy += 1) {
    for (let gx = 0; gx < gridX; gx += 1) {
      const c = [nodes[gy][gx], nodes[gy][gx + 1], nodes[gy + 1][gx + 1], nodes[gy + 1][gx]]; // tl tr br bl
      if (Math.min(c[0].presence, c[1].presence, c[2].presence, c[3].presence) < minPresence) continue;
      const p = [nodeWorld(gx, gy), nodeWorld(gx + 1, gy), nodeWorld(gx + 1, gy + 1), nodeWorld(gx, gy + 1)];
      const v = c.map((cell) => cell.mastery);
      const above = v.map((value) => value >= level);
      const crossings: Array<{ x: number; y: number }> = [];
      const edges: Array<[number, number]> = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0]
      ];
      for (const [i, j] of edges) {
        if (above[i] !== above[j]) crossings.push(lerp(p[i], p[j], v[i], v[j]));
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

// Bilinear sample of the field at a world coordinate — used to sit item pins
// on the terrain surface.
export function sampleField(nodes: FieldCell[][], gridX: number, gridY: number, x: number, y: number): FieldCell {
  const fx = clamp01((x + 1) / 2) * gridX;
  const fy = clamp01((y + 1) / 2) * gridY;
  const gx = Math.min(gridX - 1, Math.floor(fx));
  const gy = Math.min(gridY - 1, Math.floor(fy));
  const tx = fx - gx;
  const ty = fy - gy;
  const mix = (key: keyof FieldCell) => {
    const a = nodes[gy][gx][key] * (1 - tx) + nodes[gy][gx + 1][key] * tx;
    const b = nodes[gy + 1][gx][key] * (1 - tx) + nodes[gy + 1][gx + 1][key] * tx;
    return a * (1 - ty) + b * ty;
  };
  return { mastery: mix("mastery"), variance: mix("variance"), presence: mix("presence") };
}
