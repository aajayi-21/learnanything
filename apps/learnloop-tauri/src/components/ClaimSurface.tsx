import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../api/client";
import type { ClaimCandidateDto, PresentedClaimDto } from "../api/dto";
import { COLOR, FONT_MONO } from "./term";

export function mintVisitId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `visit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ClaimSurface({
  claim,
  sessionId,
  visitId,
  variant = "default",
  onReceipt,
  onResponded,
  onError
}: {
  claim: ClaimCandidateDto;
  sessionId?: string | null;
  visitId?: string | null;
  variant?: "default" | "detail-panel";
  onReceipt?: (ref: string) => void;
  onResponded?: (payload: Record<string, unknown>) => void;
  onError: (message: string) => void;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const exposureStarted = useRef(false);
  const [presentation, setPresentation] = useState<PresentedClaimDto | null>(null);
  const [responded, setResponded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [interpretation, setInterpretation] = useState("");

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || exposureStarted.current) return;
        exposureStarted.current = true;
        api.presentClaims([{ ...claim, visibleAt: new Date().toISOString() }], { sessionId, visitId })
          .then((result) => setPresentation(result.claims[0] ?? null))
          .catch((error) => onError((error as Error).message));
      },
      { threshold: 0.35 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [claim, onError, sessionId, visitId]);

  async function respond(payload: Record<string, unknown>) {
    if (!presentation || responded) return;
    try {
      await api.respondClaim(presentation.presentationId, payload);
      setResponded(true);
      onResponded?.(payload);
    } catch (error) {
      onError((error as Error).message);
    }
  }

  async function dismiss() {
    if (!presentation || responded) return;
    try {
      await api.dismissClaim(presentation.presentationId);
      setResponded(true);
    } catch (error) {
      onError((error as Error).message);
    }
  }

  const enabled = Boolean(presentation?.affordancesEnabled && !responded);
  const inDetailPanel = variant === "detail-panel";
  return (
    <div
      ref={root}
      role={inDetailPanel ? "group" : undefined}
      aria-label={inDetailPanel ? "Scheduler choice feedback" : undefined}
      style={
        inDetailPanel
          ? {
              border: `1px solid ${COLOR.border}`,
              borderLeft: `2px solid ${COLOR.amber}`,
              padding: "10px 12px 11px",
              background: COLOR.bgInput
            }
          : {
              border: `1px solid ${COLOR.border}`,
              borderLeft: `3px solid ${COLOR.amber}`,
              padding: "12px 14px",
              background: COLOR.bgElev
            }
      }
    >
      {inDetailPanel ? (
        <div
          style={{
            color: COLOR.amber,
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 5
          }}
        >
          selected rationale
        </div>
      ) : null}
      <div style={{ color: COLOR.text, fontSize: inDetailPanel ? 12 : undefined, lineHeight: 1.55 }}>{claim.claimText}</div>
      {claim.provenance ? (
        <div
          style={{
            marginTop: 5,
            color: COLOR.textFaint,
            fontSize: inDetailPanel ? 10 : 11,
            fontFamily: FONT_MONO,
            overflowWrap: "anywhere"
          }}
        >
          {inDetailPanel ? `policy · ${claim.provenance}` : claim.provenance}
        </div>
      ) : null}
      {claim.receiptRef && onReceipt ? (
        <button
          type="button"
          className={inDetailPanel ? undefined : "queue-row"}
          style={inDetailPanel ? { ...panelButtonStyle, marginTop: 8 } : { marginTop: 8 }}
          onClick={() => onReceipt(claim.receiptRef!)}
        >
          show receipt
        </button>
      ) : null}
      {presentation?.suppressionReason ? (
        <div
          style={{
            marginTop: 8,
            color: COLOR.textFaint,
            fontSize: inDetailPanel ? 10 : 11,
            fontFamily: inDetailPanel ? FONT_MONO : undefined
          }}
        >
          annotated claim · responses paused ({presentation.suppressionReason.replace(/_/g, " ")})
        </div>
      ) : null}
      {responded ? (
        <div
          style={{
            marginTop: 8,
            color: COLOR.green,
            fontSize: inDetailPanel ? 10 : 11,
            fontFamily: inDetailPanel ? FONT_MONO : undefined
          }}
        >
          ✓ response saved locally
        </div>
      ) : null}
      {enabled ? (
        <div style={{ marginTop: 10 }}>
          {inDetailPanel ? (
            <div style={{ marginBottom: 6, color: COLOR.textFaint, fontFamily: FONT_MONO, fontSize: 10 }}>
              was this queue choice useful?
            </div>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: inDetailPanel ? 5 : 6, alignItems: "center" }}>
            <ClaimResponses
              claim={claim}
              variant={variant}
              editing={editing}
              setEditing={setEditing}
              interpretation={interpretation}
              setInterpretation={setInterpretation}
              respond={respond}
            />
            <button
              type="button"
              className={inDetailPanel ? undefined : "queue-row"}
              style={inDetailPanel ? panelDismissStyle : undefined}
              onClick={() => void dismiss()}
            >
              dismiss
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ClaimResponses({
  claim,
  variant,
  editing,
  setEditing,
  interpretation,
  setInterpretation,
  respond
}: {
  claim: ClaimCandidateDto;
  variant: "default" | "detail-panel";
  editing: boolean;
  setEditing: (value: boolean) => void;
  interpretation: string;
  setInterpretation: (value: string) => void;
  respond: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const inDetailPanel = variant === "detail-panel";
  const button = (label: string, response: string, extra: Record<string, unknown> = {}) => (
    <button
      key={`${response}:${String(extra.reason ?? "")}`}
      type="button"
      className={inDetailPanel ? undefined : "queue-row"}
      style={inDetailPanel ? (response === "useful" ? panelPrimaryButtonStyle : panelButtonStyle) : undefined}
      onClick={() => void respond({ response, ...extra })}
    >
      {label}
    </button>
  );
  if (claim.claimClass === "estimate" && claim.claimType === "ready_estimate") {
    return <>{button("seems high", "high")}{button("about right", "about_right")}{button("seems low", "low")}{button("not sure", "not_sure")}</>;
  }
  if (claim.claimClass === "estimate") {
    return <>{button("pace is typical", "pace_typical")}{button("pace is atypical", "pace_atypical")}</>;
  }
  if (claim.claimClass === "policy") {
    return <>{button("useful", "useful")}{button("too easy", "choose_something_else", { reason: "too_easy" })}{button("too hard", "choose_something_else", { reason: "too_hard" })}{button("irrelevant", "choose_something_else", { reason: "irrelevant" })}{button("recently done", "choose_something_else", { reason: "recently_done" })}{button("bad item", "choose_something_else", { reason: "bad_item" })}</>;
  }
  if (claim.claimClass === "diagnosis") {
    return <>
      {button("fits", "fits")}{button("doesn't fit", "doesnt_fit")}{button("partly", "partly")}
      <button type="button" className="queue-row" onClick={() => setEditing(!editing)}>edit interpretation</button>
      {editing ? <span style={{ display: "flex", gap: 6, flexBasis: "100%" }}><input value={interpretation} onChange={(event) => setInterpretation(event.target.value)} aria-label="edit the interpretation" /><button type="button" className="queue-row" disabled={!interpretation.trim()} onClick={() => void respond({ response: "edit", interpretation })}>save edit</button></span> : null}
    </>;
  }
  if (claim.claimType === "regrade") {
    return <>{button("request review", "request_review")}</>;
  }
  return null;
}

const panelButtonStyle: CSSProperties = {
  width: "auto",
  border: `1px solid ${COLOR.borderStrong}`,
  background: "transparent",
  color: COLOR.textDim,
  padding: "3px 7px",
  fontFamily: FONT_MONO,
  fontSize: 11,
  lineHeight: 1.4,
  cursor: "pointer",
  textAlign: "left"
};

const panelPrimaryButtonStyle: CSSProperties = {
  ...panelButtonStyle,
  borderColor: COLOR.amber,
  background: "#241d12",
  color: COLOR.amber
};

const panelDismissStyle: CSSProperties = {
  width: "auto",
  marginLeft: "auto",
  border: "none",
  background: "transparent",
  color: COLOR.textFaint,
  padding: "3px 2px",
  fontFamily: FONT_MONO,
  fontSize: 10,
  lineHeight: 1.4,
  cursor: "pointer"
};
