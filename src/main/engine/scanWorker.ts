import { parentPort } from "node:worker_threads";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import { classify } from "./classifier.js";
import { assessSafety } from "./safety.js";
import { dedupeCandidates } from "./candidateDedup.js";
import type { Category, CandidateKind, SafetyLevel } from "../../shared/types.js";

export interface WorkerStart {
  type: "start";
  paths: string[];
  quick: boolean;
  exclusions: string[];
}

export type WorkerControl = { type: "pause" } | { type: "resume" } | { type: "cancel" };

export interface WorkerCandidate {
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

export interface WorkerTreeNode {
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

export interface WorkerResult {
  status: "completed" | "cancelled" | "partial" | "error";
  message?: string;
  totalFiles: number;
  totalDirs: number;
  totalBytes: number;
  errors: { path: string; code: string; message: string }[];
  categories: Partial<Record<Category, { bytes: number; files: number }>>;
  tree: Record<string, WorkerTreeNode>;
  candidates: WorkerCandidate[];
}

// Limites mémoire raisonnables — les résultats restent exploitables sans exploser.
const LARGE_TOP = 1500;
const KIND_CAP = 30000;
const OLD_DAYS = 180;
const OLD_MIN_BYTES = 10 * 1024 * 1024;
const ARCHIVE_MIN_BYTES = 100 * 1024 * 1024;
const DIR_FILES_CAP = 5000;
const DIR_CONCURRENCY = 8;

const CANCEL_SENTINEL = "NOVA_CANCEL";

export class BoundedList {
  private items: WorkerCandidate[] = [];
  private heap: WorkerCandidate[] = [];
  private cap: number;
  private bySize: boolean;
  constructor(cap: number, bySize = false) {
    this.cap = cap;
    this.bySize = bySize;
  }
  push(item: WorkerCandidate): void {
    if (!this.bySize) {
      if (this.items.length >= this.cap) return;
      this.items.push(item);
      return;
    }
    // Min-heap des elements : on garde toujours les `cap` plus gros.
    if (this.heap.length < this.cap) {
      this.heapPush(item);
      return;
    }
    if (item.size <= this.heap[0].size) return;
    this.heapPop();
    this.heapPush(item);
  }
  private heapPush(item: WorkerCandidate): void {
    const h = this.heap;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p].size <= h[i].size) break;
      const t = h[p];
      h[p] = h[i];
      h[i] = t;
      i = p;
    }
  }
  private heapPop(): void {
    const h = this.heap;
    const last = h.pop();
    if (h.length === 0 || !last) return;
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && h[l].size < h[m].size) m = l;
      if (r < h.length && h[r].size < h[m].size) m = r;
      if (m === i) break;
      const t = h[m];
      h[m] = h[i];
      h[i] = t;
      i = m;
    }
  }
  get(): WorkerCandidate[] {
    if (this.bySize) return [...this.heap].sort((a, b) => b.size - a.size);
    return this.items;
  }
}

interface WalkCtx {
  quick: boolean;
  exclusions: Set<string>;
  cancel: boolean;
  paused: boolean;
  waiters: Array<() => void>;
  files: number;
  dirs: number;
  bytes: number;
  errors: { path: string; code: string; message: string }[];
  categories: Partial<Record<Category, { bytes: number; files: number }>>;
  tree: Record<string, WorkerTreeNode>;
  currentPath: string;
  large: BoundedList;
  temp: BoundedList;
  cache: BoundedList;
  download: BoundedList;
  archive: BoundedList;
  old: BoundedList;
}

function isExcluded(ctx: WalkCtx, p: string): boolean {
  const lower = p.toLowerCase();
  for (const ex of ctx.exclusions) {
    if (lower === ex || lower.startsWith(ex + "\\") || lower.startsWith(ex + "/")) return true;
  }
  return false;
}

function isHotPath(p: string): boolean {
  const lower = p.toLowerCase();
  return (
    lower.includes("\\temp") ||
    lower.includes("\\cache") ||
    lower.includes("\\downloads") ||
    lower.includes("\\telechargements")
  );
}

function waitIfPaused(ctx: WalkCtx): Promise<void> {
  if (ctx.cancel) return Promise.reject(new Error(CANCEL_SENTINEL));
  if (!ctx.paused) return Promise.resolve();
  return new Promise<void>((resolve) => {
    ctx.waiters.push(resolve);
  });
}

function makeCandidate(
  p: string,
  name: string,
  size: number,
  created: number,
  modified: number,
  isDir: boolean,
  kind: CandidateKind,
  category: Category,
  safety: SafetyLevel,
  confidence: number,
  reasons: string[],
): WorkerCandidate {
  const idx = name.lastIndexOf(".");
  const extension = isDir || idx <= 0 ? "" : name.slice(idx + 1).toLowerCase();
  return {
    path: p,
    name,
    extension,
    size,
    created,
    modified,
    isDir,
    category,
    safety,
    confidence,
    reasons,
    kind,
  };
}

async function walkDir(ctx: WalkCtx, dir: string, depth: number): Promise<void> {
  await waitIfPaused(ctx);
  ctx.currentPath = dir;

  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    ctx.errors.push({ path: dir, code: e.code ?? "EUNKNOWN", message: e.message });
    return;
  }

  const node: WorkerTreeNode = {
    path: dir,
    parentPath: null,
    name: path.basename(dir) || dir,
    size: 0,
    fileCount: 0,
    dirCount: 0,
    category: "other",
    safety: "review",
    files: [],
  };

  const files: Dirent[] = [];
  const subdirs: Dirent[] = [];

  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue; // éviter les cycles / junctions
    if (isExcluded(ctx, path.join(dir, ent.name))) continue;
    if (ent.isFile()) files.push(ent);
    else if (ent.isDirectory()) subdirs.push(ent);
  }

  const maxDepthReached = ctx.quick && !isHotPath(dir) && depth >= 2;

  const statsBatch = 64;
  for (let i = 0; i < files.length; i += statsBatch) {
    const batch = files.slice(i, i + statsBatch);
    const results = await Promise.all(
      batch.map(async (f) => {
        const fp = path.join(dir, f.name);
        try {
          return { fp, name: f.name, stat: await fsp.stat(fp) };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) {
      if (!r) continue;
      const { fp, name, stat } = r;
      const cls = classify(fp, name, false);
      const safe = assessSafety(fp, false, cls.category);
      const size = stat.size;
      const cat = cls.category;
      ctx.bytes += size;
      ctx.files++;
      const agg = ctx.categories[cat] ?? { bytes: 0, files: 0 };
      agg.bytes += size;
      agg.files++;
      ctx.categories[cat] = agg;

      const base: WorkerCandidate = makeCandidate(
        fp,
        name,
        size,
        stat.birthtimeMs || stat.ctimeMs,
        stat.mtimeMs,
        false,
        "temp",
        cat,
        safe.safety,
        cls.confidence,
        safe.reasons,
      );

      if (node.files.length < DIR_FILES_CAP) node.files.push({ ...base });

      if (size >= 50 * 1024 * 1024) ctx.large.push({ ...base, kind: "large" });

      if (cat === "temp" || (safe.safety === "safe" && /\.(?:tmp|temp|part|crdownload)$/i.test(name))) {
        ctx.temp.push({
          ...base,
          kind: "temp",
          reasons: [...safe.reasons, "Fichier temporaire ou recréable."],
        });
      }

      if (cat === "caches") {
        ctx.cache.push({ ...base, kind: "cache", reasons: ["Cache d'application recréable."] });
      }

      if (cat === "downloads") {
        ctx.download.push({ ...base, kind: "download", reasons: ["Fichier présent dans le dossier Téléchargements."] });
      }

      if (cat === "archives" && size >= ARCHIVE_MIN_BYTES) {
        ctx.archive.push({
          ...base,
          kind: "archive",
          reasons: ["Archive volumineuse — vérifier avant suppression."],
        });
      }

      if (stat.mtimeMs < Date.now() - OLD_DAYS * 86400000 && size >= OLD_MIN_BYTES) {
        ctx.old.push({
          ...base,
          kind: "old",
          reasons: [`Non modifié depuis ${Math.round((Date.now() - stat.mtimeMs) / 86400000)} jours.`],
        });
      }
    }
  }

  node.size = 0;
  node.fileCount = 0;

  const poolSize = Math.min(DIR_CONCURRENCY, subdirs.length);
  let idx = 0;
  const aggregateChild = async () => {
    while (idx < subdirs.length) {
      const d = subdirs[idx++];
      const dp = path.join(dir, d.name);
      try {
        await walkDir(ctx, dp, depth + 1);
      } catch (e) {
        if (e instanceof Error && e.message === CANCEL_SENTINEL) throw e;
      }
      const childNode = ctx.tree[dp];
      if (childNode) {
        node.size += childNode.size;
        node.fileCount += childNode.fileCount;
        node.dirCount++;
      }
    }
  };
  if (!maxDepthReached && poolSize > 0) {
    await Promise.all(Array.from({ length: poolSize }, () => aggregateChild()));
  }

  if (node.size > 0 || node.fileCount > 0 || node.dirCount > 0) {
    const cls = classify(dir, node.name, true);
    const safe = assessSafety(dir, true);
    node.category = cls.category;
    node.safety = safe.safety;
    const parentPath = path.dirname(dir);
    node.parentPath = parentPath === dir ? null : parentPath;
    ctx.tree[dir] = node;
    ctx.dirs++;
  }

  maybeReport(ctx);
}

let lastReport = 0;function maybeReport(ctx: WalkCtx): void {
  const now = Date.now();
  if (now - lastReport < 150) return;
  lastReport = now;
  const port = parentPort;
  if (!port) return;
  port.postMessage({
    type: "progress",
    filesAnalyzed: ctx.files,
    dirsAnalyzed: ctx.dirs,
    bytesAnalyzed: ctx.bytes,
    currentPath: ctx.currentPath,
    errors: ctx.errors.length,
  });
}

function makeCtx(): WalkCtx {
  return {
    quick: false,
    exclusions: new Set<string>(),
    cancel: false,
    paused: false,
    waiters: [],
    files: 0,
    dirs: 0,
    bytes: 0,
    errors: [],
    categories: {} as Partial<Record<Category, { bytes: number; files: number }>>,
    tree: {},
    currentPath: "",
    large: new BoundedList(LARGE_TOP, true),
    temp: new BoundedList(KIND_CAP, true),
    cache: new BoundedList(KIND_CAP, true),
    download: new BoundedList(KIND_CAP, true),
    archive: new BoundedList(KIND_CAP, true),
    old: new BoundedList(KIND_CAP, true),
  };
}

function run(): void {
  const port = parentPort!;  let state = makeCtx();

  port.on("message", (msg: WorkerStart | WorkerControl) => {
    if (msg.type === "pause") {
      state.paused = true;
    } else if (msg.type === "resume") {
      state.paused = false;
      state.waiters.splice(0).forEach((r) => r());
    } else if (msg.type === "cancel") {
      state.cancel = true;
    } else if (msg.type === "start") {
      state = makeCtx();
      state.quick = msg.quick;
      state.exclusions = new Set(msg.exclusions.map((e) => e.trim().toLowerCase()).filter(Boolean));
      void mainLoop(state, msg.paths);
    }
  });

  async function mainLoop(ctx: WalkCtx, roots: string[]): Promise<void> {
    const started = Date.now();
    let cancelled = false;
    try {
      for (const root of roots) {
        await walkDir(ctx, root, 0);
      }
    } catch (e) {
      if (e instanceof Error && e.message === CANCEL_SENTINEL) cancelled = true;
      else {
        port.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    const status = cancelled ? "cancelled" : ctx.errors.length > 0 ? "partial" : "completed";
    const result: WorkerResult = {
      status,
      message: cancelled ? "Analyse annulée." : undefined,
      totalFiles: ctx.files,
      totalDirs: ctx.dirs,
      totalBytes: ctx.bytes,
      errors: ctx.errors,
      categories: ctx.categories,
      tree: ctx.tree,
      candidates: dedupeCandidates([
        ...ctx.temp.get().map((c) => ({ ...c, kind: "temp" as CandidateKind })),
        ...ctx.cache.get().map((c) => ({ ...c, kind: "cache" as CandidateKind })),
        ...ctx.download.get().map((c) => ({ ...c, kind: "download" as CandidateKind })),
        ...ctx.large.get().map((c) => ({ ...c, kind: "large" as CandidateKind })),
        ...ctx.archive.get().map((c) => ({ ...c, kind: "archive" as CandidateKind })),
        ...ctx.old.get().map((c) => ({ ...c, kind: "old" as CandidateKind })),
      ]),
    };
    port.postMessage({ type: "done", result, elapsedMs: Date.now() - started });
  }
}

if (parentPort) run();
