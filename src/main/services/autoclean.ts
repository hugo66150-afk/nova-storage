/**
 * Nova AutoClean (Nova Pro) — service MAIN.
 *
 * Réutilise intégralement le moteur d'automatisation existant :
 *  - la règle interne est construite par les helpers purs (shared/autoclean.ts)
 *    et exécutée via runRuleEngine / getDryRunPreview (gates Pro, exclusions,
 *    protections, quarantaine, historique rule_executions) ;
 *  - la planification est gérée ici (daily / weekly / startup / seuil disque),
 *    distincte du scheduler de règles (schedule "manual" sur la règle interne).
 *
 * Gates : can("automation") pour simuler/exécuter, can("scheduledMaintenance")
 * pour l'exécution planifiée. Sans droit, la config reste sauvegardée mais ne
 * s'exécute jamais.
 */
import { getDb } from "../data/db.js";
import {
  getPreferences,
  insertRule,
  setPreference,
  updateRule,
} from "../data/repositories.js";
import { getDrives } from "./drives.js";
import { getLatestScanId, runRuleEngine } from "./automation.js";
import { licenseService } from "./licenseService.js";
import {
  AUTOCLEAN_DEFAULTS,
  autoCleanDue,
  buildAutoCleanRule,
  nextAutoCleanRun,
  sanitizeAutoCleanConfig,
} from "../../shared/autoclean.js";
import type { AutoCleanConfig, AutoCleanState, RuleExecution } from "../../shared/types.js";
import { logger } from "../infra/logger.js";

const CFG_KEY = "autoclean.config";
const RULE_ID_KEY = "autoclean.ruleId";
const LAST_RUN_KEY = "autoclean.lastRunAt";
// Le nom est défini dans shared/autoclean.ts (buildAutoCleanRule).

function loadConfig(): AutoCleanConfig {
  const raw = getPreferences()[CFG_KEY];
  if (!raw) return { ...AUTOCLEAN_DEFAULTS };
  try {
    return sanitizeAutoCleanConfig(JSON.parse(raw));
  } catch {
    return { ...AUTOCLEAN_DEFAULTS };
  }
}

function loadRuleId(): number | null {
  const v = Number(getPreferences()[RULE_ID_KEY]);
  return Number.isInteger(v) && v > 0 ? v : null;
}

function loadLastRunAt(): number | null {
  const v = Number(getPreferences()[LAST_RUN_KEY]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Retrouve la règle interne, ou la recrée si elle a été supprimée. */
function ensureRule(config: AutoCleanConfig): number {
  let ruleId = loadRuleId();
  if (ruleId !== null) {
    try {
      const row = getDb().prepare(`SELECT id FROM automation_rules WHERE id = ?`).get(ruleId);
      if (row) return ruleId;
    } catch {
      /* base absente → recréée plus tard */
    }
  }
  const draft = buildAutoCleanRule(config, 0);
  ruleId = insertRule({
    name: draft.name,
    description: draft.description,
    enabled: config.enabled,
    condition: draft.condition,
    actions: draft.actions,
    schedule: "manual",
    scheduleTime: undefined,
    scheduleDay: undefined,
  });
  setPreference(RULE_ID_KEY, String(ruleId));
  setPreference(LAST_RUN_KEY, "0");
  return ruleId;
}

function syncRule(config: AutoCleanConfig): number {
  const ruleId = ensureRule(config);
  updateRule({
    id: ruleId,
    enabled: config.enabled,
    condition: buildAutoCleanRule(config, ruleId).condition,
    actions: buildAutoCleanRule(config, ruleId).actions,
  });
  return ruleId;
}

export function getAutoCleanState(): AutoCleanState {
  const config = loadConfig();
  const ruleId = loadRuleId();
  const lastRunAt = loadLastRunAt();
  const hasScan = getLatestScanId() !== null;
  let executions: RuleExecution[] = [];
  if (ruleId !== null) {
    try {
      const rows = getDb()
        .prepare(`SELECT * FROM rule_executions WHERE rule_id = ? ORDER BY started_at DESC LIMIT 50`)
        .all(ruleId) as Array<Record<string, unknown>>;
      executions = rows.map((r) => ({
        id: Number(r.id),
        ruleId: Number(r.rule_id),
        ruleName: String(r.rule_name),
        status: String(r.status) as RuleExecution["status"],
        startedAt: Number(r.started_at),
        finishedAt: r.finished_at === null ? null : Number(r.finished_at),
        dryRunCandidates: JSON.parse(String(r.dry_run_candidates_json)) as RuleExecution["dryRunCandidates"],
        executedCandidates: JSON.parse(String(r.executed_candidates_json)) as RuleExecution["executedCandidates"],
        bytesAffected: Number(r.bytes_affected),
        filesAffected: Number(r.files_affected),
        error: r.error === null ? undefined : String(r.error),
      }));
    } catch (err) {
      logger.warn(`Historique AutoClean indisponible : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const nextRunAt = nextAutoCleanRun(config, lastRunAt);
  return { config, ruleId, lastRunAt, nextRunAt, hasScan, executions };
}

export function saveAutoCleanConfig(raw: unknown): AutoCleanState {
  const config = sanitizeAutoCleanConfig((raw ?? {}) as Partial<AutoCleanConfig>);
  setPreference(CFG_KEY, JSON.stringify(config));
  syncRule(config);
  logger.info(`AutoClean : configuration enregistrée (${config.actions.join(",")}, ${config.trigger}).`);
  return getAutoCleanState();
}

/** Exécute AutoClean maintenant (dryRun = simulation). Gate Pro (automation). */
export async function runAutoClean(dryRun: boolean): Promise<RuleExecution> {
  const config = loadConfig();
  const ruleId = syncRule(config);
  if (!config.enabled && !dryRun) {
    throw new Error("AutoClean est désactivé — activez-le avant de l'exécuter.");
  }
  const scanId = getLatestScanId();
  if (!scanId) throw new Error("Aucune analyse disponible");
  const rule = buildAutoCleanRule(config, ruleId);
  const exec = await runRuleEngine(rule, scanId, dryRun);
  if (!dryRun) {
    setPreference(LAST_RUN_KEY, String(Date.now()));
    logger.info(`AutoClean exécuté : ${exec.filesAffected} fichier(s), ${exec.bytesAffected} octets.`);
  }
  return exec;
}

/**
 * Point d'entrée du scheduler : exécute AutoClean s'il est dû. Gate Pro
 * (scheduledMaintenance) — sans droit, rien ne s'exécute (config conservée).
 */
export async function runAutoCleanIfDue(): Promise<void> {
  if (!licenseService.can("scheduledMaintenance")) return;
  const config = loadConfig();
  if (!config.enabled) return;
  let drivePct: number | null = null;
  if (config.trigger === "disk") {
    try {
      const drives = await getDrives();
      drivePct = drives.length > 0 ? Math.max(...drives.map((d) => (d.total > 0 ? (d.used / d.total) * 100 : 0))) : null;
    } catch {
      drivePct = null;
    }
  }
  if (!autoCleanDue(config, loadLastRunAt(), drivePct)) return;
  try {
    await runAutoClean(false);
  } catch (err) {
    logger.warn(`Exécution AutoClean planifiée échouée : ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const autocleanService = { getAutoCleanState, saveAutoCleanConfig, runAutoClean, runAutoCleanIfDue };
