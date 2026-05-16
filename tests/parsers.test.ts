/**
 * Tests for `src/config/parsers.ts` — typed coercion helpers.
 */

import { describe, it, expect } from "vitest";
import {
  parseBoolean,
  parseCsvNonEmpty,
  parseIsoDate,
  parsePositiveInt,
  parseWsUrl,
} from "../src/config/parsers.js";
import { InvalidConfigurationError } from "../src/errors.js";

describe("parseBoolean", () => {
  for (const v of ["true", "TRUE", "yes", "on", "1"]) {
    it(`accepts ${JSON.stringify(v)} as true`, () => {
      expect(parseBoolean(v, "--x", "X")).toBe(true);
    });
  }
  for (const v of ["false", "FALSE", "no", "off", "0"]) {
    it(`accepts ${JSON.stringify(v)} as false`, () => {
      expect(parseBoolean(v, "--x", "X")).toBe(false);
    });
  }
  it("rejects unknown values with a message naming both flag and env var", () => {
    try {
      parseBoolean("maybe", "--x", "MY_VAR");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidConfigurationError);
      expect((err as Error).message).toContain("--x");
      expect((err as Error).message).toContain("MY_VAR");
    }
  });
});

describe("parsePositiveInt", () => {
  it("parses a positive integer", () => {
    expect(parsePositiveInt("16000", "--x", "X")).toBe(16000);
  });
  it("rejects negative numbers", () => {
    expect(() => parsePositiveInt("-1", "--x", "X")).toThrowError(
      InvalidConfigurationError,
    );
  });
  it("rejects non-integers", () => {
    expect(() => parsePositiveInt("3.14", "--x", "X")).toThrowError(
      InvalidConfigurationError,
    );
  });
  it("enforces min", () => {
    expect(() => parsePositiveInt("5", "--x", "X", 10)).toThrowError(/>= 10/);
  });
  it("enforces max", () => {
    expect(() => parsePositiveInt("100", "--x", "X", 0, 50)).toThrowError(
      /<= 50/,
    );
  });
});

describe("parseCsvNonEmpty", () => {
  it("splits on commas and trims items", () => {
    expect(parseCsvNonEmpty("a, b ,c", "--x", "X")).toEqual(["a", "b", "c"]);
  });
  it("drops empty items between commas", () => {
    expect(parseCsvNonEmpty("a,,b", "--x", "X")).toEqual(["a", "b"]);
  });
  it("throws when the value is empty after splitting", () => {
    expect(() => parseCsvNonEmpty(" ,  , ", "--x", "X")).toThrowError(
      InvalidConfigurationError,
    );
  });
});

describe("parseIsoDate", () => {
  it("accepts a valid YYYY-MM-DD date", () => {
    expect(parseIsoDate("2026-12-31", "--x", "X")).toBe("2026-12-31");
  });
  it("rejects malformed strings", () => {
    expect(() => parseIsoDate("2026/01/01", "--x", "X")).toThrowError(
      InvalidConfigurationError,
    );
  });
  it("rejects impossible calendar dates (e.g. February 30)", () => {
    expect(() => parseIsoDate("2026-02-30", "--x", "X")).toThrowError(
      InvalidConfigurationError,
    );
  });
});

describe("parseWsUrl", () => {
  it("accepts wss://", () => {
    expect(parseWsUrl("wss://example.com/path", "--x", "X")).toBe(
      "wss://example.com/path",
    );
  });
  it("accepts ws://", () => {
    expect(parseWsUrl("ws://example.com", "--x", "X")).toBe(
      "ws://example.com",
    );
  });
  it("rejects http://", () => {
    expect(() => parseWsUrl("http://example.com", "--x", "X")).toThrowError(
      InvalidConfigurationError,
    );
  });
  it("rejects junk", () => {
    expect(() => parseWsUrl("not a url", "--x", "X")).toThrowError(
      InvalidConfigurationError,
    );
  });
});
