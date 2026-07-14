// The pending-edits strip: a compact list of staged edits with per-item removal,
// a required rationale, "preview geometry", and "file edits" → proposeGraphEdits.
// Shows the batch confirmation (with a hint to review in Proposals) on success,
// or per-item validation errors if the sidecar rejects any item.

import type { PendingEdit, Relation } from "./pending";
import { COLOR, FONT_MONO } from "../term";

const RELATION_COLOR: Record<Relation, string> = {
  prerequisite: COLOR.amber,
  related: COLOR.cyan,
  part_of: COLOR.green,
  confusable_with: COLOR.red
};

function editLabel(edit: PendingEdit): { verb: string; color: string } {
  if (edit.op === "create") return { verb: "create", color: COLOR.green };
  if (edit.op === "delete") return { verb: "retire", color: COLOR.red };
  if (edit.kind === "flip") return { verb: "flip", color: COLOR.amber };
  if (edit.kind === "reorder") return { verb: "reorder", color: COLOR.amber };
  return { verb: "retype", color: COLOR.cyan };
}

export function PendingStrip({
  pending,
  conceptTitle,
  rationale,
  onRationale,
  filing,
  onFile,
  onPreview,
  onRemove,
  onClear,
  errorsByPid,
  confirmation,
  fileError
}: {
  pending: PendingEdit[];
  conceptTitle: (id: string) => string;
  rationale: string;
  onRationale: (value: string) => void;
  filing: boolean;
  onFile: () => void;
  onPreview: () => void;
  onRemove: (pid: string) => void;
  onClear: () => void;
  errorsByPid: Map<string, string[]>;
  confirmation: { batchId: string } | null;
  fileError: string | null;
}) {
  const canFile = pending.length > 0 && rationale.trim().length > 0 && !filing;

  return (
    <div
      style={{
        borderTop: `1px solid ${COLOR.border}`,
        background: COLOR.bg,
        fontFamily: FONT_MONO,
        fontSize: 12,
        color: COLOR.text,
        flexShrink: 0,
        maxHeight: 220,
        overflowY: "auto"
      }}
    >
      {confirmation ? (
        <div
          style={{
            padding: "8px 14px",
            borderBottom: `1px solid ${COLOR.border}`,
            color: COLOR.green,
            display: "flex",
            gap: 8,
            alignItems: "center"
          }}
        >
          <span>✓ filed batch</span>
          <span style={{ color: COLOR.text }}>{confirmation.batchId}</span>
          <span style={{ color: COLOR.textFaint }}>— review & accept it in the Proposals screen [5].</span>
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px" }}>
        <span style={{ color: COLOR.amber }}>
          {pending.length} pending edit{pending.length === 1 ? "" : "s"}
        </span>
        {pending.length === 0 ? (
          <span style={{ color: COLOR.textFaint }}>
            click a node then another to draw an edge, or click an edge to flip / retype / retire it.
          </span>
        ) : (
          <>
            <input
              value={rationale}
              onChange={(e) => onRationale(e.target.value)}
              placeholder="rationale (required)…"
              style={{
                flex: 1,
                minWidth: 120,
                background: COLOR.bgInput,
                border: `1px solid ${rationale.trim() ? COLOR.border : COLOR.borderStrong}`,
                color: COLOR.text,
                font: "inherit",
                padding: "3px 8px"
              }}
            />
            <button
              type="button"
              onClick={onPreview}
              style={{
                background: "transparent",
                border: `1px solid ${COLOR.border}`,
                color: COLOR.cyan,
                font: "inherit",
                padding: "3px 10px",
                cursor: "pointer"
              }}
            >
              preview geometry
            </button>
            <button
              type="button"
              onClick={onFile}
              disabled={!canFile}
              style={{
                background: canFile ? "#241d12" : "transparent",
                border: `1px solid ${canFile ? COLOR.amber : COLOR.border}`,
                color: canFile ? COLOR.amber : COLOR.textFaint,
                font: "inherit",
                padding: "3px 12px",
                cursor: canFile ? "pointer" : "not-allowed"
              }}
            >
              {filing ? "filing…" : "file edits"}
            </button>
            <button
              type="button"
              onClick={onClear}
              style={{
                background: "transparent",
                border: `1px solid ${COLOR.border}`,
                color: COLOR.textDim,
                font: "inherit",
                padding: "3px 10px",
                cursor: "pointer"
              }}
            >
              clear
            </button>
          </>
        )}
      </div>

      {fileError ? (
        <div style={{ padding: "0 14px 8px", color: COLOR.red }}>filing failed: {fileError}</div>
      ) : null}

      {pending.length > 0 ? (
        <div style={{ padding: "0 14px 10px", display: "grid", gap: 3 }}>
          {pending.map((edit) => {
            const { verb, color } = editLabel(edit);
            const errors = errorsByPid.get(edit.pid) ?? [];
            return (
              <div key={edit.pid} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color, width: 60 }}>{verb}</span>
                  <span style={{ color: COLOR.textDim }}>{conceptTitle(edit.source)}</span>
                  <span style={{ color: RELATION_COLOR[edit.relationType] }}>
                    →{edit.relationType === "prerequisite" ? "" : ` ${edit.relationType} →`}
                    {edit.relationType === "prerequisite" ? " prereq →" : ""}
                  </span>
                  <span style={{ color: COLOR.textDim }}>{conceptTitle(edit.target)}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(edit.pid)}
                    style={{
                      marginLeft: "auto",
                      background: "transparent",
                      border: "none",
                      color: COLOR.textFaint,
                      cursor: "pointer",
                      font: "inherit"
                    }}
                    title="drop this edit"
                  >
                    ✕
                  </button>
                </div>
                {errors.length > 0 ? (
                  <div style={{ color: COLOR.red, fontSize: 11, paddingLeft: 68 }}>{errors.join("; ")}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
