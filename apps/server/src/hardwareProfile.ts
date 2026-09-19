import * as NodeOS from "node:os";

import type { HardwareProfileSelection } from "@t3tools/contracts";
import {
  HARDWARE_PROFILE_ENV,
  parseHardwareProfileSelection,
  resolveHardwareProfile,
  scaleTimeoutMs as scaleMs,
  type HardwareFacts,
  type ResolvedHardwareProfile,
} from "@t3tools/shared/performanceProfile";

export { HARDWARE_PROFILE_ENV };

/**
 * The process-wide answer to "how slow is this machine?", in the form provider
 * layers need it: how long a cold start is allowed to take.
 *
 * Probe budgets live deep inside provider layers, as module-scope constants
 * read before — and independently of — anything that can read settings:
 * `opencode --version` gets 4s, `grok models` 10s, the Cursor ACP handshake
 * 15s. Those numbers are sized for a fast developer machine, so on a slow
 * laptop the cold start loses the race and the user is told the provider is
 * broken or missing. Each of those budgets asks this module instead of
 * hard-coding, so one setting moves all of them.
 *
 * A module-level value rather than a service: how slow the box is, is a
 * property of the box rather than of a request, and `auto` needs no I/O, so a
 * probe that runs before the server has read `settings.json` still gets this
 * machine's correct answer. The settings read only refines an explicit
 * `low-end`/`standard` choice, which is why a failed settings read leaves the
 * holder at `auto` rather than failing anything.
 */

let configuredSelection: HardwareProfileSelection | undefined;

const readProcessHardwareFacts = (): HardwareFacts => ({
  cpuCount: NodeOS.cpus().length,
  totalMemoryBytes: NodeOS.totalmem(),
});

/**
 * Resolution order, most specific first: the environment variable, then the
 * caller's selection (the settings file), then the last configured selection,
 * then `auto`.
 */
export const resolveProcessHardwareProfile = (input?: {
  readonly selection?: HardwareProfileSelection | undefined;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly facts?: HardwareFacts;
}): ResolvedHardwareProfile => {
  const environment = input?.environment ?? process.env;
  const selection =
    parseHardwareProfileSelection(environment[HARDWARE_PROFILE_ENV]) ??
    input?.selection ??
    configuredSelection;
  return resolveHardwareProfile({
    selection,
    facts: input?.facts ?? readProcessHardwareFacts(),
  });
};

/** Called once settings are readable, and again whenever they change. */
export const configureHardwareProfile = (selection: HardwareProfileSelection): void => {
  configuredSelection = selection;
};

/** Forgets the configured selection, returning the process to `auto`. */
export const resetConfiguredHardwareProfile = (): void => {
  configuredSelection = undefined;
};

export const currentHardwareProfile = (): ResolvedHardwareProfile =>
  resolveProcessHardwareProfile();

/** A cold-start or probe budget, in milliseconds, for this machine. */
export const scaledTimeoutMs = (baseMs: number): number =>
  scaleMs(baseMs, currentHardwareProfile().timeoutScale);
