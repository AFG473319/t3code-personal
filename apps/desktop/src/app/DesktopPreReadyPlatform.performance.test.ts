import { assert, describe, it } from "@effect/vitest";
import { afterEach, vi } from "vite-plus/test";

import { HARDWARE_PROFILE_ENV } from "@t3tools/shared/performanceProfile";

import { resolveLowEndElectronSwitches } from "./DesktopPreReadyPlatform.ts";

vi.mock("electron", () => ({
  app: {
    commandLine: {
      appendSwitch: () => {},
      getSwitchValue: () => "",
      hasSwitch: () => false,
      removeSwitch: () => {},
    },
    getVersion: () => "0.0.0",
    registerSchemesAsPrivileged: () => {},
    setDesktopName: () => {},
  },
}));

const GIB = 1024 ** 3;
const LOW_END_LAPTOP = { cpuCount: 4, totalMemoryBytes: 8 * GIB };
const FAST_MACHINE = { cpuCount: 16, totalMemoryBytes: 32 * GIB };

afterEach(() => vi.unstubAllEnvs());

describe("resolveLowEndElectronSwitches", () => {
  it("launches a slow Windows machine with the low-end switches", () => {
    assert.deepEqual(
      resolveLowEndElectronSwitches({
        platform: "win32",
        facts: LOW_END_LAPTOP,
        environment: {},
      }),
      [
        { name: "enable-low-end-device-mode" },
        {
          name: "disable-features",
          value: "SpareRendererForSitePerProcess,CalculateNativeWinOcclusion",
        },
      ],
    );
  });

  it("leaves a fast machine on Electron's defaults", () => {
    assert.deepEqual(
      resolveLowEndElectronSwitches({ platform: "win32", facts: FAST_MACHINE, environment: {} }),
      [],
    );
  });

  it("keeps the occlusion fix off other platforms, in one disable-features value", () => {
    assert.deepEqual(
      resolveLowEndElectronSwitches({ platform: "linux", facts: LOW_END_LAPTOP, environment: {} }),
      [
        { name: "enable-low-end-device-mode" },
        { name: "disable-features", value: "SpareRendererForSitePerProcess" },
      ],
    );
  });

  it("honors a stored low-end selection on a machine that looks fast", () => {
    const switches = resolveLowEndElectronSwitches({
      platform: "win32",
      facts: FAST_MACHINE,
      selection: "low-end",
      environment: {},
    });
    assert.isTrue(switches.some((entry) => entry.name === "enable-low-end-device-mode"));
  });

  it("honors a stored standard selection on a machine that looks slow", () => {
    assert.deepEqual(
      resolveLowEndElectronSwitches({
        platform: "win32",
        facts: LOW_END_LAPTOP,
        selection: "standard",
        environment: {},
      }),
      [],
    );
  });

  it("lets the environment override the stored selection", () => {
    assert.deepEqual(
      resolveLowEndElectronSwitches({
        platform: "win32",
        facts: FAST_MACHINE,
        selection: "standard",
        environment: { [HARDWARE_PROFILE_ENV]: "low-end" },
      }).length,
      2,
    );
  });
});
