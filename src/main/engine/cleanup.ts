import { shell } from "electron";
import * as fsp from "node:fs/promises";
import type { CleanupRequest, CleanupResult, CleanupItemResult } from "../../shared/types.js";
import { assessSafety } from "./safety.js";
import { getExclusions, insertCleanup } from "../data/repositories.js";
import { logger } from "../infra/logger.js";

type ProgressCb = (p: { done: number; total: number; current: string; bytesFreed: number }) => void;

function isExcludedPath(p: string, exclusions: Array<{ path: string; kind: string }>): boolean {
  const lower = p.toLowerCase();
  return exclusions
    .filter((e) => e.kind === "folder" || e.kind === "file")
    .some((e) => lower === e.path.toLowerCase() || lower.startsWith(e.path.toLowerCase() + "\\"));
}

function blockedBySafety(p: string): string | null {
  const result = assessSafety(p, false);
  if (result.safety === "protected" || result.safety === "risky") {
    return result.reasons[0] ?? "Élément protégé.";
  }
  return null;
}

export async function runCleanup(request: CleanupRequest, onProgress: ProgressCb | null = null): Promise<CleanupResult> {
  const { paths, mode } = request;
  const items: CleanupItemResult[] = [];
  let requested = 0;
  let succeeded = 0;
  let bytesFreed = 0;
  let folders = 0;
  const total = paths.length;
  // Les exclusions sont chargées une seule fois par opération (pas par fichier).
  const exclusions = getExclusions();

  const sizes = new Map<string, number>();

  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const done = i + 1;
    onProgress?.({ done, total, current: p, bytesFreed });

    let size = 0;
    try {
      size = await sizeOf(p);
    } catch {
      size = 0;
    }
    sizes.set(p, size);
    requested += size;

    if (isExcludedPath(p, exclusions)) {
      items.push({ path: p, status: "protected", bytes: size, error: "Chemin exclu par l'utilisateur." });
      continue;
    }

    const blocked = blockedBySafety(p);
    if (blocked) {
      items.push({ path: p, status: "protected", bytes: size, error: blocked });
      continue;
    }

    let exists = false;
    try {
      await fsp.access(p);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      items.push({ path: p, status: "missing", bytes: size, error: "Le fichier n'existe plus." });
      continue;
    }

    let isDir = false;
    try {
      isDir = (await fsp.stat(p)).isDirectory();
    } catch {
      /* ignoré */
    }

    try {
      if (mode === "recycle") {
        await shell.trashItem(p);
        items.push({ path: p, status: "recycled", bytes: size });
      } else {
        await fsp.rm(p, { recursive: true, force: true });
        items.push({ path: p, status: "deleted", bytes: size });
      }
      succeeded++;
      bytesFreed += size;
      if (isDir) folders++;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      const code = e.code ?? "";
      if (code === "EBUSY" || code === "EPERM" || code === "EACCES" || /locked|in use|utilisé/i.test(e.message)) {
        items.push({ path: p, status: "locked", bytes: size, error: "Fichier verrouillé ou utilisé par un autre programme." });
      } else {
        items.push({ path: p, status: "error", bytes: size, error: e.message });
      }
      logger.warn(`Suppression échouée : ${p} (${e.message})`);
    }
  }

  const successful = items.filter((i) => i.status === "deleted" || i.status === "recycled");
  const files = successful.length - folders;
  insertCleanup({
    performedAt: Date.now(),
    mode,
    kind: request.kind,
    files,
    folders,
    bytes: bytesFreed,
    requested,
    succeeded,
    targets: paths,
  });

  logger.info(`Nettoyage ${request.kind} : ${succeeded}/${total} éléments, ${bytesFreed} octets libérés (${mode}).`);

  return {
    kind: request.kind,
    mode,
    requested,
    succeeded,
    bytesFreed,
    bytesRequested: requested,
    items,
  };
}

async function sizeOf(p: string): Promise<number> {
  try {
    const stat = await fsp.stat(p);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    let count = 0;
    const stack = [p];
    while (stack.length > 0 && count < 200000) {
      const dir = stack.pop()!;
      let entries: string[];
      try {
        entries = await fsp.readdir(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        const fp = `${dir}\\${name}`;
        try {
          const st = await fsp.stat(fp);
          if (st.isDirectory()) stack.push(fp);
          else total += st.size;
          count++;
        } catch {
          /* ignore */
        }
      }
    }
    return total;
  } catch {
    return 0;
  }
}