// Open-in-source viewer (§9.2): read-only. Resolves a block_span_v1 locator to
// its geometry + text and records a source_exposure event on every view. No page
// raster is persisted, so PDF spans render an honest text fallback labelled with
// the page + region; HTML/text spans scroll-to-anchor with a highlight.

import { useEffect, useState, type CSSProperties } from "react";
import { api } from "../api/client";
import type { SpanNeighborDto, SpanViewDto } from "../api/dto";
import { COLOR, Faint, FONT_MONO, Pill } from "./term";

export function OpenInSource({
  extractionId,
  spanId,
  context,
  entityType,
  entityId,
  onClose
}: {
  extractionId: string;
  spanId: string;
  context?: string;
  entityType?: string | null;
  entityId?: string | null;
  onClose: () => void;
}) {
  const [currentSpanId, setCurrentSpanId] = useState(spanId);
  const [view, setView] = useState<SpanViewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getSpanView({ extractionId, spanId: currentSpanId, context: context ?? "provenance", entityType, entityId })
      .then((res) => {
        if (!cancelled) {
          setView(res.spanView);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [extractionId, currentSpanId, context, entityType, entityId]);

  const heading = view
    ? view.sectionPath.length > 0
      ? view.sectionPath.join(" › ")
      : view.blockType
    : "Open in source";

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ color: COLOR.amber, fontWeight: 700 }}>❯</span>
          <span style={{ fontSize: 13, color: COLOR.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {heading}
          </span>
          {view ? <Pill color={view.viewerMode === "pdf_text" ? "amber" : "cyan"}>{view.viewerMode}</Pill> : null}
          <span style={{ marginLeft: "auto", cursor: "pointer", color: COLOR.textFaint, fontSize: 12 }} onClick={onClose}>
            esc ✕
          </span>
        </div>

        <div className="ll-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          {loading ? <Faint>loading span…</Faint> : null}
          {error ? <div style={{ color: COLOR.red, fontSize: 12 }}>{error}</div> : null}
          {view ? (
            <>
              <div style={{ fontSize: 11, color: COLOR.textFaint, fontFamily: FONT_MONO, marginBottom: 8 }}>
                {view.sourceId ? `${view.sourceId} · ` : ""}
                {view.locator} · {view.locatorScheme}
              </div>

              {view.viewerMode === "pdf_text" ? (
                <div>
                  <Faint style={{ fontSize: 11 }}>
                    text view — page {view.page ?? "?"}, region highlighted
                  </Faint>
                  <div style={pageBoxStyle}>
                    <div style={highlightBlockStyle}>{view.text}</div>
                  </div>
                  {view.bbox ? (
                    <div style={{ marginTop: 6 }}>
                      <Faint style={{ fontSize: 11 }}>
                        bbox [{view.bbox.map((n) => Math.round(n)).join(", ")}]
                      </Faint>
                    </div>
                  ) : null}
                  {view.pageSpans.length > 1 ? (
                    <div style={{ marginTop: 4 }}>
                      <Faint style={{ fontSize: 11 }}>{view.pageSpans.length} spans highlighted on this page</Faint>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div>
                  <Faint style={{ fontSize: 11 }}>block anchor {view.spanId}</Faint>
                  <div style={highlightBlockStyle}>{view.text}</div>
                </div>
              )}

              {view.acquisitionKind === "youtube" && view.canonicalUri ? (
                // YouTube embed is M8; external-open fallback at the source for now.
                <div style={{ marginTop: 12 }}>
                  <a href={view.canonicalUri} target="_blank" rel="noreferrer" style={{ color: COLOR.amberLink, fontSize: 12, fontFamily: FONT_MONO }}>
                    open externally ↗
                  </a>
                </div>
              ) : null}

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
                <button
                  style={{ ...navBtn, opacity: view.previousSpans.length ? 1 : 0.4, cursor: view.previousSpans.length ? "pointer" : "default" }}
                  disabled={!view.previousSpans.length}
                  onClick={() => {
                    const prev = view.previousSpans[view.previousSpans.length - 1];
                    if (prev) setCurrentSpanId(prev.spanId);
                  }}
                >
                  ← prev
                </button>
                <button
                  style={{ ...navBtn, opacity: view.nextSpans.length ? 1 : 0.4, cursor: view.nextSpans.length ? "pointer" : "default" }}
                  disabled={!view.nextSpans.length}
                  onClick={() => {
                    const next = view.nextSpans[0];
                    if (next) setCurrentSpanId(next.spanId);
                  }}
                >
                  next →
                </button>
              </div>

              <NeighborList label="before" spans={view.previousSpans} onJump={setCurrentSpanId} />
              <NeighborList label="after" spans={view.nextSpans} onJump={setCurrentSpanId} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NeighborList({ label, spans, onJump }: { label: string; spans: SpanNeighborDto[]; onJump: (id: string) => void }) {
  if (!spans.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10, color: COLOR.amber, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: FONT_MONO, marginBottom: 4 }}>
        {label}
      </div>
      {spans.map((s) => (
        <div
          key={s.spanId}
          onClick={() => onJump(s.spanId)}
          style={{ cursor: "pointer", fontSize: 12, color: COLOR.textDim, padding: "3px 0", borderTop: `1px solid ${COLOR.border}` }}
        >
          {s.text}
          {s.truncated ? "…" : ""}
        </div>
      ))}
    </div>
  );
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 220,
  background: "rgba(8, 8, 13, 0.78)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "6vh 5vw",
  backdropFilter: "blur(2px)"
};

const panelStyle: CSSProperties = {
  width: "min(720px, 100%)",
  maxHeight: "84vh",
  background: COLOR.bg,
  border: `1px solid ${COLOR.borderStrong}`,
  boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
  display: "flex",
  flexDirection: "column",
  fontFamily: FONT_MONO,
  color: COLOR.text
};

const headerStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: `1px solid ${COLOR.border}`,
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexShrink: 0
};

const pageBoxStyle: CSSProperties = {
  marginTop: 6,
  border: `1px dashed ${COLOR.borderStrong}`,
  background: "#0b0b0b",
  padding: 12,
  minHeight: 120
};

const highlightBlockStyle: CSSProperties = {
  borderLeft: `3px solid ${COLOR.amber}`,
  background: COLOR.bgInput,
  padding: "10px 14px",
  fontSize: 13,
  lineHeight: 1.7,
  color: COLOR.text,
  whiteSpace: "pre-wrap"
};

const navBtn: CSSProperties = {
  padding: "6px 14px",
  border: `1px solid ${COLOR.borderStrong}`,
  background: "transparent",
  color: COLOR.textDim,
  fontFamily: FONT_MONO,
  fontSize: 12
};
