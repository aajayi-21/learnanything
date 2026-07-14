import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { FacetMasteryFacet, FacetMasterySnapshot } from "../api/dto";
import { EntityLink } from "../components/ui";
import { BlockBar, COLOR, Dim, Faint, FONT_MONO, KeyBar, Meta, Pill, SectionHeader, type PillColor } from "../components/term";
import { masteryTone } from "../app/algoConfig";
import { FacetWellView } from "./FacetWellView";
import { FacetEvidenceDrawer } from "../components/KnowledgeModel";

// Radar ("spider") view of evidence-facet mastery across the vault. Each axis
// is one evidence facet; the polygon radius encodes aggregate mastery for that
// facet. Hover or click an axis to see which practice items test the facet.
// Hover highlights are sticky: the last facet touched stays highlighted until
// another one is hovered/selected, and highlight changes cross-fade via CSS
// transitions instead of snapping.
//
// The "well" mode swaps the flat radar for FacetWellView's 3D gravity well —
// same data, same selection state, drag to orbit.

const W = 860;
const H = 640;
const CX = W / 2;
const CY = H / 2;
const R = 200;
const RINGS = [0.25, 0.5, 0.75, 1];
const LABEL_LINE_H = 13;
const EASE = "stroke 0.22s ease, fill 0.22s ease, opacity 0.22s ease, stroke-width 0.22s ease";

function statePillColor(state: string): PillColor {
  if (state === "solid") return "green";
  if (state === "known_gap" || state === "knownGap") return "red";
  if (state === "uncertain") return "amber";
  return "slate";
}

function axisPoint(index: number, total: number, radius: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}

// Point on an axis at `radius`, nudged `offset` px perpendicular to the spoke
// so multiple item dots at the same difficulty don't stack on one pixel.
function axisPointOffset(index: number, total: number, radius: number, offset: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
  return {
    x: CX + radius * Math.cos(angle) - offset * Math.sin(angle),
    y: CY + radius * Math.sin(angle) + offset * Math.cos(angle)
  };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

// Break a facet id into display lines at underscores so the full id is always
// visible around the radar (no truncation), stacked as compact label lines.
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

export function FacetRadarView({ onInspect, onError }: { onInspect: (id: string) => void; onError: (message: string) => void }) {
  const [snapshot, setSnapshot] = useState<FacetMasterySnapshot | null>(null);
  // Single sticky highlight: hovering a facet selects it and it stays selected
  // after the pointer leaves, so the view never jumps back to the first axis.
  const [selected, setSelected] = useState<string | null>(null);
  // Sticky item highlight (same convention): the last dot hovered stays
  // highlighted in the side panel until another dot is touched.
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  // Default queue-only: showing every authored item clutters the axes; the
  // due queue is what the selection policy actually chose today.
  const [itemFilter, setItemFilter] = useState<"queue" | "all">("queue");
  // Flat radar vs 3D gravity well (radial displacement of the facet fabric).
  const [mode, setMode] = useState<"2d" | "well">("2d");

  useEffect(() => {
    let cancelled = false;
    api
      .getFacetMastery()
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data);
        setSelected((current) => current ?? data.facets[0]?.facetId ?? null);
      })
      .catch((error) => {
        if (!cancelled) onError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const facets = snapshot?.facets ?? [];
  const order = useMemo(() => facets.map((f) => f.facetId), [facets]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (event.key !== "Tab" || order.length === 0) return;
      event.preventDefault();
      const index = selected ? order.indexOf(selected) : -1;
      const next = event.shiftKey ? (index - 1 + order.length) % order.length : (index + 1) % order.length;
      setSelected(order[next]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, selected]);

  if (!snapshot) {
    return <div style={{ padding: 30, color: COLOR.textFaint, fontSize: 13 }}>loading facet mastery…</div>;
  }

  const facetById = new Map(facets.map((facet) => [facet.facetId, facet] as const));
  const activeFacet = selected ? facetById.get(selected) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Canvas */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden", background: COLOR.bg }}>
          {/* Grid backdrop — same treatment as the concept-graph canvas */}
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
                <span style={{ color: COLOR.amber, fontSize: 13 }}>facet-mastery</span>{" "}
                <Meta>{snapshot.counts.facets} evidence facets</Meta>{" "}
                {snapshot.canonicalKeys ? (
                  <Pill color="cyan">canonical · {snapshot.modelVersion}</Pill>
                ) : snapshot.modelVersion ? (
                  <Pill color="slate">{snapshot.modelVersion}</Pill>
                ) : null}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
                <span style={{ display: "flex", gap: 4 }}>
                  <Faint>view:</Faint>
                  {(["2d", "well"] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setMode(id)}
                      style={{
                        background: mode === id ? "#241d12" : "transparent",
                        border: `1px solid ${mode === id ? COLOR.amber : COLOR.border}`,
                        color: mode === id ? COLOR.amber : COLOR.textDim,
                        font: "inherit",
                        fontFamily: FONT_MONO,
                        padding: "1px 8px",
                        cursor: "pointer",
                        transition: "border-color 0.22s ease, color 0.22s ease"
                      }}
                    >
                      {id}
                    </button>
                  ))}
                </span>
                <span style={{ display: "flex", gap: 4 }}>
                  <Faint>items:</Faint>
                  {(["queue", "all"] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setItemFilter(id)}
                      style={{
                        background: itemFilter === id ? "#241d12" : "transparent",
                        border: `1px solid ${itemFilter === id ? COLOR.amber : COLOR.border}`,
                        color: itemFilter === id ? COLOR.amber : COLOR.textDim,
                        font: "inherit",
                        fontFamily: FONT_MONO,
                        padding: "1px 8px",
                        cursor: "pointer",
                        transition: "border-color 0.22s ease, color 0.22s ease"
                      }}
                    >
                      {id}
                    </button>
                  ))}
                </span>
                <span>
                  <Faint>tab/shift+tab</Faint> <Dim>walk facets</Dim>
                </span>
              </div>
            </div>

            {facets.length === 0 ? (
              <div style={{ color: COLOR.textFaint, fontSize: 13, padding: 30 }}>
                no evidence facets yet — facets appear once practice items declare what they test
              </div>
            ) : facets.length < 3 ? (
              <FacetBars facets={facets} selected={selected} onSelect={setSelected} />
            ) : mode === "well" ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <FacetWellView
                  facets={facets}
                  selected={selected}
                  hoveredItem={hoveredItem}
                  itemFilter={itemFilter}
                  onSelect={setSelected}
                  onHoverItem={setHoveredItem}
                  onInspect={onInspect}
                />
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <svg
                  className="noselect-canvas"
                  width={W}
                  height={H}
                  viewBox={`0 0 ${W} ${H}`}
                  style={{ fontFamily: FONT_MONO, maxWidth: "100%", height: "auto", overflow: "visible", userSelect: "none", WebkitUserSelect: "none" }}
                >
                  {/* concentric rings */}
                  {RINGS.map((ring) => (
                    <polygon
                      key={ring}
                      points={facets.map((_, i) => {
                        const p = axisPoint(i, facets.length, R * ring);
                        return `${p.x},${p.y}`;
                      }).join(" ")}
                      fill="none"
                      stroke={COLOR.borderStrong}
                      strokeWidth={ring === 1 ? 1.2 : 0.7}
                      opacity={ring === 1 ? 0.8 : 0.5}
                    />
                  ))}
                  {/* spokes */}
                  {facets.map((facet, i) => {
                    const tip = axisPoint(i, facets.length, R);
                    const isActive = facet.facetId === selected;
                    return (
                      <line
                        key={`spoke-${facet.facetId}`}
                        x1={CX}
                        y1={CY}
                        x2={tip.x}
                        y2={tip.y}
                        stroke={isActive ? COLOR.amber : COLOR.borderStrong}
                        strokeWidth={isActive ? 1.4 : 0.7}
                        opacity={isActive ? 0.9 : 0.55}
                        style={{ transition: EASE }}
                      />
                    );
                  })}
                  {/* variance band: mastery ∓ uncertainty per axis, drawn as an
                      annulus (outer ring minus inner ring, evenodd) beneath the
                      mastery polygon. Fat band = the diagnostic posterior still
                      hesitates on that axis. */}
                  <path
                    d={(() => {
                      const ring = (radius: (f: FacetMasteryFacet) => number, reverse: boolean) => {
                        const pts = facets.map((facet, i) => axisPoint(i, facets.length, R * Math.max(0.02, radius(facet))));
                        if (reverse) pts.reverse();
                        return `M ${pts.map((p) => `${p.x},${p.y}`).join(" L ")} Z`;
                      };
                      return [
                        ring((f) => clamp01(f.mastery + f.uncertainty), false),
                        ring((f) => clamp01(f.mastery - f.uncertainty), true)
                      ].join(" ");
                    })()}
                    fill="rgba(227, 160, 99, 0.10)"
                    fillRule="evenodd"
                    stroke={COLOR.amber}
                    strokeWidth={0.5}
                    strokeOpacity={0.25}
                    style={{ transition: EASE }}
                  />
                  {/* mastery polygon */}
                  <polygon
                    points={facets.map((facet, i) => {
                      const p = axisPoint(i, facets.length, R * Math.max(0.02, facet.mastery));
                      return `${p.x},${p.y}`;
                    }).join(" ")}
                    fill="rgba(227, 160, 99, 0.14)"
                    stroke={COLOR.amber}
                    strokeWidth={1.4}
                  />
                  {/* vertices + hit areas + labels */}
                  {facets.map((facet, i) => {
                    const vertex = axisPoint(i, facets.length, R * Math.max(0.02, facet.mastery));
                    const labelAnchor = axisPoint(i, facets.length, R + 28);
                    const tip = axisPoint(i, facets.length, R);
                    const isActive = facet.facetId === selected;
                    const anchor = Math.abs(labelAnchor.x - CX) < 12 ? "middle" : labelAnchor.x > CX ? "start" : "end";
                    const tone = masteryTone(facet.mastery, COLOR);
                    const hasGap = facet.stateCounts.knownGap > 0;
                    const lines = labelLines(facet.facetId);
                    // Vertically center the label block on its anchor; labels in
                    // the lower half hang downward so they clear the radar rim.
                    const blockShift = labelAnchor.y > CY + 12
                      ? 4
                      : -((lines.length - 1) * LABEL_LINE_H) / 2;
                    return (
                      <g
                        key={facet.facetId}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => setSelected(facet.facetId)}
                        onClick={() => setSelected(facet.facetId)}
                      >
                        {/* invisible wide hit line so the whole axis is hoverable */}
                        <line x1={CX} y1={CY} x2={tip.x} y2={tip.y} stroke="transparent" strokeWidth={18} />
                        <circle
                          cx={vertex.x}
                          cy={vertex.y}
                          r={isActive ? 5 : 3.5}
                          fill={tone}
                          stroke={isActive ? COLOR.text : "transparent"}
                          strokeWidth={1}
                          style={{ transition: EASE }}
                        >
                          <title>{`${facet.facetId} · mastery ${facet.mastery.toFixed(2)} · ${facet.practiceItems.length} practice item${facet.practiceItems.length === 1 ? "" : "s"}`}</title>
                        </circle>
                        <text
                          x={labelAnchor.x}
                          y={labelAnchor.y + blockShift}
                          textAnchor={anchor}
                          dominantBaseline="middle"
                          fontSize={11}
                          fill={isActive ? COLOR.amber : hasGap ? COLOR.red : COLOR.textDim}
                          style={{ transition: EASE }}
                        >
                          {lines.map((line, lineIndex) => (
                            <tspan key={lineIndex} x={labelAnchor.x} dy={lineIndex === 0 ? 0 : LABEL_LINE_H}>
                              {line}
                            </tspan>
                          ))}
                        </text>
                        <text
                          x={labelAnchor.x}
                          y={labelAnchor.y + blockShift + lines.length * LABEL_LINE_H}
                          textAnchor={anchor}
                          dominantBaseline="middle"
                          fontSize={10}
                          fill={isActive ? tone : COLOR.textFaint}
                          style={{ transition: EASE }}
                        >
                          {facet.mastery.toFixed(2)}
                        </text>
                      </g>
                    );
                  })}
                  {/* Item dots: one marker per (facet, item) at radius = authored
                      difficulty. Interpretive point of this overlay — dots just
                      OUTSIDE the mastery polygon are the desirable-difficulty
                      band (slightly harder than current mastery), and probe
                      diamonds should sit on axes with fat uncertainty bands.
                      This view exists to make selection-policy behavior visible:
                      if probes cluster on already-thin axes or the queue only
                      samples inside the polygon, the policy is misbehaving. */}
                  {facets.map((facet, i) => {
                    const shown = facet.practiceItems.filter((item) => itemFilter === "all" || item.queued);
                    return shown.map((item, itemIndex) => {
                      const radius = R * Math.max(0.03, clamp01(item.difficulty ?? 0.5));
                      const offset = (itemIndex - (shown.length - 1) / 2) * 7;
                      const p = axisPointOffset(i, facets.length, radius, offset);
                      const isHovered = hoveredItem === item.id;
                      const opacity = 0.35 + 0.6 * clamp01(item.weight ?? 1);
                      const size = item.queued ? 4 : 3.2;
                      const tooltip = `${item.title}\ndifficulty ${(item.difficulty ?? 0.5).toFixed(2)}${item.difficulty == null ? " (default)" : ""}${item.isProbe ? " · probe" : ""}${item.queued ? " · queued" : ""}`;
                      return (
                        <g
                          key={`dot-${facet.facetId}-${item.id}`}
                          style={{ cursor: "pointer" }}
                          opacity={isHovered ? 1 : opacity}
                          onMouseEnter={() => {
                            setSelected(facet.facetId);
                            setHoveredItem(item.id);
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            onInspect(item.id);
                          }}
                        >
                          {/* generous invisible hit target */}
                          <circle cx={p.x} cy={p.y} r={9} fill="transparent" />
                          {item.isProbe ? (
                            <path
                              d={`M ${p.x} ${p.y - (size + 1.4)} L ${p.x + size + 1.4} ${p.y} L ${p.x} ${p.y + (size + 1.4)} L ${p.x - (size + 1.4)} ${p.y} Z`}
                              fill={COLOR.red}
                              stroke={isHovered ? COLOR.text : "transparent"}
                              strokeWidth={1}
                              style={{ transition: EASE }}
                            />
                          ) : (
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={size}
                              fill={COLOR.cyan}
                              stroke={isHovered ? COLOR.text : "transparent"}
                              strokeWidth={1}
                              style={{ transition: EASE }}
                            />
                          )}
                          {item.queued ? (
                            <circle
                              cx={p.x}
                              cy={p.y}
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
                    });
                  })}
                </svg>
              </div>
            )}
          </div>
        </div>

        <FacetDetail facet={activeFacet} hoveredItem={hoveredItem} onInspect={onInspect} />
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
        <Faint>facet state:</Faint>
        <span style={{ color: COLOR.green }}>solid</span>
        <span style={{ color: COLOR.amber }}>uncertain</span>
        <span style={{ color: COLOR.red }}>known gap</span>
        <span style={{ color: COLOR.textFaint }}>unexamined</span>
        <Faint>markers:</Faint>
        <span style={{ color: COLOR.cyan }}>● item</span>
        <span style={{ color: COLOR.red }}>◆ probe</span>
        <span style={{ color: COLOR.textDim }}>◎ queued</span>
        <span style={{ color: COLOR.amber, opacity: 0.7 }}>▒ ±uncertainty band</span>
        <Faint>dot radius = difficulty</Faint>
        {mode === "well" ? <Faint>well depth = mastery pull · ╌ equipotential</Faint> : null}
        <span style={{ flex: 1 }} />
        <Faint>
          {snapshot.counts.facets} facets · {snapshot.counts.learningObjects} learning objects · {snapshot.counts.practiceItems} practice items
        </Faint>
      </div>

      <KeyBar
        keys={[
          { key: "tab", label: "Next facet" },
          { key: "shift+tab", label: "Prev" },
          { key: "hover/click", label: "Inspect facet" },
          ...(mode === "well" ? [{ key: "drag", label: "Orbit" }] : [])
        ]}
        right={{ key: "^p", label: "palette" }}
      />
    </div>
  );
}

// Fallback when a radar shape is degenerate (fewer than three axes).
function FacetBars({
  facets,
  selected,
  onSelect
}: {
  facets: FacetMasteryFacet[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
      {facets.map((facet) => (
        <div
          key={facet.facetId}
          onMouseEnter={() => onSelect(facet.facetId)}
          onClick={() => onSelect(facet.facetId)}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 120px 44px",
            gap: 10,
            alignItems: "center",
            padding: "8px 12px",
            border: `1px solid ${facet.facetId === selected ? COLOR.amber : COLOR.border}`,
            background: facet.facetId === selected ? "#241d12" : COLOR.bgElev,
            cursor: "pointer",
            fontSize: 12,
            transition: "border-color 0.22s ease, background 0.22s ease"
          }}
        >
          <span style={{ color: COLOR.text, overflowWrap: "anywhere" }}>{facet.facetId}</span>
          <BlockBar value={facet.mastery} width={12} color={masteryTone(facet.mastery, COLOR)} />
          <Dim style={{ textAlign: "right" }}>{facet.mastery.toFixed(2)}</Dim>
        </div>
      ))}
    </div>
  );
}

function FacetDetail({
  facet,
  hoveredItem,
  onInspect
}: {
  facet: FacetMasteryFacet | null;
  hoveredItem: string | null;
  onInspect: (id: string) => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  if (!facet) {
    return (
      <div style={{ width: 360, flexShrink: 0, borderLeft: `1px solid ${COLOR.border}`, background: COLOR.bg, padding: "16px 18px", color: COLOR.textFaint, fontSize: 13 }}>
        hover or select a facet
      </div>
    );
  }
  const tone = masteryTone(facet.mastery, COLOR);
  return (
    <div className="ll-scroll" style={{ width: 360, flexShrink: 0, borderLeft: `1px solid ${COLOR.border}`, background: COLOR.bg, overflowY: "auto", padding: "16px 18px", fontSize: 13 }}>
      <div style={{ fontSize: 11, color: COLOR.textFaint, marginBottom: 4 }}>evidence facet</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: COLOR.text, overflowWrap: "anywhere" }}>{facet.facetId}</div>

      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <BlockBar value={facet.mastery} width={16} color={tone} />
        <span style={{ color: tone, fontFamily: FONT_MONO, fontSize: 13 }}>{facet.mastery.toFixed(2)}</span>
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {facet.stateCounts.solid > 0 ? <Pill color="green">{facet.stateCounts.solid} solid</Pill> : null}
        {facet.stateCounts.uncertain > 0 ? <Pill color="amber">{facet.stateCounts.uncertain} uncertain</Pill> : null}
        {facet.stateCounts.knownGap > 0 ? <Pill color="red">{facet.stateCounts.knownGap} known gap</Pill> : null}
        {facet.stateCounts.unexamined > 0 ? <Pill color="slate">{facet.stateCounts.unexamined} unexamined</Pill> : null}
      </div>

      {/* KM3b §9.6: the facet evidence drawer + Demonstrated timeline. */}
      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          onClick={() => setShowEvidence((v) => !v)}
          style={{
            fontFamily: FONT_MONO,
            fontSize: 12,
            background: "transparent",
            border: `1px solid ${COLOR.border}`,
            borderRadius: 3,
            color: COLOR.amberLink,
            padding: "3px 10px",
            cursor: "pointer",
          }}
        >
          {showEvidence ? "▾" : "▸"} evidence timeline
        </button>
        {showEvidence && (
          <div style={{ marginTop: 8 }}>
            <FacetEvidenceDrawer facetId={facet.facetId} onClose={() => setShowEvidence(false)} />
          </div>
        )}
      </div>

      {(facet.questionCount ?? 0) > 0 ? (
        <div style={{ marginTop: 8, fontSize: 11 }}>
          <Faint>
            {facet.questionCount} tutor question{facet.questionCount === 1 ? "" : "s"} asked about this facet
          </Faint>
        </div>
      ) : null}

      <SectionHeader>Practice items testing this facet</SectionHeader>
      {facet.practiceItems.length === 0 ? <Faint>none yet</Faint> : null}
      {facet.practiceItems.map((item) => {
        const isHovered = item.id === hoveredItem;
        return (
          <div
            key={item.id}
            style={{
              padding: "6px 6px",
              margin: "0 -6px",
              borderTop: `1px solid ${COLOR.border}`,
              fontSize: 12,
              background: isHovered ? "#241d12" : "transparent",
              outline: isHovered ? `1px solid ${COLOR.amber}` : "1px solid transparent",
              transition: "background 0.22s ease, outline-color 0.22s ease"
            }}
          >
            <div style={{ color: COLOR.text }}>{item.title}</div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
              <EntityLink id={item.id} onInspect={onInspect}>
                <Meta>{item.id}</Meta>
              </EntityLink>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {item.isProbe ? <Pill color="red">probe</Pill> : null}
                {item.queued ? <Pill color="cyan">queued</Pill> : null}
                {item.difficulty != null ? <Faint>d={item.difficulty.toFixed(2)}</Faint> : null}
                {item.weight != null ? <Faint>w={item.weight.toFixed(2)}</Faint> : null}
              </span>
            </div>
            <Faint style={{ fontSize: 11 }}>{item.learningObjectId}</Faint>
          </div>
        );
      })}

      <SectionHeader>Learning objects</SectionHeader>
      {facet.learningObjects.length === 0 ? <Faint>none</Faint> : null}
      {facet.learningObjects.map((lo) => (
        <div
          key={lo.id}
          style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${COLOR.border}`, fontSize: 12 }}
        >
          <span style={{ minWidth: 0 }}>
            <div style={{ color: COLOR.text, overflowWrap: "anywhere" }}>{lo.title}</div>
            <EntityLink id={lo.id} onInspect={onInspect}>
              <Meta>{lo.id}</Meta>
            </EntityLink>
          </span>
          <Pill color={statePillColor(lo.state)}>{lo.state}</Pill>
          <Dim style={{ textAlign: "right", fontFamily: FONT_MONO }}>{lo.facetMastery.toFixed(2)}</Dim>
        </div>
      ))}
    </div>
  );
}
