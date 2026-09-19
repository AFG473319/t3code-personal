// @effect-diagnostics nodeBuiltinImport:off - pre-ready Electron setup reads settings and prepares the Linux desktop entry synchronously before app services are available.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";
import type { HardwareProfileSelection } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import {
  HARDWARE_PROFILE_ENV,
  parseHardwareProfileSelection,
  resolveHardwareProfile,
  type HardwareFacts,
} from "@t3tools/shared/performanceProfile";

import * as DesktopEarlyElectronStartup from "./DesktopEarlyElectronStartup.ts";
import { resolveDesktopAppBranding } from "./DesktopEnvironment.ts";
import { renderUrlHandlerDesktopEntry } from "./DesktopLinuxUrlHandler.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";

export interface DesktopPreReadyCommandLineReader {
  readonly hasSwitch: (switchName: string) => boolean;
  readonly getSwitchValue: (switchName: string) => string;
}

function readCommandLineSwitchValue(
  commandLine: DesktopPreReadyCommandLineReader,
  switchName: string,
): string | null {
  if (!commandLine.hasSwitch(switchName)) {
    return null;
  }

  const value = commandLine.getSwitchValue(switchName).trim();
  return value.length > 0 ? value : null;
}

export interface DesktopElectronSwitch {
  readonly name: string;
  readonly value?: string;
}

/**
 * The Chromium switches that make the app lighter on a machine this small.
 * Resolved pre-ready because Chromium reads its switch list once, before the
 * first window exists, and because the user's alternative to a slow app here is
 * a frozen one: `CalculateNativeWinOcclusion` polling is a known cause of
 * Windows windows that stop repainting on older GPU drivers, and the spare
 * renderer is a whole extra process this app never needs to show one window.
 * `enable-low-end-device-mode` is Chromium's own low-end tuning — smaller
 * caches and fewer background subsystems, same UI.
 *
 * This classifies the machine the window is drawn on rather than reading the
 * server's `hardwareProfile`: the server can be remote, and a remote machine's
 * speed says nothing about this one's GPU. `T3_HARDWARE_PROFILE` overrides
 * both sides at once.
 */
export function resolveLowEndElectronSwitches(input: {
  readonly platform: NodeJS.Platform;
  readonly facts: HardwareFacts;
  readonly selection?: HardwareProfileSelection | undefined;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}): ReadonlyArray<DesktopElectronSwitch> {
  const environment = input.environment ?? process.env;
  const profile = resolveHardwareProfile({
    // The environment variable wins over the stored setting, matching the
    // server's resolution order for the same value.
    selection:
      parseHardwareProfileSelection(environment[HARDWARE_PROFILE_ENV]) ?? input.selection,
    facts: input.facts,
  });
  if (!profile.lowEnd) {
    return [];
  }
  // One switch, one value: Chromium keeps only the last `--disable-features`
  // it is handed, so the names have to be joined rather than appended twice.
  const disabledFeatures = [
    "SpareRendererForSitePerProcess",
    ...(input.platform === "win32" ? ["CalculateNativeWinOcclusion"] : []),
  ];
  return [
    { name: "enable-low-end-device-mode" },
    { name: "disable-features", value: disabledFeatures.join(",") },
  ];
}

export const resolveEarlyLinuxElectronOptionsFromProcess =
  (): DesktopEarlyElectronStartup.EarlyLinuxElectronOptions =>
    DesktopEarlyElectronStartup.resolveEarlyLinuxElectronOptions({
      env: process.env,
      homeDirectory: NodeOS.homedir(),
      joinPath: NodePath.posix.join,
      readFileString: (path) => NodeFS.readFileSync(path, "utf8"),
    });

export class DesktopPreReadyElectronOptions extends Context.Service<
  DesktopPreReadyElectronOptions,
  {
    readonly linux: DesktopEarlyElectronStartup.EarlyLinuxElectronOptions | null;
    readonly linuxPasswordStoreCommandLine: string | null;
  }
>()("@t3tools/desktop/app/DesktopPreReadyPlatform/DesktopPreReadyElectronOptions") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  return yield* Effect.sync((): DesktopPreReadyElectronOptions["Service"] => {
    const linuxPasswordStoreCommandLine =
      platform === "linux"
        ? readCommandLineSwitchValue(Electron.app.commandLine, "password-store")
        : null;
    const linux = platform === "linux" ? resolveEarlyLinuxElectronOptionsFromProcess() : null;

    if (linux !== null) {
      // The portal also requires a valid desktop entry. An AppImage update may
      // have removed the executable referenced by the previous launch's entry.
      try {
        const applicationsDir = NodePath.posix.join(
          process.env.XDG_DATA_HOME?.trim() ||
            NodePath.posix.join(NodeOS.homedir(), ".local", "share"),
          "applications",
        );
        NodeFS.mkdirSync(applicationsDir, { recursive: true });
        NodeFS.writeFileSync(
          NodePath.posix.join(applicationsDir, linux.linuxDesktopEntryName),
          renderUrlHandlerDesktopEntry({
            displayName: resolveDesktopAppBranding({
              isDevelopment: linux.isDevelopment,
              appVersion: Electron.app.getVersion(),
            }).displayName,
            execTarget: process.env.APPIMAGE?.trim() || process.execPath,
            scheme: ElectronProtocol.getDesktopScheme(linux.isDevelopment),
          }),
          "utf8",
        );
      } catch {
        // The URL handler retries with the full environment and logs failures.
      }
      // Chromium caches its portal registration during startup. Set the identity
      // before any asynchronous work can initialize it with Electron's default.
      Electron.app.setDesktopName(linux.linuxDesktopEntryName);
      Electron.app.commandLine.appendSwitch("class", linux.linuxWmClass);
      if (linux.passwordStore !== null && linuxPasswordStoreCommandLine === null) {
        Electron.app.commandLine.appendSwitch("password-store", linux.passwordStore);
      }
    }

    for (const commandLineSwitch of resolveLowEndElectronSwitches({
      platform,
      facts: { cpuCount: NodeOS.cpus().length, totalMemoryBytes: NodeOS.totalmem() },
    })) {
      if (commandLineSwitch.value === undefined) {
        Electron.app.commandLine.appendSwitch(commandLineSwitch.name);
      } else {
        Electron.app.commandLine.appendSwitch(commandLineSwitch.name, commandLineSwitch.value);
      }
    }

    return { linux, linuxPasswordStoreCommandLine };
  });
}).pipe(Effect.withSpan("desktop.electron.configureBeforeReady"));

// Keep Electron's strict pre-ready setup isolated so later runtime layers cannot
// observe app readiness before scheme privileges and command-line switches exist.
export const layer = Layer.mergeAll(
  ElectronProtocol.layerSchemePrivileges,
  Layer.effect(DesktopPreReadyElectronOptions, make),
);
