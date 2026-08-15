import * as fsp from "node:fs/promises";
import { getDrives } from "./drives.js";

export interface RecycleBinInfo {
  bytes: number;
  files: number;
}

/**
 * Estime la taille de la corbeille Windows en sommant les fichiers `$R*`
 * de chaque volume. Les métadonnées `$I*` sont ignorées.
 */
export async function getRecycleBinInfo(): Promise<RecycleBinInfo> {
  let bytes = 0;
  let files = 0;
  try {
    const drives = await getDrives();
    await Promise.all(
      drives.map(async (d) => {
        const binDir = `${d.name}\\$Recycle.Bin`;
        try {
          await fsp.access(binDir);
        } catch {
          return;
        }
        const stack = [binDir];
        while (stack.length > 0) {
          const dir = stack.pop()!;
          let entries: string[];
          try {
            entries = await fsp.readdir(dir);
          } catch {
            continue;
          }
          for (const name of entries) {
            const fp = `${dir}\\${name}`;
            if (!/^\$R/.test(name)) continue;
            try {
              const st = await fsp.stat(fp);
              if (st.isDirectory()) stack.push(fp);
              else {
                bytes += st.size;
                files++;
              }
            } catch {
              /* ignore */
            }
          }
        }
      }),
    );
  } catch {
    /* silencieux */
  }
  return { bytes, files };
}
