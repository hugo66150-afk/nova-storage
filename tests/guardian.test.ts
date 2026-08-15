import { describe, expect, it } from "vitest";
import { buildAdvancedForecast, buildPrediction } from "../src/main/services/guardian.js";
import type { GuardianPrediction } from "../src/shared/types.js";

describe("buildPrediction", () => {
  it("retourne une prédiction non fiable avec moins de 2 points", () => {
    const p = buildPrediction([{ at: 0, used: 100, total: 1000 }]);
    expect(p).not.toBeNull();
    expect(p!.reliable).toBe(false);
    expect(p!.message).toContain("Pas assez de données");
  });

  it("retourne une prédiction non fiable si l'intervalle est trop court", () => {
    const now = Date.now();
    const p = buildPrediction(
      [
        { at: now - 1 * 86400000, used: 100, total: 1000 },
        { at: now, used: 110, total: 1000 },
      ],
      now,
    );
    expect(p!.reliable).toBe(false);
  });

  it("estime le délai avant saturation à partir de la croissance réelle", () => {
    const now = Date.now();
    const start = now - 30 * 86400000;
    // +30 Go en 30 jours => 1 Go/jour, 470 Go libres => 470 jours
    const points = [
      { at: start, used: 500 * 1024 ** 3, total: 1000 * 1024 ** 3 },
      { at: now, used: 530 * 1024 ** 3, total: 1000 * 1024 ** 3 },
    ];
    const p = buildPrediction(points, now);
    expect(p!.reliable).toBe(true);
    expect(p!.ratePerDay).toBeGreaterThan(0);
    expect(p!.daysToFull).toBeCloseTo(470, 0);
    expect(p!.message).toContain("plein dans environ");
  });

  it("ne prédit pas de saturation si le stockage baisse", () => {
    const now = Date.now();
    const start = now - 10 * 86400000;
    const p = buildPrediction(
      [
        { at: start, used: 200, total: 1000 },
        { at: now, used: 180, total: 1000 },
      ],
      now,
    );
    expect(p!.reliable).toBe(true);
    expect(p!.daysToFull).toBeNull();
  });

  it("type de retour cohérent", () => {
    const p: GuardianPrediction = buildPrediction([
      { at: 0, used: 1, total: 10 },
      { at: 86400000, used: 1, total: 10 },
    ])!;
    expect(typeof p.at).toBe("number");
    expect(typeof p.reliable).toBe("boolean");
  });
});

describe("buildAdvancedForecast — Gardien avancé (Pro)", () => {
  const DAY = 86400000;
  const GB = 1024 ** 3;
  const now = Date.now();
  const start = now - 30 * DAY;
  // +30 Go en 30 jours => 1 Go/jour ; disque 1 To, 500 Go utilisés => 500 Go libres.
  const snapshots = [
    { at: start, used: 470 * GB, total: 1000 * GB },
    { at: now - 15 * DAY, used: 485 * GB, total: 1000 * GB },
    { at: now, used: 500 * GB, total: 1000 * GB },
  ];

  it("retourne null avec moins de 2 points ou un intervalle trop court", () => {
    expect(buildAdvancedForecast([snapshots[0]], { warn: 80, alert: 90, critical: 95 })).toBeNull();
    expect(
      buildAdvancedForecast(
        [
          { at: now - DAY, used: 100, total: 1000 },
          { at: now, used: 110, total: 1000 },
        ],
        { warn: 80, alert: 90, critical: 95 },
      ),
    ).toBeNull();
  });

  it("estime les dates de franchissement des seuils et la saturation", () => {
    const f = buildAdvancedForecast(snapshots, { warn: 80, alert: 90, critical: 95 })!;
    expect(f).not.toBeNull();
    expect(f.reliable).toBe(true);
    expect(f.dataPoints).toBe(3);
    expect(f.spanDays).toBe(30);
    // 500 Go utilisés, 1 To total : seuil 90% = 900 Go => il faut 400 Go => 400 jours.
    expect(f.thresholds.length).toBe(3);
    const t90 = f.thresholds.find((t) => t.pct === 90)!;
    expect(t90.at).not.toBeNull();
    expect(t90.at! - now).toBeGreaterThan(350 * DAY);
    expect(t90.at! - now).toBeLessThan(450 * DAY);
    // Saturation : 500 Go libres / 1 Go par jour = 500 jours.
    expect(f.fullAt).not.toBeNull();
    expect(f.fullAt! - now).toBeGreaterThan(450 * DAY);
    expect(f.fullAt! - now).toBeLessThan(550 * DAY);
  });

  it("croissance stable : aucune date prévisible (at null)", () => {
    const stable = [
      { at: start, used: 500 * GB, total: 1000 * GB },
      { at: now, used: 498 * GB, total: 1000 * GB },
    ];
    const f = buildAdvancedForecast(stable, { warn: 80, alert: 90, critical: 95 })!;
    expect(f.reliable).toBe(false);
    for (const t of f.thresholds) expect(t.at).toBeNull();
    expect(f.fullAt).toBeNull();
  });
});
