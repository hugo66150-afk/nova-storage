import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserMock, installBrowserMock } from "../src/renderer/dev/browserMock";
import type { NovaApi } from "../src/shared/types";

const API_KEYS: Array<keyof NovaApi> = [
  "getDrives", "getOverview",
  "startScan", "pauseScan", "resumeScan", "cancelScan",
  "onScanProgress", "onScanFinished", "onScanError",
  "getScanResult", "getLastScanResult",
  "getDirChildren",
  "getLargeFiles", "getOldFiles", "getByCategory", "getDownloads", "getRecommendationDetail", "getDuplicates",
  "getApps", "getGames", "uninstallGame",
  "preAnalyzeApp", "runUninstaller", "getRemains", "cleanRemains", "restoreQuarantine", "refreshApps", "onUninstallProgress",
  "cleanup", "getRecycleBinInfo", "emptyRecycleBin", "onCleanupProgress",
  "getHistory", "getTrend",
  "openPath", "openInFolder", "copyPath", "pickFolder", "pickFolders",
  "getExclusions", "addExclusion", "removeExclusion",
  "getPreferences", "savePreferences", "getVersion",
  "getLicenseInfo", "startTrial", "activateLicense", "restoreLicense", "openCheckout",
  "getCoachReport",
  "getGuardianReport", "runGuardianCheck", "onGuardianEvent", "onGuardianNavigate",
  "getRules", "saveRule", "updateRule", "deleteRule", "runRule", "getRuleExecutions", "getDryRunPreview",
  "minimize", "maximize", "close", "isMaximized",
];

describe("createBrowserMock — contrat NovaApi", () => {
  it("implémente tous les membres de NovaApi", () => {
    const mock = createBrowserMock();
    for (const key of API_KEYS) {
      expect(typeof (mock as unknown as Record<string, unknown>)[key], `membre manquant : ${key}`).toBe("function");
    }
  });

  it("getPreferences retourne TOUTES les préférences avec leurs valeurs par défaut", async () => {
    const prefs = await createBrowserMock().getPreferences();
    const fields: Array<[keyof typeof prefs, unknown]> = [
      ["recycleByDefault", true],
      ["tempCleanupRequiresConfirm", true],
      ["retentionScans", 5],
      ["retentionDays", 30],
      ["scanOnStartup", false],
      ["confirmPermanentDelete", true],
      ["guardianEnabled", false],
      ["guardianNotifications", true],
      ["guardianPredictions", true],
      ["guardianWeekly", true],
      ["guardianWarnPct", 80],
      ["guardianAlertPct", 90],
      ["guardianCriticalPct", 95],
      ["guardianFrequencyMin", 60],
    ];
    for (const [k, v] of fields) expect(prefs[k], `champ ${k}`).toBe(v);
    expect(Array.isArray(prefs.guardianDrives)).toBe(true);
  });

  it("getOverview retourne une structure Overview exploitable par le Dashboard", async () => {
    const o = await createBrowserMock().getOverview();
    expect(o.drives).toEqual([]);
    expect(o.recoverable.totalBytes).toBe(0);
    expect(o.recoverable.byKind).toBeDefined();
    expect(o.recoverable.groups).toEqual([]);
    expect(o.filesAnalyzed).toBe(0);
    expect(o.lastScanAt).toBeNull();
    expect(o.lastScanId).toBeNull();
    expect(o.insights).toEqual([]);
    expect(o.trend).toBeNull();
  });

  it("les listes paginées retournent des pages vides sans hasMore", async () => {
    const mock = createBrowserMock();
    for (const p of [
      await mock.getLargeFiles(1, 0, 0, 200),
      await mock.getOldFiles(1, 0, 0, 200),
      await mock.getByCategory(1, "temp", 0, 200),
      await mock.getDownloads(1, 0, 200),
    ]) {
      expect(p.items).toEqual([]);
      expect(p.total).toBe(0);
      expect(p.totalBytes).toBe(0);
      expect(p.hasMore).toBe(false);
    }
  });

  it("les états nuls sont retournés pour scan/explorer/recommandations (pages sans crash)", async () => {
    const mock = createBrowserMock();
    expect(await mock.getLastScanResult()).toBeNull();
    expect(await mock.getScanResult(1)).toBeNull();
    expect(await mock.getDirChildren(1, "C:\\")).toBeNull();
    expect(await mock.getRecommendationDetail(1, "temp", 0, 200)).toBeNull();
  });

  it("les rapports Coach et Gardien sont des états vides valides", async () => {
    const mock = createBrowserMock();
    const coach = await mock.getCoachReport();
    expect(coach.recommendations).toEqual([]);
    expect(coach.totalRecoverable).toBe(0);
    const guardian = await mock.getGuardianReport();
    expect(guardian.enabled).toBe(false);
    expect(guardian.drives).toEqual([]);
    expect(guardian.events).toEqual([]);
    expect(guardian.prediction).toBeNull();
  });

  it("les abonnements retournent une fonction de désabonnement appelable", () => {
    const mock = createBrowserMock();
    for (const sub of [
      mock.onScanProgress(() => undefined),
      mock.onScanFinished(() => undefined),
      mock.onScanError(() => undefined),
      mock.onCleanupProgress(() => undefined),
      mock.onUninstallProgress(() => undefined),
      mock.onGuardianEvent(() => undefined),
      mock.onGuardianNavigate(() => undefined),
      mock.isMaximized(() => undefined),
    ]) {
      expect(typeof sub).toBe("function");
      expect(() => sub()).not.toThrow();
    }
  });

  it("cleanup reflète la requête (mode/kind) sans rien exécuter", async () => {
    const r = await createBrowserMock().cleanup({ kind: "temp", paths: ["C:\\x.tmp"], mode: "recycle" });
    expect(r.kind).toBe("temp");
    expect(r.mode).toBe("recycle");
    expect(r.requested).toBe(0);
    expect(r.succeeded).toBe(0);
    expect(r.bytesFreed).toBe(0);
    expect(r.items).toEqual([]);
  });

  it("les opérations Electron inaccessibles rejettent avec un message explicite", async () => {
    const mock = createBrowserMock();
    await expect(mock.preAnalyzeApp({} as never)).rejects.toThrow("aperçu navigateur");
    await expect(mock.runUninstaller("s")).rejects.toThrow("aperçu navigateur");
    await expect(mock.getRemains("s")).rejects.toThrow("aperçu navigateur");
  });

  it("automation (aperçu) : crée, modifie, exécute et supprime des règles en mémoire", async () => {
    const mock = createBrowserMock();
    const initial = await mock.getRules();
    expect(initial.length).toBeGreaterThan(0);

    const id = await mock.saveRule({
      name: "Test rule",
      description: "",
      enabled: true,
      condition: { operator: "AND", conditions: [{ field: "kind", operator: "eq", value: "temp" }] },
      actions: [{ type: "moveToQuarantine" }],
      schedule: "manual",
    });
    expect(id).toBeGreaterThan(0);
    const after = await mock.getRules();
    expect(after.find((r) => r.id === id)?.name).toBe("Test rule");

    await mock.updateRule({ id, name: "Test rule v2" });
    expect((await mock.getRules()).find((r) => r.id === id)?.name).toBe("Test rule v2");

    const exec = await mock.runRule(id, false);
    expect(exec.ruleId).toBe(id);
    expect(exec.status).toBe("completed");
    expect((await mock.getRuleExecutions()).length).toBeGreaterThan(0);

    const preview = await mock.getDryRunPreview({
      name: "Test",
      description: "",
      enabled: true,
      condition: { operator: "AND", conditions: [{ field: "kind", operator: "eq", value: "temp" }] },
      actions: [{ type: "deletePermanent" }],
      schedule: "manual",
    });
    expect(preview.totalFiles).toBeGreaterThan(0);
    expect(preview.warnings?.length).toBeGreaterThan(0);

    await mock.deleteRule(id);
    expect((await mock.getRules()).find((r) => r.id === id)).toBeUndefined();
  });

  it("autoclean (aperçu) : état, sauvegarde de config et exécution simulée", async () => {
    const mock = createBrowserMock();
    const state = await mock.getAutoCleanState();
    expect(state.config.enabled).toBe(false);
    expect(state.ruleId).not.toBeNull();
    expect(state.executions.length).toBeGreaterThan(0);

    const saved = await mock.saveAutoCleanConfig({ ...state.config, enabled: true, trigger: "daily" });
    expect(saved.config.enabled).toBe(true);
    expect(saved.config.trigger).toBe("daily");

    const dry = await mock.runAutoClean(true);
    expect(dry.status).toBe("dry-run");
    expect(dry.dryRunCandidates.length).toBeGreaterThan(0);

    const real = await mock.runAutoClean(false);
    expect(real.status).toBe("completed");
    expect(real.bytesAffected).toBeGreaterThan(0);
  });

  it("les contrôles de fenêtre ne lèvent pas (no-op navigateur)", () => {
    const mock = createBrowserMock();
    expect(() => mock.minimize()).not.toThrow();
    expect(() => mock.maximize()).not.toThrow();
    expect(() => mock.close()).not.toThrow();
  });
});

describe("createBrowserMock — override de licence pour l'aperçu (dev only)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fakeStorage = (value: string | null) => {
    const store = new Map<string, string>();
    if (value !== null) store.set("nova-preview-license", value);
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  };

  it("Free par défaut (aucun override localStorage)", async () => {
    vi.stubGlobal("localStorage", fakeStorage(null));
    const info = await createBrowserMock().getLicenseInfo();
    expect(info.status).toBe("free");
    expect(info.isPro).toBe(false);
    expect(info.trialActive).toBe(false);
    expect(info.trialDaysLeft).toBe(0);
  });

  it("Essai : override 'trial' → statut trial_pro avec jours restants", async () => {
    vi.stubGlobal("localStorage", fakeStorage("trial"));
    const info = await createBrowserMock().getLicenseInfo();
    expect(info.status).toBe("trial_pro");
    expect(info.isPro).toBe(true);
    expect(info.trialActive).toBe(true);
    expect(info.trialDaysLeft).toBeGreaterThan(0);
    expect(info.trialUsed).toBe(true);
  });

  it("Essai court : override 'trial-soon' → trial_pro avec 2 jours restants (rappel Dashboard)", async () => {
    vi.stubGlobal("localStorage", fakeStorage("trial-soon"));
    const info = await createBrowserMock().getLicenseInfo();
    expect(info.status).toBe("trial_pro");
    expect(info.isPro).toBe(true);
    expect(info.trialActive).toBe(true);
    expect(info.trialDaysLeft).toBe(2);
  });

  it("Pro : override 'pro' → statut pro avec licence validée", async () => {
    vi.stubGlobal("localStorage", fakeStorage("pro"));
    const info = await createBrowserMock().getLicenseInfo();
    expect(info.status).toBe("pro");
    expect(info.isPro).toBe(true);
    expect(info.trialActive).toBe(false);
    expect(info.trialDaysLeft).toBe(0);
    expect(info.validationStatus).toBe("valid");
    expect(info.licenseKeyHint).not.toBeNull();
  });

  it("ignore les valeurs d'override inconnues → Free (jamais de Pro déduit d'une valeur arbitraire)", async () => {
    vi.stubGlobal("localStorage", fakeStorage("isPro=true"));
    const info = await createBrowserMock().getLicenseInfo();
    expect(info.status).toBe("free");
    expect(info.isPro).toBe(false);
  });

  it("résiste à un localStorage absent (environnement Node)", async () => {
    vi.stubGlobal("localStorage", undefined);
    const info = await createBrowserMock().getLicenseInfo();
    expect(info.status).toBe("free");
    expect(info.isPro).toBe(false);
  });
});

describe("installBrowserMock — inertie en Electron", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("installe le mock quand window.nova est absent (navigateur nu)", () => {
    vi.stubGlobal("window", {});
    installBrowserMock();
    const w = globalThis as unknown as { window: { nova?: unknown } };
    expect(w.window.nova).toBeDefined();
  });

  it("ne remplace JAMAIS un window.nova existant (Electron : preload injecté)", () => {
    const realApi = { real: true };
    vi.stubGlobal("window", { nova: realApi });
    installBrowserMock();
    const w = globalThis as unknown as { window: { nova: unknown } };
    expect(w.window.nova).toBe(realApi);
  });

  it("ne fait rien quand window est indéfini (Node)", () => {
    expect(() => installBrowserMock()).not.toThrow();
  });
});
