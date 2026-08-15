import { describe, expect, it } from "vitest";
import { analyzeGrowth } from "../src/shared/guardianPro";

const DAY = 86400000;
const GB = 1024 ** 3;

function series(dailyGrowth: number, days = 30): Array<{ at: number; used: number }> {
  const now = Date.now();
  return Array.from({ length: days }, (_, i) => ({
    at: now - (days - 1 - i) * DAY,
    used: 100 * GB + i * dailyGrowth,
  }));
}

describe("analyzeGrowth — détection de croissance anormale", () => {
  it("pas assez de mesures → non anormal, message neutre", () => {
    const a = analyzeGrowth([{ at: 1, used: 1 }, { at: 2, used: 2 }]);
    expect(a.anomalous).toBe(false);
    expect(a.message).toContain("Pas assez de mesures");
  });

  it("croissance constante → aucune anomalie", () => {
    const a = analyzeGrowth(series(1 * GB));
    expect(a.anomalous).toBe(false);
    expect(a.message).toContain("aucune anomalie");
  });

  it("accélération récente nette → anomalie détectée", () => {
    // 20 premiers jours : 0,5 Go/jour. Les 10 derniers : 5 Go/jour.
    const now = Date.now();
    const points: Array<{ at: number; used: number }> = [];
    for (let i = 0; i < 20; i++) points.push({ at: now - (29 - i) * DAY, used: 100 * GB + i * 0.5 * GB });
    for (let i = 20; i < 30; i++) points.push({ at: now - (29 - i) * DAY, used: 100 * GB + 20 * 0.5 * GB + (i - 20) * 5 * GB });
    const a = analyzeGrowth(points);
    expect(a.anomalous).toBe(true);
    expect(a.message).toContain("Croissance anormale");
  });

  it("stockage en baisse → aucune anomalie", () => {
    const a = analyzeGrowth(series(-1 * GB));
    expect(a.anomalous).toBe(false);
  });

  it("message clair (jamais technique)", () => {
    const a = analyzeGrowth(series(1 * GB));
    expect(a.message).not.toMatch(/rateAll|ratio|GB\/jour,/);
  });
});
