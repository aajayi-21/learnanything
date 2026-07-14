import type { ProbeBlockEndDto } from "../api/dto";
import { MarkdownMath } from "../render/MarkdownMath";
import { COLOR, FONT_MONO, Faint } from "./term";
import { Pill } from "./ui";

// Shared §5.7 block-end review: status/route banner + the withheld feedback
// released for every attempt in the block. Extracted from DialogueProbe's
// "done" phase so the ordinary Diagnostic Check review (DiagnosticReviewScreen)
// renders in the exact same visual language.

const ROUTE_LABEL: Record<string, string> = {
  tutoring: "next: tutoring on the diagnosed gap",
  next_block: "next: another short diagnostic block",
  ordinary_practice: "next: ordinary practice"
};

export function ProbeBlockResult({
  status,
  completionReason,
  route,
  releasedFeedback,
  labelForIndex
}: {
  status: string;
  completionReason: string | null;
  route: ProbeBlockEndDto["route"];
  releasedFeedback: ProbeBlockEndDto["releasedFeedback"];
  /** Per-entry caption (defaults to "observation N"); dialogue turns label by kind. */
  labelForIndex?: (index: number) => string;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Pill tone={status === "complete" ? "cyan" : "slate"}>{status}</Pill>
        {completionReason ? <Faint>{completionReason}</Faint> : null}
        {route ? (
          <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: COLOR.amber }}>
            {ROUTE_LABEL[route] ?? route}
          </span>
        ) : null}
      </div>
      {releasedFeedback.length > 0 ? (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <Faint>Feedback withheld during the block, released now:</Faint>
          {releasedFeedback.map((feedback, index) => (
            <div
              key={feedback.attemptId}
              style={{ borderTop: `1px solid ${COLOR.border}`, paddingTop: 8, fontSize: 13 }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Pill tone={(feedback.rubricScore ?? 0) >= 3 ? "green" : "amber"}>
                  {feedback.rubricScore ?? "—"}/4
                </Pill>
                <Faint>{labelForIndex ? labelForIndex(index) : `observation ${index + 1}`}</Faint>
                {feedback.fatalErrors.length > 0 ? (
                  <span style={{ color: COLOR.red, fontFamily: FONT_MONO, fontSize: 11 }}>
                    {feedback.fatalErrors.join(", ")}
                  </span>
                ) : null}
              </div>
              {feedback.feedbackMd ? (
                <div className="markdown" style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5 }}>
                  <MarkdownMath value={feedback.feedbackMd} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <Faint>No feedback to release for this block.</Faint>
        </div>
      )}
    </>
  );
}
