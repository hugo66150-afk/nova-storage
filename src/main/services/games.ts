import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { shell } from "electron";
import type { GameInfo } from "../../shared/types.js";
import { logger } from "../infra/logger.js";
import { REG_KEYS, runRegQuery, parseRegOutput, type RegEntry } from "./apps.js";

type GameLibrary = GameInfo["library"];

export interface Library {
  name: string;
  library: GameLibrary;
  root: string;
}

export async function getGames(): Promise<GameInfo[]> {
  const libraries: Library[] = [];
  libraries.push(...(await steamLibraries()));
  libraries.push(...(await epicLibraries()));
  libraries.push(...(await registryGameLibraries()));
  libraries.push(...(await launcherRootLibraries()));

  const games: GameInfo[] = [];
  const seen = new Set<string>();
  for (const lib of dedupeNestedLibraries(libraries)) {
    try {
      const entries = await fsp.readdir(lib.root, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (isLauncherFolder(ent.name)) continue;
        const gamePath = path.join(lib.root, ent.name);
        const norm = gamePath.toLowerCase();
        if (seen.has(norm)) continue;
        seen.add(norm);
        const size = await boundedSize(gamePath);
        if (size > 20 * 1024 * 1024) {
          games.push({ name: ent.name, path: gamePath, library: lib.library, size, files: 0 });
        }
      }
    } catch {
      /* ignore */
    }
  }
  games.sort((a, b) => b.size - a.size);
  return games;
}

function steamLibraries(): Promise<Library[]> {
  return new Promise((resolve) => {
    execFile(
      "reg.exe",
      ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
      { windowsHide: true, timeout: 10000 },
      (err, stdout) => {
        if (err) return resolve([]);
        const m = /\\([A-Z]:[^\\]+)\\Steam/.exec(stdout) || /REG_SZ\s+(.+)/.exec(stdout);
        if (!m) return resolve([]);
        const steamRoot = m[1];
        void (async () => {
          const libs: Library[] = [];
          try {
            const vdf = await fsp.readFile(path.join(steamRoot, "steamapps", "libraryfolders.vdf"), "utf8");
            const folders = parseVdfFolders(vdf);
            const roots = new Set<string>();
            // Le VDF contient généralement déjà le dossier par défaut : on le déduplique
            // pour éviter de scanner deux fois le même dossier (jeux affichés en double).
            if (steamRoot) roots.add(steamRoot.toLowerCase());
            for (const folder of folders) {
              if (folder && !roots.has(folder.toLowerCase())) roots.add(folder.toLowerCase());
            }
            for (const folder of Array.from(roots)) {
              libs.push({ name: "Steam", library: "Steam", root: path.join(folder, "steamapps", "common") });
            }
          } catch {
            libs.push({ name: "Steam", library: "Steam", root: path.join(steamRoot, "steamapps", "common") });
          }
          resolve(libs);
        })();
      },
    );
  });
}

/** Extrait les chemins `"path"` des bibliothèques Steam d'un libraryfolders.vdf. */
export function parseVdfFolders(vdf: string): string[] {
  const paths: string[] = [];
  const re = /"path"\s+"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(vdf)) !== null) {
    const p = m[1].replace(/\\\\/g, "\\");
    if (!paths.includes(p)) paths.push(p);
  }
  return paths;
}

async function epicLibraries(): Promise<Library[]> {
  const libs: Library[] = [];
  const manifestDir = path.join(
    process.env.PROGRAMDATA ?? "C:\\ProgramData",
    "Epic",
    "EpicGamesLauncher",
    "Data",
    "Manifests",
  );
  try {
    const files = await fsp.readdir(manifestDir);
    for (const f of files.filter((x) => x.endsWith(".item"))) {
      try {
        const raw = await fsp.readFile(path.join(manifestDir, f), "utf8");
        const manifest = JSON.parse(raw) as { InstallLocation?: string };
        if (manifest.InstallLocation) libs.push({ name: "Epic", library: "Epic", root: manifest.InstallLocation });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return libs;
}

/**
 * Bibliothèques découvertes via les entrées de désinstallation du registre
 * (HKLM 64 bits, Wow6432Node, HKCU). La plupart des launchers (Blizzard,
 * Ubisoft, EA, Riot…) enregistrent chaque jeu installé avec un
 * `InstallLocation` pointant vers son dossier — c'est ce qui permet de
 * détecter Valorant, League of Legends et bien d'autres jeux hors Steam.
 */
async function registryGameLibraries(): Promise<Library[]> {
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
  const libs: Library[] = [];
  for (const entry of entries.values()) {
    const lib = libraryFromRegEntry(entry);
    if (lib) libs.push(lib);
  }
  return libs;
}

/** Éditeurs de jeux dont les entrées de désinstallation pointent vers un dossier de jeu. */
const GAME_PUBLISHER_RE =
  /riot|blizzard|ubisoft|electronic arts|\bea\b|activision|rockstar|bethesda|zenimax|cd projekt|capcom|bandai|square enix|sega|konami|epic games|gog|valve|\b2k\b|take[- ]two|gearbox|paradox|frontier|devolver|team17|team cherry|tinybuild|humble games|focus entertainment|deep silver|kakao|neowiz|smilegate|krafton|netmarble|nexon|ncsoft|wargaming|gaijin|bohemia|arkane|obsidian|insomniac|supergiant|moon studios|double fine|motion twin|nicalis|toby fox|concernedape|mojang|facepunch|fatshark|11 bit|coffee stain|digital extremes|hello games|remedy|io interactive|techland|klei|chucklefish|supercell|platinumgames|red hook|subset games|frictional|thatgamecompany|playdead|annapurna|raw fury|curve games|kadokawa|fromsoftware|nintendo|playstation|sony interactive/i;

/** Noms d'entrées de désinstallation qui sont des launchers, pas des jeux. */
const LAUNCHER_ENTRY_NAMES = [
  "steam",
  "battle.net",
  "ubisoft connect",
  "ubisoft game launcher",
  "ea desktop",
  "ea app",
  "origin",
  "epic games launcher",
  "gog galaxy",
  "riot client",
  "rockstar games launcher",
  "bethesda.net launcher",
  "xbox app",
  "minecraft launcher",
  "riot vanguard",
  "redlauncher",
  "netmarble launcher",
];

/** Transforme une entrée de désinstallation en bibliothèque de jeux (ou null). */
export function libraryFromRegEntry(
  entry: Pick<RegEntry, "name" | "publisher"> & Partial<Pick<RegEntry, "installLocation" | "uninstallString" | "displayIcon">>,
): Library | null {
  if (!GAME_PUBLISHER_RE.test(entry.publisher)) return null;
  if (LAUNCHER_ENTRY_NAMES.includes(entry.name.trim().toLowerCase())) return null;
  const root = inferInstallRoot(entry);
  if (!root) return null;
  // Garde générique : une entrée dont le dossier racine est un launcher connu
  // (ex. Netmarble Launcher) n'est pas une bibliothèque de jeux.
  if (isLauncherFolder(path.basename(root))) return null;
  let library: GameLibrary = "Other";
  if (/riot/i.test(entry.publisher)) library = "Riot";
  else if (/blizzard/i.test(entry.publisher)) library = "Battle.net";
  else if (/gog|cd projekt/i.test(entry.publisher)) library = "GOG";
  return { name: entry.name, library, root };
}

/**
 * Dossier d'installation : InstallLocation, sinon le dossier du désinstalleur
 * ou de l'icône — beaucoup d'éditeurs (dont les indés) n'enregistrent pas
 * d'InstallLocation mais un chemin de désinstallation exploitable.
 */
function inferInstallRoot(
  entry: Partial<Pick<RegEntry, "installLocation" | "uninstallString" | "displayIcon">>,
): string | null {
  if (entry.installLocation) return entry.installLocation;
  return dirnameOfExe(entry.uninstallString ?? "") ?? dirnameOfExe(entry.displayIcon ?? "");
}

/** Dossier contenant le premier .exe d'une commande (« C:\Jeux\Titre\unins000.exe » → « C:\Jeux\Titre »). */
export function dirnameOfExe(cmd: string): string | null {
  const m = /^"?([a-zA-Z]:[^"]*?)[\\/][^\\/"]+\.exe"?/i.exec(cmd.trim());
  return m ? m[1] : null;
}

/** Vrais dossiers de jeux : exclut les dossiers de launchers connus. */
export function isLauncherFolder(name: string): boolean {
  const n = name.trim().toLowerCase();
  return (
    n === "riot client" ||
    n === "riot vanguard" ||
    n === "netmarble launcher" ||
    n === "battle.net" ||
    n === "ubisoft game launcher" ||
    n === "epic games launcher" ||
    n === "origin" ||
    n === "ea desktop" ||
    n === "gog galaxy" ||
    n === "steam" ||
    n === "steamapps" ||
    n === "common" ||
    n === "xbox games"
  );
}

/** Normalise un chemin Windows pour comparaison (accepte / et \). */
function normPath(p: string): string {
  return p.replace(/\//g, "\\").toLowerCase();
}

/**
 * Élimine les racines imbriquées : une bibliothèque dont le dossier est déjà
 * couvert par un parent (ex. entrée registre → C:\\Riot Games\\League of Legends
 * alors que C:\\Riot Games est déjà scanné) ne doit pas être scannée à nouveau,
 * sinon ses sous-dossiers internes remonteraient comme de faux jeux.
 */
export function dedupeNestedLibraries(libraries: Library[]): Library[] {
  const sorted = [...libraries].sort((a, b) => normPath(a.root).length - normPath(b.root).length);
  const kept: Library[] = [];
  for (const lib of sorted) {
    const base = normPath(lib.root);
    const covered = kept.some((k) => base.startsWith(normPath(k.root) + "\\"));
    if (!covered) kept.push(lib);
  }
  return kept;
}

/**
 * Racines de launchers connues (Riot, Epic, EA, GOG, Ubisoft) : dossiers
 * Programme + mêmes dossiers sur chaque lecteur présent. Leurs sous-dossiers
 * directs sont les jeux installés (le launcher lui-même est exclu par
 * `isLauncherFolder`).
 */
async function launcherRootLibraries(): Promise<Library[]> {
  const roots: Array<{ library: GameLibrary; root: string }> = [];
  const pf = process.env.ProgramFiles ?? "";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "";
  if (pf) {
    roots.push({ library: "Epic", root: path.join(pf, "Epic Games") });
    roots.push({ library: "Other", root: path.join(pf, "EA Games") });
  }
  if (pf86) {
    roots.push({
      library: "Other",
      root: path.join(pf86, "Ubisoft", "Ubisoft Game Launcher", "games"),
    });
  }
  for (const drive of await driveRoots()) {
    roots.push({ library: "Riot", root: path.join(drive, "Riot Games") });
    roots.push({ library: "Epic", root: path.join(drive, "Epic Games") });
    roots.push({ library: "Other", root: path.join(drive, "EA Games") });
    roots.push({ library: "GOG", root: path.join(drive, "GOG Games") });
    roots.push({ library: "GOG", root: path.join(drive, "GOGLibrary") });
  }
  const libs: Library[] = [];
  for (const r of roots) {
    try {
      await fsp.access(r.root);
      libs.push({ name: r.library, library: r.library, root: r.root });
    } catch {
      /* ignore */
    }
  }
  return libs;
}

/** Racines des lecteurs montés (C:\, D:\…). */
async function driveRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (let i = 0; i < 26; i++) {
    const root = `${String.fromCharCode(65 + i)}:\\`;
    try {
      await fsp.access(root);
      roots.push(root);
    } catch {
      /* ignore */
    }
  }
  return roots;
}

async function boundedSize(dir: string, capFiles = 80000): Promise<number> {
  let total = 0;
  let count = 0;
  const stack = [dir];
  try {
    await fsp.access(dir);
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

/**
 * Supprime un dossier de jeu : vers la corbeille (récupérable) ou définitivement.
 * La suppression n'est jamais silencieuse — elle est déclenchée par l'utilisateur
 * depuis l'interface, après confirmation.
 */
export async function uninstallGame(
  gamePath: string,
  mode: "recycle" | "permanent",
): Promise<{ ok: boolean; bytes: number; message: string }> {
  if (!/^[a-zA-Z]:[\\/]/.test(gamePath) || gamePath.length > 400) {
    return { ok: false, bytes: 0, message: "Chemin de jeu invalide." };
  }
  const bytes = await boundedSize(gamePath);
  try {
    if (mode === "recycle") {
      await shell.trashItem(gamePath);
      return { ok: true, bytes, message: `Jeu déplacé vers la corbeille (${bytes} octets).` };
    }
    await fsp.rm(gamePath, { recursive: true, force: true });
    return { ok: true, bytes, message: `Jeu supprimé définitivement (${bytes} octets).` };
  } catch (err) {
    logger.warn(`Suppression du jeu impossible : ${err instanceof Error ? err.message : String(err)}`);
    return {
      ok: false,
      bytes: 0,
      message: `Suppression impossible : ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
