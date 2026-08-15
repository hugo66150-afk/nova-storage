import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatNumber } from "../src/shared/types";

describe("formatBytes", () => {
  it("returns 0 o for negative and non-finite values", () => {
    expect(formatBytes(-5)).toBe("0 o");
    expect(formatBytes(NaN)).toBe("0 o");
    expect(formatBytes(Infinity)).toBe("0 o");
  });

  it("formats bytes as integers below 1024", () => {
    expect(formatBytes(0)).toBe("0.0 o");
    expect(formatBytes(500)).toBe("500 o");
    expect(formatBytes(1023)).toBe("1023 o");
  });

  it("scales to the correct unit", () => {
    expect(formatBytes(1024)).toBe("1.0 Ko");
    expect(formatBytes(1024 ** 2)).toBe("1.0 Mo");
    expect(formatBytes(1024 ** 3)).toBe("1.0 Go");
    expect(formatBytes(1024 ** 4)).toBe("1.0 To");
  });

  it("rounds values >= 100 to whole numbers", () => {
    expect(formatBytes(100 * 1024)).toBe("100 Ko");
    expect(formatBytes(150 * 1024 ** 2)).toBe("150 Mo");
  });
});

describe("formatDuration", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(5000)).toBe("00:05");
    expect(formatDuration(65000)).toBe("01:05");
  });

  it("formats hours as hh:mm:ss", () => {
    expect(formatDuration(3600 * 1000)).toBe("01:00:00");
    expect(formatDuration(3661 * 1000)).toBe("01:01:01");
  });

  it("clamps negative values to zero", () => {
    expect(formatDuration(-1000)).toBe("00:00");
  });
});

describe("formatNumber", () => {
  it("uses fr-FR separators", () => {
    expect(formatNumber(1234567)).toBe("1 234 567");
  });
});
