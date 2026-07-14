// Floating pickers for edge gestures, absolutely positioned inside the graph
// content layer. Both carry the layer-honesty caption (design principle 3).

import { useState, type CSSProperties } from "react";
import { COLOR, FONT_MONO } from "../term";
import { HONESTY_CAPTION, RELATIONS, type Relation } from "./pending";

// Same visual language as GraphScreen's RELATION_STYLE, kept here so the pickers
// are self-contained (colors only — dash patterns live on the canvas).
const RELATION_COLOR: Record<Relation, string> = {
  prerequisite: COLOR.amber,
  related: COLOR.cyan,
  part_of: COLOR.green,
  confusable_with: COLOR.red
};

const RELATION_LABEL: Record<Relation, string> = {
  prerequisite: "prerequisite",
  related: "related",
  part_of: "part_of",
  confusable_with: "confusable_with"
};

function Caption() {
  return (
    <div style={{ marginTop: 8, maxWidth: 240, color: COLOR.textFaint, fontSize: 10.5, lineHeight: 1.4 }}>
      {HONESTY_CAPTION}
    </div>
  );
}

const panelStyle = (x: number, y: number): CSSProperties => ({
  position: "absolute",
  left: x,
  top: y,
  zIndex: 20,
  background: COLOR.bgElev,
  border: `1px solid ${COLOR.borderStrong}`,
  boxShadow: "0 6px 20px rgba(0,0,0,0.55)",
  padding: 10,
  fontFamily: FONT_MONO,
  fontSize: 12,
  color: COLOR.text
});

function relButtonStyle(color: string): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    background: "transparent",
    border: `1px solid ${COLOR.border}`,
    color: COLOR.text,
    font: "inherit",
    padding: "4px 8px",
    marginBottom: 4,
    cursor: "pointer",
    textAlign: "left"
  };
}

// Create-edge relation picker: source → target chosen, now pick a relation type.
export function RelationPicker({
  x,
  y,
  sourceTitle,
  targetTitle,
  onPick,
  onCancel
}: {
  x: number;
  y: number;
  sourceTitle: string;
  targetTitle: string;
  onPick: (relation: Relation) => void;
  onCancel: () => void;
}) {
  return (
    <div style={panelStyle(x, y)} onClick={(e) => e.stopPropagation()}>
      <div style={{ color: COLOR.amber, marginBottom: 6 }}>new edge</div>
      <div style={{ color: COLOR.textDim, marginBottom: 8, maxWidth: 240 }}>
        {sourceTitle} <span style={{ color: COLOR.textFaint }}>→</span> {targetTitle}
      </div>
      {RELATIONS.map((relation) => (
        <button
          key={relation}
          type="button"
          style={relButtonStyle(RELATION_COLOR[relation])}
          onClick={() => onPick(relation)}
        >
          <span style={{ width: 10, height: 10, background: RELATION_COLOR[relation], display: "inline-block" }} />
          <span style={{ color: RELATION_COLOR[relation] }}>{RELATION_LABEL[relation]}</span>
        </button>
      ))}
      <Caption />
      <button
        type="button"
        onClick={onCancel}
        style={{
          marginTop: 8,
          background: "transparent",
          border: `1px solid ${COLOR.border}`,
          color: COLOR.textDim,
          font: "inherit",
          padding: "2px 8px",
          cursor: "pointer"
        }}
      >
        esc · cancel
      </button>
    </div>
  );
}

// Existing-edge popover: flip direction, retype, or retire.
export function EdgePopover({
  x,
  y,
  sourceTitle,
  targetTitle,
  relationType,
  onFlip,
  onRetype,
  onRetire,
  onClose
}: {
  x: number;
  y: number;
  sourceTitle: string;
  targetTitle: string;
  relationType: Relation;
  onFlip: () => void;
  onRetype: (relation: Relation) => void;
  onRetire: () => void;
  onClose: () => void;
}) {
  const [retyping, setRetyping] = useState(false);
  return (
    <div style={panelStyle(x, y)} onClick={(e) => e.stopPropagation()}>
      <div style={{ color: COLOR.amber, marginBottom: 6 }}>edit edge</div>
      <div style={{ color: COLOR.textDim, marginBottom: 8, maxWidth: 240 }}>
        {sourceTitle}{" "}
        <span style={{ color: RELATION_COLOR[relationType] }}>→ {RELATION_LABEL[relationType]} →</span> {targetTitle}
      </div>
      {retyping ? (
        <>
          <div style={{ color: COLOR.textFaint, marginBottom: 4, fontSize: 11 }}>change type to…</div>
          {RELATIONS.filter((r) => r !== relationType).map((relation) => (
            <button
              key={relation}
              type="button"
              style={relButtonStyle(RELATION_COLOR[relation])}
              onClick={() => onRetype(relation)}
            >
              <span style={{ width: 10, height: 10, background: RELATION_COLOR[relation], display: "inline-block" }} />
              <span style={{ color: RELATION_COLOR[relation] }}>{RELATION_LABEL[relation]}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRetyping(false)}
            style={{
              marginTop: 2,
              background: "transparent",
              border: `1px solid ${COLOR.border}`,
              color: COLOR.textDim,
              font: "inherit",
              padding: "2px 8px",
              cursor: "pointer"
            }}
          >
            back
          </button>
        </>
      ) : (
        <div style={{ display: "grid", gap: 4 }}>
          <button type="button" style={relButtonStyle(COLOR.amber)} onClick={onFlip}>
            <span style={{ color: COLOR.amber }}>⇄</span> flip direction
          </button>
          <button type="button" style={relButtonStyle(COLOR.cyan)} onClick={() => setRetyping(true)}>
            <span style={{ color: COLOR.cyan }}>↻</span> change type
          </button>
          <button
            type="button"
            style={{ ...relButtonStyle(COLOR.red), color: COLOR.red }}
            onClick={onRetire}
          >
            <span style={{ color: COLOR.red }}>✕</span> retire edge
          </button>
        </div>
      )}
      <Caption />
      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 8,
          background: "transparent",
          border: `1px solid ${COLOR.border}`,
          color: COLOR.textDim,
          font: "inherit",
          padding: "2px 8px",
          cursor: "pointer"
        }}
      >
        close
      </button>
    </div>
  );
}
