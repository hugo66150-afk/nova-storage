import { describe, expect, it } from "vitest";
import {
  AUTOCLEAN_DEFAULTS,
  autoCleanDue,
  buildAutoCleanCondition,
  buildAutoCleanRule,
  nextAutoCleanRun,
  sanitizeAutoCleanConfig,
  summarizeAutoClean,
} from "../src/shared/autoclean";
import type { AutoCleanConfig } from "../src/shared/types";

function config(overrides: Partial<AutoCleanConfig> = {}): AutoCleanConfig {
  return { ...AUTOCLEAN_DEFAULTS, ...overrides };
}

describe("sanitizeAutoCleanConfig — configuration robuste", () => {
  it("retourne les valeurs par défaut pour une entrée vide", () => {
    expect(sanitizeAutoCleanConfig(null)).toEqual(AUTOCLEAN_DEFAULTS);
    expect(sanitizeAutoCleanConfig(undefined)).toEqual(AUTOCLEAN_DEFAULTS);
  });

  it("ignore les valeurs invalides et corrige les bornes", () => {
    const out = sanitizeAutoCleanConfig({
      enabled: true,
      trigger: "mensuel" as never,
      triggerTime: "99:99",
      triggerDay: 99,
      triggerPct: 5,
      actions: ["temp", "inconnu" as never],
      action: "supprimer" as never,
      largeFilesGo: -5,
      oldDownloadsDays: 99999,
    });
    expect(out.trigger).toBe(AUTOCLEAN_DEFAULTS.trigger);
    expect(out.triggerTime).toBe(AUTOCLEAN_DEFAULTS.triggerTime);
    expect(out.triggerDay).toBeGreaterThanOrEqual(0);
    expect(out.triggerDay).toBeLessThanOrEqual(6);
    expect(out.triggerPct).toBeGreaterThanOrEqual(50);
    expect(out.actions).toEqual(["temp"]);
    expect(out.action).toBe("quarantine");
    expect(out.largeFilesGo).toBeGreaterThanOrEqual(0.1);
    expect(out.oldDownloadsDays).toBeLessThanOrEqual(3650);
  });

  it("conserve une liste d'actions valide non vide", () => {
    const out = sanitizeAutoCleanConfig({ actions: [] });
    expect(out.actions.length).toBeGreaterThan(0);
  });
});

describe("buildAutoCleanCondition — conditions SI", () => {
  it("temp → condition catégorie temp", () => {
    const cond = buildAutoCleanCondition(["temp"], config());
    expect(cond.operator).toBe("OR");
    expect(cond.groups?.length).toBe(1);
    expect(cond.groups![0].conditions[0]).toEqual({ field: "category", operator: "eq", value: "temp" });
  });

  it("oldDownloads → catégorie downloads ET ancienneté", () => {
    const cond = buildAutoCleanCondition(["oldDownloads"], config({ oldDownloadsDays: 45 }));
    const group = cond.groups![0];
    expect(group.operator).toBe("AND");
    expect(group.conditions).toContainEqual({ field: "category", operator: "eq", value: "downloads" });
    expect(group.conditions).toContainEqual({ field: "ageDays", operator: "gte", value: 45 });
  });

  it("largeFiles → seuil en octets", () => {
    const cond = buildAutoCleanCondition(["largeFiles"], config({ largeFilesGo: 2 }));
    expect(cond.groups![0].conditions[0]).toEqual({ field: "size", operator: "gte", value: 2 * 1024 ** 3 });
  });

  it("actions multiples → autant de sous-groupes (OR)", () => {
    const cond = buildAutoCleanCondition(["temp", "oldDownloads"], config());
    expect(cond.groups?.length).toBe(2);
  });

  it("aucune action → repli sûr sur temp", () => {
    const cond = buildAutoCleanCondition([], config());
    expect(cond.groups![0].conditions[0].value).toBe("temp");
  });
});

describe("buildAutoCleanRule — règle interne réutilisant le moteur", () => {
  it("action quarantaine par défaut, planification manuelle", () => {
    const rule = buildAutoCleanRule(config(), 42);
    expect(rule.id).toBe(42);
    expect(rule.name).toBe("Nova AutoClean");
    expect(rule.schedule).toBe("manual");
    expect(rule.actions).toEqual([{ type: "moveToQuarantine" }]);
    expect(rule.condition.groups?.length).toBeGreaterThan(0);
  });

  it("action corbeille si configurée", () => {
    const rule = buildAutoCleanRule(config({ action: "recycleBin" }), 42);
    expect(rule.actions).toEqual([{ type: "deleteToRecycleBin" }]);
  });

  it("enabled suit la config", () => {
    expect(buildAutoCleanRule(config({ enabled: true }), 1).enabled).toBe(true);
    expect(buildAutoCleanRule(config({ enabled: false }), 1).enabled).toBe(false);
  });
});

describe("autoCleanDue — logique de déclenchement", () => {
  it("désactivé → jamais dû", () => {
    expect(autoCleanDue(config({ enabled: false }), 0, 99)).toBe(false);
  });

  it("daily : dû après l'heure prévue, une seule fois par jour", () => {
    const at = new Date("2026-08-15T03:00:00").getTime();
    expect(autoCleanDue(config({ enabled: true, trigger: "daily", triggerTime: "02:00" }), 0, null, at)).toBe(true);
    // Déjà exécuté aujourd'hui à 00:30 → pas dû.
    const today = new Date("2026-08-15T00:30:00").getTime();
    expect(autoCleanDue(config({ enabled: true, trigger: "daily", triggerTime: "02:00" }), today, null, at)).toBe(false);
    // Avant l'heure prévue → pas dû.
    expect(autoCleanDue(config({ enabled: true, trigger: "daily", triggerTime: "04:00" }), 0, null, at)).toBe(false);
  });

  it("weekly : dû seulement le jour configuré, une fois par semaine", () => {
    // Dimanche 16/08/2026 03:00
    const at = new Date("2026-08-16T03:00:00").getTime();
    const cfg = config({ enabled: true, trigger: "weekly", triggerDay: 0, triggerTime: "02:00" });
    expect(autoCleanDue(cfg, 0, null, at)).toBe(true);
    // Lundi 17/08 → pas dû.
    expect(autoCleanDue(cfg, 0, null, new Date("2026-08-17T03:00:00").getTime())).toBe(false);
    // Déjà exécuté aujourd'hui (00:30) → pas dû.
    const todayEarly = new Date("2026-08-16T00:30:00").getTime();
    expect(autoCleanDue(cfg, todayEarly, null, at)).toBe(false);
    // Exécuté la semaine dernière (dimanche 09/08) → dû à nouveau.
    const lastSunday = new Date("2026-08-09T03:00:00").getTime();
    expect(autoCleanDue(cfg, lastSunday, null, at)).toBe(true);
  });

  it("startup : une fois par jour, indépendamment de l'heure", () => {
    const at = new Date("2026-08-15T18:00:00").getTime();
    expect(autoCleanDue(config({ enabled: true, trigger: "startup" }), 0, null, at)).toBe(true);
    // Déjà exécuté aujourd'hui à 08:00 → pas dû.
    const todayMorning = new Date("2026-08-15T08:00:00").getTime();
    expect(autoCleanDue(config({ enabled: true, trigger: "startup" }), todayMorning, null, at)).toBe(false);
  });

  it("disk : dû quand le disque dépasse le seuil, une fois par jour", () => {
    const cfg = config({ enabled: true, trigger: "disk", triggerPct: 85 });
    expect(autoCleanDue(cfg, 0, 84, new Date("2026-08-15T10:00:00").getTime())).toBe(false);
    expect(autoCleanDue(cfg, 0, 86, new Date("2026-08-15T10:00:00").getTime())).toBe(true);
    // Déjà exécuté aujourd'hui → pas dû malgré le seuil franchi.
    const today = new Date("2026-08-15T00:30:00").getTime();
    expect(autoCleanDue(cfg, today, 99, new Date("2026-08-15T10:00:00").getTime())).toBe(false);
    // Seuil inconnu (null) → jamais dû.
    expect(autoCleanDue(cfg, 0, null, new Date("2026-08-15T10:00:00").getTime())).toBe(false);
  });
});

describe("nextAutoCleanRun — prochaine exécution", () => {
  it("null quand désactivé ou déclencheur non prévisible", () => {
    expect(nextAutoCleanRun(config({ enabled: false }), 0)).toBeNull();
    expect(nextAutoCleanRun(config({ enabled: true, trigger: "startup" }), 0)).toBeNull();
    expect(nextAutoCleanRun(config({ enabled: true, trigger: "disk" }), 0)).toBeNull();
  });

  it("daily : prochaine heure prévue, demain si dépassée", () => {
    const now = new Date("2026-08-15T03:00:00").getTime();
    const next = nextAutoCleanRun(config({ enabled: true, trigger: "daily", triggerTime: "02:00" }), 0, now)!;
    const d = new Date(next);
    expect(d.getHours()).toBe(2);
    expect(d.getMinutes()).toBe(0);
    expect(next).toBeGreaterThan(now);
    expect(d.getDate()).toBe(16); // demain
  });

  it("weekly : prochain jour configuré", () => {
    const now = new Date("2026-08-15T03:00:00").getTime(); // samedi
    const next = nextAutoCleanRun(config({ enabled: true, trigger: "weekly", triggerDay: 0, triggerTime: "02:00" }), 0, now)!;
    const d = new Date(next);
    expect(d.getDay()).toBe(0); // dimanche
    expect(next).toBeGreaterThan(now);
  });
});

describe("summarizeAutoClean — résumé lisible", () => {
  it("liste les actions et le déclencheur", () => {
    const s = summarizeAutoClean(config({ actions: ["temp", "largeFiles"], trigger: "daily" }));
    expect(s).toContain("Fichiers temporaires");
    expect(s).toContain("Gros fichiers");
    expect(s).toContain("Chaque jour");
  });
});
