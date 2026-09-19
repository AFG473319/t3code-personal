import type { HardwareProfileSelection } from "@t3tools/contracts";

/**
 * The two numbers that decide whether a machine can meet budgets sized for a
 * development laptop. Both matter independently: CPU decides how long a cold
 * `node` start takes, memory decides whether the provider processes running
 * alongside it have room to work.
 */
export interface HardwareFacts {
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
}

export interface ResolvedHardwareProfile {
  readonly selection: HardwareProfileSelection;
  readonly lowEnd: boolean;
  /** Multiplier for cold-start and probe budgets; `1` on a standard machine. */
  readonly timeoutScale: number;
}

// Four logical CPUs is every dual-core laptop with hyper-threading, which is
// the class of machine that keeps hitting the probe budgets. Four-core/eight-
// thread machines are left alone.
const LOW_END_MAX_CPU_COUNT = 4;
// Two cores is slow regardless of how much memory is fitted, so it does not
// need the memory test that four cores do.
const LOW_END_UNAMBIGUOUS_CPU_COUNT = 2;
// 12 GiB rather than 8 GiB: an "8 GB" machine reports slightly more than 8 GiB
// of installed memory, and a 12 GB machine cold-starts CLIs no faster. The
// cutoff is what keeps continuous-integration runners (4 vCPU, 16 GiB) out of
// the low-end bucket, so their existing probe budgets and assertions hold.
const LOW_END_MAX_TOTAL_MEMORY_BYTES = 12 * 1024 ** 3;

/**
 * Matches what a slow laptop needed by hand before this existed: its OpenCode
 * version probe went from 4s to 20s, and its OpenCode server start from 30s to
 * 120s. Only the deadline grows — a genuine hang still fails, five times
 * later.
 */
export const LOW_END_TIMEOUT_SCALE = 5;

/**
 * Overrides an environment's stored `hardwareProfile` for one process. Shared
 * because the server reads it for probe budgets and the desktop app reads it
 * for the Chromium switches it launches with, and those two must agree.
 */
export const HARDWARE_PROFILE_ENV = "T3_HARDWARE_PROFILE";

const HARDWARE_PROFILE_SELECTIONS: ReadonlyArray<HardwareProfileSelection> = [
  "auto",
  "low-end",
  "standard",
];

/** Reads a `T3_HARDWARE_PROFILE`-style value, ignoring anything unrecognized. */
export function parseHardwareProfileSelection(
  value: string | undefined,
): HardwareProfileSelection | undefined {
  const trimmed = value?.trim().toLowerCase();
  return HARDWARE_PROFILE_SELECTIONS.find((selection) => selection === trimmed);
}

export function detectLowEndHardware(facts: HardwareFacts): boolean {
  return (
    facts.cpuCount <= LOW_END_UNAMBIGUOUS_CPU_COUNT ||
    (facts.cpuCount <= LOW_END_MAX_CPU_COUNT &&
      facts.totalMemoryBytes <= LOW_END_MAX_TOTAL_MEMORY_BYTES)
  );
}

/**
 * `selection` is the environment's explicit choice; `undefined` behaves as
 * `auto`, so callers that have not read settings yet still get this machine's
 * answer.
 */
export function resolveHardwareProfile(input: {
  readonly selection: HardwareProfileSelection | undefined;
  readonly facts: HardwareFacts;
}): ResolvedHardwareProfile {
  const selection = input.selection ?? "auto";
  const lowEnd =
    selection === "auto" ? detectLowEndHardware(input.facts) : selection === "low-end";
  return {
    selection,
    lowEnd,
    timeoutScale: lowEnd ? LOW_END_TIMEOUT_SCALE : 1,
  };
}

export function scaleTimeoutMs(baseMs: number, timeoutScale: number): number {
  return timeoutScale > 1 ? Math.round(baseMs * timeoutScale) : baseMs;
}
