import { describe, expect, it, vi } from "vitest";

// Le mock electron est autonome : le chemin userData est résolu à l'import du
// module (QUARANTINE_ROOT). Les exclusions sont mockées pour ne pas dépendre
// de la base SQLite (compilée pour l'ABI Electron, pas pour Node).
vi.mock("electron", () => {
  const p = require("node:path");
  const osMod = require("node:os");
  return {
    app: {
      getPath: () => p.join(osMod.tmpdir(), "nova-test-data"),
      getVersion: () => "1.0.0-test",
    },
    shell: {
      trashItem: vi.fn().mockResolvedValue(undefined),
    },
    Notification: class {
      show(): void {
        /* noop */
      }
    },
  };
});

vi.mock("../src/main/data/repositories.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/data/repositories.js")>();
  return {
    ...actual,
    getExclusions: () => [
      { id: 1, path: "D:\\KeepSafe", kind: "folder", createdAt: 0 },
      { id: 2, path: ".backup", kind: "extension", createdAt: 0 },
    ],
  };
});

import { blockedTargetReason, shouldRunNow } from "../src/main/services/automation.js";
import { conditionGroupToSql, conditionToSql } from "../src/main/utils/ruleEngine.js";
import type { AutomationRule, RuleConditionGroup } from "../src/shared/types.js";

function makeRule(overrides: Partial<AutomationRule>): AutomationRule {
  return {
    id: 1,
    name: "test",
    description: "",
    enabled: true,
    condition: { operator: "AND", conditions: [] },
    actions: [],
    schedule: "manual",
    lastRunAt: null,
    runCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("conditionGroupToSql — pré-filtre SQL des règles", () => {
  it("joint les conditions d'un groupe AND avec AND", () => {
    const group: RuleConditionGroup = {
      operator: "AND",
      conditions: [
        { field: "kind", operator: "eq", value: "temp" },
        { field: "size", operator: "gt", value: 1000 },
      ],
    };
    const params: Array<string | number> = [];
    expect(conditionGroupToSql(group, params)).toBe("(kind = ? AND size > ?)");
    expect(params).toEqual(["temp", 1000]);
  });

  it("joint les conditions d'un groupe OR avec OR (bug corrigé)", () => {
    const group: RuleConditionGroup = {
      operator: "OR",
      conditions: [
        { field: "kind", operator: "eq", value: "logs" },
        { field: "kind", operator: "eq", value: "temp" },
      ],
    };
    const params: Array<string | number> = [];
    expect(conditionGroupToSql(group, params)).toBe("(kind = ? OR kind = ?)");
    expect(params).toEqual(["logs", "temp"]);
  });

  it("ne pré-filtre pas un groupe OR contenant une condition non SQL (évite l'exclusion de candidats valides)", () => {
    const group: RuleConditionGroup = {
      operator: "OR",
      conditions: [
        { field: "kind", operator: "eq", value: "temp" },
        { field: "path", operator: "matches", value: ".*backup.*" },
      ],
    };
    const params: Array<string | number> = [];
    expect(conditionGroupToSql(group, params)).toBeNull();
    expect(params).toEqual([]);
  });

  it("omet une condition non SQL dans un groupe AND (sur-ensemble correct)", () => {
    const group: RuleConditionGroup = {
      operator: "AND",
      conditions: [
        { field: "kind", operator: "eq", value: "temp" },
        { field: "path", operator: "matches", value: ".*" },
      ],
    };
    const params: Array<string | number> = [];
    expect(conditionGroupToSql(group, params)).toBe("(kind = ?)");
    expect(params).toEqual(["temp"]);
  });

  it("retourne null pour un groupe vide", () => {
    const params: Array<string | number> = [];
    expect(conditionGroupToSql({ operator: "AND", conditions: [] }, params)).toBeNull();
  });

  it("traduit ageDays gt en modified < cutoff", () => {
    const now = Date.now();
    const params: Array<string | number> = [];
    const sql = conditionToSql({ field: "ageDays", operator: "gt", value: 30 }, params);
    expect(sql).toBe("modified < ?");
    expect(params[0]).toBeGreaterThan(now - 31 * 86400000);
    expect(params[0]).toBeLessThan(now - 29 * 86400000);
  });

  it("normalise l'extension en minuscules (cohérent avec le filtre mémoire)", () => {
    const params: Array<string | number> = [];
    const sql = conditionToSql({ field: "extension", operator: "eq", value: "TMP" }, params);
    expect(sql).toBe("extension = ?");
    expect(params).toEqual(["tmp"]);
  });

  it("échappe les caractères LIKE dans path contains", () => {
    const params: Array<string | number> = [];
    const sql = conditionToSql({ field: "path", operator: "contains", value: "100%_\\x" }, params);
    expect(sql).toBe("path LIKE ? ESCAPE '\\'");
    expect(params[0]).toBe("%100\\%\\_\\\\x%");
  });
});

describe("shouldRunNow — une exécution par période, avec rattrapage", () => {
  const day = (offset: number) => new Date(Date.now() - offset * 86400000);

  it("daily : s'exécute après l'heure prévue si jamais exécutée aujourd'hui", () => {
    const rule = makeRule({ schedule: "daily", scheduleTime: "02:00", lastRunAt: day(1).getTime() });
    const now = new Date();
    now.setHours(3, 30, 0, 0);
    expect(shouldRunNow(rule, now)).toBe(true);
  });

  it("daily : ne s'exécute pas deux fois le même jour", () => {
    const rule = makeRule({ schedule: "daily", scheduleTime: "02:00", lastRunAt: day(0).getTime() + 2 * 3600000 });
    const now = new Date();
    now.setHours(5, 0, 0, 0);
    expect(shouldRunNow(rule, now)).toBe(false);
  });

  it("daily : ne s'exécute pas avant l'heure prévue", () => {
    const rule = makeRule({ schedule: "daily", scheduleTime: "14:00", lastRunAt: day(1).getTime() });
    const now = new Date();
    now.setHours(9, 0, 0, 0);
    expect(shouldRunNow(rule, now)).toBe(false);
  });

  it("daily : rattrape une échéance manquée (application fermée)", () => {
    const rule = makeRule({ schedule: "daily", scheduleTime: "02:00", lastRunAt: day(1).getTime() });
    const now = new Date();
    now.setHours(8, 45, 0, 0);
    expect(shouldRunNow(rule, now)).toBe(true);
  });

  it("weekly : seulement le jour configuré", () => {
    // 2026-08-15 est un samedi (getDay() = 6).
    const rule = makeRule({ schedule: "weekly", scheduleTime: "10:00", scheduleDay: 6, lastRunAt: day(3).getTime() });
    const saturday = new Date(2026, 7, 15, 10, 30, 0, 0);
    expect(shouldRunNow(rule, saturday)).toBe(true);
    const sunday = new Date(2026, 7, 16, 10, 30, 0, 0);
    expect(shouldRunNow(rule, sunday)).toBe(false);
  });

  it("monthly : seulement le jour configuré", () => {
    const rule = makeRule({ schedule: "monthly", scheduleTime: "09:00", scheduleDay: 15, lastRunAt: day(30).getTime() });
    const onDay = new Date(2026, 7, 15, 9, 30, 0, 0);
    expect(shouldRunNow(rule, onDay)).toBe(true);
    const otherDay = new Date(2026, 7, 16, 9, 30, 0, 0);
    expect(shouldRunNow(rule, otherDay)).toBe(false);
  });

  it("hourly : une fois par heure, même en cas de rattrapage", () => {
    // lastRunAt en FIXE (pas `day(0)`, qui dépend de l'horloge réelle et rend
    // le test flaky selon l'heure de la journée) : 2 h avant l'heure de test.
    const rule = makeRule({
      schedule: "hourly",
      scheduleTime: "00:15",
      lastRunAt: new Date(2026, 7, 15, 8, 0, 0, 0).getTime(),
    });
    // Heure fixe 10:20 (minute >= 15) : pas de franchissement d'heure dans le test.
    const now = new Date(2026, 7, 15, 10, 20, 0, 0);
    expect(shouldRunNow(rule, now)).toBe(true);
    // Après l'exécution, lastRunAt est mis à jour : plus rien dans cette heure.
    rule.lastRunAt = now.getTime();
    const again = new Date(2026, 7, 15, 10, 21, 0, 0); // 1 min plus tard, même heure
    expect(shouldRunNow(rule, again)).toBe(false);
  });

  it("manual : jamais planifiée", () => {
    const rule = makeRule({ schedule: "manual", lastRunAt: null });
    expect(shouldRunNow(rule, new Date())).toBe(false);
  });
});

describe("blockedTargetReason — protections des actions destructives", () => {
  it("bloque les chemins Windows protégés (System32)", () => {
    const reason = blockedTargetReason("C:\\Windows\\System32\\drivers\\etc\\hosts");
    expect(reason).not.toBeNull();
    expect(reason).toContain("Windows");
  });

  it("bloque les chemins protégés par classement système", () => {
    // Un fichier .dll classé « system » est protégé par assessSafety.
    expect(blockedTargetReason("C:\\Windows\\WinSxS\\amd64_kernel32.dll")).not.toBeNull();
  });

  it("bloque un chemin exclu par l'utilisateur", () => {
    const reason = blockedTargetReason("D:\\KeepSafe\\sous-dossier\\fichier.txt");
    expect(reason).not.toBeNull();
    expect(reason).toContain("exclu");
  });

  it("autorise un fichier ordinaire non protégé", () => {
    expect(blockedTargetReason("D:\\Users\\moi\\Documents\\rapport.pdf")).toBeNull();
  });
});
