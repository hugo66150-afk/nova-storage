import Database from "better-sqlite3";
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../infra/logger.js";

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  target TEXT NOT NULL,
  root TEXT NOT NULL,
  total_files INTEGER NOT NULL DEFAULT 0,
  total_dirs INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scan_categories (
  scan_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  files INTEGER NOT NULL,
  PRIMARY KEY (scan_id, category)
);

CREATE TABLE IF NOT EXISTS tree_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  parent_path TEXT,
  name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  dir_count INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'other',
  safety TEXT NOT NULL DEFAULT 'review',
  UNIQUE (scan_id, path)
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  extension TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL DEFAULT 0,
  modified INTEGER NOT NULL DEFAULT 0,
  is_dir INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  safety TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,
  reasons TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cleanups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  performed_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  kind TEXT NOT NULL,
  files INTEGER NOT NULL,
  folders INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  requested INTEGER NOT NULL,
  succeeded INTEGER NOT NULL,
  targets TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS exclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  total INTEGER NOT NULL,
  free INTEGER NOT NULL,
  used INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guardian_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  drive TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  condition_json TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  schedule TEXT NOT NULL DEFAULT 'manual',
  schedule_time TEXT,
  schedule_day INTEGER,
  last_run_at INTEGER,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL,
  rule_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  dry_run_candidates_json TEXT NOT NULL DEFAULT '[]',
  executed_candidates_json TEXT NOT NULL DEFAULT '[]',
  bytes_affected INTEGER NOT NULL DEFAULT 0,
  files_affected INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  FOREIGN KEY (rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tree_scan_parent ON tree_nodes (scan_id, parent_path);
CREATE INDEX IF NOT EXISTS idx_cand_scan_kind ON candidates (scan_id, kind);
CREATE INDEX IF NOT EXISTS idx_cand_scan_size ON candidates (scan_id, size);
CREATE INDEX IF NOT EXISTS idx_cand_scan_category ON candidates (scan_id, category);
CREATE INDEX IF NOT EXISTS idx_cand_scan_kind_size ON candidates (scan_id, kind, size);
CREATE INDEX IF NOT EXISTS idx_cand_scan_category_size ON candidates (scan_id, category, size);
CREATE INDEX IF NOT EXISTS idx_cand_scan_modified ON candidates (scan_id, modified);
CREATE INDEX IF NOT EXISTS idx_cand_scan_modified_size ON candidates (scan_id, modified, size);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cand_scan_path ON candidates (scan_id, path);
CREATE INDEX IF NOT EXISTS idx_scan_cat_scan ON scan_categories (scan_id);
`;

/**
 * Migration d'index pour les bases créées avant 1.0.0 : l'ancien schéma créait
 * un index simple nommé `idx_cand_scan_path`, ce qui faisait échouer
 * silencieusement la création de l'index UNIQUE du même nom. On remplace
 * l'index simple par l'index unique (en dédupliquant d'éventuels doublons
 * historiques pour que la création réussisse).
 */
function migrateCandidateIndex(d: Database.Database): void {
  const row = d
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_cand_scan_path'`)
    .get() as { sql: string | null } | undefined;
  if (!row) return;
  if ((row.sql ?? "").toUpperCase().includes("UNIQUE")) return;
  try {
    d.exec(`DROP INDEX idx_cand_scan_path`);
    d.exec(`CREATE UNIQUE INDEX idx_cand_scan_path ON candidates (scan_id, path)`);
    logger.info("Index des candidats migré : unicité (scan_id, path) appliquée.");
  } catch {
    // Doublons historiques : on conserve le plus ancien exemplaire de chaque paire.
    d.exec(`DELETE FROM candidates WHERE id NOT IN (SELECT MIN(id) FROM candidates GROUP BY scan_id, path)`);
    d.exec(`CREATE UNIQUE INDEX idx_cand_scan_path ON candidates (scan_id, path)`);
    logger.info("Index des candidats migré (doublons historiques dédupliqués).");
  }
}

export function getDb(): Database.Database {
  if (db) return db;
  const dir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, "nova.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  // Les clés étrangères (ex. rule_executions → automation_rules) doivent être
  // actives pour que les suppressions en cascade fonctionnent réellement.
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrateCandidateIndex(db);
  logger.info(`Base de données initialisée (${dir})`);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function runRetention(retentionScans = 5, retentionDays = 30): void {
  const d = getDb();
  const cutoff = Date.now() - retentionDays * 86400000;
  const keepFrom = d
    .prepare(
      `SELECT id FROM scans WHERE status IN ('completed','partial') ORDER BY finished_at DESC LIMIT ?`,
    )
    .all(retentionScans) as { id: number }[];
  const keepIds = keepFrom.map((r) => r.id);
  if (keepIds.length === 0) return;
  const placeholders = keepIds.map(() => "?").join(",");
  d.prepare(
    `DELETE FROM tree_nodes WHERE scan_id NOT IN (${placeholders}) OR scan_id IN (SELECT id FROM scans WHERE finished_at < ?)`,
  ).run(...keepIds, cutoff);
  d.prepare(
    `DELETE FROM candidates WHERE scan_id NOT IN (${placeholders}) OR scan_id IN (SELECT id FROM scans WHERE finished_at < ?)`,
  ).run(...keepIds, cutoff);
  d.prepare(
    `DELETE FROM scan_categories WHERE scan_id NOT IN (${placeholders}) OR scan_id IN (SELECT id FROM scans WHERE finished_at < ?)`,
  ).run(...keepIds, cutoff);
  d.prepare(
    `DELETE FROM scans WHERE id NOT IN (${placeholders}) OR finished_at < ?`,
  ).run(...keepIds, cutoff);
  d.prepare(`DELETE FROM snapshots WHERE at < ?`).run(cutoff);
  d.prepare(`DELETE FROM guardian_events WHERE at < ?`).run(cutoff);
  d.prepare(`DELETE FROM rule_executions WHERE started_at < ?`).run(cutoff);
  logger.info(`Rétention appliquée (${keepIds.length} scans conservés, ${retentionDays} jours).`);
}
