import { ipcMain, shell, BrowserWindow, clipboard, dialog } from "electron";
import { execFile } from "node:child_process";
import type {
  AppInfo,
  CleanupRequest,
  CleanupResult,
  CoachReport,
  DirChildrenResult,
  DriveInfo,
  DuplicateGroup,
  ExcludedItem,
  GuardianReport,
  HistoryEvent,
  LicenseActivationResult,
  LicenseCheckoutResult,
  LicenseInfo,
  Overview,
  PagedFiles,
  RecommendationDetail,
  ScanResult,
  ScanSettings,
  AutoCleanState,
  StorageTrend,
} from "../shared/types.js";
import { CandidateKind } from "../shared/types.js";
import { scanManager } from "./engine/scanManager.js";
import { buildRecoverable, getKindMeta } from "./engine/analysis.js";
import { runCleanup } from "./engine/cleanup.js";
import { detectDuplicates } from "./engine/duplicates.js";
import { getDrives } from "./services/drives.js";
import { getRecycleBinInfo } from "./services/recyclebin.js";
import { getInstalledApps, refreshInstalledApps } from "./services/apps.js";
import { getGames, uninstallGame } from "./services/games.js";
import {
  cleanRemains,
  getRemains,
  preAnalyzeApp,
  restoreQuarantine,
  runUninstaller,
} from "./services/uninstaller.js";
import { buildInsights, buildTrend } from "./services/insights.js";
import { buildCoachReport } from "./services/coach.js";
import { guardianService } from "./services/guardian.js";
import { licenseService } from "./services/licenseService.js";
import { MONETIZATION, validateCheckoutUrl } from "../shared/monetization.js";
import {
  insertRule,
  updateRule,
  deleteRule,
  getRules,
  getRuleById,
  getRuleExecutions,
} from "./data/repositories.js";
import { runRuleEngine, getDryRunPreview, getLatestScanId } from "./services/automation.js";
import { autocleanService } from "./services/autoclean.js";
import type { AutomationRule, RuleExecution, DryRunResult } from "../shared/types.js";
import {
  addExclusion as dbAddExclusion,
  getExclusions,
  getHistory as dbGetHistory,
  getLastScan,
  getPreferences,
  insertCleanup,
  removeExclusion as dbRemoveExclusion,
  setPreference,
} from "./data/repositories.js";
import { logger } from "./infra/logger.js";

const DEFAULT_PREFS = {
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
  guardianDrives: [] as string[],
};

let recycleCache: { at: number; bytes: number; files: number } | null = null;

async function recoverableWithRecycleBin(scanId: number | null): Promise<ReturnType<typeof buildRecoverable>> {
  const recoverable = scanId ? scanManager.getRecoverableFromDb(scanId) : buildRecoverable([]);
  const lastScan = scanId ? getLastScan() : null;
  if (lastScan && /^[a-zA-Z]:\\/.test(lastScan.root)) {
    if (!recycleCache || Date.now() - recycleCache.at > 30000) {
      const info = await getRecycleBinInfo();
      recycleCache = { at: Date.now(), bytes: info.bytes, files: info.files };
    }
    if (recycleCache.bytes > 0) {
      const existing = recoverable.groups.find((g) => g.key === "recyclebin");
      if (existing) {
        existing.bytes = recycleCache.bytes;
        existing.files = recycleCache.files;
      } else {
        recoverable.groups.push({
          key: "recyclebin",
          title: getKindMeta("recyclebin").title,
          description: getKindMeta("recyclebin").description,
          risk: "review",
          confidence: 90,
          bytes: recycleCache.bytes,
          files: recycleCache.files,
        });
      }
      recoverable.byKind.recyclebin = recycleCache.bytes;
      recoverable.totalBytes = recoverable.groups.reduce((a, g) => a + g.bytes, 0);
    }
  }
  return recoverable;
}

function send(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

export function registerIpc(): void {
  // ---- Disques & aperçu ----
  ipcMain.handle("drives:get", async (): Promise<DriveInfo[]> => {
    return getDrives();
  });

  ipcMain.handle("overview:get", async (): Promise<Overview> => {
    const drives = await getDrives();
    const last = getLastScan();
    const lastScanId = last ? last.id : null;
    const recoverable = await recoverableWithRecycleBin(lastScanId);
    const trend = buildTrend();
    const insights = buildInsights(drives, recoverable, last?.finished_at ?? null);
    return {
      drives,
      recoverable,
      filesAnalyzed: last?.total_files ?? 0,
      lastScanAt: last?.finished_at ?? null,
      lastScanId,
      insights,
      trend,
    };
  });

  // ---- Scan ----
  ipcMain.handle("scan:start", async (_e, settings: ScanSettings): Promise<{ scanId: number }> => {
    if (scanManager.isRunning()) throw new Error("Une analyse est déjà en cours.");
    const scanId = await scanManager.start(settings);
    return { scanId };
  });
  ipcMain.handle("scan:pause", () => {
    scanManager.pause();
  });
  ipcMain.handle("scan:resume", () => {
    scanManager.resume();
  });
  ipcMain.handle("scan:cancel", () => {
    scanManager.cancel();
  });
  ipcMain.handle("scan:getResult", async (_e, scanId: number): Promise<ScanResult | null> => scanManager.getScanResult(scanId));
  ipcMain.handle("scan:getLast", async (): Promise<ScanResult | null> => scanManager.getLastScanResult());

  // ---- Explorateur ----
  ipcMain.handle("explorer:getDirChildren", async (_e, scanId: number, p: string): Promise<DirChildrenResult | null> =>
    scanManager.getDirChildren(scanId, p),
  );

  // ---- Fichiers ----
  ipcMain.handle("files:large", async (_e, scanId: number, minSize: number, offset: number, limit: number): Promise<PagedFiles> =>
    scanManager.getLargeFiles(scanId, minSize, offset, limit),
  );
  ipcMain.handle("files:old", async (_e, scanId: number, days: number, offset: number, limit: number): Promise<PagedFiles> =>
    scanManager.getOldFiles(scanId, days, offset, limit),
  );
  ipcMain.handle("files:category", async (_e, scanId: number, category: string, offset: number, limit: number): Promise<PagedFiles> =>
    scanManager.getByCategory(scanId, category, offset, limit),
  );
  ipcMain.handle("files:downloads", async (_e, scanId: number, offset: number, limit: number): Promise<PagedFiles> =>
    scanManager.getDownloads(scanId, offset, limit),
  );
  ipcMain.handle("recommendation:detail", async (_e, scanId: number, kind: string, offset: number, limit: number): Promise<RecommendationDetail | null> => {
    const k = kind as CandidateKind;
    const detail = await scanManager.getRecommendationDetail(scanId, k, offset, limit);
    if (!detail) return null;
    const meta = getKindMeta(k);
    return {
      group: {
        key: k,
        title: meta.title,
        description: meta.description,
        risk: meta.risk,
        confidence: meta.confidence,
        bytes: detail.totalBytes,
        files: detail.total,
      },
      samples: detail.files,
      total: detail.total,
      totalBytes: detail.totalBytes,
      hasMore: detail.hasMore,
    };
  });

  ipcMain.handle("duplicates:get", async (_e, scanId: number): Promise<DuplicateGroup[]> => {
    const candidates = await scanManager.getDuplicatesCandidates(scanId, 3000);
    return detectDuplicates(candidates);
  });

  // ---- Applications & jeux ----
  ipcMain.handle("apps:get", async () => getInstalledApps());
  ipcMain.handle("apps:refresh", async () => refreshInstalledApps());
  ipcMain.handle("games:get", async () => getGames());
  ipcMain.handle(
    "games:uninstall",
    async (_e, gamePath: string, mode: "recycle" | "permanent") => {
      if (mode !== "recycle" && mode !== "permanent") throw new Error("Mode invalide.");
      if (typeof gamePath !== "string" || !gamePath) throw new Error("Chemin de jeu manquant.");
      return uninstallGame(gamePath, mode);
    },
  );

  // ---- NOVA UNINSTALLER ----
  ipcMain.handle("uninstaller:preAnalyze", async (_e, app: AppInfo) => preAnalyzeApp(app));
  ipcMain.handle("uninstaller:run", async (_e, sessionId: string) =>
    runUninstaller(sessionId, (p) => send("uninstall:progress", p)),
  );
  ipcMain.handle("uninstaller:remains", async (_e, sessionId: string) => getRemains(sessionId));
  ipcMain.handle("uninstaller:cleanRemains", async (_e, sessionId: string, ids: string[]) =>
    cleanRemains(sessionId, ids, (p) => send("uninstall:progress", p)),
  );
  ipcMain.handle("uninstaller:restore", async (_e, sessionId: string) => restoreQuarantine(sessionId));

  // ---- Nettoyage ----
  ipcMain.handle("cleanup:run", async (_e, request: CleanupRequest): Promise<CleanupResult> => {
    if (request.mode !== "recycle" && request.mode !== "permanent") {
      throw new Error("Mode de suppression invalide.");
    }
    if (!Array.isArray(request.paths) || request.paths.length === 0) {
      throw new Error("Aucun élément sélectionné.");
    }
    if (request.paths.length > 5000) {
      throw new Error("Trop d'éléments (maximum 5 000 par opération).");
    }
    const result = runCleanup(request, (p) => send("cleanup:progress", p));
    scanManager.applyCleanup(new Set(request.paths));
    return result;
  });

  ipcMain.handle("recyclebin:info", async (): Promise<{ bytes: number; files: number }> => getRecycleBinInfo());

  ipcMain.handle("recyclebin:empty", async (): Promise<{ freedBytes: number; fileCount: number; requestedBytes: number }> => {
    const before = await getRecycleBinInfo();
    const script = "Clear-RecycleBin -Force -ErrorAction SilentlyContinue";
    await new Promise<void>((resolve) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 60000 }, () => resolve());
    });
    const after = await getRecycleBinInfo();
    const freedBytes = Math.max(0, before.bytes - after.bytes);
    insertCleanup({
      performedAt: Date.now(),
      mode: "permanent",
      kind: "recyclebin",
      files: before.files,
      folders: 0,
      bytes: freedBytes,
      requested: before.bytes,
      succeeded: before.files,
      targets: [],
    });
    recycleCache = null;
    logger.info(`Corbeille vidée : ${freedBytes} octets libérés.`);
    return { freedBytes, fileCount: before.files, requestedBytes: before.bytes };
  });

  // ---- Historique ----
  ipcMain.handle("history:get", async (): Promise<HistoryEvent[]> => dbGetHistory());
  ipcMain.handle("trend:get", async (): Promise<StorageTrend | null> => buildTrend());

  // ---- Fichiers système ----
  ipcMain.handle("fs:open", async (_e, p: string): Promise<void> => {
    try {
      await shell.openPath(p);
    } catch (err) {
      logger.warn(`Ouverture impossible : ${p}`);
    }
  });
  ipcMain.handle("fs:show", async (_e, p: string): Promise<void> => {
    try {
      shell.showItemInFolder(p);
    } catch (err) {
      logger.warn(`Affichage impossible : ${p}`);
    }
  });
  ipcMain.handle("fs:copy", async (_e, p: string): Promise<void> => {
    clipboard.writeText(p);
  });

  // ---- Exclusions ----
  ipcMain.handle("exclusions:get", async (): Promise<ExcludedItem[]> =>
    getExclusions().map((e) => ({ id: e.id, path: e.path, kind: e.kind as ExcludedItem["kind"], createdAt: e.createdAt })),
  );
  ipcMain.handle("exclusions:add", async (_e, item: { path: string; kind: "folder" | "extension" | "file" }): Promise<ExcludedItem> => {
    const kind = item?.kind;
    const p = typeof item?.path === "string" ? item.path.trim() : "";
    if (kind !== "folder" && kind !== "extension" && kind !== "file") {
      throw new Error("Type d'exclusion invalide.");
    }
    if (!p) throw new Error("Chemin invalide.");
    if (kind === "extension") {
      if (!p.startsWith(".") || /[\\/]/.test(p)) {
        throw new Error("Une extension doit commencer par un point (ex. .bak).");
      }
    } else if (!/^[a-zA-Z]:[\\/]/.test(p) && !/^\\\\/.test(p)) {
      throw new Error("Chemin invalide : utilisez un chemin absolu (ex. D:\\Dossier).");
    }
    dbAddExclusion(p, kind);
    const rows = getExclusions();
    const row = rows[rows.length - 1];
    return { id: row.id, path: row.path, kind, createdAt: row.createdAt };
  });
  ipcMain.handle("exclusions:remove", async (_e, id: number): Promise<void> => dbRemoveExclusion(id));

  // ---- Préférences ----
  ipcMain.handle("prefs:get", async (): Promise<typeof DEFAULT_PREFS> => {
    const p = getPreferences();
    const merged: Record<string, unknown> = { ...DEFAULT_PREFS, ...p };
    for (const key of Object.keys(DEFAULT_PREFS) as Array<keyof typeof DEFAULT_PREFS>) {
      const v = merged[key];
      const def = DEFAULT_PREFS[key];
      if (typeof def === "boolean") {
        merged[key] = v === true || v === "true" || v === "1";
      } else if (typeof def === "number") {
        const n = typeof v === "number" ? v : Number(v);
        merged[key] = Number.isFinite(n) ? n : def;
      } else if (Array.isArray(def)) {
        if (Array.isArray(v)) {
          merged[key] = v;
        } else {
          try {
            const arr = JSON.parse(String(v));
            merged[key] = Array.isArray(arr) ? arr : def;
          } catch {
            merged[key] = def;
          }
        }
      }
    }
    return merged as typeof DEFAULT_PREFS;
  });
  ipcMain.handle("prefs:save", async (_e, raw: Record<string, unknown>): Promise<void> => {
    const prefs: Record<string, unknown> = { ...raw };
    const clamp = (v: unknown, def: number, min: number, max: number): number => {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return def;
      return Math.min(max, Math.max(min, Math.round(n)));
    };
    // Bornes cohérentes : les seuils du Gardien doivent rester ordonnés.
    if ("guardianWarnPct" in prefs || "guardianAlertPct" in prefs || "guardianCriticalPct" in prefs) {
      const critical = clamp(prefs.guardianCriticalPct, 95, 1, 100);
      const alert = Math.min(clamp(prefs.guardianAlertPct, 90, 1, 100), Math.max(1, critical - 1));
      const warn = Math.min(clamp(prefs.guardianWarnPct, 80, 1, 100), Math.max(1, alert - 1));
      prefs.guardianWarnPct = warn;
      prefs.guardianAlertPct = alert;
      prefs.guardianCriticalPct = critical;
    }
    if ("guardianFrequencyMin" in prefs) {
      prefs.guardianFrequencyMin = clamp(prefs.guardianFrequencyMin, 60, 5, 1440);
    }
    if ("retentionScans" in prefs) {
      prefs.retentionScans = clamp(prefs.retentionScans, 5, 1, 50);
    }
    if ("retentionDays" in prefs) {
      prefs.retentionDays = clamp(prefs.retentionDays, 30, 1, 730);
    }
    for (const [k, v] of Object.entries(prefs)) {
      setPreference(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
    }
    if ("guardianEnabled" in prefs || "guardianFrequencyMin" in prefs || "guardianDrives" in prefs) {
      guardianService.refresh();
    }
  });

  // ---- Nova Coach ----
  ipcMain.handle("coach:get", async (): Promise<CoachReport> => buildCoachReport());

  // ---- Gardien du stockage ----
  ipcMain.handle("guardian:get", async (): Promise<GuardianReport> => {
    const report = guardianService.report();
    report.drives = await guardianService.liveDrives();
    return report;
  });
  ipcMain.handle("guardian:check", async (): Promise<GuardianReport> => {
    await guardianService.check(true);
    const report = guardianService.report();
    report.drives = await guardianService.liveDrives();
    return report;
  });

  // ---- Automatisation par règles ----
  ipcMain.handle("automation:getRules", async (): Promise<AutomationRule[]> => getRules());

  ipcMain.handle("automation:saveRule", async (_e, rule: Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "runCount" | "lastRunAt">): Promise<number> => insertRule(rule));

  ipcMain.handle("automation:updateRule", async (_e, rule: Partial<AutomationRule> & { id: number }): Promise<void> => updateRule(rule));

  ipcMain.handle("automation:deleteRule", async (_e, id: number): Promise<void> => deleteRule(id));

  ipcMain.handle("automation:runRule", async (_e, ruleId: number, dryRun = false): Promise<RuleExecution> => {
    const rule = getRuleById(ruleId);
    if (!rule) throw new Error("Règle introuvable");
    const scanId = getLatestScanId();
    if (!scanId) throw new Error("Aucune analyse disponible");
    return runRuleEngine(rule, scanId, dryRun);
  });

  ipcMain.handle("automation:getExecutions", async (_e, ruleId?: number, limit = 200): Promise<RuleExecution[]> => getRuleExecutions(ruleId, limit));

  ipcMain.handle("automation:dryRunPreview", async (_e, rule: Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "runCount" | "lastRunAt">): Promise<DryRunResult> => {
    const scanId = getLatestScanId();
    if (!scanId) throw new Error("Aucune analyse disponible");
    return getDryRunPreview(rule, scanId);
  });

  // ---- Nova AutoClean (Nova Pro) ----
  ipcMain.handle("autoclean:get", async (): Promise<AutoCleanState> => autocleanService.getAutoCleanState());
  ipcMain.handle("autoclean:save", async (_e, config: unknown): Promise<AutoCleanState> => autocleanService.saveAutoCleanConfig(config));
  ipcMain.handle("autoclean:run", async (_e, dryRun = false): Promise<RuleExecution> => autocleanService.runAutoClean(dryRun));

  // ---- Divers ----
  ipcMain.handle("license:getInfo", async (): Promise<LicenseInfo> => licenseService.getInfo());
  ipcMain.handle("license:startTrial", async (): Promise<LicenseInfo> => licenseService.startTrial());
  ipcMain.handle("license:activate", async (_e, licenseKey: unknown): Promise<LicenseActivationResult> => {
    // Validation stricte de l'entrée : une clé non textuelle est refusée.
    if (typeof licenseKey !== "string" || licenseKey.trim().length === 0) {
      return { ok: false, message: "Veuillez saisir votre clé de licence.", info: licenseService.getInfo() };
    }
    if (licenseKey.length > 200) {
      return { ok: false, message: "Cette clé de licence semble invalide (format inattendu).", info: licenseService.getInfo() };
    }
    return licenseService.activateLicense(licenseKey);
  });
  ipcMain.handle("license:restore", async (): Promise<LicenseActivationResult> => licenseService.restoreLicense());
  ipcMain.handle("license:openCheckout", async (): Promise<LicenseCheckoutResult> => {
    // Validation centralisée : https:// explicite uniquement (voir
    // validateCheckoutUrl dans src/shared/monetization.ts).
    const validated = validateCheckoutUrl(MONETIZATION.payment.checkoutUrl);
    if (!validated.ok) {
      return { opened: false, message: validated.message };
    }
    try {
      await shell.openExternal(validated.url);
      return { opened: true, message: "" };
    } catch {
      // Échec réel d'ouverture du navigateur : jamais un faux succès.
      return { opened: false, message: "Impossible d'ouvrir le paiement. Réessayez dans quelques instants." };
    }
  });
  ipcMain.handle("app:version", async (): Promise<string> => {
    const { app } = await import("electron");
    return app.getVersion();
  });

  ipcMain.handle("fs:pickFolder", async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle("fs:pickFolders", async (): Promise<string[]> => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "multiSelections"] });
    if (result.canceled) return [];
    return result.filePaths;
  });

  // Broadcasts vers le renderer
  scanManager.attach((channel, payload) => send(channel, payload));

  logger.info("IPC enregistré.");
}
