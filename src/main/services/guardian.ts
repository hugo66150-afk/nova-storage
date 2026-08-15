import { app, BrowserWindow, Menu, Notification, Tray, nativeImage } from "electron";
import * as path from "node:path";
import type {
  AppPreferences,
  GuardianDriveStatus,
  GuardianEvent,
  GuardianForecast,
  GuardianPrediction,
  GuardianReport,
} from "../../shared/types.js";
import { getDrives } from "./drives.js";
import { buildTrend } from "./insights.js";
import { licenseService } from "./licenseService.js";
import {
  addSnapshot,
  getGuardianEvents,
  getGuardianLastCheckAt,
  getPreferences,
  getSnapshots,
  insertGuardianEvent,
  setPreference,
} from "../data/repositories.js";
import { logger } from "../infra/logger.js";

const DEFAULT_WARN = 80;
const DEFAULT_ALERT = 90;
const DEFAULT_CRITICAL = 95;
const DEFAULT_FREQ_MIN = 60;

/** Niveaux par paliers : on ne notifie qu'au franchissement (pas de spam). */
const LEVEL_ORDER = ["ok", "warn", "alert", "critical"] as const;

function levelFor(pct: number, prefs: AppPreferences): GuardianDriveStatus["level"] {
  if (pct >= prefs.guardianCriticalPct) return "critical";
  if (pct >= prefs.guardianAlertPct) return "alert";
  if (pct >= prefs.guardianWarnPct) return "warn";
  return "ok";
}

function loadPrefs(): AppPreferences {
  const p = getPreferences();
  const num = (k: string, def: number) => {
    const n = Number(p[k]);
    return Number.isFinite(n) ? n : def;
  };
  const bool = (k: string, def: boolean) => {
    const v = p[k];
    return v === undefined ? def : v === "true" || v === "1";
  };
  const drivesRaw = p.guardianDrives;
  let drives: string[] = [];
  try {
    drives = drivesRaw ? (JSON.parse(drivesRaw) as string[]) : [];
  } catch {
    drives = [];
  }
  return {
    guardianEnabled: bool("guardianEnabled", false),
    guardianNotifications: bool("guardianNotifications", true),
    guardianPredictions: bool("guardianPredictions", true),
    guardianWeekly: bool("guardianWeekly", true),
    guardianWarnPct: num("guardianWarnPct", DEFAULT_WARN),
    guardianAlertPct: num("guardianAlertPct", DEFAULT_ALERT),
    guardianCriticalPct: num("guardianCriticalPct", DEFAULT_CRITICAL),
    guardianFrequencyMin: Math.max(5, num("guardianFrequencyMin", DEFAULT_FREQ_MIN)),
    guardianDrives: drives,
  } as AppPreferences;
}

/** Construit la prédiction de remplissage à partir des snapshots réels. */
export function buildPrediction(snapshots: { at: number; used: number; total: number }[], now = Date.now()): GuardianPrediction | null {
  if (snapshots.length < 2) {
    return {
      at: now,
      ratePerDay: 0,
      daysToFull: null,
      fullAt: null,
      reliable: false,
      message: "Pas assez de données pour établir une prédiction fiable.",
    };
  }
  const sorted = [...snapshots].sort((a, b) => a.at - b.at);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const days = (last.at - first.at) / 86400000;
  if (days < 3) {
    return {
      at: now,
      ratePerDay: 0,
      daysToFull: null,
      fullAt: null,
      reliable: false,
      message: "Pas assez de données pour établir une prédiction fiable.",
    };
  }
  const ratePerDay = (last.used - first.used) / days;
  const freeNow = last.total - last.used;
  let daysToFull: number | null = null;
  let fullAt: number | null = null;
  if (ratePerDay > 0) {
    daysToFull = freeNow / ratePerDay;
    fullAt = last.at + daysToFull * 86400000;
  }
  const roundedDays = daysToFull !== null ? Math.round(daysToFull) : 0;
  const message =
    ratePerDay <= 0 || daysToFull === null
      ? "Votre stockage diminue ou reste stable : aucune prédiction de saturation nécessaire."
      : `À ce rythme (+${(ratePerDay / 1024 ** 2).toFixed(0)} Mo/jour), votre disque pourrait être plein dans environ ${roundedDays} jours.`;
  return { at: now, ratePerDay, daysToFull, fullAt, reliable: true, message };
}

/**
 * Prévisions AVANCÉES (Gardien avancé — Nova Pro) : à partir des mesures
 * réelles, estime la date de franchissement de chaque seuil d'alerte
 * configuré (warn / alert / critical) et la saturation complète.
 * Fonction pure, testable.
 */
export function buildAdvancedForecast(
  snapshots: { at: number; used: number; total: number }[],
  thresholds: { warn: number; alert: number; critical: number },
): GuardianForecast | null {
  if (snapshots.length < 2) return null;
  const sorted = [...snapshots].sort((a, b) => a.at - b.at);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const spanDays = (last.at - first.at) / 86400000;
  if (spanDays < 3) return null;
  const ratePerDay = (last.used - first.used) / spanDays;
  const freeNow = Math.max(0, last.total - last.used);
  const total = last.total;

  const thresholdsList = [
    { pct: thresholds.warn },
    { pct: thresholds.alert },
    { pct: thresholds.critical },
  ];

  const forecast: GuardianForecast = {
    thresholds: thresholdsList.map(({ pct }) => {
      const needed = Math.max(0, (total * pct) / 100 - last.used);
      return {
        pct,
        at: ratePerDay > 0 ? last.at + (needed / ratePerDay) * 86400000 : null,
      };
    }),
    fullAt: ratePerDay > 0 ? last.at + (freeNow / ratePerDay) * 86400000 : null,
    dataPoints: sorted.length,
    spanDays,
    reliable: ratePerDay > 0,
  };
  return forecast;
}

class GuardianService {
  private timer: NodeJS.Timeout | null = null;
  private tray: Tray | null = null;
  private lastLevels = new Map<string, GuardianDriveStatus["level"]>();
  private weeklyReportedAt = 0;
  private lastCheckAt: number | null = null;
  private predictionNotifiedAt = new Map<string, number>();
  private broadcast: ((channel: string, payload: unknown) => void) | null = null;
  private notifyCb: ((e: GuardianEvent) => void) | null = null;

  attach(broadcast: (channel: string, payload: unknown) => void): void {
    this.broadcast = broadcast;
  }

  private iconPath(): string {
    return path.join(app.getAppPath(), "assets", "branding", "nova.png");
  }

  get enabled(): boolean {
    return loadPrefs().guardianEnabled;
  }

  start(): void {
    if (this.tray) return;
    try {
      const img = nativeImage.createFromPath(this.iconPath());
      const tray = new Tray(img.resize({ width: 16, height: 16 }));
      tray.setToolTip("Nova Storage — Gardien");
      this.tray = tray;
      this.rebuildTrayMenu();
    } catch (err) {
      logger.warn(`Systray indisponible : ${err instanceof Error ? err.message : String(err)}`);
    }
    this.schedule();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      this.tray?.destroy();
    } catch {
      /* silencieux */
    }
    this.tray = null;
  }

  /** Replanifie la boucle selon les préférences (fréquence). */
  refresh(): void {
    if (this.enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  private schedule(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const freq = Math.max(5, loadPrefs().guardianFrequencyMin) * 60000;
    this.timer = setInterval(() => void this.check(false), freq);
    this.timer.unref?.();
  }

  private rebuildTrayMenu(): void {
    if (!this.tray) return;
    const showWindow = () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    };
    const navigate = (page: string) => {
      showWindow();
      this.broadcast?.("guardian:navigate", page);
    };

    const menu = Menu.buildFromTemplate([
      { label: "Ouvrir Nova Storage", click: () => showWindow() },
      { type: "separator" },
      { label: "Lancer une analyse", click: () => navigate("analyze") },
      { label: "Voir les recommandations", click: () => navigate("coach") },
      { label: "Historique du Gardien", click: () => navigate("guardian") },
      { label: "Paramètres du Gardien", click: () => navigate("settings") },
      { type: "separator" },
      { label: "Quitter complètement Nova", click: () => app.quit() },
    ]);
    this.tray.setContextMenu(menu);
    this.tray.on("click", () => showWindow());
  }

  private notify(title: string, body: string, drive: string, level: GuardianDriveStatus["level"] | "info"): void {
    insertGuardianEvent(drive, level, body);
    this.broadcast?.("guardian:event", { id: 0, at: Date.now(), drive, level, message: body } satisfies GuardianEvent);
    this.notifyCb?.({ id: 0, at: Date.now(), drive, level, message: body });
    if (loadPrefs().guardianNotifications) {
      try {
        const n = new Notification({ title, body, silent: false });
        n.show();
      } catch (err) {
        logger.warn(`Notification impossible : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** Exécute une vérification : seuils, snapshot, prédiction, résumé hebdo. */
  async check(_force = true): Promise<void> {
    const prefs = loadPrefs();
    if (!prefs.guardianEnabled) return;
    this.lastCheckAt = Date.now();
    try {
      const drives = await getDrives();
      const monitored = prefs.guardianDrives.length > 0 ? prefs.guardianDrives : drives.map((d) => d.name);

      const firstDrive = drives[0];
      if (firstDrive) {
        const lastSnap = getSnapshots().at(-1);
        if (!lastSnap || Date.now() - lastSnap.at > 3600000) {
          addSnapshot(firstDrive.total, firstDrive.free);
        }
      }

      for (const drive of drives) {
        if (!monitored.includes(drive.name)) continue;
        if (drive.total <= 0) continue;
        const pct = (drive.used / drive.total) * 100;
        const level = levelFor(pct, prefs);
        const prev = this.lastLevels.get(drive.name) ?? "ok";
        if (LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(prev)) {
          const message =
            level === "critical"
              ? `Votre disque ${drive.name} dépasse ${prefs.guardianCriticalPct} % d'utilisation. Une action est fortement recommandée.`
              : level === "alert"
                ? `Votre disque ${drive.name} dépasse ${prefs.guardianAlertPct} % d'utilisation.`
                : `Votre disque ${drive.name} dépasse ${prefs.guardianWarnPct} % d'utilisation.`;
          this.notify(`Disque ${drive.name} presque plein`, message, drive.name, level);
        }
        this.lastLevels.set(drive.name, level);
      }

      // Prédiction : une notification maximum par palier et par cooldown (12 h),
      // même lors d'une vérification manuelle (pas de spam). Fonctionnalité Pro
      // (prévisions de remplissage) : sans droit, aucune notification ni donnée.
      if (prefs.guardianPredictions && licenseService.can("guardianPredictions")) {
        const snaps = getSnapshots();
        const pred = buildPrediction(snaps, this.lastCheckAt);
        if (pred?.reliable && pred.daysToFull !== null && pred.daysToFull <= 30) {
          const key = `prediction:${Math.floor(pred.daysToFull / 5)}`;
          const lastNotified = this.predictionNotifiedAt.get(key) ?? 0;
          if (Date.now() - lastNotified >= 12 * 3600000) {
            this.predictionNotifiedAt.set(key, Date.now());
            this.notify(
              "Prédiction de remplissage",
              pred.message,
              firstDrive?.name ?? "",
              "info",
            );
          }
        }
      }

      // Résumé hebdomadaire.
      if (prefs.guardianWeekly) {
        const weekMs = 7 * 86400000;
        if (this.weeklyReportedAt === 0) {
          this.weeklyReportedAt = Date.now();
        } else if (Date.now() - this.weeklyReportedAt >= weekMs) {
          this.weeklyReportedAt = Date.now();
          const trend = buildTrend();
          const growth = trend?.weeklyGrowth ?? 0;
          const growthTxt = growth / 1024 ** 3 >= 0.1 ? `${(growth / 1024 ** 3).toFixed(1)} Go/semaine` : "stable";
          this.notify(
            "Résumé hebdomadaire Nova",
            `Votre stockage évolue de ${growthTxt} cette semaine.`,
            "",
            "info",
          );
        }
      }

      this.rebuildTrayMenu();
      logger.info(`Gardien : vérification terminée (${drives.length} disques).`);
    } catch (err) {
      logger.warn(`Vérification du Gardien échouée : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Retourne l'état complet pour le renderer. */
  report(): GuardianReport {
    const prefs = loadPrefs();
    void prefs;
    const snapshots = getSnapshots();
    const events: GuardianEvent[] = getGuardianEvents(60).map((e) => ({
      id: e.id,
      at: e.at,
      drive: e.drive,
      level: e.level as GuardianEvent["level"],
      message: e.message,
    }));
    const trend = buildTrend();
    const lastCheck = getGuardianLastCheckAt();
    // Les prévisions de remplissage sont une fonctionnalité Pro : sans droit,
    // le rapport n'expose aucune prédiction (ni notification, ni données).
    const prediction = licenseService.can("guardianPredictions") ? buildPrediction(snapshots) : null;
    // Gardien avancé (Nova Pro) : prévisions par seuil + saturation. Sans droit,
    // le rapport n'expose aucune donnée de prévision avancée.
    const forecast = licenseService.can("advancedGuardian")
      ? buildAdvancedForecast(snapshots, {
          warn: prefs.guardianWarnPct,
          alert: prefs.guardianAlertPct,
          critical: prefs.guardianCriticalPct,
        })
      : null;
    return {
      enabled: prefs.guardianEnabled,
      drives: [],
      prediction,
      forecast,
      events,
      lastCheckAt: lastCheck,
      weeklyGrowth: trend?.weeklyGrowth ?? 0,
    };
  }

  async liveDrives(): Promise<GuardianDriveStatus[]> {
    const prefs = loadPrefs();
    const info = await getDrives();
    const monitored = prefs.guardianDrives.length > 0 ? prefs.guardianDrives : info.map((d) => d.name);
    return info.map((d) => {
      const pct = d.total > 0 ? (d.used / d.total) * 100 : 0;
      return {
        name: d.name,
        label: d.label,
        total: d.total,
        used: d.used,
        free: d.free,
        pct,
        level: monitored.includes(d.name) ? levelFor(pct, prefs) : "ok",
      };
    });
  }

  /** Enregistre une nouvelle préférence puis rafraîchit la boucle. */
  setPrefs(patch: Partial<Record<string, unknown>>): void {
    for (const [k, v] of Object.entries(patch)) {
      setPreference(k, typeof v === "string" || typeof v === "boolean" || typeof v === "number" ? String(v) : JSON.stringify(v));
    }
    this.refresh();
  }
}

export const guardianService = new GuardianService();

export { loadPrefs, levelFor };