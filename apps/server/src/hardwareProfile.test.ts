import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  HARDWARE_PROFILE_ENV,
  configureHardwareProfile,
  currentHardwareProfile,
  resetConfiguredHardwareProfile,
  resolveProcessHardwareProfile,
  scaledTimeoutMs,
} from "./hardwareProfile.ts";

const GIB = 1024 ** 3;

// The laptop this exists for, and a machine that must keep its budgets.
const LOW_END_LAPTOP = { cpuCount: 4, totalMemoryBytes: 8 * GIB };
const FAST_MACHINE = { cpuCount: 16, totalMemoryBytes: 32 * GIB };

afterEach(() => {
  resetConfiguredHardwareProfile();
  vi.unstubAllEnvs();
});

describe("resolveProcessHardwareProfile", () => {
  it("classifies the machine when nothing is configured", () => {
    expect(resolveProcessHardwareProfile({ facts: LOW_END_LAPTOP }).lowEnd).toBe(true);
    expect(resolveProcessHardwareProfile({ facts: FAST_MACHINE }).lowEnd).toBe(false);
  });

  it("uses the configured selection on a machine that looks fast", () => {
    configureHardwareProfile("low-end");
    expect(resolveProcessHardwareProfile({ facts: FAST_MACHINE })).toMatchObject({
      lowEnd: true,
      timeoutScale: 5,
    });
  });

  it("lets the environment override the configured selection", () => {
    configureHardwareProfile("low-end");
    vi.stubEnv(HARDWARE_PROFILE_ENV, "standard");
    expect(resolveProcessHardwareProfile({ facts: LOW_END_LAPTOP }).lowEnd).toBe(false);

    configureHardwareProfile("standard");
    vi.stubEnv(HARDWARE_PROFILE_ENV, "low-end");
    expect(resolveProcessHardwareProfile({ facts: FAST_MACHINE }).lowEnd).toBe(true);
  });

  it("lets an explicit selection beat the configured one", () => {
    configureHardwareProfile("low-end");
    expect(resolveProcessHardwareProfile({ selection: "standard", facts: LOW_END_LAPTOP })).toMatchObject({
      selection: "standard",
      lowEnd: false,
    });
  });

  it("ignores an unrecognized environment value", () => {
    vi.stubEnv(HARDWARE_PROFILE_ENV, "not-a-profile");
    configureHardwareProfile("low-end");
    expect(resolveProcessHardwareProfile({ facts: FAST_MACHINE }).lowEnd).toBe(true);
  });
});

describe("scaledTimeoutMs", () => {
  it("hands a low-end machine the longer budget its cold starts needed", () => {
    // What the OpenCode version probe was raised to by hand on the machine this
    // profile is built for: 4s to 20s.
    configureHardwareProfile("low-end");
    expect(scaledTimeoutMs(4_000)).toBe(20_000);
  });

  it("leaves a fast machine on the base budget", () => {
    configureHardwareProfile("standard");
    expect(scaledTimeoutMs(4_000)).toBe(4_000);
  });

  it("falls back to this machine's classification when nothing is configured", () => {
    vi.stubEnv(HARDWARE_PROFILE_ENV, "standard");
    expect(currentHardwareProfile().lowEnd).toBe(false);
  });
});
