import { describe, expect, it } from "vitest";
import {
  CONDITION_FIELDS,
  CONDITION_FIELDS_ORDER,
  SCHEDULE_LABELS,
  nextRunAt,
  summarizeRule,
} from "../src/shared/automation";
import type { AutomationRule } from "../src/shared/types";

function rule(schedule: AutomationRule["schedule"], scheduleTime?: string, scheduleDay?: number): Pick<AutomationRule, "schedule" | "scheduleTime" | "scheduleDay"> {
  return { schedule, scheduleTime, scheduleDay };
}

/** Mercredi 12 août 2026, 10:20 locale. */
const NOW = new Date(2026, 7, 12, 10, 20, 0);
const DAY = 86400000;

function local(ts: number): string {
  return new Date(ts).toString();
}

describe("nextRunAt — prochaine exécution planifiée", () => {
  it("manuel : jamais de prochaine exécution", () => {
    expect(nextRunAt(rule("manual"), NOW)).toBeNull();
  });

  it("horaire : prochaine heure pleine", () => {
    expect(nextRunAt(rule("hourly"), NOW)).toBe(new Date(2026, 7, 12, 11, 0, 0).getTime());
    expect(nextRunAt(rule("hourly"), new Date(2026, 7, 12, 11, 0, 0))).toBe(new Date(2026, 7, 12, 12, 0, 0).getTime());
  });

  it("quotidien : aujourd'hui si l'heure n'est pas passée, sinon demain", () => {
    expect(nextRunAt(rule("daily", "02:00"), NOW)).toBe(new Date(2026, 7, 13, 2, 0, 0).getTime());
    expect(nextRunAt(rule("daily", "12:00"), NOW)).toBe(new Date(2026, 7, 12, 12, 0, 0).getTime());
    // minuit et demie : l'heure du jour est passée → lendemain
    expect(nextRunAt(rule("daily", "02:00"), new Date(2026, 7, 12, 0, 30))).toBe(new Date(2026, 7, 12, 2, 0, 0).getTime());
  });

  it("hebdomadaire : prochain jour ciblé (mercredi → vendredi)", () => {
    // scheduleDay utilise getDay() : 0 = dimanche, 5 = vendredi.
    const next = nextRunAt(rule("weekly", "02:00", 5), NOW)!;
    expect(new Date(next).getDay()).toBe(5);
    expect(new Date(next).getHours()).toBe(2);
    expect(new Date(next).getMinutes()).toBe(0);
    // le vendredi 14 août 2026
    expect(new Date(next).getDate()).toBe(14);
  });

  it("hebdomadaire : le jour même est pris en compte si l'heure n'est pas passée", () => {
    // mercredi 12, scheduleDay 3 (mercredi) à 18:00 → aujourd'hui 18:00
    const next = nextRunAt(rule("weekly", "18:00", 3), NOW)!;
    expect(new Date(next).getDate()).toBe(12);
  });

  it("mensuel : prochain jour du mois (avec clamp sur les mois courts)", () => {
    // 15 du mois, passé → mois suivant
    expect(nextRunAt(rule("monthly", "02:00", 1), NOW)).toBe(new Date(2026, 8, 1, 2, 0, 0).getTime());
    // jour 31 en août (31 jours) → 31 août
    expect(new Date(nextRunAt(rule("monthly", "02:00", 31), NOW)!).getDate()).toBe(31);
    // jour 31 en septembre (30 jours) → clamp au 30 septembre
    const sep1 = new Date(2026, 8, 1, 10, 0);
    const clamped = new Date(nextRunAt(rule("monthly", "02:00", 31), sep1)!);
    expect(clamped.getMonth()).toBe(8);
    expect(clamped.getDate()).toBe(30);
  });

  it("respecte le fuseau local (heure locale, pas UTC)", () => {
    const next = nextRunAt(rule("daily", "02:00"), NOW)!;
    expect(local(next)).toContain("02:00");
    expect(next - NOW.getTime()).toBeLessThan(2 * DAY);
  });
});

describe("métadonnées de l'éditeur de règles", () => {
  it("chaque champ de condition a un opérateur par défaut valide et une valeur par défaut", () => {
    for (const field of CONDITION_FIELDS_ORDER) {
      const meta = CONDITION_FIELDS[field];
      expect(meta.operators).toContain(meta.defaultOperator);
      if (meta.valueKind === "enum") {
        expect(meta.enumValues?.length).toBeGreaterThan(0);
        expect(meta.enumValues).toContain(meta.defaultValue);
      }
    }
  });

  it("expose les libellés de planification", () => {
    expect(SCHEDULE_LABELS.daily).toBe("Quotidien");
    expect(SCHEDULE_LABELS.monthly).toBe("Mensuel");
  });

  it("résume une règle en nombre de conditions et d'actions", () => {
    expect(
      summarizeRule({
        condition: { operator: "AND", conditions: [{ field: "kind", operator: "eq", value: "temp" }, { field: "ageDays", operator: "gte", value: 30 }] },
        actions: [{ type: "moveToQuarantine" }],
      }),
    ).toBe("2 conditions · 1 action");
  });
});
