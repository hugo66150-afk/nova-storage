import { Worker } from "node:worker_threads";
import * as path from "node:path";
import * as url from "node:url";
import type {
  Category,
  CandidateKind,
  DirChildrenResult,
  FileCandidate,
  PagedFiles,
  RecoverableSummary,
  SafetyLevel,
  ScanProgress,
  ScanResult,
  ScanSettings,
} from "../../shared/types.js";
import { buildRecoverable, buildRecoverableFromSummary } from "./analysis.js";
import {
  addSnapshot,
  getCandidatesByParent,
  getCandidatesPage,
  getCandidatesSummary,
  getScanById,
  getScanCategories,
  getLastScan,
  insertScan,
  saveCandidates,
  saveScanCategories,
  saveTreeNodes,
  updateScan,
  deleteCandidates,
  getExclusions,
  getPreferences,
} from "../data/repositories.js";
import { getDb, runRetention } from "../data/db.js";
import { logger } from "../infra/logger.js";
import { getDrives, rootOf } from "../services/drives.js";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

interface WorkerTreeNode {
  path: string;
  parentPath: string | null;
  name: string;
  size: number;
  fileCount: number;
  dirCount: number;
  category: Category;
  safety: SafetyLevel;
  files: WorkerCandidate[];
}

interface WorkerCandidate {
  path: string;
  name: string;
  extension: string;
  size: number;
  created: number;
  modified: number;
  isDir: boolean;
  category: Category;
  safety: SafetyLevel;
  confidence: number;
  reasons: string[];
  kind: CandidateKind;
}

interface WorkerResultMessage {
  type: "progress" | "done" | "error";
  result?: {
    status: "completed" | "cancelled" | "partial" | "error";
    message?: string;
    totalFiles: number;
    totalDirs: number;
    totalBytes: number;
    errors: { path: string; code: string; message: string }[];
    categories: Record<Category, { bytes: number; files: number }>;
    tree: Record<string, WorkerTreeNode>;
    candidates: WorkerCandidate[];
  };
  elapsedMs?: number;
  message?: string;
  filesAnalyzed?: number;
  dirsAnalyzed?: number;
  bytesAnalyzed?: number;
  currentPath?: string;
  errors?: number;
}

type Broadcast = (channel: string, payload: unknown) => void;

class ScanManager {
  private worker: Worker | null = null;
  private active = false;
  private paused = false;
  private scanId = 0;
  private startedAt = 0;
  private mode: string | null = null;
  private targetPaths: string[] = [];
  private driveUsedTotal = 0;
  private memory: Map<number, { tree: Record<string, WorkerTreeNode> }> = new Map();
  private broadcast: Broadcast | null = null;

  attach(broadcast: Broadcast): void {
    this.broadcast = broadcast;
    void this.restoreLast();
  }

  private async restoreLast(): Promise<void> {
    try {
      const row = getLastScan();
      if (!row) return;
      const memory: Record<string, WorkerTreeNode> = {};
      const rows = getDb()
        .prepare(
          `SELECT path, parent_path, name, size, file_count, dir_count, category, safety FROM tree_nodes WHERE scan_id = ?`,
        )
        .all(row.id) as unknown[][];
      for (const r of rows as Array<[string, string | null, string, number, number, number, string, string]>) {
        memory[r[0]] = {
          path: r[0],
          parentPath: r[1],
          name: r[2],
          size: r[3],
          fileCount: r[4],
          dirCount: r[5],
          category: r[6] as Category,
          safety: r[7] as SafetyLevel,
          files: [],
        };
      }
      this.memory.set(row.id, { tree: memory });
      logger.info(`Dernière analyse restaurée (scan ${row.id}, ${Object.keys(memory).length} dossiers).`);
    } catch (err) {
      logger.warn("Restauration de la dernière analyse impossible");
    }
  }

  isRunning(): boolean {
    return this.active;
  }

  async start(settings: ScanSettings): Promise<number> {
    if (this.active) throw new Error("Une analyse est déjà en cours.");

    const targets = this.resolveTargets(settings);
    this.mode = settings.mode;
    this.targetPaths = targets.paths;
    const startedAt = Date.now();
    const scanId = insertScan({
      startedAt,
      finishedAt: null,
      status: "running",
      target: settings.mode,
      root: targets.paths[0] ?? "C:\\",
    });
    this.scanId = scanId;
    this.startedAt = startedAt;
    this.active = true;
    this.paused = false;

    if (targets.kind === "drive") {
      const drives = await getDrives();
      this.driveUsedTotal = drives
        .filter((d) => targets.paths.some((p) => rootOf(p).toLowerCase() === d.name.toLowerCase()))
        .reduce((a, d) => a + d.used, 0) ?? 0;
    } else {
      this.driveUsedTotal = 0;
    }

    const exclusions = getExclusions()
      .filter((e) => e.kind === "folder" || e.kind === "file")
      .map((e) => e.path);

    const workerPath = path.join(__dirname, "scanWorker.js");
    this.worker = new Worker(workerPath);

    this.worker.on("message", (msg: WorkerResultMessage) => {
      if (msg.type === "progress") {
        void this.handleProgress(msg);
      } else if (msg.type === "done" && msg.result) {
        void this.finish(msg.result, msg.elapsedMs ?? 0);
      } else if (msg.type === "error") {
        logger.error("Erreur du worker de scan", msg.message);
        void this.fail(msg.message ?? "Erreur inconnue");
      }
    });
    this.worker.on("error", (err) => {
      logger.error("Worker de scan planté", err);
      void this.fail(err.message);
    });

    this.worker.postMessage({ type: "start", paths: targets.paths, quick: settings.mode === "quick", exclusions });

    this.emitProgress({
      status: "running",
      percent: 0,
      currentPath: targets.paths[0] ?? "",
      filesAnalyzed: 0,
      dirsAnalyzed: 0,
      bytesAnalyzed: 0,
      errors: 0,
      elapsedMs: 0,
      etaMs: null,
      target: targets.paths.join(" ; "),
    });
    return scanId;
  }

  private resolveTargets(settings: ScanSettings): { paths: string[]; kind: string } {
    if (settings.mode === "custom" && settings.targets && settings.targets.paths.length > 0) {
      return { paths: settings.targets.paths, kind: settings.targets.kind };
    }
    return { paths: ["C:\\"], kind: "drive" };
  }

  private async handleProgress(p: WorkerResultMessage): Promise<void> {
    if (!this.active) return;
    const elapsed = Date.now() - this.startedAt;
    const bytes = p.bytesAnalyzed ?? 0;
    let percent = 0;
    if (this.driveUsedTotal > 0) {
      percent = Math.min(100, Math.round((bytes / this.driveUsedTotal) * 100));
    }
    const ratePerSec = elapsed > 0 ? bytes / (elapsed / 1000) : 0;
    const etaMs = ratePerSec > 0 && percent > 2 && percent < 100 ? ((this.driveUsedTotal - bytes) / ratePerSec) * 1000 : null;
    this.emitProgress({
      status: this.paused ? "paused" : "running",
      percent,
      currentPath: p.currentPath ?? "",
      filesAnalyzed: p.filesAnalyzed ?? 0,
      dirsAnalyzed: p.dirsAnalyzed ?? 0,
      bytesAnalyzed: bytes,
      errors: p.errors ?? 0,
      elapsedMs: elapsed,
      etaMs,
      target: this.targetPaths.join(" ; "),
    });
  }

  private emitProgress(p: ScanProgress): void {
    this.broadcast?.("scan:progress", p);
  }

  private async finish(
    result: NonNullable<WorkerResultMessage["result"]>,
    elapsedMs: number,
  ): Promise<void> {
    if (!this.active) return;
    const scanId = this.scanId;
    const finishedAt = Date.now();
    const status = result.status;

    updateScan(scanId, {
      finishedAt,
      status,
      totalFiles: result.totalFiles,
      totalDirs: result.totalDirs,
      totalBytes: result.totalBytes,
      errors: result.errors.length,
      durationMs: elapsedMs,
    });

    saveScanCategories(scanId, result.categories);

    const candidates: FileCandidate[] = result.candidates.map((c) => ({
      id: `${scanId}:${c.path}`,
      path: c.path,
      name: c.name,
      extension: c.extension,
      size: c.size,
      created: c.created,
      modified: c.modified,
      isDir: c.isDir,
      category: c.category,
      safety: c.safety,
      confidence: c.confidence,
      reasons: c.reasons,
      kind: c.kind,
      sourceScanId: scanId,
    }));

    try {
      saveCandidates(scanId, candidates);
      const slimTree: Record<string, { parentPath: string | null; name: string; size: number; fileCount: number; dirCount: number; category: Category; safety: SafetyLevel }> = {};
      for (const [p, n] of Object.entries(result.tree)) {
        slimTree[p] = {
          parentPath: n.parentPath,
          name: n.name,
          size: n.size,
          fileCount: n.fileCount,
          dirCount: n.dirCount,
          category: n.category,
          safety: n.safety,
        };
      }
      saveTreeNodes(scanId, slimTree);
    } catch (err) {
      logger.error("Persistance du scan échouée", err);
    }
    this.memory.set(scanId, { tree: result.tree });

    try {
      const drives = await getDrives();
      const firstRoot = rootOf(this.targetPaths[0] ?? "C:\\");
      const driveInfo = drives.find((d) => d.name.toLowerCase() === firstRoot.toLowerCase());
      if (driveInfo && status !== "cancelled") addSnapshot(driveInfo.total, driveInfo.free);
    } catch {
      /* silencieux */
    }

    try {
      const prefs = getPreferences();
      runRetention(Number(prefs.retentionScans) || 5, Number(prefs.retentionDays) || 30);
    } catch {
      /* silencieux */
    }

    this.active = false;
    this.worker?.terminate();
    this.worker = null;

    const scanResult: ScanResult = {
      scanId,
      target: this.mode ?? "full",
      root: this.targetPaths[0] ?? "C:\\",
      status,
      startedAt: this.startedAt,
      finishedAt,
      durationMs: elapsedMs,
      totalFiles: result.totalFiles,
      totalDirs: result.totalDirs,
      totalBytes: result.totalBytes,
      errors: result.errors,
      categories: Object.entries(result.categories).map(([c, v]) => ({
        category: c as Category,
        bytes: v.bytes,
        files: v.files,
      })),
      recoverable: buildRecoverable(candidates),
    };
    this.broadcast?.("scan:finished", scanResult);
  }

  private fail(message: string): void {
    if (!this.active) return;
    updateScan(this.scanId, { finishedAt: Date.now(), status: "error" });
    this.active = false;
    this.worker?.terminate();
    this.worker = null;
    this.broadcast?.("scan:error", { scanId: this.scanId, message });
  }

  pause(): void {
    if (!this.active || this.paused) return;
    this.paused = true;
    this.worker?.postMessage({ type: "pause" });
  }

  resume(): void {
    if (!this.active || !this.paused) return;
    this.paused = false;
    this.worker?.postMessage({ type: "resume" });
  }

  cancel(): void {
    if (!this.active) return;
    this.worker?.postMessage({ type: "cancel" });
  }

  private async getDirChildrenFromDb(scanId: number, dirPath: string): Promise<DirChildrenResult | null> {
    const rows = getDb()
      .prepare(`SELECT * FROM tree_nodes WHERE scan_id = ? AND parent_path = ? ORDER BY size DESC`)
      .all(scanId, dirPath) as Array<{
      path: string;
      parent_path: string | null;
      name: string;
      size: number;
      file_count: number;
      dir_count: number;
      category: string;
      safety: string;
    }>;
    if (rows.length === 0) return null;
    const nodeRow = getDb()
      .prepare(`SELECT path, parent_path, size, file_count, dir_count FROM tree_nodes WHERE scan_id = ? AND path = ?`)
      .get(scanId, dirPath) as { path: string; parent_path: string | null; size: number; file_count: number; dir_count: number } | undefined;
    if (!nodeRow) return null;
    const files = getCandidatesByParent(scanId, dirPath);
    return {
      path: dirPath,
      parentPath: nodeRow.parent_path,
      dirs: rows.map((r) => ({
        path: r.path,
        name: r.name,
        size: r.size,
        fileCount: r.file_count,
        dirCount: r.dir_count,
        category: r.category as Category,
        safety: r.safety as SafetyLevel,
      })),
      files,
      totalSize: nodeRow.size,
      totalFiles: nodeRow.file_count,
      totalDirs: nodeRow.dir_count,
    };
  }

  async getDirChildren(scanId: number, dirPath: string): Promise<DirChildrenResult | null> {
    const memory = this.memory.get(scanId);
    // Un scan restauré depuis la DB a des nœuds mémoire sans fichiers (files: []).
    // Dans ce cas on retombe sur le chemin SQL pour servir les vrais enfants.
    if (memory && memory.tree[dirPath] && memory.tree[dirPath].files.length > 0) {
      const node = memory.tree[dirPath];
      const dirs = Object.values(memory.tree)
        .filter((n) => n.parentPath === dirPath)
        .sort((a, b) => b.size - a.size)
        .map((n) => ({
          path: n.path,
          name: n.name,
          size: n.size,
          fileCount: n.fileCount,
          dirCount: n.dirCount,
          category: n.category,
          safety: n.safety,
        }));
      const files = node.files
        .sort((a, b) => b.size - a.size)
        .map((f) => ({
          ...f,
          id: `${scanId}:${f.path}`,
          sourceScanId: scanId,
        }));
      return {
        path: dirPath,
        parentPath: node.parentPath,
        dirs,
        files,
        totalSize: node.size,
        totalFiles: node.fileCount,
        totalDirs: node.dirCount,
      };
    }
    return this.getDirChildrenFromDb(scanId, dirPath);
  }

  async getLargeFiles(scanId: number, minSize: number, offset: number, limit: number): Promise<PagedFiles> {
    const page = getCandidatesPage(scanId, { minSize }, offset, limit);
    return { ...page, offset, limit, hasMore: offset + page.items.length < page.total };
  }

  async getOldFiles(scanId: number, olderThanDays: number, offset: number, limit: number): Promise<PagedFiles> {
    const page = getCandidatesPage(scanId, { olderThanDays }, offset, limit);
    return { ...page, offset, limit, hasMore: offset + page.items.length < page.total };
  }

  async getByCategory(scanId: number, category: string, offset: number, limit: number): Promise<PagedFiles> {
    const page = getCandidatesPage(scanId, { category }, offset, limit);
    return { ...page, offset, limit, hasMore: offset + page.items.length < page.total };
  }

  async getDownloads(scanId: number, offset: number, limit: number): Promise<PagedFiles> {
    const page = getCandidatesPage(scanId, { category: "downloads" }, offset, limit);
    return { ...page, offset, limit, hasMore: offset + page.items.length < page.total };
  }

  async getRecommendationDetail(
    scanId: number,
    kind: CandidateKind,
    offset: number,
    limit: number,
  ): Promise<{ files: FileCandidate[]; totalBytes: number; total: number; hasMore: boolean } | null> {
    const page = getCandidatesPage(scanId, { kind }, offset, limit);
    if (offset === 0 && page.total === 0) return null;
    return {
      files: page.items,
      totalBytes: page.totalBytes,
      total: page.total,
      hasMore: offset + page.items.length < page.total,
    };
  }

  async getScanResult(scanId: number): Promise<ScanResult | null> {
    const row = getScanById(scanId);
    if (!row) return null;
    const categories = getScanCategories(scanId);
    return {
      scanId,
      target: row.target,
      root: row.root,
      status: row.status as ScanResult["status"],
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? row.started_at,
      durationMs: row.duration_ms,
      totalFiles: row.total_files,
      totalDirs: row.total_dirs,
      totalBytes: row.total_bytes,
      errors: [],
      categories,
      recoverable: this.getRecoverableFromDb(scanId),
    };
  }

  async getLastScanResult(): Promise<ScanResult | null> {
    const row = getLastScan();
    if (!row) return null;
    return this.getScanResult(row.id);
  }

  async getDuplicatesCandidates(scanId: number, limit: number): Promise<FileCandidate[]> {
    return getCandidatesPage(scanId, { minSize: 50 * 1024 * 1024 }, 0, limit).items;
  }

  /** Résumé récupérable d'un scan, calculé par agrégats SQL (GROUP BY kind). */
  getRecoverableFromDb(scanId: number | null): RecoverableSummary {
    if (!scanId) {
      return buildRecoverable([]);
    }
    const { byKind } = getCandidatesSummary(scanId);
    return buildRecoverableFromSummary(byKind);
  }

  /** Met à jour les données après un nettoyage : supprime les chemins libérés. */
  applyCleanup(paths: ReadonlySet<string>): void {
    if (paths.size === 0) return;
    // Cible le dernier scan terminé : si une nouvelle analyse est en cours,
    // this.scanId pointe vers un scan sans candidats encore enregistrés.
    const scanId = getLastScan()?.id;
    if (!scanId) return;
    try {
      deleteCandidates(scanId, [...paths]);
      logger.info(`Nettoyage appliqué : ${paths.size} chemins retirés des candidats.`);
    } catch (err) {
      logger.warn(`Application du nettoyage aux candidats échouée : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const scanManager = new ScanManager();