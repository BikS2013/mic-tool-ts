/**
 * Tests for `src/config/expiry.ts` — operational expiry tracking helper.
 */

import { describe, it, expect, vi } from "vitest";
import { evaluateExpiry, warnAboutExpiry } from "../src/config/expiry.js";

const REFERENCE_NOW = new Date("2026-05-16T12:00:00Z");

describe("evaluateExpiry", () => {
  it("returns 'ok' when expiry is more than 14 days away", () => {
    const r = evaluateExpiry("2026-12-31", REFERENCE_NOW);
    expect(r.level).toBe("ok");
    expect(r.daysUntil).toBeGreaterThan(14);
  });

  it("returns 'soon' when expiry is within 14 days", () => {
    const r = evaluateExpiry("2026-05-25", REFERENCE_NOW); // ~9 days
    expect(r.level).toBe("soon");
    expect(r.daysUntil).toBeGreaterThanOrEqual(0);
    expect(r.daysUntil).toBeLessThanOrEqual(14);
  });

  it("returns 'soon' on exactly the warning-window boundary (14 days)", () => {
    const r = evaluateExpiry("2026-05-30", REFERENCE_NOW); // exactly 14 days
    expect(r.level).toBe("soon");
  });

  it("returns 'expired' when expiry is in the past", () => {
    const r = evaluateExpiry("2026-05-01", REFERENCE_NOW);
    expect(r.level).toBe("expired");
    expect(r.daysUntil).toBeLessThan(0);
  });
});

describe("warnAboutExpiry", () => {
  it("writes nothing when isoDate is undefined and verbose is false", () => {
    const writer = vi.fn();
    warnAboutExpiry(undefined, false, writer, REFERENCE_NOW);
    expect(writer).not.toHaveBeenCalled();
  });

  it("writes a 'disabled' note under verbose when isoDate is undefined", () => {
    const writer = vi.fn();
    warnAboutExpiry(undefined, true, writer, REFERENCE_NOW);
    expect(writer).toHaveBeenCalledOnce();
    expect(writer.mock.calls[0]![0]).toContain("expiry tracking disabled");
  });

  it("writes a WARNING when the key has expired", () => {
    const writer = vi.fn();
    warnAboutExpiry("2026-05-01", false, writer, REFERENCE_NOW);
    expect(writer).toHaveBeenCalledOnce();
    expect(writer.mock.calls[0]![0]).toMatch(/WARNING.*expired/);
    expect(writer.mock.calls[0]![0]).toContain("2026-05-01");
  });

  it("writes a WARNING when the key expires within the warning window", () => {
    const writer = vi.fn();
    warnAboutExpiry("2026-05-25", false, writer, REFERENCE_NOW);
    expect(writer).toHaveBeenCalledOnce();
    expect(writer.mock.calls[0]![0]).toMatch(/WARNING.*expires in/);
  });

  it("writes nothing for a healthy expiry when verbose is false", () => {
    const writer = vi.fn();
    warnAboutExpiry("2026-12-31", false, writer, REFERENCE_NOW);
    expect(writer).not.toHaveBeenCalled();
  });

  it("writes a status line for a healthy expiry under verbose", () => {
    const writer = vi.fn();
    warnAboutExpiry("2026-12-31", true, writer, REFERENCE_NOW);
    expect(writer).toHaveBeenCalledOnce();
    expect(writer.mock.calls[0]![0]).toMatch(/expires in .* days/);
  });
});
