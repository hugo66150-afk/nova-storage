import { app, Notification, shell } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { getDb } from "../data/db.js";
import { licenseService } from "./licenseService.js";
import {
  deleteCandidates,
  getExclusions,
  getLastExecution,
  getRules,
  insertExecution,
  updateExecution,
  updateRule,
} from "../data/repositories.js";
import type {
  AutomationRule,
  RuleAction,
  RuleExecution,
  FileCandidate,
  CandidateKind,
  Category,
  SafetyLevel,
  DryRunResult,
} from "../../shared/types.js";
import { evaluateConditionGroup, conditionGroupToSql } from "../utils/ruleEngine.js";
import { assessSafety } from "../engine/safety.js";
import { logger } from "../infra/logger.js";

const QUARANTINE_ROOT = path.join(app.getPath("userData"), "quarantine");

/** Actions qui modifient ou suppriment des données : soumises aux protections. */
const DESTRUCTIVE_ACTIONS = new Set<RuleAction["type"]>([
  "moveToQuarantine",
  "moveToFolder",
  "deleteToRecycleBin",
  "deletePermanent",
]);

function ensureQuarantine(): void {
  fs.mkdirSync(QUARANTINE_ROOT, { recursive: true });
}

/** Chemin relatif sûr pour la quarantaine (sans caractères de chemin). */
function sanitizeQuarantineRel(p: string): string {
  const rel = p.replace(/^[a-zA-Z]:[\\/]/, "").replace(/[\\/]/g, "_");
  return rel.replace(/[^a-zA-Z0-9._-]+/g, "_") || "fichier";
}

/**
 * Déplace un fichier/dossier vers la quarantaine en gérant le changement de
 * volume (EXDEV) : copie puis suppression. La source n'est supprimée que si
 * la copie a réussi.
 */
async function moveToQuarantineSafe(src: string): Promise<string> {
  ensureQuarantine();
  const target = path.join(QUARANTINE_ROOT, `${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${sanitizeQuarantineRel(src)}`);
  try {
    await fsp.rename(src, target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fsp.cp(src, target, { recursive: true, force: true });
    await fsp.rm(src, { recursive: true, force: true });
  }
  return target;
}

interface CandidateRow {
  id: number;
  scan_id: number;
  path: string;
  name: string;
  extension: string;
  size: number;
  created: number;
  modified: number;
  is_dir: number;
  category: string;
  safety: string;
  confidence: number;
  reasons: string;
  kind: string;
}

function rowToCandidate(r: CandidateRow): FileCandidate {
  return {
    id: `${r.scan_id}:${r.path}`,
    path: r.path,
    name: r.name,
    extension: r.extension,
    size: r.size,
    created: r.created,
    modified: r.modified,
    isDir: r.is_dir === 1,
    category: r.category as Category,
    safety: r.safety as SafetyLevel,
    confidence: r.confidence,
    reasons: (JSON.parse(r.reasons) as string[]) ?? [],
    kind: r.kind as CandidateKind,
    sourceScanId: r.scan_id,
  };
}

/**
 * Sélection SQL des candidats pour une règle. Le SQL est un simple pré-filtre :
 * la vérité est le filtre mémoire (evaluateConditionGroup) appliqué ensuite
 * par runRuleEngine / getDryRunPreview.
 */
export function getCandidatesForRule(scanId: number, rule: AutomationRule): FileCandidate[] {
  const db = getDb();
  const params: Array<string | number> = [scanId];
  const where = conditionGroupToSql(rule.condition, params);
  const sql = where ? `WHERE scan_id = ? AND ${where}` : "WHERE scan_id = ?";
  const rows = db.prepare(`SELECT * FROM candidates ${sql} ORDER BY size DESC`).all(...params) as CandidateRow[];
  return rows.map(rowToCandidate);
}

/**
 * Vérifie si une cible peut être modifiée/supprimée par une règle.
 * Retourne un message d'explication si la cible est protégée, sinon null.
 * Les exclusions peuvent être passées une seule fois pour éviter une requête
 * SQL par candidat lors des exécutions massives.
 */
export function blockedTargetReason(
  p: string,
  exclusions: Array<{ path: string; kind: string }> = getExclusions(),
): string | null {
  const lower = p.toLowerCase();
  for (const e of exclusions) {
    if (e.kind !== "folder" && e.kind !== "file") continue;
    const ex = e.path.toLowerCase();
    if (lower === ex || lower.startsWith(ex + "\\")) {
      return `Chemin exclu par l'utilisateur (${e.path}).`;
    }
  }
  const s = assessSafety(p, false);
  if (s.safety === "protected" || s.safety === "risky") {
    return s.reasons[0] ?? "Élément protégé.";
  }
  return null;
}

async function executeAction(
  action: RuleAction,
  candidate: FileCandidate,
  dryRun: boolean,
): Promise<{ result: "ok" | "error"; error?: string; action: string }> {
  try {
    switch (action.type) {
      case "moveToQuarantine": {
        if (dryRun) return { result: "ok", action: "moveToQuarantine" };
        await moveToQuarantineSafe(candidate.path);
        return { result: "ok", action: "moveToQuarantine" };
      }
      case "moveToFolder": {
        if (!action.targetPath) return { result: "error", error: "targetPath manquant", action: "moveToFolder" };
        if (dryRun) return { result: "ok", action: "moveToFolder" };
        fs.mkdirSync(action.targetPath, { recursive: true });
        const target = path.join(action.targetPath, candidate.name);
        try {
          await fsp.rename(candidate.path, target);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
          await fsp.cp(candidate.path, target, { recursive: true, force: true });
          await fsp.rm(candidate.path, { recursive: true, force: true });
        }
        return { result: "ok", action: "moveToFolder" };
      }
      case "deleteToRecycleBin": {
        if (dryRun) return { result: "ok", action: "deleteToRecycleBin" };
        await shell.trashItem(candidate.path);
        return { result: "ok", action: "deleteToRecycleBin" };
      }
      case "deletePermanent": {
        if (dryRun) return { result: "ok", action: "deletePermanent" };
        await fsp.rm(candidate.path, { recursive: true, force: true });
        return { result: "ok", action: "deletePermanent" };
      }
      case "notify": {
        if (dryRun) return { result: "ok", action: "notify" };
        try {
          const n = new Notification({
            title: "Nova Storage — Automatisation",
            body: action.message ?? `La règle a affecté ${candidate.name}.`,
            silent: false,
          });
          n.show();
        } catch (err) {
          logger.warn(`Notification de règle impossible : ${err instanceof Error ? err.message : String(err)}`);
        }
        return { result: "ok", action: "notify" };
      }
      case "logOnly": {
        logger.info(`[Règle] ${candidate.path} (${candidate.size} octets)`);
        return { result: "ok", action: "logOnly" };
      }
    }
  } catch (err) {
    return { result: "error", error: err instanceof Error ? err.message : String(err), action: action.type };
  }
  return { result: "error", error: "Action inconnue", action: action.type };
}

export async function runRuleEngine(
  rule: AutomationRule,
  scanId: number,
  dryRun: boolean,
): Promise<RuleExecution> {
  // L'automatisation par règles est une fonctionnalité Nova Pro : l'exécution
  // (réelle ou simulée) est refusée sans droit, même en appel direct (IPC).
  if (!licenseService.can("automation")) {
    throw new Error("L'automatisation par règles nécessite Nova Pro.");
  }
  const candidates = getCandidatesForRule(scanId, rule);
  const matching = candidates.filter((c) => evaluateConditionGroup(rule.condition, c));

  const execId = insertExecution({
    ruleId: rule.id,
    ruleName: rule.name,
    status: dryRun ? "dry-run" : "running",
    startedAt: Date.now(),
    finishedAt: dryRun ? Date.now() : null,
    dryRunCandidates: matching.map((c) => ({ path: c.path, size: c.size, kind: c.kind })),
    executedCandidates: [],
    bytesAffected: matching.reduce((s, c) => s + c.size, 0),
    filesAffected: matching.length,
  });

  if (dryRun) {
    updateExecution(execId, { status: "completed", finishedAt: Date.now() });
    return getLastExecution(rule.id)!;
  }

  const executed: RuleExecution["executedCandidates"] = [];
  let bytesAffected = 0;
  let filesAffected = 0;
  const handledPaths = new Set<string>();
  const exclusions = getExclusions();

  for (const c of matching) {
    const blocked = blockedTargetReason(c.path, exclusions);
    for (const action of rule.actions) {
      if (DESTRUCTIVE_ACTIONS.has(action.type) && blocked) {
        executed.push({
          path: c.path,
          size: c.size,
          action: action.type,
          result: "error",
          error: `Élément protégé ou exclu — ignoré. (${blocked})`,
        });
        continue;
      }
      const res = await executeAction(action, c, false);
      executed.push({ path: c.path, size: c.size, action: action.type, result: res.result, error: res.error });
      if (res.result === "ok") {
        bytesAffected += c.size;
        filesAffected++;
        if (DESTRUCTIVE_ACTIONS.has(action.type)) handledPaths.add(c.path);
      }
    }
  }

  // Met à jour les données de l'analyse : les fichiers traités ne doivent plus
  // être proposés par les règles ni les vues de nettoyage suivantes.
  if (handledPaths.size > 0) {
    try {
      deleteCandidates(scanId, [...handledPaths]);
      logger.info(`Règle "${rule.name}" : ${handledPaths.size} chemins retirés des candidats.`);
    } catch (err) {
      logger.warn(`Purge des candidats après règle échouée : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  updateExecution(execId, {
    status: "completed",
    finishedAt: Date.now(),
    executedCandidates: executed,
    bytesAffected,
    filesAffected,
  });

  updateRule({ id: rule.id, lastRunAt: Date.now(), runCount: rule.runCount + 1 });

  return getLastExecution(rule.id)!;
}

/**
 * Avertissements de sécurité du dry-run : fichiers protégés/exclus ignorés,
 * actions irréversibles, aucune correspondance. Jamais bloquants — information
 * seule, affichée avant toute exécution. Fonction pure, testable.
 */
export function buildDryRunWarnings(
  matching: Array<{ path: string }>,
  actions: RuleAction[],
  exclusions: Array<{ path: string; kind: string }> = getExclusions(),
): string[] {
  const warnings: string[] = [];
  const hasDestructive = actions.some((a) => DESTRUCTIVE_ACTIONS.has(a.type));
  if (hasDestructive) {
    const blocked = matching.filter((c) => blockedTargetReason(c.path, exclusions) !== null).length;
    if (blocked > 0) {
      warnings.push(`${blocked} fichier(s) protégé(s) ou exclu(s) seront ignorés par les actions destructives.`);
    }
  }
  if (actions.some((a) => a.type === "deletePermanent")) {
    warnings.push("Suppression définitive : irréversible — aucun retour possible via la corbeille.");
  }
  if (matching.length === 0) {
    warnings.push("Aucun fichier ne correspond à cette règle sur la dernière analyse.");
  }
  return warnings;
}

export async function getDryRunPreview(rule: Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "runCount" | "lastRunAt">, scanId: number): Promise<DryRunResult> {
  if (!licenseService.can("automation")) {
    throw new Error("L'automatisation par règles nécessite Nova Pro.");
  }
  const tempRule = { ...rule, id: 0, createdAt: 0, updatedAt: 0, runCount: 0, lastRunAt: null } as AutomationRule;
  const candidates = getCandidatesForRule(scanId, tempRule);
  const matching = candidates.filter((c) => evaluateConditionGroup(tempRule.condition, c));
  const warnings = buildDryRunWarnings(matching, rule.actions);
  return {
    ruleId: 0,
    ruleName: rule.name,
    candidates: matching.map((c) => ({ path: c.path, size: c.size, kind: c.kind, category: c.category })),
    totalBytes: matching.reduce((s, c) => s + c.size, 0),
    totalFiles: matching.length,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export function getLatestScanId(): number | null {
  const row = getDb().prepare(`SELECT id FROM scans WHERE status IN ('completed','partial') ORDER BY finished_at DESC LIMIT 1`).get() as { id: number } | undefined;
  return row?.id ?? null;
}

export function getScheduledRules(): AutomationRule[] {
  return getRules().filter((r: AutomationRule) => r.enabled && r.schedule !== "manual");
}

/**
 * Détermine si une règle planifiée doit s'exécuter maintenant.
 * Garantit une seule exécution par période (heure/jour/semaine/mois) grâce à
 * `lastRunAt`, et rattrape une échéance manquée (application fermée à l'heure
 * prévue, machine en veille, etc.).
 */
export function shouldRunNow(rule: AutomationRule, now = new Date()): boolean {
  if (rule.schedule === "manual") return false;
  const [h = 2, m = 0] = (rule.scheduleTime ?? "02:00").split(":").map(Number);
  const last = rule.lastRunAt ?? 0;

  const startOfHour = new Date(now);
  startOfHour.setMinutes(0, 0, 0);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  // L'échéance est passée ? (heure >= heure prévue)
  const afterTime = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);

  switch (rule.schedule) {
    case "hourly":
      return afterTime && last < startOfHour.getTime();
    case "daily":
      return afterTime && last < startOfDay.getTime();
    case "weekly":
      return now.getDay() === (rule.scheduleDay ?? 0) && afterTime && last < startOfDay.getTime();
    case "monthly":
      return now.getDate() === (rule.scheduleDay ?? 1) && afterTime && last < startOfDay.getTime();
    default:
      return false;
  }
}
