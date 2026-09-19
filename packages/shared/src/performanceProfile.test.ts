import { assert, describe, it } from "@effect/vitest";

import {
  LOW_END_TIMEOUT_SCALE,
  detectLowEndHardware,
  parseHardwareProfileSelection,
  resolveHardwareProfile,
  scaleTimeoutMs,
} from "./performanceProfile.ts";

const GIB = 1024 ** 3;

// The machine this classification exists for: a Core i5-2450M (2 cores, 4
// threads) with 8 GB of memory.
const LOW_END_LAPTOP = { cpuCount: 4, totalMemoryBytes: 8 * GIB };
// A continuous-integration runner. It must stay on unscaled budgets, or every
// existing probe assertion changes with the machine the suite runs on.
const CI_RUNNER = { cpuCount: 4, totalMemoryBytes: 16 * GIB };

describe("detectLowEndHardware", () => {
  it("classifies a dual-core laptop as low-end", () => {
    assert.isTrue(detectLowEndHardware(LOW_END_LAPTOP));
  });

  it("treats two cores as low-end no matter how much memory is fitted", () => {
    assert.isTrue(detectLowEndHardware({ cpuCount: 2, totalMemoryBytes: 64 * GIB }));
  });

  it("leaves a four-thread machine with enough memory alone", () => {
    assert.isFalse(detectLowEndHardware(CI_RUNNER));
  });

  it("leaves a fast machine alone", () => {
    assert.isFalse(detectLowEndHardware({ cpuCount: 16, totalMemoryBytes: 32 * GIB }));
  });
});

describe("resolveHardwareProfile", () => {
  it("classifies the machine when no selection is stored", () => {
    assert.deepEqual(resolveHardwareProfile({ selection: undefined, facts: LOW_END_LAPTOP }), {
      selection: "auto",
      lowEnd: true,
      timeoutScale: LOW_END_TIMEOUT_SCALE,
    });
  });

  it("honors a stored low-end selection on a machine that looks fast", () => {
    assert.deepEqual(resolveHardwareProfile({ selection: "low-end", facts: CI_RUNNER }), {
      selection: "low-end",
      lowEnd: true,
      timeoutScale: LOW_END_TIMEOUT_SCALE,
    });
  });

  it("honors a stored standard selection on a machine that looks slow", () => {
    assert.deepEqual(resolveHardwareProfile({ selection: "standard", facts: LOW_END_LAPTOP }), {
      selection: "standard",
      lowEnd: false,
      timeoutScale: 1,
    });
  });
});

describe("parseHardwareProfileSelection", () => {
  it("accepts the stored spellings, trimmed and without regard to case", () => {
    assert.equal(parseHardwareProfileSelection("low-end"), "low-end");
    assert.equal(parseHardwareProfileSelection("  LOW-END  "), "low-end");
    assert.equal(parseHardwareProfileSelection("Standard"), "standard");
    assert.equal(parseHardwareProfileSelection("auto"), "auto");
  });

  it("ignores anything else", () => {
    assert.isUndefined(parseHardwareProfileSelection(undefined));
    assert.isUndefined(parseHardwareProfileSelection(""));
    assert.isUndefined(parseHardwareProfileSelection("slow"));
  });
});

describe("scaleTimeoutMs", () => {
  it("leaves a standard machine's budgets untouched", () => {
    assert.equal(scaleTimeoutMs(4_000, 1), 4_000);
  });

  it("stretches a low-end machine's budgets", () => {
    assert.equal(scaleTimeoutMs(4_000, LOW_END_TIMEOUT_SCALE), 20_000);
    assert.equal(scaleTimeoutMs(8_000, LOW_END_TIMEOUT_SCALE), 40_000);
  });
});
