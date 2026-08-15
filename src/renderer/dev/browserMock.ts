import type {
  AppPreferences,
  AutomationRule,
  DryRunResult,
  LicenseInfo,
  NovaApi,
  RecoverableSummary,
  RuleExecution,
} from "../../shared/types";
import { AUTOCLEAN_DEFAULTS, sanitizeAutoCleanConfig } from "../../shared/autoclean";

/**
 * Aperçu navigateur uniquement : le renderer ne peut pas tourner dans un
 * navigateur sans l'API preload (window.nova). Ce mock fournit des réponses
 * vides/neutres pour que l'interface se rende avec ses états vides.
 * Il n'est JAMAIS installé dans Electron (le preload injecte window.nova).
 */

/**
 * Dev UNIQUEMENT : permet de prévisualiser les trois états de licence dans
 * l'aperçu navigateur via localStorage (clé "nova-preview-license" =
 * "free" | "trial" | "pro"). Jamais utilisé en Electron (le main process
 * reste la seule source de vérité) et éliminé du build de production.
 */
export type PreviewLicenseState = "free" | "trial" | "trial-soon" | "pro";
const PREVIEW_LICENSE_STORAGE_KEY = "nova-preview-license";

function getPreviewLicenseState(): PreviewLicenseState {
  try {
    const v = globalThis.localStorage?.getItem(PREVIEW_LICENSE_STORAGE_KEY);
    if (v === "free" || v === "trial" || v === "trial-soon" || v === "pro") return v;
  } catch {
    /* localStorage indisponible (Node) : Free */
  }
  return "free";
}

function previewLicenseInfo(): LicenseInfo {
  const state = getPreviewLicenseState();
  const base = {
    trialStartedAt: null,
    trialEndsAt: null,
    licenseKey: null,
    licenseKeyHint: null,
    activatedAt: null,
    lastValidatedAt: null,
    devOverride: false,
  };
  if (state === "trial" || state === "trial-soon") {
    const daysLeft = state === "trial-soon" ? 2 : 5;
    return {
      ...base,
      status: "trial_pro",
      isPro: true,
      trialActive: true,
      trialDaysLeft: daysLeft,
      trialStartedAt: Date.now() - (7 - daysLeft) * 86400000,
      trialEndsAt: Date.now() + daysLeft * 86400000,
      trialUsed: true,
      validationStatus: "never",
    };
  }
  if (state === "pro") {
    return {
      ...base,
      status: "pro",
      isPro: true,
      trialActive: false,
      trialDaysLeft: 0,
      trialUsed: true,
      licenseKey: "ls_preview_0000000000000000",
      licenseKeyHint: "…0000",
      activatedAt: Date.now() - 30 * 86400000,
      lastValidatedAt: Date.now() - 86400000,
      validationStatus: "valid",
    };
  }
  return {
    ...base,
    status: "free",
    isPro: false,
    trialActive: false,
    trialDaysLeft: 0,
    trialUsed: false,
    validationStatus: "never",
  };
}


const EMPTY_RECOVERABLE: RecoverableSummary = {
  totalBytes: 0,
  byKind: {
    temp: 0,
    cache: 0,
    recyclebin: 0,
    large: 0,
    old: 0,
    download: 0,
    archive: 0,
    duplicate: 0,
    logs: 0,
    crash: 0,
    thumbnail: 0,
  },
  groups: [],
};

const DEFAULT_PREFS: AppPreferences = {
  recycleByDefault: true,
  tempCleanupRequiresConfirm: true,
  retentionScans: 5,
  retentionDays: 30,
  scanOnStartup: false,
  confirmPermanentDelete: true,
  guardianEnabled: false,
  guardianNotifications: true,
  guardianPredictions: true,
  guardianWeekly: true,
  guardianWarnPct: 80,
  guardianAlertPct: 90,
  guardianCriticalPct: 95,
  guardianFrequencyMin: 60,
  guardianDrives: [],
};

const NOT_AVAILABLE = "Non disponible dans l'aperçu navigateur (API Electron).";

function noop(): () => void {
  return () => {
    /* noop */
  };
}

function unavailable<T>(): Promise<T> {
  return Promise.reject(new Error(NOT_AVAILABLE));
}

function sampleRule(): AutomationRule {
  return {
    id: 1,
    name: "Temp anciens (aperçu)",
    description: "Déplace en quarantaine les fichiers temporaires de plus de 30 jours.",
    enabled: true,
    condition: {
      operator: "AND",
      conditions: [
        { field: "kind", operator: "eq", value: "temp" },
        { field: "ageDays", operator: "gte", value: 30 },
      ],
    },
    actions: [{ type: "moveToQuarantine" }],
    schedule: "daily",
    scheduleTime: "02:00",
    scheduleDay: undefined,
    lastRunAt: Date.now() - 2 * 86400000,
    runCount: 3,
    createdAt: Date.now() - 30 * 86400000,
    updatedAt: Date.now() - 2 * 86400000,
  };
}

function sampleDryRun(): DryRunResult {
  const candidates = [
    { path: "C:\\Users\\demo\\AppData\\Local\\Temp\\installer_cache_1.tmp", size: 812_400_000, kind: "temp", category: "temp" },
    { path: "C:\\Users\\demo\\AppData\\Local\\Temp\\old_download_pack.bin", size: 1_240_000_000, kind: "temp", category: "temp" },
    { path: "C:\\Windows\\Temp\\crash_dump_old.dmp", size: 356_000_000, kind: "temp", category: "temp" },
  ];
  return {
    ruleId: 0,
    ruleName: "Temp anciens (aperçu)",
    candidates,
    totalBytes: candidates.reduce((s, c) => s + c.size, 0),
    totalFiles: candidates.length,
    warnings: ["Les fichiers protégés ou exclus seront ignorés par les actions destructives."],
  };
}

function guardianPreview() {
  const state = getPreviewLicenseState();
  const pro = state === "pro" || state === "trial" || state === "trial-soon";
  const base = {
    enabled: false,
    drives: pro
      ? [
          { name: "C:\\", label: "Disque système", total: 512 * 1024 ** 3, used: 392 * 1024 ** 3, free: 120 * 1024 ** 3, pct: 76.6, level: "ok" as const },
          { name: "D:\\", label: "Données", total: 1024 * 1024 ** 3, used: 880 * 1024 ** 3, free: 144 * 1024 ** 3, pct: 85.9, level: "alert" as const },
        ]
      : [],
    events: [],
    lastCheckAt: Date.now() - 3600_000,
    weeklyGrowth: 0,
  };
  if (!pro) {
    return { ...base, prediction: null, forecast: null };
  }
  const now = Date.now();
  const day = 86400000;
  return {
    ...base,
    prediction: {
      at: now,
      ratePerDay: 0.8 * 1024 ** 3,
      daysToFull: 210,
      fullAt: now + 210 * day,
      reliable: true,
      message: "À ce rythme (+800 Mo/jour), votre disque pourrait être plein dans environ 210 jours.",
    },
    forecast: {
      thresholds: [
        { pct: 80, at: now + 40 * day },
        { pct: 90, at: now + 95 * day },
        { pct: 95, at: now + 140 * day },
      ],
      fullAt: now + 210 * day,
      dataPoints: 14,
      spanDays: 30,
      reliable: true,
    },
  };
}

function sampleExecution(): RuleExecution {
  return {
    id: Date.now(),
    ruleId: 1,
    ruleName: "Temp anciens (aperçu)",
    status: "completed",
    startedAt: Date.now() - 3600_000,
    finishedAt: Date.now() - 3590_000,
    dryRunCandidates: [],
    executedCandidates: [{ path: "C:\\Temp\\x.tmp", size: 42_000_000, action: "moveToQuarantine", result: "ok" }],
    bytesAffected: 42_000_000,
    filesAffected: 1,
  };
}

export function createBrowserMock(): NovaApi {
  const overview = {
    drives: [],
    recoverable: EMPTY_RECOVERABLE,
    filesAnalyzed: 0,
    lastScanAt: null,
    lastScanId: null,
    insights: [],
    trend: null,
  };
  const rules: AutomationRule[] = [sampleRule()];
  const executions: RuleExecution[] = [sampleExecution()];
  let nextRuleId = 2;

  return {
    // storage
    getDrives: async () => [],
    getOverview: async () => overview,
    // scan
    startScan: async () => ({ scanId: 0 }),
    pauseScan: async () => undefined,
    resumeScan: async () => undefined,
    cancelScan: async () => undefined,
    onScanProgress: () => noop(),
    onScanFinished: () => noop(),
    onScanError: () => noop(),
    getScanResult: async () => null,
    getLastScanResult: async () => {
      const state = getPreviewLicenseState();
      if (state === "free") return null;
      return {
        scanId: 1,
        target: "C:\\",
        root: "C:\\",
        status: "completed",
        startedAt: Date.now() - 3600_000,
        finishedAt: Date.now() - 3500_000,
        durationMs: 100_000,
        totalFiles: 128_450,
        totalDirs: 9_120,
        totalBytes: 412_000_000_000,
        errors: [],
        categories: [
          { category: "downloads", bytes: 62_000_000_000, files: 1_240 },
          { category: "games", bytes: 48_000_000_000, files: 3_120 },
          { category: "videos", bytes: 39_000_000_000, files: 412 },
          { category: "temp", bytes: 11_000_000_000, files: 8_540 },
        ],
        recoverable: EMPTY_RECOVERABLE,
      };
    },
    // explorer
    getDirChildren: async () => null,
    // files
    getLargeFiles: async () => ({ items: [], total: 0, totalBytes: 0, offset: 0, limit: 200, hasMore: false }),
    getOldFiles: async () => ({ items: [], total: 0, totalBytes: 0, offset: 0, limit: 200, hasMore: false }),
    getByCategory: async () => ({ items: [], total: 0, totalBytes: 0, offset: 0, limit: 200, hasMore: false }),
    getDownloads: async () => ({ items: [], total: 0, totalBytes: 0, offset: 0, limit: 200, hasMore: false }),
    getRecommendationDetail: async () => null,
    getDuplicates: async () => [],
    // apps & games
    getApps: async () => [],
    getGames: async () => [],
    uninstallGame: async () => ({ ok: false, bytes: 0, message: NOT_AVAILABLE }),
    // uninstaller
    preAnalyzeApp: unavailable,
    runUninstaller: unavailable,
    getRemains: unavailable,
    cleanRemains: unavailable,
    restoreQuarantine: async () => ({ restored: 0, failed: 0, items: [] }),
    refreshApps: async () => [],
    onUninstallProgress: () => noop(),
    // cleanup
    cleanup: async (request) => ({
      kind: request.kind,
      mode: request.mode,
      requested: 0,
      succeeded: 0,
      bytesFreed: 0,
      bytesRequested: 0,
      items: [],
    }),
    getRecycleBinInfo: async () => ({ bytes: 0, files: 0 }),
    emptyRecycleBin: async () => ({ freedBytes: 0, fileCount: 0, requestedBytes: 0 }),
    onCleanupProgress: () => noop(),
    // history
    getHistory: async () => [],
    getTrend: async () => {
      const state = getPreviewLicenseState();
      if (state === "free") return null;
      const now = Date.now();
      const day = 86400000;
      return {
        points: Array.from({ length: 14 }, (_, i) => ({
          at: now - (13 - i) * day,
          total: 512 * 1024 ** 3,
          free: 120 * 1024 ** 3 + i * 0.8 * 1024 ** 3,
          used: 392 * 1024 ** 3 - i * 0.8 * 1024 ** 3,
        })),
        weeklyGrowth: 5.6 * 1024 ** 3,
      };
    },
    // misc
    openPath: async () => undefined,
    openInFolder: async () => undefined,
    copyPath: async () => undefined,
    pickFolder: async () => null,
    pickFolders: async () => [],
    getExclusions: async () => [],
    addExclusion: async (item) => ({ id: Date.now(), path: item.path, kind: item.kind, createdAt: Date.now() }),
    removeExclusion: async () => undefined,
    getPreferences: async () => DEFAULT_PREFS,
    savePreferences: async () => undefined,
    getVersion: async () => "1.0.0",
    // monétisation
    getLicenseInfo: async () => previewLicenseInfo(),
    startTrial: async () => ({
      status: "trial_pro",
      isPro: true,
      trialActive: true,
      trialDaysLeft: 7,
      trialStartedAt: Date.now(),
      trialEndsAt: Date.now() + 7 * 24 * 3600 * 1000,
      trialUsed: true,
      licenseKey: null,
      licenseKeyHint: null,
      activatedAt: null,
      lastValidatedAt: null,
      validationStatus: "never",
      devOverride: false,
    }),
    activateLicense: async () => ({
      ok: false,
      message: "Non disponible dans l'aperçu navigateur (API Electron).",
      info: {
        status: "free",
        isPro: false,
        trialActive: false,
        trialDaysLeft: 0,
        trialStartedAt: null,
        trialEndsAt: null,
        trialUsed: false,
        licenseKey: null,
        licenseKeyHint: null,
        activatedAt: null,
        lastValidatedAt: null,
        validationStatus: "never",
        devOverride: false,
      },
    }),
    restoreLicense: async () => ({
      ok: false,
      message: "Non disponible dans l'aperçu navigateur (API Electron).",
      info: {
        status: "free",
        isPro: false,
        trialActive: false,
        trialDaysLeft: 0,
        trialStartedAt: null,
        trialEndsAt: null,
        trialUsed: false,
        licenseKey: null,
        licenseKeyHint: null,
        activatedAt: null,
        lastValidatedAt: null,
        validationStatus: "never",
        devOverride: false,
      },
    }),
    openCheckout: async () => ({
      opened: false,
      message: "Dans l'aperçu navigateur, l'ouverture du checkout est simulée — aucun paiement réel n'est effectué.",
    }),
    // coach
    getCoachReport: async () => ({
      status: "healthy",
      headline: "Votre stockage est actuellement bien entretenu",
      sub: "Aucune action pertinente détectée pour l'instant.",
      totalRecoverable: 0,
      recommendations: [],
      protectedNote: null,
      generatedAt: Date.now(),
    }),
    // gardien
    getGuardianReport: async () => guardianPreview(),
    runGuardianCheck: async () => guardianPreview(),
    onGuardianEvent: () => noop(),
    onGuardianNavigate: () => noop(),
    // automation (aperçu navigateur : état en mémoire, aucune écriture réelle)
    getRules: async () => rules.map((r) => ({ ...r })),
    saveRule: async (rule) => {
      const now = Date.now();
      const id = nextRuleId++;
      rules.unshift({ ...rule, id, createdAt: now, updatedAt: now, runCount: 0, lastRunAt: null });
      return id;
    },
    updateRule: async (patch) => {
      const idx = rules.findIndex((r) => r.id === patch.id);
      if (idx >= 0) rules[idx] = { ...rules[idx], ...patch, updatedAt: Date.now() };
    },
    deleteRule: async (id) => {
      const idx = rules.findIndex((r) => r.id === id);
      if (idx >= 0) rules.splice(idx, 1);
    },
    runRule: async (ruleId, dryRun) => {
      const rule = rules.find((r) => r.id === ruleId) ?? sampleRule();
      const exec: RuleExecution = {
        ...sampleExecution(),
        ruleId,
        ruleName: rule.name,
        status: dryRun ? "dry-run" : "completed",
      };
      executions.unshift(exec);
      return exec;
    },
    getRuleExecutions: async () => executions.map((e) => ({ ...e })),
    getDryRunPreview: async () => sampleDryRun(),
    // autoclean (aperçu navigateur : état en mémoire)
    getAutoCleanState: async () => {
      const ruleId = 999;
      return {
        config: { ...AUTOCLEAN_DEFAULTS },
        ruleId,
        lastRunAt: Date.now() - 2 * 86400000,
        nextRunAt: Date.now() + 5 * 86400000,
        hasScan: false,
        executions: [sampleExecution()],
      };
    },
    saveAutoCleanConfig: async (config) => {
      const sanitized = sanitizeAutoCleanConfig(config);
      return {
        config: sanitized,
        ruleId: 999,
        lastRunAt: Date.now() - 2 * 86400000,
        nextRunAt: Date.now() + 5 * 86400000,
        hasScan: false,
        executions: [sampleExecution()],
      };
    },
    runAutoClean: async (dryRun) => {
      const dry = sampleDryRun();
      const cands = dry.candidates.map((c) => ({ path: c.path, size: c.size, kind: c.kind }));
      return {
        ...sampleExecution(),
        ruleName: "Nova AutoClean",
        status: dryRun ? "dry-run" : "completed",
        dryRunCandidates: dryRun ? cands : [],
        executedCandidates: dryRun ? [] : cands.map((c) => ({ path: c.path, size: c.size, action: "moveToQuarantine", result: "ok" as const })),
        bytesAffected: dry.totalBytes,
        filesAffected: cands.length,
      };
    },
    // fenêtre
    minimize: () => undefined,
    maximize: () => undefined,
    close: () => undefined,
    isMaximized: () => noop(),
  };
}

export function installBrowserMock(): void {
  if (typeof window !== "undefined" && !window.nova) {
    window.nova = createBrowserMock();
  }
}
