import { getDb } from "./db.js";
import type {
  Category,
  CandidateKind,
  FileCandidate,
  SafetyLevel,
  AutomationRule,
  RuleConditionGroup,
  RuleAction,
  RuleExecution,
  ExecutionStatus,
} from "../../shared/types.js";
import { logger } from "../infra/logger.js";

export interface ScanRow {
  id: number;
  started_at: number;
  finished_at: number | null;
  status: string;
  target: string;
  root: string;
  total_files: number;
  total_dirs: number;
  total_bytes: number;
  errors: number;
  duration_ms: number;
}

interface CategoryRow {
  category: string;
  bytes: number;
  files: number;
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

interface TreeNodeRow {
  path: string;
  parent_path: string | null;
  name: string;
  size: number;
  file_count: number;
  dir_count: number;
  category: string;
  safety: string;
}

export function insertScan(r: {
  startedAt: number;
  finishedAt: number | null;
  status: string;
  target: string;
  root: string;
}): number {
  return getDb()
    .prepare(
      `INSERT INTO scans (started_at, finished_at, status, target, root)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(r.startedAt, r.finishedAt, r.status, r.target, r.root).lastInsertRowid as number;
}

export function updateScan(
  id: number,
  patch: Partial<{
    finishedAt: number;
    status: string;
    totalFiles: number;
    totalDirs: number;
    totalBytes: number;
    errors: number;
    durationMs: number;
  }>,
): void {
  const db = getDb();
  const sets: string[] = [];
  const vals: Array<number | string> = [];
  if (patch.finishedAt !== undefined) {
    sets.push("finished_at = ?");
    vals.push(patch.finishedAt);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    vals.push(patch.status);
  }
  if (patch.totalFiles !== undefined) {
    sets.push("total_files = ?");
    vals.push(patch.totalFiles);
  }
  if (patch.totalDirs !== undefined) {
    sets.push("total_dirs = ?");
    vals.push(patch.totalDirs);
  }
  if (patch.totalBytes !== undefined) {
    sets.push("total_bytes = ?");
    vals.push(patch.totalBytes);
  }
  if (patch.errors !== undefined) {
    sets.push("errors = ?");
    vals.push(patch.errors);
  }
  if (patch.durationMs !== undefined) {
    sets.push("duration_ms = ?");
    vals.push(patch.durationMs);
  }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE scans SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function getLastScan(): ScanRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM scans WHERE status IN ('completed','partial') ORDER BY finished_at DESC LIMIT 1`)
    .get() as ScanRow | undefined;
  return row ?? null;
}

export function getScanById(id: number): ScanRow | null {
  const row = getDb().prepare(`SELECT * FROM scans WHERE id = ?`).get(id) as ScanRow | undefined;
  return row ?? null;
}

export function getScanCategories(scanId: number): Array<{ category: Category; bytes: number; files: number }> {
  const rows = getDb()
    .prepare(`SELECT category, bytes, files FROM scan_categories WHERE scan_id = ?`)
    .all(scanId) as CategoryRow[];
  return rows.map((r) => ({ category: r.category as Category, bytes: r.bytes, files: r.files }));
}

export function saveScanCategories(
  scanId: number,
  categories: Record<Category, { bytes: number; files: number }>,
): void {
  const db = getDb();
  const stmt = db.prepare(`INSERT OR REPLACE INTO scan_categories (scan_id, category, bytes, files) VALUES (?, ?, ?, ?)`);
  const tx = db.transaction((entries: Array<[Category, number, number]>) => {
    for (const [cat, bytes, files] of entries) stmt.run(scanId, cat, bytes, files);
  });
  tx(Object.entries(categories).map(([cat, v]) => [cat as Category, v.bytes, v.files]));
}

export function saveTreeNodes(
  scanId: number,
  tree: Record<string, { parentPath: string | null; name: string; size: number; fileCount: number; dirCount: number; category: Category; safety: SafetyLevel }>,
): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO tree_nodes (scan_id, path, parent_path, name, size, file_count, dir_count, category, safety)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((nodes: Array<[string, string | null, string, number, number, number, string, string]>) => {
    for (const n of nodes) stmt.run(scanId, n[0], n[1], n[2], n[3], n[4], n[5], n[6], n[7]);
  });
  const entries: Array<[string, string | null, string, number, number, number, string, string]> = [];
  for (const [p, node] of Object.entries(tree)) {
    entries.push([p, node.parentPath, node.name, node.size, node.fileCount, node.dirCount, node.category, node.safety]);
  }
  tx(entries);
}

export function getDirChildren(scanId: number, parentPath: string): TreeNodeRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM tree_nodes WHERE scan_id = ? AND parent_path = ? ORDER BY size DESC`)
    .all(scanId, parentPath) as TreeNodeRow[];
  return rows;
}

export function saveCandidates(scanId: number, candidates: FileCandidate[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO candidates (scan_id, path, name, extension, size, created, modified, is_dir, category, safety, confidence, reasons, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows: Array<unknown[]>) => {
    for (const r of rows) stmt.run(...r);
  });
  const rows = candidates.map((c) => [
    scanId,
    c.path,
    c.name,
    c.extension,
    c.size,
    c.created,
    c.modified,
    c.isDir ? 1 : 0,
    c.category,
    c.safety,
    c.confidence,
    JSON.stringify(c.reasons ?? []),
    c.kind,
  ]);
  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    tx(rows.slice(i, i + BATCH));
  }
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

export interface CandidatePage {
  items: FileCandidate[];
  total: number;
  totalBytes: number;
}

export interface CandidateQuery {
  category?: string;
  kind?: CandidateKind;
  minSize?: number;
  olderThanDays?: number;
  query?: string;
}

/**
 * Page de candidats triés par taille décroissante (SQL paginé).
 * Retourne aussi le total et la taille totale des éléments répondant au filtre.
 */
export function getCandidatesPage(scanId: number, q: CandidateQuery, offset: number, limit: number): CandidatePage {
  const db = getDb();
  const where: string[] = ["scan_id = ?"];
  const params: Array<string | number> = [scanId];
  if (q.category) {
    where.push("category = ?");
    params.push(q.category);
  }
  if (q.kind) {
    where.push("kind = ?");
    params.push(q.kind);
  }
  if (q.minSize !== undefined) {
    where.push("size >= ?");
    params.push(q.minSize);
  }
  if (q.olderThanDays !== undefined) {
    where.push("modified < ?");
    params.push(Date.now() - q.olderThanDays * 86400000);
  }
  if (q.query) {
    where.push("(LOWER(name) LIKE ? OR LOWER(path) LIKE ?)");
    const like = `%${q.query.toLowerCase()}%`;
    params.push(like, like);
  }
  const whereSql = where.join(" AND ");
  const agg = db
    .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(size), 0) AS total_bytes FROM candidates WHERE ${whereSql}`)
    .get(...params) as { total: number; total_bytes: number };
  const rows = db
    .prepare(`SELECT * FROM candidates WHERE ${whereSql} ORDER BY size DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as CandidateRow[];
  return { items: rows.map(rowToCandidate), total: agg.total, totalBytes: agg.total_bytes };
}

/** Filtre pour l'aperçu récupérable : indexés par kind et par catégorie. */
export function getCandidatesSummary(scanId: number): { byKind: Array<{ kind: CandidateKind; bytes: number; files: number }> } {
  const rows = getDb()
    .prepare(`SELECT kind, SUM(size) AS bytes, COUNT(*) AS files FROM candidates WHERE scan_id = ? GROUP BY kind`)
    .all(scanId) as Array<{ kind: string; bytes: number; files: number }>;
  return {
    byKind: rows.map((r) => ({ kind: r.kind as CandidateKind, bytes: r.bytes, files: r.files })),
  };
}

/** Enfants directs (fichiers) d'un dossier, via SQL (préfixe de chemin). */
export function getCandidatesByParent(scanId: number, parentPath: string, limit = 5000): FileCandidate[] {
  const db = getDb();
  const prefix = parentPath.endsWith("\\") || parentPath.endsWith("/") ? parentPath : `${parentPath}\\`;
  const esc = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = db
    .prepare(
      `SELECT * FROM candidates
       WHERE scan_id = ? AND path LIKE ? ESCAPE '\\' AND path NOT LIKE ? ESCAPE '\\'
       ORDER BY size DESC LIMIT ?`,
    )
    .all(scanId, `${esc}%`, `${esc}%\\%`, limit) as CandidateRow[];
  return rows.map(rowToCandidate);
}

/** Supprime les candidats d'un scan dont le chemin figure dans paths. */
export function deleteCandidates(scanId: number, paths: string[]): void {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM candidates WHERE scan_id = ? AND path = ?`);
  const tx = db.transaction((rows: Array<[number, string]>) => {
    for (const r of rows) stmt.run(r[0], r[1]);
  });
  const BATCH = 2000;
  const rows: Array<[number, string]> = paths.map((p) => [scanId, p]);
  for (let i = 0; i < rows.length; i += BATCH) {
    tx(rows.slice(i, i + BATCH));
  }
}

export function insertCleanup(r: {
  performedAt: number;
  mode: string;
  kind: string;
  files: number;
  folders: number;
  bytes: number;
  requested: number;
  succeeded: number;
  targets: string[];
}): number {
  return getDb()
    .prepare(
      `INSERT INTO cleanups (performed_at, mode, kind, files, folders, bytes, requested, succeeded, targets)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.performedAt,
      r.mode,
      r.kind,
      r.files,
      r.folders,
      r.bytes,
      r.requested,
      r.succeeded,
      JSON.stringify(r.targets),
    ).lastInsertRowid as number;
}

export interface CleanupRow {
  id: number;
  performed_at: number;
  mode: string;
  kind: string;
  files: number;
  folders: number;
  bytes: number;
  requested: number;
  succeeded: number;
  targets: string;
}

export function getCleanups(limit = 200): CleanupRow[] {
  return getDb()
    .prepare(`SELECT * FROM cleanups ORDER BY performed_at DESC LIMIT ?`)
    .all(limit) as CleanupRow[];
}

export function getHistory(): Array<{
  id: number;
  at: number;
  type: "scan" | "cleanup";
  status: string;
  totalBytes: number;
  freedBytes: number;
  detail: string;
}> {
  const db = getDb();
  const scans = db.prepare(`SELECT id, finished_at as at, status, total_bytes, duration_ms FROM scans WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 100`).all() as Array<{
    id: number;
    at: number;
    status: string;
    total_bytes: number;
    duration_ms: number;
  }>;
  const cleanups = getCleanups();
  const events = [
    ...scans.map((s) => ({
      id: s.id,
      at: s.at,
      type: "scan" as const,
      status: s.status,
      totalBytes: s.total_bytes,
      freedBytes: 0,
      detail: `${(s.total_bytes / (1024 ** 3)).toFixed(2)} Go analysés`,
    })),
    ...cleanups.map((c) => ({
      id: 100000 + c.id,
      at: c.performed_at,
      type: "cleanup" as const,
      status: "completed",
      totalBytes: 0,
      freedBytes: c.bytes,
      detail: `${c.files} éléments · ${c.bytes / (1024 ** 3) >= 1 ? (c.bytes / (1024 ** 3)).toFixed(2) + " Go" : Math.round(c.bytes / (1024 ** 2)) + " Mo"} récupérés`,
    })),
  ];
  events.sort((a, b) => b.at - a.at);
  return events;
}

export function addSnapshot(total: number, free: number): void {
  getDb()
    .prepare(`INSERT INTO snapshots (at, total, free, used) VALUES (?, ?, ?, ?)`)
    .run(Date.now(), total, free, total - free);
}

export interface SnapshotRow {
  at: number;
  total: number;
  free: number;
  used: number;
}

export function getSnapshots(): SnapshotRow[] {
  return getDb().prepare(`SELECT * FROM snapshots ORDER BY at ASC`).all() as SnapshotRow[];
}

export function getPreferences(): Record<string, string> {
  const rows = getDb().prepare(`SELECT key, value FROM preferences`).all() as Array<{ key: string; value: string }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setPreference(key: string, value: string): void {
  getDb()
    .prepare(`INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, value);
}

export function getExclusions(): Array<{ id: number; path: string; kind: string; createdAt: number }> {
  return getDb()
    .prepare(`SELECT * FROM exclusions ORDER BY created_at ASC`)
    .all() as Array<{ id: number; path: string; kind: string; createdAt: number }>;
}

export function addExclusion(pathValue: string, kind: string): void {
  try {
    getDb()
      .prepare(`INSERT INTO exclusions (path, kind, created_at) VALUES (?, ?, ?)`)
      .run(pathValue, kind, Date.now());
  } catch (err) {
    logger.warn(`Exclusion déjà existante : ${pathValue}`);
  }
}

export function removeExclusion(id: number): void {
  getDb().prepare(`DELETE FROM exclusions WHERE id = ?`).run(id);
}

/* ---------------- Gardien du stockage ---------------- */

export interface GuardianEventRow {
  id: number;
  at: number;
  drive: string;
  level: string;
  message: string;
}

export function insertGuardianEvent(drive: string, level: string, message: string): number {
  return getDb()
    .prepare(`INSERT INTO guardian_events (at, drive, level, message) VALUES (?, ?, ?, ?)`)
    .run(Date.now(), drive, level, message).lastInsertRowid as number;
}

export function getGuardianEvents(limit = 100): GuardianEventRow[] {
  return getDb()
    .prepare(`SELECT * FROM guardian_events ORDER BY at DESC LIMIT ?`)
    .all(limit) as GuardianEventRow[];
}

export function getGuardianLastCheckAt(): number | null {
  const row = getDb().prepare(`SELECT at FROM guardian_events ORDER BY at DESC LIMIT 1`).get() as { at: number } | undefined;
  return row?.at ?? null;
}

/* ---------------- Automatisation par règles ---------------- */

interface RuleRow {
  id: number;
  name: string;
  description: string;
  enabled: number;
  condition_json: string;
  actions_json: string;
  schedule: string;
  schedule_time: string | null;
  schedule_day: number | null;
  last_run_at: number | null;
  run_count: number;
  created_at: number;
  updated_at: number;
}

interface ExecutionRow {
  id: number;
  rule_id: number;
  rule_name: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  dry_run_candidates_json: string;
  executed_candidates_json: string;
  bytes_affected: number;
  files_affected: number;
  error: string | null;
}

function rowToRule(r: RuleRow): AutomationRule {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    enabled: r.enabled === 1,
    condition: JSON.parse(r.condition_json) as RuleConditionGroup,
    actions: JSON.parse(r.actions_json) as RuleAction[],
    schedule: r.schedule as AutomationRule["schedule"],
    scheduleTime: r.schedule_time ?? undefined,
    scheduleDay: r.schedule_day ?? undefined,
    lastRunAt: r.last_run_at ?? null,
    runCount: r.run_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToExecution(r: ExecutionRow): RuleExecution {
  return {
    id: r.id,
    ruleId: r.rule_id,
    ruleName: r.rule_name,
    status: r.status as ExecutionStatus,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? null,
    dryRunCandidates: JSON.parse(r.dry_run_candidates_json) as RuleExecution["dryRunCandidates"],
    executedCandidates: JSON.parse(r.executed_candidates_json) as RuleExecution["executedCandidates"],
    bytesAffected: r.bytes_affected,
    filesAffected: r.files_affected,
    error: r.error ?? undefined,
  };
}

export function insertRule(rule: Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "runCount" | "lastRunAt">): number {
  const now = Date.now();
  return getDb()
    .prepare(
      `INSERT INTO automation_rules (name, description, enabled, condition_json, actions_json, schedule, schedule_time, schedule_day, last_run_at, run_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rule.name,
      rule.description,
      rule.enabled ? 1 : 0,
      JSON.stringify(rule.condition),
      JSON.stringify(rule.actions),
      rule.schedule,
      rule.scheduleTime ?? null,
      rule.scheduleDay ?? null,
      null,
      0,
      now,
      now,
    ).lastInsertRowid as number;
}

export function updateRule(rule: Partial<AutomationRule> & { id: number }): void {
  const db = getDb();
  const sets: string[] = [];
  const vals: Array<string | number | null> = [];
  if (rule.name !== undefined) {
    sets.push("name = ?");
    vals.push(rule.name);
  }
  if (rule.description !== undefined) {
    sets.push("description = ?");
    vals.push(rule.description);
  }
  if (rule.enabled !== undefined) {
    sets.push("enabled = ?");
    vals.push(rule.enabled ? 1 : 0);
  }
  if (rule.condition !== undefined) {
    sets.push("condition_json = ?");
    vals.push(JSON.stringify(rule.condition));
  }
  if (rule.actions !== undefined) {
    sets.push("actions_json = ?");
    vals.push(JSON.stringify(rule.actions));
  }
  if (rule.schedule !== undefined) {
    sets.push("schedule = ?");
    vals.push(rule.schedule);
  }
  if (rule.scheduleTime !== undefined) {
    sets.push("schedule_time = ?");
    vals.push(rule.scheduleTime);
  }
  if (rule.scheduleDay !== undefined) {
    sets.push("schedule_day = ?");
    vals.push(rule.scheduleDay);
  }
  if (rule.lastRunAt !== undefined) {
    sets.push("last_run_at = ?");
    vals.push(rule.lastRunAt);
  }
  if (rule.runCount !== undefined) {
    sets.push("run_count = ?");
    vals.push(rule.runCount);
  }
  sets.push("updated_at = ?");
  vals.push(Date.now());
  if (sets.length === 1) return;
  vals.push(rule.id);
  db.prepare(`UPDATE automation_rules SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function deleteRule(id: number): void {
  getDb().prepare(`DELETE FROM automation_rules WHERE id = ?`).run(id);
}

export function getRules(): AutomationRule[] {
  const rows = getDb().prepare(`SELECT * FROM automation_rules ORDER BY created_at DESC`).all() as RuleRow[];
  return rows.map(rowToRule);
}

export function getRuleById(id: number): AutomationRule | null {
  const row = getDb().prepare(`SELECT * FROM automation_rules WHERE id = ?`).get(id) as RuleRow | undefined;
  return row ? rowToRule(row) : null;
}

export function insertExecution(exec: Omit<RuleExecution, "id">): number {
  return getDb()
    .prepare(
      `INSERT INTO rule_executions (rule_id, rule_name, status, started_at, finished_at, dry_run_candidates_json, executed_candidates_json, bytes_affected, files_affected, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      exec.ruleId,
      exec.ruleName,
      exec.status,
      exec.startedAt,
      exec.finishedAt ?? null,
      JSON.stringify(exec.dryRunCandidates),
      JSON.stringify(exec.executedCandidates),
      exec.bytesAffected,
      exec.filesAffected,
      exec.error ?? null,
    ).lastInsertRowid as number;
}

export function updateExecution(id: number, patch: Partial<Pick<RuleExecution, "status" | "finishedAt" | "executedCandidates" | "bytesAffected" | "filesAffected" | "error">>): void {
  const db = getDb();
  const sets: string[] = [];
  const vals: Array<string | number | null> = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    vals.push(patch.status);
  }
  if (patch.finishedAt !== undefined) {
    sets.push("finished_at = ?");
    vals.push(patch.finishedAt);
  }
  if (patch.executedCandidates !== undefined) {
    sets.push("executed_candidates_json = ?");
    vals.push(JSON.stringify(patch.executedCandidates));
  }
  if (patch.bytesAffected !== undefined) {
    sets.push("bytes_affected = ?");
    vals.push(patch.bytesAffected);
  }
  if (patch.filesAffected !== undefined) {
    sets.push("files_affected = ?");
    vals.push(patch.filesAffected);
  }
  if (patch.error !== undefined) {
    sets.push("error = ?");
    vals.push(patch.error);
  }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE rule_executions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function getRuleExecutions(ruleId?: number, limit = 200): RuleExecution[] {
  const db = getDb();
  if (ruleId !== undefined) {
    const rows = db.prepare(`SELECT * FROM rule_executions WHERE rule_id = ? ORDER BY started_at DESC LIMIT ?`).all(ruleId, limit) as ExecutionRow[];
    return rows.map(rowToExecution);
  }
  const rows = db.prepare(`SELECT * FROM rule_executions ORDER BY started_at DESC LIMIT ?`).all(limit) as ExecutionRow[];
  return rows.map(rowToExecution);
}

export function getLastExecution(ruleId: number): RuleExecution | null {
  const row = getDb().prepare(`SELECT * FROM rule_executions WHERE rule_id = ? ORDER BY started_at DESC LIMIT 1`).get(ruleId) as ExecutionRow | undefined;
  return row ? rowToExecution(row) : null;
}
