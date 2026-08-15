import { app } from "electron";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { spawn, execFile } from "node:child_process";
import type {
  AppInfo,
  CleanRemainsResult,
  RemainConfidence,
  RestoreResult,
  UninstallAnalysis,
  UninstallBreakdown,
  UninstallProgress,
  UninstallReferenceItem,
  UninstallRemain,
  UninstallRunResult,
  UninstallStatus,
} from "../../shared/types.js";
import { boundedSize } from "./apps.js";

export type UninstallPhase = UninstallProgress["phase"];

interface SessionState {
  analysis: UninstallAnalysis;
  app: AppInfo;
  quarantineDir: string;
  removed: UninstallRemain[];
  remains: UninstallRemain[] | null;
  ran: boolean;
}

const sessions = new Map<string, SessionState>();

const RUN_TIMEOUT_MS = 8 * 60_000;
const RUN_PROBE_INTERVAL_MS = 3000;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function userDataDir(): string {
  return path.join(app.getPath("userData"), "quarantine");
}

/** Découpe une ligne de commande en exécutable + arguments. */
export function parseCommand(cmd: string): { exe: string; args: string[] } {
  const trimmed = cmd.trim();
  if (!trimmed) return { exe: "", args: [] };
  const parts: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed))) parts.push(m[1] ?? m[2]);

  // Chemin non cité contenant des espaces : on recolle les segments tant que
  // l'exécutable n'a pas d'extension connue (ex. "C:\Program Files\App\uninstall.exe /S").
  const EXE_EXT = /\.(exe|bat|cmd|com|msi|msp|vbs|ps1|cpl|jar)$/i;
  let exe = parts.shift() ?? "";
  while (parts.length > 0 && !EXE_EXT.test(exe)) exe = `${exe} ${parts.shift()}`;
  return { exe, args: parts };
}

const GUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** Extrait le code produit MSI d'une application, si identifiable de façon fiable. */
export function msiProductCode(app: AppInfo): string | null {
  const leaf = app.registryPath.split("\\").pop() ?? "";
  if (new RegExp(`^\\{?${GUID}\\}?$`).test(leaf)) return leaf.replace(/[{}]/g, "");
  const both = `${app.uninstallString} ${app.quietUninstallString}`;
  const m = new RegExp(`msiexec\\.?(?:exe)?[^0-9a-fA-F]*\\/[ix]\\s*\\{?${GUID}\\}?`, "i").exec(both);
  if (m) {
    const code = m[0].match(new RegExp(GUID, "i"));
    return code ? code[0].toLowerCase() : null;
  }
  return null;
}

/** Résolution de la commande officielle de désinstallation. */
export function resolveUninstaller(app: AppInfo): { type: AppInfo["type"]; command: string; quiet: string; productCode: string | null } {
  const code = msiProductCode(app);
  if (code) {
    return {
      type: "msi",
      command: `msiexec /x ${code}`,
      quiet: `msiexec /x ${code} /qb /norestart`,
      productCode: code,
    };
  }
  const primary = app.uninstallString.trim();
  if (primary) {
    return { type: app.type, command: primary, quiet: app.quietUninstallString.trim() || primary, productCode: null };
  }
  const modify = (app.modifyPath ?? "").trim();
  if (modify) return { type: app.type, command: modify, quiet: modify, productCode: null };
  return { type: "unknown", command: "", quiet: "", productCode: null };
}

// ---------------------------------------------------------------------------
// Analyse préalable
// ---------------------------------------------------------------------------

function nameVariants(appName: string): string[] {
  const clean = appName.replace(/[^\w -]+/g, "").trim();
  const variants = new Set<string>();
  if (clean.length >= 3) variants.add(clean);
  // Variante sans espaces (ex. "Black Desert" → "BlackDesert") : typiquement
  // le nom du dossier d'installation / de données réellement utilisé.
  const joined = clean.replace(/[\s_-]+/g, "");
  if (joined.length >= 5 && joined !== clean) variants.add(joined);
  // Premier mot uniquement s'il est suffisamment distinctif : un mot trop court
  // ("Black") provoque de fausses associations (ex. "Black Desert" ↔ "Blackmagic Design").
  for (const sep of [" ", "-", "_"]) {
    const base = clean.split(sep)[0];
    if (base && base.length >= 6) variants.add(base);
  }
  return Array.from(variants).filter(Boolean);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Vérifie l'existence d'une clé de registre. */
async function regKeyExists(key: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("reg.exe", ["query", key], { windowsHide: true, timeout: 15000 }, (err) => resolve(!err));
  });
}

async function regExport(key: string, file: string): Promise<void> {
  await new Promise<void>((resolve) => {
    execFile("reg.exe", ["export", key, file, "/y"], { windowsHide: true, timeout: 20000 }, () => resolve());
  });
}

async function regDelete(key: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("reg.exe", ["delete", key, "/f"], { windowsHide: true, timeout: 20000 }, (err) => resolve(!err));
  });
}

interface ServiceRow {
  Name: string;
  State: string;
  PathName: string;
}

async function listServices(): Promise<ServiceRow[]> {
  const script = `Get-CimInstance Win32_Service | Select-Object Name, State, PathName | ConvertTo-Json -Compress`;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 30000 }, (err, out) => (err ? reject(err) : resolve(out)));
    });
    const parsed = JSON.parse(stdout) as ServiceRow | ServiceRow[];
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return [];
  }
}

interface TaskRow {
  TaskName: string;
  TaskPath: string;
}

async function listTasks(): Promise<TaskRow[]> {
  return new Promise((resolve) => {
    execFile("schtasks.exe", ["/query", "/fo", "csv", "/nh"], { windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      const rows: TaskRow[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        const cols = line.split(",");
        if (cols.length >= 2) {
          const name = cols[0].replace(/^"|"$/g, "");
          const taskPath = cols[1] ? cols[1].replace(/^"|"$/g, "") : "";
          if (name && name !== "Informations") rows.push({ TaskName: name, TaskPath: taskPath });
        }
      }
      resolve(rows);
    });
  });
}

/** Analyse préalable : état de référence avant désinstallation. */
export async function preAnalyzeApp(app: AppInfo): Promise<UninstallAnalysis> {
  const items: UninstallReferenceItem[] = [];
  const breakdown: UninstallBreakdown = { install: 0, userData: 0, programData: 0, cache: 0, other: 0 };

  const addRef = (kind: UninstallReferenceItem["kind"], p: string, label: string, confidence: UninstallReferenceItem["confidence"], shared = false, size = 0): void => {
    items.push({ kind, path: p, size, label, confidence, shared });
  };

  // Emplacement principal (haute confiance)
  if (app.installLocation) {
    const exists = await pathExists(app.installLocation);
    if (exists) {
      const size = await boundedSize(app.installLocation, 80000);
      breakdown.install += size;
      addRef("folder", app.installLocation, "Dossier d'installation", "certain", false, size);
    }
  }

  // Dossiers de données utilisateur (confiance nominale)
  const variants = nameVariants(app.name);
  const appdataRoots: Array<{ env: string; kind: keyof UninstallBreakdown; root: string }> = [];
  if (process.env.APPDATA) appdataRoots.push({ env: "APPDATA", kind: "userData", root: process.env.APPDATA });
  if (process.env.LOCALAPPDATA) appdataRoots.push({ env: "LOCALAPPDATA", kind: "userData", root: process.env.LOCALAPPDATA });
  if (process.env.PROGRAMDATA) appdataRoots.push({ env: "PROGRAMDATA", kind: "programData", root: process.env.PROGRAMDATA });
  if (process.env.LOCALAPPDATA) appdataRoots.push({ env: "LPP", kind: "userData", root: path.join(process.env.LOCALAPPDATA, "Programs") });
  if (process.env.PROGRAMFILES) appdataRoots.push({ env: "PF", kind: "other", root: process.env.PROGRAMFILES });
  if (process.env["PROGRAMFILES(X86)"]) appdataRoots.push({ env: "PF86", kind: "other", root: process.env["PROGRAMFILES(X86)"] });

  for (const item of appdataRoots) {
    if (item.env === "PF" || item.env === "PF86") {
      // Ne pas dupliquer l'emplacement principal
      if (app.installLocation && app.installLocation.toUpperCase().startsWith(item.root.toUpperCase())) continue;
    }
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(item.root);
    } catch {
      continue;
    }
    for (const v of variants) {
      // Correspondance exacte, ou préfixe uniquement pour des variantes longues et
      // distinctives (>= 5 caractères) afin d'éviter les fausses associations.
      const match = entries.filter((e) => e.toLowerCase() === v.toLowerCase() || (v.length >= 5 && e.toLowerCase().startsWith(v.toLowerCase())));
      for (const e of match.slice(0, 3)) {
        const fp = path.join(item.root, e);
        let st;
        try {
          st = await fsp.stat(fp);
        } catch {
          continue;
        }
        const size = st.isDirectory() ? await boundedSize(fp, 60000) : st.size;
        const isCache = /cache|temp/i.test(e);
        if (item.kind === "cache" || isCache) breakdown.cache += size;
        else breakdown[item.kind] += size;
        addRef("folder", fp, `Dossier de données (${e})`, v.length >= 6 ? "likely" : "examine", isCache, size);
      }
    }
  }

  // Clés de registre dérivées (confiance nominale)
  const hiveKeys: string[] = [];
  const pushHive = (base: string): void => {
    if (base) hiveKeys.push(base);
  };
  const clean = app.name.replace(/[^\w -]+/g, "").trim();
  for (const scope of ["HKCU\\Software", "HKLM\\Software", "HKLM\\Software\\WOW6432Node"]) {
    if (app.publisher && app.publisher !== "—") pushHive(`${scope}\\${app.publisher}\\${clean}`);
    if (clean) pushHive(`${scope}\\${clean}`);
  }
  const checked = new Set<string>();
  for (const key of hiveKeys) {
    if (checked.has(key.toUpperCase())) continue;
    checked.add(key.toUpperCase());
    if (await regKeyExists(key)) addRef("registry", key, `Clé de registre` , "likely", false);
  }

  // Clé de désinstallation elle-même : très probable si elle persiste
  if (app.registryPath && app.registryPath.toLowerCase().includes("uninstall")) {
    if (await regKeyExists(app.registryPath)) addRef("registry", app.registryPath, "Entrée de désinstallation", "certain");
  }

  // Services associés (à examiner)
  const installRoot = app.installLocation ? app.installLocation.toLowerCase() : "";
  try {
    const services = await listServices();
    const baseNames = variants.map((v) => v.toLowerCase());
    for (const s of services) {
      const pn = (s.PathName ?? "").toLowerCase();
      const matches =
        (installRoot.length > 8 && pn.startsWith(installRoot)) ||
        baseNames.some((n) => n.length >= 5 && (s.Name.toLowerCase() === n || s.Name.toLowerCase().startsWith(n)));
      if (matches) addRef("service", s.Name, `Service (${s.Name})`, "examine", true);
    }
  } catch {
    /* silencieux */
  }

  // Tâches planifiées (à examiner)
  try {
    const tasks = await listTasks();
    const baseNames = variants.map((v) => v.toLowerCase());
    for (const t of tasks) {
      const tn = t.TaskName.toLowerCase();
      const matches = baseNames.some((n) => n.length >= 5 && (tn === n || tn.includes(n)));
      if (matches) addRef("task", `${t.TaskPath}\\${t.TaskName}`, `Tâche planifiée (${t.TaskName})`, "examine", true);
    }
  } catch {
    /* silencieux */
  }

  // Démarrage automatique (à examiner)
  try {
    const startupItems = await listStartup();
    const baseNames = variants.map((v) => v.toLowerCase());
    for (const s of startupItems) {
      const lc = s.command.toLowerCase();
      const matches =
        (installRoot.length > 8 && lc.includes(installRoot)) ||
        (s.name !== "" && baseNames.some((n) => n.length >= 5 && s.name.toLowerCase().includes(n)));
      if (matches) addRef("startup", `${s.source}\\${s.name}`, `Démarrage automatique (${s.name})`, "examine", true);
    }
  } catch {
    /* silencieux */
  }

  const uninstaller = resolveUninstaller(app);
  const totalBytes = breakdown.install + breakdown.userData + breakdown.programData + breakdown.cache + breakdown.other;
  const sessionId = uid();
  const analysis: UninstallAnalysis = {
    sessionId,
    appKey: app.key,
    appName: app.name,
    breakdown,
    totalBytes,
    items,
    uninstaller: {
      type: uninstaller.type,
      command: uninstaller.command,
      silentCommand: uninstaller.quiet,
      msiexecProductCode: uninstaller.productCode ?? "",
    },
    createdAt: Date.now(),
  };

  // Mémoire bornée : on évacue les sessions de plus de 24 h et on plafonne le
  // nombre de sessions conservées (une session = un assistant ouvert).
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.analysis.createdAt < now - 24 * 3600000) sessions.delete(id);
  }
  if (sessions.size >= 20) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].analysis.createdAt - b[1].analysis.createdAt);
    for (const [id] of oldest.slice(0, sessions.size - 19)) sessions.delete(id);
  }

  sessions.set(sessionId, {
    analysis,
    app,
    quarantineDir: path.join(userDataDir(), sessionId),
    removed: [],
    remains: null,
    ran: false,
  });

  return analysis;
}

// ---------------------------------------------------------------------------
// Lancement de la désinstallation officielle
// ---------------------------------------------------------------------------

function runProcess(exe: string, args: string[], silent: boolean): Promise<{ code: number | null; te: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(exe, args, { windowsHide: silent, shell: false, detached: false });
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        resolve({ code: null, te: true });
      }
    }, RUN_TIMEOUT_MS);
    child.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ code: null, te: false });
      }
    });
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ code, te: false });
      }
    });
  });
}

async function waitForMainProc(pathValue: string): Promise<void> {
  // Certains désinstalleurs attendent une confirmation : on laisse l'utilisateur finir,
  // puis on vérifie jusqu'à disparition du processus principal.
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const still = await processAlive(pathValue);
    if (!still) return;
    await new Promise((r) => setTimeout(r, RUN_PROBE_INTERVAL_MS));
  }
}

function processAlive(exePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const script = `Get-Process | Where-Object { $_.Path -and $_.Path -eq '${exePath.replace(/'/g, "''")}' } | Select-Object -First 1`;
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15000 }, (err, stdout) =>
      resolve(!err && stdout.trim().length > 0),
    );
  });
}

/** Exécute le désinstalleur officiel et attend sa terminaison. */
export async function runUninstaller(sessionId: string, onProgress?: (p: UninstallProgress) => void): Promise<UninstallRunResult> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session de désinstallation introuvable.");
  const { app, analysis } = session;
  const started = Date.now();
  const emit = (phase: UninstallProgress["phase"], label: string, percent: number, detail?: string): void =>
    onProgress?.({ sessionId, phase, label, percent, detail });

  emit("uninstalling", "Préparation de la désinstallation", 10);

  // Déjà supprimé ?
  const installExists = app.installLocation ? await pathExists(app.installLocation) : false;
  const regStill = app.registryPath ? await regKeyExists(app.registryPath) : false;
  if (!installExists && !regStill && !app.packageFamilyName) {
    session.ran = true;
    emit("done", "Application déjà désinstallée", 100);
    return { sessionId, status: "alreadyGone", message: "Aucune trace de l'application n'a été trouvée : elle semble déjà désinstallée.", returnedCode: null, elapsedMs: Date.now() - started };
  }

  const u = analysis.uninstaller;
  let status: UninstallStatus = "success";
  let message = "La désinstallation s'est terminée.";
  let returnedCode: number | null = null;

  if (u.type === "msi" && u.msiexecProductCode) {
    emit("uninstalling", "Exécution du désinstallateur Windows (MSI)", 30);
    const code = await runMsi(uninstallProduct(u.msiexecProductCode), (label, pct) => emit("uninstalling", label, pct));
    returnedCode = code;
    status = msiExitStatus(code);
    message = msiExitMessage(code);
  } else if (u.type === "msix" || app.packageFullName) {
    emit("uninstalling", "Désinstallation de l'application Store / MSIX", 30);
    returnedCode = await runAppxUninstall(app.packageFullName ?? app.name);
    status = returnedCode === 0 ? "success" : returnedCode === -1 ? "cancelled" : "failed";
    message = returnedCode === 0 ? "Package MSIX supprimé." : returnedCode === -1 ? "La désinstallation a été annulée." : "La désinstallation du package a échoué.";
  } else if (u.command) {
    emit("uninstalling", `Exécution du désinstallateur officiel de ${app.name}`, 30);
    const desc = await runOfficialUninstaller(u.command, (label, pct) => emit("uninstalling", label, pct));
    returnedCode = desc.code;
    if (desc.timedOut) {
      status = "pending";
      message = "Le désinstallateur tourne encore. Terminez-le puis cliquez sur « Vérifier ».";
    } else if (desc.code === 0) {
      status = "success";
      message = "Le désinstallateur s'est terminé sans erreur.";
    } else if (desc.code === 1223 || desc.code === 1602 || desc.code === 1601) {
      status = "cancelled";
      message = "La désinstallation a été annulée par l'utilisateur ou l'application.";
    } else {
      status = "failed";
      message = `Le désinstallateur a retourné le code ${desc.code ?? "inconnu"}.`;
    }
  } else {
    status = "failed";
    message = "Nova n'a pas trouvé de désinstallateur officiel pour cette application.";
  }

  session.ran = true;
  emit("remains", "Recherche des restes après désinstallation", 70);
  session.remains = await analyzeRemainsForSession(session);
  emit("verify", "Vérification finale", 90);
  emit("done", "Désinstallation terminée", 100);
  return { sessionId, status, message, returnedCode, elapsedMs: Date.now() - started };
}

function uninstallProduct(code: string): string {
  return code.replace(/[{}]/g, "");
}

function runMsi(productCode: string, emit: (label: string, pct: number) => void): Promise<number | null> {
  return new Promise((resolve) => {
    emit("Exécution de msiexec…", 40);
    const child = spawn("msiexec.exe", ["/x", productCode, "/qb", "/norestart"], { windowsHide: false, shell: false });
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve(null);
    }, RUN_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

async function runAppxUninstall(packageId: string): Promise<number> {
  const script = `Remove-AppxPackage -Package '${packageId.replace(/'/g, "''")}' -ErrorAction Stop`;
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: false });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function runOfficialUninstaller(
  command: string,
  emit: (label: string, pct: number) => void,
): Promise<{ code: number | null; timedOut: boolean }> {
  return new Promise(async (resolve) => {
    emit("Lancement du désinstallateur…", 40);
    const { exe, args } = parseCommand(command);
    if (!exe) return resolve({ code: null, timedOut: false });
    const { code, te } = await runProcess(exe, args, false);
    if (te) return resolve({ code, timedOut: true });
    emit("Attente de la fin du processus…", 60);
    await waitForMainProc(exe);
    emit("Désinstallateur terminé", 90);
    resolve({ code, timedOut: false });
  });
}

function msiExitStatus(code: number | null): UninstallStatus {
  switch (code) {
    case 0:
      return "success";
    case 3010:
      return "restartRequired";
    case 1602:
    case 1601:
      return "cancelled";
    case 1605:
      return "alreadyGone";
    case 1612:
    case 1603:
    default:
      return "failed";
  }
}

function msiExitMessage(code: number | null): string {
  switch (code) {
    case 0:
      return "L'application MSI a été désinstallée avec succès.";
    case 3010:
      return "Désinstallation MSI réussie : un redémarrage est recommandé.";
    case 1605:
      return "Le produit MSI n'était plus installé.";
    case 1602:
      return "La désinstallation MSI a été annulée par l'utilisateur.";
    case 1603:
      return "Fatal error pendant la désinstallation MSI.";
    case 1612:
      return "Le programme d'installation source est introuvable (MSI).";
    default:
      return `Le désinstallateur MSI a retourné le code ${code ?? "inconnu"}.`;
  }
}

// ---------------------------------------------------------------------------
// Démarrage automatique / registre Run
// ---------------------------------------------------------------------------

interface StartupEntry {
  name: string;
  command: string;
  source: string;
  kind: "reg" | "file";
}

async function listStartup(): Promise<StartupEntry[]> {
  const entries: StartupEntry[] = [];
  const roots = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
  ];
  for (const root of roots) {
    const stdout = await new Promise<string | null>((resolve) => {
      execFile("reg.exe", ["query", root], { windowsHide: true, timeout: 15000 }, (err, out) => resolve(err ? null : out));
    });
    if (!stdout) continue;
    for (const line of stdout.split(/\r?\n/)) {
      const m = /^\s{4}([^\s].*?)\s+REG_[A-Z_]+\s+(.+)$/.exec(line);
      if (m) entries.push({ name: m[1], command: m[2].trim(), source: root, kind: "reg" });
    }
  }
  for (const folder of [path.join(process.env.APPDATA ?? "", "Microsoft\\Windows\\Start Menu\\Programs\\Startup"), path.join(process.env.PROGRAMDATA ?? "", "Microsoft\\Windows\\Start Menu\\Programs\\Startup")]) {
    try {
      for (const f of await fsp.readdir(folder)) {
        const fp = path.join(folder, f);
        entries.push({ name: f, command: fp, source: folder, kind: "file" });
      }
    } catch {
      /* ignore */
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Détection des restes
// ---------------------------------------------------------------------------

async function analyzeRemainsForSession(session: SessionState): Promise<UninstallRemain[]> {
  const remains: UninstallRemain[] = [];
  const { analysis } = session;

  for (const item of analysis.items) {
    if (item.kind === "registry") {
      const exists = await regKeyExists(item.path);
      const shared = item.shared ?? (item.path.toLowerCase().includes("\\wow6432node\\") ? false : false);
      remains.push({
        id: uid(),
        kind: "registry",
        path: item.path,
        label: item.label === "Clé de registre" ? `Clé de registre : ${item.path}` : item.label,
        size: 0,
        confidence: resolveConfidence(item.confidence, shared),
        shared,
        note: exists ? "Entrée de registre encore présente après la désinstallation." : "",
        exists,
      });
      continue;
    }
    if (item.kind === "service" || item.kind === "task") {
      const exists = item.kind === "service" ? await serviceExists(item.path) : await taskExists(item.path);
      remains.push({
        id: uid(),
        kind: item.kind,
        path: item.path,
        label: `${item.kind === "service" ? "Service" : "Tâche planifiée"} : ${item.path.split("\\").pop()}`,
        size: 0,
        confidence: resolveConfidence(item.confidence, item.shared ?? true),
        shared: item.shared ?? true,
        note: exists ? "Élément encore présent." : "",
        exists,
      });
      continue;
    }
    if (item.kind === "startup") {
      const exists = await startupExists(item.path);
      remains.push({
        id: uid(),
        kind: "startup",
        path: item.path,
        label: `Démarrage automatique : ${item.label}`,
        size: 0,
        confidence: resolveConfidence(item.confidence, item.shared ?? true),
        shared: item.shared ?? true,
        note: exists ? "Entrée de démarrage encore présente." : "",
        exists,
      });
      continue;
    }

    // Fichiers / dossiers
    const exists = await pathExists(item.path);
    const size = exists ? (item.size > 0 ? item.size : await boundedSize(item.path, 60000)) : 0;
    const shared = isSharedPath(item.path);
    remains.push({
      id: uid(),
      kind: item.kind,
      path: item.path,
      label: item.label,
      size,
      confidence: resolveConfidence(item.confidence, shared),
      shared,
      note: exists
        ? shared
          ? "Nova ne recommande pas sa suppression : cet emplacement peut être partagé par d'autres applications."
          : "Élément encore présent après la désinstallation."
        : "",
      exists,
    });
  }

  // Emplacement principal non listé (dossier d'installation resté) — confiance certaine
  if (session.app.installLocation && !analysis.items.some((i) => i.path.toLowerCase() === session.app.installLocation!.toLowerCase())) {
    const exists = await pathExists(session.app.installLocation);
    if (exists) {
      const size = await boundedSize(session.app.installLocation, 60000);
      remains.push({
        id: uid(),
        kind: "folder",
        path: session.app.installLocation,
        label: `Dossier d'installation restant`,
        size,
        confidence: "certain",
        shared: false,
        note: "Le dossier principal de l'application existe toujours.",
        exists,
      });
    }
  }

  return remains.sort((a, b) => b.size - a.size);
}

function resolveConfidence(source: UninstallReferenceItem["confidence"], shared: boolean): RemainConfidence {
  if (shared) return "protected";
  if (source === "certain") return "certain";
  if (source === "likely") return "likely";
  return "examine";
}

function isSharedPath(p: string): boolean {
  const low = p.toLowerCase();
  const markers = ["\\common files\\", "\\microsoft shared\\", "\\system32\\", "\\windows\\", "\\programdata\\microsoft\\", "\\appdata\\local\\packages\\microsoft"];
  return markers.some((m) => low.includes(m));
}

function serviceExists(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("sc.exe", ["query", name], { windowsHide: true, timeout: 10000 }, (err) => resolve(!err));
  });
}

function taskExists(fullName: string): Promise<boolean> {
  const clean = fullName.replace(/^\\+/, "");
  return new Promise((resolve) => {
    execFile("schtasks.exe", ["/query", "/tn", clean], { windowsHide: true, timeout: 10000 }, (err) => resolve(!err));
  });
}

function startupExists(itemPath: string): Promise<boolean> {
  const sep = itemPath.lastIndexOf("\\");
  const source = itemPath.slice(0, sep);
  const name = itemPath.slice(sep + 1);
  if (source.includes("CurrentVersion\\Run")) {
    return new Promise((resolve) => {
      execFile("reg.exe", ["query", source, "/v", name], { windowsHide: true, timeout: 10000 }, (err) => resolve(!err));
    });
  }
  return pathExists(itemPath);
}

/** Liste publique des restes d'une session. */
export async function getRemains(sessionId: string): Promise<UninstallRemain[]> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session de désinstallation introuvable.");
  if (session.ran && !session.remains) {
    session.remains = await analyzeRemainsForSession(session);
  }
  return session.remains ?? [];
}

// ---------------------------------------------------------------------------
// Nettoyage des restes (quarantaine + sauvegarde registre)
// ---------------------------------------------------------------------------

async function moveToQuarantine(src: string, dest: string): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.rename(src, dest);
  } catch {
    await fsp.cp(src, dest, { recursive: true, force: true });
    await fsp.rm(src, { recursive: true, force: true });
  }
}

function sanitizePathSegments(p: string): string {
  return p.replace(/^[a-zA-Z]:\\/, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export async function cleanRemains(sessionId: string, ids: string[], onProgress?: (p: UninstallProgress) => void): Promise<CleanRemainsResult> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session de désinstallation introuvable.");
  const remains = (session.remains ?? (await getRemains(sessionId))) ;
  const selected = remains.filter((r) => ids.includes(r.id));
  const emit = (label: string, percent: number): void =>
    onProgress?.({ sessionId, phase: "cleaning", label, percent });

  let moved = 0;
  let bytesQuarantined = 0;
  let registryExported = 0;
  let handled = 0;
  let failed = 0;
  const updated: UninstallRemain[] = [];

  for (let i = 0; i < selected.length; i++) {
    const r = selected[i];
    emit(`Traitement de ${r.label}…`, Math.round(((i + 1) / Math.max(1, selected.length)) * 100));
    try {
      if (r.kind === "registry") {
        const keyPath = r.path;
        const safe = sanitizePathSegments(keyPath).slice(0, 120) || "key";
        const regDir = path.join(session.quarantineDir, "registry");
        await fsp.mkdir(regDir, { recursive: true });
        const regFile = path.join(regDir, `${safe}.reg`);
        await regExport(keyPath, regFile);
        const ok = await regDelete(keyPath);
        if (ok) {
          registryExported++;
          handled++;
          r.exists = false;
          r.note = "Clé de registre supprimée (sauvegarde .reg conservée en quarantaine).";
        } else {
          failed++;
          r.exists = true;
          r.note = "Impossible de supprimer la clé de registre (permissions administrateur requises).";
        }
        updated.push(r);
        continue;
      }
      if (r.kind === "service") {
        const name = r.path;
        const code = await new Promise<number>((resolve) => {
          execFile("sc.exe", ["delete", name], { windowsHide: true, timeout: 15000 }, (err) => resolve(err ? 1 : 0));
        });
        r.exists = code === 0;
        if (code === 0) {
          handled++;
          r.note = "Service supprimé.";
        } else {
          failed++;
          r.note = "Suppression impossible (droits administrateur requis).";
        }
        updated.push(r);
        continue;
      }
      if (r.kind === "task") {
        const clean = r.path.replace(/^\\+/, "");
        const code = await new Promise<number>((resolve) => {
          execFile("schtasks.exe", ["/delete", "/tn", clean, "/f"], { windowsHide: true, timeout: 15000 }, (err) => resolve(err ? 1 : 0));
        });
        r.exists = code === 0;
        if (code === 0) {
          handled++;
          r.note = "Tâche planifiée supprimée.";
        } else {
          failed++;
          r.note = "Suppression impossible.";
        }
        updated.push(r);
        continue;
      }
      if (r.kind === "startup") {
        r.note = "Élément de démarrage conservé : Nova ne modifie pas le registre Run automatiquement.";
        r.exists = true;
        updated.push(r);
        continue;
      }
      if (r.kind === "file" || r.kind === "folder") {
        if (!r.exists) {
          r.note = "Déjà supprimé.";
          updated.push(r);
          continue;
        }
        const dest = path.join(session.quarantineDir, "files", sanitizePathSegments(r.path).slice(0, 150));
        await moveToQuarantine(r.path, dest);
        bytesQuarantined += r.size;
        moved++;
        handled++;
        r.exists = false;
        r.note = "Déplacé vers la quarantaine Nova (restaurable).";
        updated.push(r);
        continue;
      }
      r.note = "Type de reste non gérable.";
      updated.push(r);
    } catch (e) {
      failed++;
      r.note = r.note || `Erreur : ${(e as Error).message}`;
      updated.push(r);
    }
  }

  // Met à jour l'état des restes restants
  session.remains = remains.map((r) => updated.find((u) => u.id === r.id) ?? r);
  return { sessionId, moved, bytesQuarantined, registryExported, handled, failed, items: session.remains };
}

export async function restoreQuarantine(sessionId: string): Promise<RestoreResult> {
  const session = sessions.get(sessionId);
  if (!session) return { restored: 0, failed: 0, items: [] };
  const dir = session.quarantineDir;
  let restored = 0;
  let failed = 0;
  const items: string[] = [];
  if (fs.existsSync(dir)) {
    const files = path.join(dir, "files");
    if (fs.existsSync(files)) {
      for (const entry of await fsp.readdir(files)) {
        const src = path.join(files, entry);
        try {
          // Le chemin original est encodé dans le nom de la quarantaine via le suffixe
          const original = await resolveOriginalFromQuarantine(entry, session.analysis.items);
          if (!original) {
            failed++;
            continue;
          }
          await fsp.mkdir(path.dirname(original), { recursive: true });
          await moveToQuarantine(src, original);
          restored++;
          items.push(original);
        } catch {
          failed++;
        }
      }
    }
  }
  return { restored, failed, items };
}

async function resolveOriginalFromQuarantine(entry: string, refs: UninstallReferenceItem[]): Promise<string | null> {
  for (const r of refs) {
    if (r.kind === "file" || r.kind === "folder") {
      if (sanitizePathSegments(r.path).slice(0, 150) === entry) return r.path;
    }
  }
  return null;
}