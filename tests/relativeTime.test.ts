import { afterEach, describe, expect, it, vi } from "vitest";
import { relativeTime } from "../src/shared/types";

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("null / absent → Jamais", () => {
    expect(relativeTime(null)).toBe("Jamais");
    expect(relativeTime(undefined)).toBe("Jamais");
    expect(relativeTime(0)).toBe("Jamais");
  });

  it("passé : minutes, heures, jours", () => {
    const now = Date.now();
    expect(relativeTime(now - 5 * 60000)).toBe("Il y a 5 min");
    expect(relativeTime(now - 3 * 3600000)).toBe("Il y a 3 h");
    expect(relativeTime(now - 2 * 86400000)).toBe("Il y a 2 j");
  });

  it("futur : libellés « Dans … » (prochaine exécution)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 10, 0, 0));
    expect(relativeTime(Date.now() + 30 * 60000)).toBe("Dans 30 min");
    expect(relativeTime(Date.now() + 4 * 3600000)).toBe("Dans 4 h");
    expect(relativeTime(Date.now() + 3 * 86400000)).toBe("Dans 3 j");
    expect(relativeTime(Date.now() + 10 * 1000)).toBe("Dans moins d'une minute");
  });
});
