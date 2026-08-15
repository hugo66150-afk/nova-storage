/**
 * Helpers PURS de Nova AutoClean (Nova Pro).
 *
 * Aucun import Electron, aucune exécution : uniquement la construction de la
 * configuration, la règle interne (réutilisée par le moteur de règles MAIN) et
 * la logique de déclenchement — le tout testable en environnement Node.
 * L'exécution réelle vit dans src/main/services/autoclean.ts.
 */
import type { AutoCleanActionType, AutoCleanConfig, AutoCleanTrigger, AutomationRule, RuleConditionGroup } from "./types.js";

export const AUTOCLEAN_DEFAULTS: AutoCleanConfig = {
  enabled: false,
  trigger: "weekly",
  triggerTime: "02:00",
  triggerDay: 0, // dimanche
  triggerPct: 85,
  actions: ["temp", "oldDownloads"],
  action: "quarantine",
  largeFilesGo: 1,
  oldDownloadsDays: 30,
};

export const AUTOCLEAN_TRIGGER_LABELS: Record<AutoCleanTrigger, string> = {
  daily: "Chaque jour",
  weekly: "Chaque semaine",
  startup: "Au démarrage de Nova",
  disk: "Quand un disque dépasse un seuil",
};

export const AUTOCLEAN_ACTION_LABELS: Record<AutoCleanActionType, string> = {
  temp: "Fichiers temporaires",
  oldDownloads: "Téléchargements anciens",
  largeFiles: "Gros fichiers",
};

/** Heure valide "HH:MM" avec heures 0-23 et minutes 0-59. */
function isValidTime(v: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

export const AUTOCLEAN_ACTION_DESCRIPTIONS: Record<AutoCleanActionType, string> = {
  temp: "Vidé le contenu des dossiers temporaires identifiés par Nova.",
  oldDownloads: "Nettoie les téléchargements plus vieux que la durée choisie.",
  largeFiles: "Traite les fichiers plus gros que le seuil choisi.",
};

export function sanitizeAutoCleanConfig(raw: Partial<AutoCleanConfig> | null | undefined): AutoCleanConfig {
  const d = AUTOCLEAN_DEFAULTS;
  if (!raw || typeof raw !== "object") return { ...d };
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const triggers: AutoCleanTrigger[] = ["daily", "weekly", "startup", "disk"];
  const actionTypes: AutoCleanActionType[] = ["temp", "oldDownloads", "largeFiles"];
  const actions = Array.isArray(raw.actions) ? (raw.actions as AutoCleanActionType[]).filter((a) => actionTypes.includes(a)) : [];
  return {
    enabled: raw.enabled === true,
    trigger: triggers.includes(raw.trigger as AutoCleanTrigger) ? (raw.trigger as AutoCleanTrigger) : d.trigger,
    triggerTime: isValidTime(String(raw.triggerTime ?? "")) ? String(raw.triggerTime) : d.triggerTime,
    triggerDay: num(raw.triggerDay, d.triggerDay, 0, 6),
    triggerPct: num(raw.triggerPct, d.triggerPct, 50, 95),
    actions: actions.length > 0 ? actions : [d.actions[0]],
    action: raw.action === "recycleBin" ? "recycleBin" : "quarantine",
    largeFilesGo: num(raw.largeFilesGo, d.largeFilesGo, 0.1, 1024),
    oldDownloadsDays: num(raw.oldDownloadsDays, d.oldDownloadsDays, 1, 3650),
  };
}

/** Construit le groupe de conditions SI de la règle interne depuis les actions. */
export function buildAutoCleanCondition(actions: AutoCleanActionType[], config: Pick<AutoCleanConfig, "largeFilesGo" | "oldDownloadsDays">): RuleConditionGroup {
  const groups: RuleConditionGroup[] = [];
  if (actions.includes("temp")) {
    groups.push({ operator: "AND", conditions: [{ field: "category", operator: "eq", value: "temp" }] });
  }
  if (actions.includes("oldDownloads")) {
    groups.push({
      operator: "AND",
      conditions: [
        { field: "category", operator: "eq", value: "downloads" },
        { field: "ageDays", operator: "gte", value: config.oldDownloadsDays },
      ],
    });
  }
  if (actions.includes("largeFiles")) {
    groups.push({ operator: "AND", conditions: [{ field: "size", operator: "gte", value: Math.round(config.largeFilesGo * 1024 ** 3) }] });
  }
  if (groups.length === 0) {
    groups.push({ operator: "AND", conditions: [{ field: "category", operator: "eq", value: "temp" }] });
  }
  return { operator: "OR", conditions: [], groups };
}

/**
 * Règle interne AutoClean : réutilise exactement le moteur de règles existant
 * (runRuleEngine / getDryRunPreview) — protections, exclusions, quarantaine,
 * historique. Sa planification est "manual" : le scheduler AutoClean (service
 * MAIN) la déclenche selon la config, le scheduler de règles ne la voit pas.
 */
export function buildAutoCleanRule(config: AutoCleanConfig, ruleId: number): AutomationRule {
  const actionType = config.action === "recycleBin" ? "deleteToRecycleBin" : "moveToQuarantine";
  return {
    id: ruleId,
    name: "Nova AutoClean",
    description: "Maintenance automatique configurée depuis Nova AutoClean (Nova Pro).",
    enabled: config.enabled,
    condition: buildAutoCleanCondition(config.actions, config),
    actions: [{ type: actionType }],
    schedule: "manual",
    scheduleTime: undefined,
    scheduleDay: undefined,
    lastRunAt: null,
    runCount: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * Vrai si AutoClean doit s'exécuter maintenant (une seule fois par période).
 * `drivePct` est le % d'utilisation du disque le plus rempli (null si inconnu).
 * Fonction pure, testable.
 */
export function autoCleanDue(config: AutoCleanConfig, lastRunAt: number | null, drivePct: number | null, now = Date.now()): boolean {
  if (!config.enabled) return false;
  const last = lastRunAt ?? 0;
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  switch (config.trigger) {
    case "daily": {
      const [h = 2, m = 0] = config.triggerTime.split(":").map(Number);
      const nowDate = new Date(now);
      const afterTime = nowDate.getHours() > h || (nowDate.getHours() === h && nowDate.getMinutes() >= m);
      return afterTime && last < startOfDay.getTime();
    }
    case "weekly": {
      const nowDate = new Date(now);
      if (nowDate.getDay() !== config.triggerDay) return false;
      const [h = 2, m = 0] = config.triggerTime.split(":").map(Number);
      const afterTime = nowDate.getHours() > h || (nowDate.getHours() === h && nowDate.getMinutes() >= m);
      // Une seule exécution par occurrence du jour planifié (borne = début du
      // jour courant) : si l'application était fermée dimanche dernier, la
      // règle s'exécute au prochain dimanche après l'heure prévue.
      return afterTime && last < startOfDay.getTime();
    }
    case "startup":
      // Une fois par jour : première vérification du jour après le démarrage.
      return last < startOfDay.getTime();
    case "disk":
      return drivePct !== null && drivePct >= config.triggerPct && last < startOfDay.getTime();
    default:
      return false;
  }
}

/** Prochaine exécution estimée (null si désactivé ou déjà due). */
export function nextAutoCleanRun(config: AutoCleanConfig, _lastRunAt: number | null, now = Date.now()): number | null {
  if (!config.enabled) return null;
  const d = new Date(now);
  switch (config.trigger) {
    case "startup":
      return null; // dépend du prochain démarrage de Nova — non prévisible.
    case "disk":
      return null; // dépend de l'évolution du disque — non prévisible.
    case "daily": {
      const [h = 2, m = 0] = config.triggerTime.split(":").map(Number);
      const next = new Date(d);
      next.setHours(h, m, 0, 0);
      if (next.getTime() <= now) next.setDate(next.getDate() + 1);
      return next.getTime();
    }
    case "weekly": {
      const [h = 2, m = 0] = config.triggerTime.split(":").map(Number);
      const next = new Date(d);
      next.setHours(h, m, 0, 0);
      let dayDiff = (config.triggerDay - next.getDay() + 7) % 7;
      next.setDate(next.getDate() + dayDiff);
      if (next.getTime() <= now) next.setDate(next.getDate() + 7);
      return next.getTime();
    }
    default:
      return null;
  }
}

/** Résumé lisible de la config (liste des règles, sous-titres, etc.). */
export function summarizeAutoClean(config: AutoCleanConfig): string {
  const actions = config.actions.map((a: AutoCleanActionType) => AUTOCLEAN_ACTION_LABELS[a]).join(", ");
  const trigger = AUTOCLEAN_TRIGGER_LABELS[config.trigger];
  return `${actions} · ${trigger}`;
}
