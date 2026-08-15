import { execFile } from "node:child_process";
import type { DriveInfo } from "../../shared/types.js";

interface PsDrive {
  DeviceID?: string;
  VolumeName?: string | null;
  FileSystem?: string | null;
  Size?: number | null;
  FreeSpace?: number | null;
}

let drivesCache: { at: number; value: DriveInfo[] } | null = null;

export async function getDrives(): Promise<DriveInfo[]> {
  if (drivesCache && Date.now() - drivesCache.at < 15000) return drivesCache.value;
  const fresh = await fetchDrives();
  drivesCache = { at: Date.now(), value: fresh };
  return fresh;
}

async function fetchDrives(): Promise<DriveInfo[]> {
  const script = `Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID, VolumeName, FileSystem, Size, FreeSpace | ConvertTo-Json -Compress`;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        { windowsHide: true, timeout: 30000 },
        (err, out) => (err ? reject(err) : resolve(out)),
      );
    });
    const parsed = JSON.parse(stdout) as PsDrive | PsDrive[];
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .filter((d) => d.DeviceID)
      .map((d) => {
        const total = Number(d.Size) || 0;
        const free = Number(d.FreeSpace) || 0;
        const name = d.DeviceID || "";
        return {
          name,
          label: (d.VolumeName || name) as string,
          filesystem: (d.FileSystem || "NTFS") as string,
          total,
          free,
          used: total - free,
        };
      });
  } catch (err) {
    return [];
  }
}

/** Résout le répertoire racine réel d'un chemin cible. */
export function rootOf(p: string): string {
  const drive = /^[a-zA-Z]:\\/.exec(p);
  if (drive) return drive[0];
  const unc = /^\\\\[^\\]+\\[^\\]+\\/.exec(p);
  if (unc) return unc[0];
  return p;
}
