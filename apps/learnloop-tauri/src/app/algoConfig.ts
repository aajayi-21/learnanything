// Algorithm-owned display constants, sourced from the sidecar's config payload
// so the frontend never duplicates algorithm opinions. The fallbacks mirror the
// backend defaults in src/learnloop/config.py and only apply before the first
// app snapshot arrives (or against a sidecar that predates these fields).

export interface AlgoDisplayConfig {
  /** Mastery mean above which the UI renders "strong" (green). */
  masteryStrongThreshold: number;
  /** Mastery mean above which the UI renders "developing" (amber); below is red. */
  masteryDevelopingThreshold: number;
  /** Surprise threshold τ (nats) used when a feedback bundle lacks its own. */
  tauFollowupNats: number;
  /** Operating point of the continuous follow-up gate score. */
  gateScoreThreshold: number;
}

const DEFAULTS: AlgoDisplayConfig = {
  masteryStrongThreshold: 0.6,
  masteryDevelopingThreshold: 0.35,
  tauFollowupNats: 0.05,
  gateScoreThreshold: 0.5
};

let current: AlgoDisplayConfig = { ...DEFAULTS };

export function setAlgoConfig(config: unknown): void {
  const root = (config ?? {}) as {
    mastery?: { displayStrongThreshold?: unknown; displayDevelopingThreshold?: unknown };
    scheduler?: { followup?: { tauFollowupNats?: unknown; gateScoreThreshold?: unknown } };
  };
  current = {
    masteryStrongThreshold: asNumber(root.mastery?.displayStrongThreshold, DEFAULTS.masteryStrongThreshold),
    masteryDevelopingThreshold: asNumber(root.mastery?.displayDevelopingThreshold, DEFAULTS.masteryDevelopingThreshold),
    tauFollowupNats: asNumber(root.scheduler?.followup?.tauFollowupNats, DEFAULTS.tauFollowupNats),
    gateScoreThreshold: asNumber(root.scheduler?.followup?.gateScoreThreshold, DEFAULTS.gateScoreThreshold)
  };
}

export function algoConfig(): AlgoDisplayConfig {
  return current;
}

export type MasteryBand = "strong" | "developing" | "weak";

export function masteryBand(mastery: number): MasteryBand {
  if (mastery > current.masteryStrongThreshold) return "strong";
  if (mastery > current.masteryDevelopingThreshold) return "developing";
  return "weak";
}

/** Maps a mastery mean to the palette's green/amber/red for the given screen. */
export function masteryTone<T>(mastery: number, palette: { green: T; amber: T; red: T }): T {
  const band = masteryBand(mastery);
  return band === "strong" ? palette.green : band === "developing" ? palette.amber : palette.red;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
