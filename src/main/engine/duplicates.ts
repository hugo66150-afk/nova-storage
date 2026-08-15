import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import type { DuplicateGroup, FileCandidate } from "../../shared/types.js";
import { logger } from "../infra/logger.js";

async function hashFile(p: string): Promise<string | null> {
  try {
    const hash = createHash("sha256");
    const stream = await fsp.open(p, "r");
    const buf = Buffer.alloc(1024 * 1024);
    let pos = 0;
    for (;;) {
      const { bytesRead } = await stream.read(buf, 0, buf.length, pos);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
      pos += bytesRead;
    }
    await stream.close();
    return hash.digest("hex");
  } catch {
    return null;
  }
}

/**
 * Détection de doublons bornée : uniquement les fichiers volumineux de l'analyse
 * (les hachages de millions de fichiers seraient trop coûteux). Ne supprime jamais
 * automatiquement.
 */
export async function detectDuplicates(candidates: FileCandidate[], minSize = 50 * 1024 * 1024): Promise<DuplicateGroup[]> {
  const byKey = new Map<string, FileCandidate[]>();
  for (const c of candidates) {
    if (c.size < minSize || c.isDir) continue;
    const key = `${c.size}:${c.name.toLowerCase()}`;
    const list = byKey.get(key);
    if (list) list.push(c);
    else byKey.set(key, [c]);
  }

  const groups: DuplicateGroup[] = [];
  let hashed = 0;
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const hashes = new Map<string, FileCandidate[]>();
    for (const f of list) {
      const h = await hashFile(f.path);
      hashed++;
      if (!h) continue;
      const arr = hashes.get(h);
      if (arr) arr.push(f);
      else hashes.set(h, [f]);
    }
    for (const [hash, files] of hashes) {
      if (files.length < 2) continue;
      groups.push({
        id: `${key}:${hash.slice(0, 12)}`,
        size: files[0].size,
        hash,
        files,
        totalBytes: files.reduce((a, f) => a + f.size, 0) - files[0].size,
      });
    }
  }
  logger.info(`Doublons : ${hashed} fichiers hachés, ${groups.length} groupes trouvés.`);
  return groups.sort((a, b) => b.totalBytes - a.totalBytes);
}
