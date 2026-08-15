import { describe, expect, it, vi } from "vitest";

// Même pattern que ruleEngineSql.test.ts : automation.ts calcule QUARANTINE_ROOT
// à l'import via app.getPath — le mock electron est donc requis.
vi.mock("electron", () => ({
  app: {
    getPath: () => require("node:os").tmpdir(),
    isPackaged: true,
  },
  shell: { trashItem: vi.fn().mockResolvedValue(undefined) },
  Notification: class {
    show(): void {
      /* noop */
    }
  },
}));

import { buildDryRunWarnings } from "../src/main/services/automation.js";
import type { RuleAction } from "../src/shared/types.js";

const CANDIDATES = [
  { path: "C:\\Users\\demo\\AppData\\Local\\Temp\\a.tmp" },
  { path: "C:\\Users\\demo\\AppData\\Local\\Temp\\b.tmp" },
  { path: "C:\\Windows\\System32\\config\\SAM" }, // système → protégé
  { path: "D:\\projets\\secret" }, // exclu par l'utilisateur
];

const EXCLUSIONS = [{ path: "D:\\projets\\secret", kind: "folder" }];

describe("buildDryRunWarnings — avertissements de sécurité du dry-run", () => {
  it("aucun avertissement pour une action non destructive sans correspondance bloquée", () => {
    const warnings = buildDryRunWarnings([CANDIDATES[0]], [{ type: "logOnly" }], EXCLUSIONS);
    expect(warnings).toEqual([]);
  });

  it("signale les fichiers protégés ou exclus ignorés par les actions destructives", () => {
    const warnings = buildDryRunWarnings(CANDIDATES, [{ type: "moveToQuarantine" }], EXCLUSIONS);
    expect(warnings.some((w) => w.includes("2 fichier(s) protégé(s) ou exclu(s)"))).toBe(true);
  });

  it("signale une suppression définitive comme irréversible", () => {
    const warnings = buildDryRunWarnings([CANDIDATES[0]], [{ type: "deletePermanent" }], EXCLUSIONS);
    expect(warnings.some((w) => w.includes("Suppression définitive"))).toBe(true);
  });

  it("signale une règle sans aucune correspondance", () => {
    const warnings = buildDryRunWarnings([], [{ type: "moveToQuarantine" }], EXCLUSIONS);
    expect(warnings.some((w) => w.includes("Aucun fichier"))).toBe(true);
  });

  it("les avertissements sont informatifs et jamais bloquants (liste simple)", () => {
    const actions: RuleAction[] = [{ type: "deletePermanent" }, { type: "notify", message: "ok" }];
    const warnings = buildDryRunWarnings(CANDIDATES, actions, EXCLUSIONS);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("protégé"),
        expect.stringContaining("Suppression définitive"),
      ]),
    );
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });
});
