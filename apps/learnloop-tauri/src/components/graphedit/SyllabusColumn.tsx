// Collapsible syllabus panel (edit mode only): concepts in derived topological
// order (prerequisite depth, ties alphabetical). Dragging a concept to a new
// position asks the parent to infer the minimal prerequisite edits that realize
// the ordering; a confirm prompt shows exactly which edges will be staged (or an
// inline refusal when the move would cycle).

import { useState } from "react";
import type { ConceptGraphNode } from "../../api/dto";
import type { PendingEdit } from "./pending";
import { COLOR, FONT_MONO } from "../term";

export interface ReorderPrompt {
  movedId: string;
  edits: PendingEdit[];
  error?: string;
}

export function SyllabusColumn({
  concepts,
  ordered,
  conceptTitle,
  collapsed,
  onToggleCollapse,
  onDrop,
  prompt,
  onConfirm,
  onCancel
}: {
  concepts: ConceptGraphNode[];
  ordered: string[];
  conceptTitle: (id: string) => string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onDrop: (movedId: string, fromIndex: number, toIndex: number) => void;
  prompt: ReorderPrompt | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const byId = new Map(concepts.map((c) => [c.id, c] as const));

  if (collapsed) {
    return (
      <div
        style={{
          width: 26,
          flexShrink: 0,
          borderLeft: `1px solid ${COLOR.border}`,
          background: COLOR.bg,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
        onClick={onToggleCollapse}
        title="expand syllabus"
      >
        <span style={{ writingMode: "vertical-rl", color: COLOR.textDim, fontFamily: FONT_MONO, fontSize: 11 }}>
          syllabus ▸
        </span>
      </div>
    );
  }

  return (
    <div
      className="ll-scroll"
      style={{
        width: 260,
        flexShrink: 0,
        borderLeft: `1px solid ${COLOR.border}`,
        background: COLOR.bg,
        overflowY: "auto",
        fontFamily: FONT_MONO,
        fontSize: 12,
        color: COLOR.text
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 12px",
          borderBottom: `1px solid ${COLOR.border}`,
          position: "sticky",
          top: 0,
          background: COLOR.bg,
          zIndex: 2
        }}
      >
        <span style={{ color: COLOR.amber }}>syllabus order</span>
        <button
          type="button"
          onClick={onToggleCollapse}
          style={{ background: "transparent", border: "none", color: COLOR.textDim, cursor: "pointer", font: "inherit" }}
          title="collapse"
        >
          ◂
        </button>
      </div>
      <div style={{ padding: "6px 8px 4px", color: COLOR.textFaint, fontSize: 10.5, lineHeight: 1.4 }}>
        drag a concept to reorder — the minimal prerequisite edits are staged, not applied.
      </div>

      {prompt ? (
        <div style={{ margin: "6px 8px", border: `1px solid ${COLOR.borderStrong}`, padding: 8, background: COLOR.bgElev }}>
          {prompt.error ? (
            <div style={{ color: COLOR.red }}>{prompt.error}</div>
          ) : prompt.edits.length === 0 ? (
            <div style={{ color: COLOR.textFaint }}>already in that order — nothing to stage.</div>
          ) : (
            <>
              <div style={{ color: COLOR.amber, marginBottom: 6 }}>stage these edits?</div>
              <div style={{ display: "grid", gap: 3 }}>
                {prompt.edits.map((edit) => (
                  <div key={edit.pid} style={{ color: COLOR.textDim }}>
                    <span style={{ color: edit.op === "create" ? COLOR.green : COLOR.amber }}>
                      {edit.op === "create" ? "add" : "flip"}
                    </span>{" "}
                    {conceptTitle(edit.source)} <span style={{ color: COLOR.amber }}>→</span> {conceptTitle(edit.target)}
                  </div>
                ))}
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {!prompt.error && prompt.edits.length > 0 ? (
              <button
                type="button"
                onClick={onConfirm}
                style={{
                  background: "#241d12",
                  border: `1px solid ${COLOR.amber}`,
                  color: COLOR.amber,
                  font: "inherit",
                  padding: "2px 10px",
                  cursor: "pointer"
                }}
              >
                stage
              </button>
            ) : null}
            <button
              type="button"
              onClick={onCancel}
              style={{
                background: "transparent",
                border: `1px solid ${COLOR.border}`,
                color: COLOR.textDim,
                font: "inherit",
                padding: "2px 10px",
                cursor: "pointer"
              }}
            >
              {prompt.error ? "dismiss" : "cancel"}
            </button>
          </div>
        </div>
      ) : null}

      <ol style={{ listStyle: "none", margin: 0, padding: "4px 0 12px" }}>
        {ordered.map((id, index) => {
          const concept = byId.get(id);
          if (!concept) return null;
          const isOver = overIndex === index && dragIndex !== null && dragIndex !== index;
          return (
            <li
              key={id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (overIndex !== index) setOverIndex(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== index) onDrop(ordered[dragIndex], dragIndex, index);
                setDragIndex(null);
                setOverIndex(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 12px",
                cursor: "grab",
                borderTop: isOver ? `2px solid ${COLOR.amber}` : "2px solid transparent",
                background: dragIndex === index ? COLOR.bgElev : "transparent",
                opacity: dragIndex === index ? 0.6 : 1
              }}
            >
              <span style={{ color: COLOR.textFaint, width: 20, textAlign: "right" }}>{index + 1}</span>
              <span style={{ color: COLOR.textFaint }}>⣿</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {concept.title || concept.id}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
