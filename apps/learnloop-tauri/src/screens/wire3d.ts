import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

// Minimal hand-rolled 3D wireframe projection for the latent-space views
// (facet gravity well, knowledge terrain). No WebGL: everything renders as
// SVG paths, which keeps the vector-terminal look of the rest of the app.
//
// World convention: x/y span the data plane in [-1, 1] and z points up (well
// depths are negative z). The camera yaws around z, pitches between top-down
// (0) and edge-on (~pi/2), and applies a weak perspective so near geometry
// reads slightly larger.

export interface Cam {
  yaw: number;
  pitch: number;
}

export interface Viewport {
  cx: number;
  cy: number;
  scale: number;
  /** Eye distance in world units — bigger = flatter (weaker perspective). */
  persp?: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Signed view depth: larger = closer to the camera. Use for painter sort. */
  depth: number;
  /** Perspective scale at this point — multiply marker sizes by it. */
  k: number;
}

export function project(x: number, y: number, z: number, cam: Cam, view: Viewport): Projected {
  const cyaw = Math.cos(cam.yaw);
  const syaw = Math.sin(cam.yaw);
  const x1 = x * cyaw - y * syaw;
  const y1 = x * syaw + y * cyaw;
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const sy = y1 * cp - z * sp; // screen-vertical (SVG y grows downward)
  const depth = z * cp - y1 * sp; // toward the camera
  const persp = view.persp ?? 5;
  const k = persp / Math.max(0.5, persp - depth);
  return { x: view.cx + x1 * view.scale * k, y: view.cy + sy * view.scale * k, depth, k };
}

/** Depth cue: nearer geometry brighter. `depth` from project(), range ~[-1.4, 1.4]. */
export function depthFade(depth: number, lo = 0.5, hi = 1): number {
  const t = Math.max(0, Math.min(1, (depth + 1.4) / 2.8));
  return lo + (hi - lo) * t;
}

const clampPitch = (value: number) => Math.max(0.25, Math.min(1.4, value));

// Orbit camera: drag rotates yaw/pitch; when idle for a few seconds a very
// slow auto-yaw keeps the 3D shape legible (parallax without babysitting).
// Components call pauseDrift() on marker hover so targets don't slide away
// from the pointer mid-inspection.
export function useOrbitCamera(initial: Cam = { yaw: -0.55, pitch: 0.95 }) {
  const [cam, setCam] = useState<Cam>(initial);
  const drag = useRef<{ startX: number; startY: number; yaw: number; pitch: number } | null>(null);
  const quietUntil = useRef(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - prev);
      prev = now;
      if (!drag.current && now > quietUntil.current) {
        setCam((c) => ({ ...c, yaw: c.yaw + dt * 0.000055 })); // ~full turn / 2min
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pauseDrift = (ms = 2600) => {
    quietUntil.current = performance.now() + ms;
  };

  const onMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    // Stop the webview from starting a text selection on the SVG labels while
    // the pointer is dragged to orbit (belt-and-suspenders with user-select:
    // none, which WebKitGTK doesn't always honor for <text> mid-drag).
    event.preventDefault();
    drag.current = { startX: event.clientX, startY: event.clientY, yaw: cam.yaw, pitch: cam.pitch };
    setDragging(true);
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      setCam({
        yaw: d.yaw + (e.clientX - d.startX) * 0.008,
        pitch: clampPitch(d.pitch + (e.clientY - d.startY) * 0.006)
      });
    };
    const up = () => {
      drag.current = null;
      setDragging(false);
      quietUntil.current = performance.now() + 4000;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return { cam, onMouseDown, pauseDrift, dragging };
}

/** Build an SVG polyline path string from projected points. */
export function polyPath(points: Projected[], close = false): string {
  if (points.length === 0) return "";
  const body = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  return close ? `${body} Z` : body;
}
