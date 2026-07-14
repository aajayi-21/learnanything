import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "../api/client";
import type {
  BuildPlan,
  BuildPlanStage,
  CommandError,
  OutlineUnit,
  SourceOutline,
  StartExtractionRepairInput
} from "../api/dto";
import { COLOR, Faint, FONT_MONO, Pill, SectionHeader } from "./term";

// ING M3 (source-ingestion v2 §5.7): the Outline & unit-selection screen and the
// Build-plan screen. Both are deterministic previews with ZERO pedagogical LLM
// calls — the outline is a byte-stable read of the extraction, the plan sums token
// budgets. The only egress-capable action here is consent-gated page repair.

function Card({ children, style = {} }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 2, padding: "14px 18px", ...style }}>{children}</div>
  );
}

const SIGNAL_ORDER = ["examples", "exercises", "equations", "figures", "definitions", "theorems", "tables"];

// ── Flow shell: outline → build plan → start batch ──────────────────────
export function OutlinePlanFlow({
  sourceRef,
  sourceUri,
  subjectId,
  onClose,
  onOpenBatch
}: {
  sourceRef: string;
  sourceUri: string | null;
  subjectId: string | null;
  onClose: () => void;
  onOpenBatch: (batchId: string) => void;
}) {
  const [step, setStep] = useState<"outline" | "plan">("outline");
  const [outline, setOutline] = useState<SourceOutline | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.getSourceOutline(sourceRef);
      setOutline(next);
      const prior = next.selection.selectedUnitIds;
      setSelected(new Set(prior.length ? prior : next.units.map((u) => u.unitId)));
      const priorOverrides: Record<string, string> = {};
      for (const ov of next.selection.boundaryOverrides) {
        const unitId = ov["unitId"] as string | undefined;
        const op = ov["op"] as string | undefined;
        if (unitId && op) priorOverrides[unitId] = op;
      }
      setOverrides(priorOverrides);
      setError(null);
    } catch (e) {
      setError((e as CommandError).message);
    } finally {
      setLoading(false);
    }
  }, [sourceRef]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleUnit(unitId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }

  function cycleOverride(unitId: string) {
    setOverrides((current) => {
      const next = { ...current };
      const now = next[unitId];
      if (!now) next[unitId] = "merge_with_next";
      else if (now === "merge_with_next") next[unitId] = "split_at_heading";
      else delete next[unitId];
      return next;
    });
  }

  async function persistSelection() {
    if (!outline) return;
    const boundaryOverrides = Object.entries(overrides).map(([unitId, op]) => ({ op, unitId }));
    await api.saveUnitSelection({
      extractionId: outline.extractionId,
      selectedUnitIds: [...selected],
      boundaryOverrides
    });
  }

  async function toPlan() {
    try {
      await persistSelection();
      setStep("plan");
      setError(null);
    } catch (e) {
      setError((e as CommandError).message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 24px",
          borderBottom: `1px solid ${COLOR.border}`,
          background: COLOR.bgElev,
          flexShrink: 0
        }}
      >
        <span onClick={onClose} style={{ color: COLOR.textFaint, cursor: "pointer", fontFamily: FONT_MONO, fontSize: 12 }}>
          ← library
        </span>
        <span style={{ color: step === "outline" ? COLOR.amber : COLOR.textFaint, fontSize: 12, fontFamily: FONT_MONO }}>
          ① outline
        </span>
        <span style={{ color: COLOR.border }}>→</span>
        <span style={{ color: step === "plan" ? COLOR.amber : COLOR.textFaint, fontSize: 12, fontFamily: FONT_MONO }}>
          ② build plan
        </span>
      </div>

      {error && <div style={{ color: COLOR.red, fontSize: 12, padding: "8px 24px" }}>{error}</div>}

      {loading || !outline ? (
        <div style={{ padding: 24, color: COLOR.textFaint }}>◐ loading outline…</div>
      ) : step === "outline" ? (
        <OutlineView
          outline={outline}
          selected={selected}
          overrides={overrides}
          onToggle={toggleUnit}
          onCycleOverride={cycleOverride}
          onSave={persistSelection}
          onNext={toPlan}
          onRepaired={load}
        />
      ) : (
        <BuildPlanView
          outline={outline}
          sourceUri={sourceUri}
          selectedUnitIds={[...selected]}
          subjectId={subjectId}
          onBack={() => setStep("outline")}
          onOpenBatch={onOpenBatch}
        />
      )}
    </div>
  );
}

// ── Outline & unit selection ─────────────────────────────────────────────
function OutlineView({
  outline,
  selected,
  overrides,
  onToggle,
  onCycleOverride,
  onSave,
  onNext,
  onRepaired
}: {
  outline: SourceOutline;
  selected: Set<string>;
  overrides: Record<string, string>;
  onToggle: (unitId: string) => void;
  onCycleOverride: (unitId: string) => void;
  onSave: () => Promise<void>;
  onNext: () => void;
  onRepaired: () => void;
}) {
  const [repairOpen, setRepairOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const selectedCount = outline.units.filter((u) => selected.has(u.unitId)).length;
  const selectedTokens = outline.units.filter((u) => selected.has(u.unitId)).reduce((sum, u) => sum + u.approxTokens, 0);

  async function save() {
    await onSave();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="ll-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <SectionHeader style={{ marginTop: 0 }}>{outline.title}</SectionHeader>
        <Pill color="slate">{outline.extractor}</Pill>
        <Faint>
          {outline.unitCount} units · {outline.blockCount} blocks · ~{outline.approxTokens.toLocaleString()} tokens
        </Faint>
        {outline.difficultPageCount > 0 && (
          <span
            onClick={() => setRepairOpen(true)}
            style={{ color: COLOR.amber, cursor: "pointer", fontSize: 12, fontFamily: FONT_MONO }}
          >
            ⚠ improve {outline.difficultPageCount} difficult page{outline.difficultPageCount === 1 ? "" : "s"} →
          </span>
        )}
      </div>

      {outline.selection.needsReview.length > 0 && (
        <div style={{ border: `1px solid ${COLOR.amber}`, background: "#241d12", padding: "8px 14px", fontSize: 12, color: COLOR.amber }}>
          {outline.selection.needsReview.length} prior selection(s) could not be re-anchored after re-extraction and need review:{" "}
          <span style={{ fontFamily: FONT_MONO }}>{outline.selection.needsReview.join(", ")}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {outline.units.map((unit) => (
          <UnitRow
            key={unit.unitId}
            unit={unit}
            checked={selected.has(unit.unitId)}
            override={overrides[unit.unitId] ?? null}
            onToggle={() => onToggle(unit.unitId)}
            onCycleOverride={() => onCycleOverride(unit.unitId)}
          />
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
        <Faint>
          {selectedCount}/{outline.units.length} units selected · ~{selectedTokens.toLocaleString()} tokens
        </Faint>
        <span style={{ flex: 1 }} />
        <button onClick={() => void save()} style={buttonStyle(false)}>
          {saved ? "✓ saved" : "save selection"}
        </button>
        <button onClick={onNext} style={buttonStyle(selectedCount > 0)} disabled={selectedCount === 0}>
          build plan →
        </button>
      </div>

      {repairOpen && (
        <RepairDialog
          outline={outline}
          onClose={() => setRepairOpen(false)}
          onStarted={() => {
            setRepairOpen(false);
            onRepaired();
          }}
        />
      )}
    </div>
  );
}

function UnitRow({
  unit,
  checked,
  override,
  onToggle,
  onCycleOverride
}: {
  unit: OutlineUnit;
  checked: boolean;
  override: string | null;
  onToggle: () => void;
  onCycleOverride: () => void;
}) {
  const pages =
    unit.pageStart != null ? `p${unit.pageStart}${unit.pageEnd && unit.pageEnd !== unit.pageStart ? `–${unit.pageEnd}` : ""}` : null;
  const signals = SIGNAL_ORDER.filter((k) => (unit.structuralSignals[k] ?? 0) > 0).map((k) => `${k} ${unit.structuralSignals[k]}`);
  return (
    <Card style={{ borderLeft: `3px solid ${checked ? COLOR.amber : COLOR.border}`, display: "flex", gap: 12 }}>
      <span onClick={onToggle} style={{ cursor: "pointer", color: checked ? COLOR.amber : COLOR.textFaint, fontFamily: FONT_MONO, fontSize: 14, userSelect: "none" }}>
        {checked ? "[✓]" : "[ ]"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: COLOR.text, fontSize: 13, fontWeight: 600 }}>{unit.label || unit.unitId}</span>
          {pages && <Faint style={{ fontFamily: FONT_MONO, fontSize: 11 }}>{pages}</Faint>}
          <Faint style={{ fontSize: 11 }}>~{unit.approxTokens.toLocaleString()} tokens</Faint>
          {unit.inventory.inventoried && <Pill color="green">inventory cached</Pill>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5, flexWrap: "wrap", fontSize: 11 }}>
          {signals.length > 0 ? (
            <span style={{ color: COLOR.textDim, fontFamily: FONT_MONO }}>{signals.join(" · ")}</span>
          ) : (
            <Faint>prose</Faint>
          )}
          {unit.healthFlags.map((flag) => (
            <Pill key={flag} color="amber">{flag}</Pill>
          ))}
          <span style={{ flex: 1 }} />
          <span
            onClick={onCycleOverride}
            title="boundary override: merge-with-next / split-at-heading"
            style={{
              cursor: "pointer",
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: override ? COLOR.cyan : COLOR.textFaint,
              border: `1px solid ${override ? COLOR.cyan : COLOR.border}`,
              padding: "1px 8px"
            }}
          >
            {override ? `⤳ ${override.replace(/_/g, " ")}` : "⤳ boundary"}
          </span>
        </div>
      </div>
    </Card>
  );
}

// ── Build plan ───────────────────────────────────────────────────────────
function BuildPlanView({
  outline,
  sourceUri,
  selectedUnitIds,
  subjectId,
  onBack,
  onOpenBatch
}: {
  outline: SourceOutline;
  sourceUri: string | null;
  selectedUnitIds: string[];
  subjectId: string | null;
  onBack: () => void;
  onOpenBatch: (batchId: string) => void;
}) {
  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getBuildPlan([{ extractionId: outline.extractionId, selectedUnitIds }], subjectId)
      .then((next) => {
        if (!cancelled) setPlan(next);
      })
      .catch((e) => {
        if (!cancelled) setError((e as CommandError).message);
      });
    return () => {
      cancelled = true;
    };
  }, [outline.extractionId, subjectId, selectedUnitIds.join(",")]);

  const canStart = Boolean(sourceUri);
  async function startBatch() {
    if (!plan || !sourceUri) return;
    setStarting(true);
    setError(null);
    try {
      // The source is already imported; re-importing is idempotent and snapshots
      // the plan estimate onto the batch payload (§8.6.2).
      const batch = await api.startImportBatch({
        sources: [sourceUri],
        subjectId,
        estimate: plan.totals as unknown as Record<string, unknown>
      });
      onOpenBatch(batch.id);
    } catch (e) {
      setError((e as CommandError).message);
    } finally {
      setStarting(false);
    }
  }

  if (error) return <div style={{ padding: 24, color: COLOR.red, fontSize: 12 }}>{error}</div>;
  if (!plan) return <div style={{ padding: 24, color: COLOR.textFaint }}>◐ computing budget…</div>;

  const routingColor = plan.routing === "create" ? COLOR.green : COLOR.cyan;
  return (
    <div className="ll-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <SectionHeader style={{ marginTop: 0 }}>Build plan</SectionHeader>
        <span style={{ color: routingColor, fontFamily: FONT_MONO, fontSize: 12, border: `1px solid ${routingColor}`, padding: "1px 8px" }}>
          {plan.routing === "create" ? "＋ create study map" : "↻ update study map"}
        </span>
        <Faint>
          provider {plan.provider}
          {plan.providerContextTokens != null ? ` · context ${plan.providerContextTokens.toLocaleString()}` : ""}
        </Faint>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {plan.stages.map((stage) => (
          <StageRow key={stage.stage} stage={stage} />
        ))}
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12, fontFamily: FONT_MONO, color: COLOR.textDim }}>
        <span>
          <Faint>calls</Faint> {plan.totals.calls}
        </span>
        <span>
          <Faint>input</Faint> ~{plan.totals.inputTokens.toLocaleString()}t
        </span>
        <span>
          <Faint>max output</Faint> ≤{plan.totals.maxOutputTokens.toLocaleString()}t
        </span>
        <span style={{ color: plan.totals.cacheSavingsTokens > 0 ? COLOR.green : COLOR.textDim }}>
          <Faint>cache savings</Faint> ~{plan.totals.cacheSavingsTokens.toLocaleString()}t
        </span>
      </div>

      <ConsentSummary plan={plan} />

      {plan.warnings.length > 0 && (
        <div style={{ border: `1px solid ${COLOR.amber}`, background: "#241d12", padding: "8px 14px", fontSize: 12, color: COLOR.amber, display: "flex", flexDirection: "column", gap: 4 }}>
          {plan.warnings.map((w) => (
            <span key={w}>⚠ {w}</span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={onBack} style={buttonStyle(false)}>
          ← units
        </button>
        <span style={{ flex: 1 }} />
        <Faint>
          will create: {plan.whatWillBeCreated.selectedUnits} unit(s) from {plan.whatWillBeCreated.sources} source(s)
        </Faint>
        <button
          onClick={() => void startBatch()}
          style={buttonStyle(canStart)}
          disabled={starting || !canStart}
          title={canStart ? "" : "no canonical URI to re-import from"}
        >
          {starting ? "starting…" : "start batch →"}
        </button>
      </div>
    </div>
  );
}

function StageRow({ stage }: { stage: BuildPlanStage }) {
  const color = stage.exceedsCeiling ? COLOR.red : COLOR.cyan;
  const pct = Math.min(100, (stage.inputTokens / Math.max(stage.ceiling, 1)) * 100);
  return (
    <Card style={{ borderLeft: `3px solid ${color}`, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: COLOR.text, fontSize: 13, fontWeight: 600 }}>{stage.stage}</span>
        <Faint style={{ fontFamily: FONT_MONO, fontSize: 11 }}>{stage.calls} call(s)</Faint>
        <span style={{ flex: 1 }} />
        {stage.exceedsCeiling && <Pill color="red">over ceiling</Pill>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: FONT_MONO }}>
        <Faint style={{ width: 90 }}>input vs ceiling</Faint>
        <div style={{ flex: 1, height: 6, background: COLOR.bgInput, border: `1px solid ${COLOR.border}`, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: color }} />
        </div>
        <span style={{ color: COLOR.text, minWidth: 150, textAlign: "right" }}>
          ~{stage.inputTokens.toLocaleString()}t / {stage.ceiling.toLocaleString()}t
        </span>
      </div>
      <Faint style={{ fontFamily: FONT_MONO, fontSize: 11 }}>
        max output ≤{stage.maxOutputTokens.toLocaleString()}t
        {stage.cachedTokens > 0 ? ` · cached ~${stage.cachedTokens.toLocaleString()}t` : ""}
      </Faint>
    </Card>
  );
}

function ConsentSummary({ plan }: { plan: BuildPlan }) {
  // Everything in a build plan stays on-device; the only egress in M3 is a
  // consent-gated page repair, surfaced separately. This makes that explicit.
  return (
    <div style={{ fontSize: 11, color: COLOR.textFaint, fontFamily: FONT_MONO }}>
      ▪ nothing in this plan leaves the device — synthesis runs against the local provider ({plan.provider}); external page
      repair is a separate, consent-gated action.
    </div>
  );
}

// ── Consent-gated repair dialog (§2.5) ───────────────────────────────────
function RepairDialog({
  outline,
  onClose,
  onStarted
}: {
  outline: SourceOutline;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [pages, setPages] = useState("");
  const [forceOcr, setForceOcr] = useState(true);
  const [inlineMath, setInlineMath] = useState(false);
  const [tableProcessing, setTableProcessing] = useState(false);
  const [useLlm, setUseLlm] = useState(false);
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!outline.revisionId) {
      setError("This extraction has no revision to repair.");
      return;
    }
    if (!consented) {
      setError("Confirm consent to run the repair.");
      return;
    }
    const pageList = pages
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (pageList.length === 0) {
      setError("Enter at least one page or range (e.g. 3-5,8).");
      return;
    }
    const input: StartExtractionRepairInput = {
      revisionId: outline.revisionId,
      pages: pageList,
      consent: {
        provider: useLlm ? "external_vlm" : "local",
        purpose: "extraction_repair",
        pages: pageList,
        cached: false,
        external: useLlm
      },
      repairOptions: { forceOcr, inlineMath, tableProcessing, useLlm },
      parentExtractionId: outline.extractionId
    };
    setBusy(true);
    setError(null);
    try {
      await api.startExtractionRepair(input);
      onStarted();
    } catch (e) {
      setError((e as CommandError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480, maxWidth: "90vw", background: COLOR.bg, border: `1px solid ${COLOR.amber}`, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ color: COLOR.amber, fontSize: 14, fontWeight: 600 }}>Improve difficult pages</div>
        <Faint style={{ fontSize: 12, lineHeight: 1.5 }}>
          Re-extracts only the pages you name, composing the result with the current extraction. Unaffected units keep their
          content hashes. {outline.difficultPageCount} page(s) currently flagged.
        </Faint>

        <label style={{ fontSize: 12, color: COLOR.textDim, display: "flex", flexDirection: "column", gap: 4 }}>
          pages (e.g. 3-5,8)
          <input
            value={pages}
            onChange={(e) => setPages(e.target.value)}
            placeholder="3-5,8"
            style={{ background: COLOR.bgInput, color: COLOR.text, border: `1px solid ${COLOR.border}`, padding: "6px 10px", fontFamily: FONT_MONO, fontSize: 13, outline: "none" }}
          />
        </label>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <OptionChip label="force OCR" on={forceOcr} onToggle={() => setForceOcr((v) => !v)} />
          <OptionChip label="inline math" on={inlineMath} onToggle={() => setInlineMath((v) => !v)} />
          <OptionChip label="table processing" on={tableProcessing} onToggle={() => setTableProcessing((v) => !v)} />
          <OptionChip label="external VLM" on={useLlm} onToggle={() => setUseLlm((v) => !v)} danger />
        </div>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: useLlm ? COLOR.amber : COLOR.textDim, cursor: "pointer" }}>
          <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
          <span>
            I consent to {useLlm ? "sending these pages to an external VLM service" : "re-running local extraction"} for repair.
            {useLlm && " This leaves the device."}
          </span>
        </label>

        {error && <div style={{ color: COLOR.red, fontSize: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={buttonStyle(false)}>
            cancel
          </button>
          <button onClick={() => void start()} style={buttonStyle(consented)} disabled={busy || !consented}>
            {busy ? "starting…" : "run repair"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OptionChip({ label, on, onToggle, danger = false }: { label: string; on: boolean; onToggle: () => void; danger?: boolean }) {
  const color = on ? (danger ? COLOR.red : COLOR.amber) : COLOR.textFaint;
  return (
    <span
      onClick={onToggle}
      style={{ cursor: "pointer", fontFamily: FONT_MONO, fontSize: 11, color, border: `1px solid ${on ? color : COLOR.border}`, padding: "3px 10px", background: on ? "#241d12" : "transparent" }}
    >
      {on ? "☑" : "☐"} {label}
    </span>
  );
}

function buttonStyle(primary: boolean): CSSProperties {
  return {
    padding: "6px 14px",
    fontSize: 12,
    fontFamily: FONT_MONO,
    border: `1px solid ${primary ? COLOR.amber : COLOR.border}`,
    background: primary ? "#241d12" : "transparent",
    color: primary ? COLOR.amber : COLOR.textDim,
    cursor: "pointer"
  };
}
