import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { AppInfo, AppType } from "../../shared/types.js";

export const REG_KEYS = [
  "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
];

const CACHE_TTL_MS = 60_000;

let appsCache: { at: number; value: AppInfo[] } | null = null;

export interface RegEntry {
  name: string;
  publisher: string;
  version: string;
  installLocation: string;
  estimatedSize: number;
  installDate: string;
  displayVersion: string;
  isSystemComponent: boolean;
  noRemove: boolean;
  regeneration: boolean;
  uninstallString: string;
  quietUninstallString: string;
  displayIcon: string;
  modifyPath: string;
  installSource: string;
  releaseType: string;
  parentDisplayName: string;
  isMsi: boolean;
  registryPath: string;
}

export function runRegQuery(key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "reg.exe",
      ["query", key, "/s"],
      { windowsHide: true, timeout: 30000, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/** Noms d'applications / fragments considérés comme systèmes ou indispensables. */
const PROTECTED_MARKERS: Array<[RegExp, string]> = [
  [/^Microsoft Windows( Computer)?$/i, "Composant du système Windows"],
  [/^Windows (Defender|Security Center|Update|Firewall|Media Player|Internet Explorer)/i, "Composant du système Windows"],
  [/^Microsoft Edge$/i, "Navigateur système intégré à Windows"],
  [/Visual C\+\+ .* Redistributable/i, "Dépendance partagée requise par de nombreuses applications"],
  [/^Microsoft .NET (Core|Runtime|Framework|Hosting Bundle|Windows Desktop|ASP\.NET)/i, "Runtime partagé requis par de nombreuses applications"],
  [/^Microsoft Visual Studio.*(Redistributable|Installer)$/i, "Dépendance de développement partagée"],
  [/Driver|Pilote/i, "Pilote système"],
  [/^Intel\(R\) (Graphics|Display|Wireless|Management)/i, "Pilote / composant matériel"],
  [/^Realtek.*(Audio|Driver|LAN)/i, "Pilote système"],
  [/^NVIDIA.*(Driver|Graphics)/i, "Pilote système"],
  [/^AMD.*(Software|Driver)/i, "Pilote système"],
  [/^Outlook Express$/i, "Composant Windows"],
  [/^Office System$/i, "Composant partagé Microsoft Office"],
  [/^Media Features Pack/i, "Composant Windows"],
  [/^KB[0-9]{6,}( |$)/i, "Mise à jour Windows"],
  [/^Update for/i, "Mise à jour Windows"],
  [/^Security Update/i, "Mise à jour Windows"],
  [/^Hotfix for/i, "Mise à jour Windows"],
];

function protectReason(name: string): string | null {
  for (const [re, reason] of PROTECTED_MARKERS) {
    if (re.test(name)) return reason;
  }
  return null;
}

function detectType(entry: RegEntry): AppType {
  if (entry.isMsi) return "msi";
  return "win32";
}

export async function getInstalledApps(): Promise<AppInfo[]> {
  if (appsCache && Date.now() - appsCache.at < CACHE_TTL_MS) return appsCache.value;
  const value = await detectApps(false);
  appsCache = { at: Date.now(), value };
  return value;
}

export async function refreshInstalledApps(): Promise<AppInfo[]> {
  const value = await detectApps(true);
  appsCache = { at: Date.now(), value };
  return value;
}

async function detectApps(_force: boolean): Promise<AppInfo[]> {
  const entries = new Map<string, RegEntry>();
  for (const key of REG_KEYS) {
    let raw = "";
    try {
      raw = await runRegQuery(key);
    } catch {
      continue;
    }
    parseRegOutput(raw, entries);
  }

  const apps = await Promise.all(
    Array.from(entries.entries())
      .filter(([, e]) => e.name && !e.isSystemComponent && !e.noRemove)
      .map(async ([keyPath, e]) => {
        const type = detectType(e);
        const protectionReason = protectReason(e.name) ?? (e.parentDisplayName ? "Composant rattaché à une suite logicielle" : null);
        let size = e.estimatedSize * 1024;
        if (size === 0 && e.installLocation) {
          size = await boundedSize(e.installLocation);
        }
        const lastUsed = await lastUsedFromAppData(e.name);
        return {
          name: e.name,
          publisher: e.publisher || "—",
          version: e.version || "—",
          installLocation: e.installLocation || "",
          estimatedSize: e.estimatedSize * 1024,
          installDate: e.installDate || "",
          size,
          files: 0,
          key: keyPath,
          type,
          protected: !!protectionReason,
          protectionReason: protectionReason ?? "",
          uninstallString: e.uninstallString,
          quietUninstallString: e.quietUninstallString,
          displayIcon: e.displayIcon,
          registryPath: e.registryPath,
          displayVersion: e.displayVersion,
          lastUsed,
          installSource: e.installSource,
        } as AppInfo;
      }),
  );

  const appx = await enumerateAppx();
  const merged = [...apps, ...appx].sort((a, b) => b.size - a.size).slice(0, 600);
  return merged;
}

/** Énumération des packages Store / MSIX de l'utilisateur courant. */
async function enumerateAppx(): Promise<AppInfo[]> {
  const script = `Get-AppxPackage | Where-Object { $_.SignatureKind -ne 'System' } | Select-Object Name, PackageFullName, PackageFamilyName, Version, Publisher, InstallLocation, InstallDate, NonRemovable, IsFramework | ConvertTo-Json -Compress`;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 60000, maxBuffer: 20 * 1024 * 1024 },
        (err, out) => (err ? reject(err) : resolve(out)),
      );
    });
    const parsed = JSON.parse(stdout) as Array<{
      Name?: string;
      PackageFullName?: string;
      PackageFamilyName?: string;
      Version?: string;
      Publisher?: string;
      InstallLocation?: string;
      InstallDate?: string;
      NonRemovable?: boolean;
      IsFramework?: boolean;
    }>;
    const arr = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const out: AppInfo[] = [];
    for (const p of arr) {
      if (!p.Name) continue;
      const system = p.NonRemovable === true || p.IsFramework === true;
      const size = p.InstallLocation ? await boundedSize(p.InstallLocation, 40000) : 0;
      out.push({
        name: p.Name,
        publisher: p.Publisher?.split(",")[0] ?? "Microsoft",
        version: p.Version ?? "",
        installLocation: p.InstallLocation ?? "",
        estimatedSize: 0,
        installDate: p.InstallDate ?? "",
        size,
        files: 0,
        key: `appx:${p.PackageFamilyName ?? p.Name}`,
        type: "msix",
        protected: system,
        protectionReason: system ? "Package système ou framework partagé (Microsoft Store)." : "",
        uninstallString: "",
        quietUninstallString: "",
        displayIcon: "",
        registryPath: "",
        displayVersion: p.Version ?? "",
        lastUsed: null,
        packageFamilyName: p.PackageFamilyName,
        packageFullName: p.PackageFullName,
      } as AppInfo);
    }
    return out;
  } catch {
    return [];
  }
}

export function parseRegOutput(raw: string, entries: Map<string, RegEntry>): void {
  const lines = raw.split(/\r?\n/);
  let currentKey = "";
  let systemInfo: Record<string, string> | null = null;

  const flush = (): void => {
    if (!currentKey || !systemInfo) return;
    const name = systemInfo.DisplayName ?? "";
    if (!name) return;
    const regKey = `${currentKey}`;
    entries.set(regKey, {
      name,
      publisher: systemInfo.Publisher ?? "",
      version: systemInfo.DisplayVersion ?? systemInfo.Version ?? "",
      installLocation: systemInfo.InstallLocation ?? "",
      estimatedSize: Number(systemInfo.EstimatedSize) || 0,
      installDate: systemInfo.InstallDate ?? "",
      displayVersion: systemInfo.DisplayVersion ?? "",
      isSystemComponent: systemInfo.SystemComponent === "1",
      noRemove: systemInfo.NoRemove === "1",
      regeneration: false,
      uninstallString: systemInfo.UninstallString ?? "",
      quietUninstallString: systemInfo.QuietUninstallString ?? "",
      displayIcon: systemInfo.DisplayIcon ?? "",
      modifyPath: systemInfo.ModifyPath ?? "",
      installSource: systemInfo.InstallSource ?? "",
      releaseType: systemInfo.ReleaseType ?? "",
      parentDisplayName: systemInfo.ParentDisplayName ?? "",
      isMsi: systemInfo.WindowsInstaller === "1" || /msiexec/i.test(systemInfo.UninstallString ?? ""),
      registryPath: regKey,
    });
  };

  for (const line of lines) {
    // Une ligne de clé commence en colonne 0 (les valeurs sont indentées de 4 espaces)
    // et peut contenir des espaces dans son dernier segment (ex. "...\Uninstall\Google Chrome").
    const keyMatch = /^(HKEY_[A-Z_]+\\[^\r\n]+)$/.exec(line.trim());
    if (keyMatch) {
      flush();
      currentKey = keyMatch[1];
      systemInfo = null;
      continue;
    }
    if (!currentKey) continue;
    const v = /^ {4}([A-Za-z0-9_().$@%-]+)\s+REG_[A-Z_]+\s+(.*)$/.exec(line);
    if (v) {
      if (!systemInfo) systemInfo = {};
      systemInfo[v[1]] = v[2].trim();
    }
  }
  flush();
}

async function lastUsedFromAppData(appName: string): Promise<number | null> {
  const baseName = appName.replace(/[^\w]+/g, "").toLowerCase();
  if (baseName.length < 3) return null;
  let latest = 0;
  for (const root of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    if (!root) continue;
    try {
      const names = await fsp.readdir(root);
      const candidates = names.filter((n) => n.toLowerCase().includes(baseName) && n.toLowerCase().startsWith(baseName.slice(0, 3)));
      for (const c of candidates.slice(0, 5)) {
        try {
          const st = await fsp.stat(path.join(root, c));
          if (st.isDirectory() && st.mtimeMs > latest) latest = st.mtimeMs;
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  return latest > 0 ? latest : null;
}

export async function sizeOf(pathValue: string): Promise<number> {
  try {
    const st = await fsp.stat(pathValue);
    if (!st.isDirectory()) return st.size;
  } catch {
    return 0;
  }
  return boundedSize(pathValue);
}

export async function boundedSize(dir: string, capFiles = 60000): Promise<number> {
  let total = 0;
  let count = 0;
  const stack = [dir];
  try {
    const st = await fsp.stat(dir);
    if (st.isFile()) return st.size;
  } catch {
    return 0;
  }
  while (stack.length > 0 && count < capFiles) {
    const d = stack.pop()!;
    let entries: string[];
    try {
      entries = await fsp.readdir(d);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (count >= capFiles) break;
      const fp = `${d}\\${name}`;
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
}

