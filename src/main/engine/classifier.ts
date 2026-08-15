import type { Category } from "../../shared/types.js";

export interface ClassificationResult {
  category: Category;
  confidence: number;
  signals: string[];
}

const DOCUMENTS = new Set([
  "pdf", "doc", "docx", "odt", "rtf", "txt", "md", "tex", "wpd", "pages",
  "xls", "xlsx", "ods", "csv", "tsv", "ppt", "pptx", "odp", "key", "msg",
  "epub", "mobi", "azw", "azw3", "fb2", "djvu", "xps", "oxps",
  "ipynb", "crdownload",
]);

const IMAGES = new Set([
  "jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "heic", "heif", "tif",
  "tiff", "raw", "cr2", "cr3", "nef", "arw", "orf", "rw2", "dng", "psd",
  "ai", "eps", "ico", "avif", "jfif", "pbm", "pgm", "ppm", "psb", "xcf",
]);

const VIDEOS = new Set([
  "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg",
  "mts", "m2ts", "ts", "3gp", "3g2", "vob", "ogv", "rm", "rmvb", "f4v",
  "divx", "asf", "amv",
]);

const AUDIO = new Set([
  "mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus", "alac", "ape",
  "aiff", "mid", "midi", "amr", "cda", "mka",
]);

const ARCHIVES = new Set([
  "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "tgz", "tbz2", "cab",
  "iso", "img", "dmg", "jar", "war", "ear", "lz4", "lzma", "ace", "arj",
  "uue", "sit", "sitx",
]);

const SYSTEM = new Set([
  "dll", "exe", "sys", "drv", "ocx", "msi", "msp", "mst", "cpl", "mui",
  "manifest", "cat", "inf", "efi", "bin", "dat", "ini", "cfg", "config",
]);

const APPS = new Set([
  "appx", "appxbundle", "msix", "msixbundle",
]);

const CACHES = new Set([
  "cache", "db-journal", "blob", "blobstorage",
]);

const TEMP = new Set([
  "tmp", "temp", "partial", "etl", "dmp", "mdmp", "minidmp",
]);

const BACKUPS = new Set([
  "bak", "backup", "old", "save", "dmp", "vhdx", "vhd", "vmx", "ova", "ovf",
  "pst", "ost",
]);

const DOWNLOADS = new Set([
  "part", "crdownload", "download",
]);

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

interface LocationRule {
  regex: RegExp;
  category: Category;
  confidence: number;
  signal: string;
}

// Règles d'emplacement — la confiance est élevée car le contexte est fiable.
const LOCATION_RULES: LocationRule[] = [
  { regex: /\\Windows\\|\/Windows\//i, category: "system", confidence: 98, signal: "dossier Windows" },
  { regex: /\\System32\\|\/System32\//i, category: "system", confidence: 99, signal: "System32" },
  { regex: /\\WinSxS\\|\/WinSxS\//i, category: "system", confidence: 99, signal: "WinSxS" },
  { regex: /\\System Volume Information\\/i, category: "system", confidence: 99, signal: "volume système" },
  { regex: /steamapps\\common\b/i, category: "games", confidence: 97, signal: "bibliothèque Steam" },
  { regex: /steamapps\\/i, category: "games", confidence: 90, signal: "Steam" },
  { regex: /\\Epic Games\\/i, category: "games", confidence: 96, signal: "bibliothèque Epic" },
  { regex: /\\Battle\.net\\Games\\/i, category: "games", confidence: 95, signal: "Battle.net" },
  { regex: /\\GOG Games\\/i, category: "games", confidence: 95, signal: "GOG" },
  { regex: /\\SteamLibrary\\/i, category: "games", confidence: 90, signal: "SteamLibrary" },
  { regex: /\\Program Files\\|\/Program Files\//i, category: "apps", confidence: 85, signal: "Program Files" },
  { regex: /\\AppData\\Local\\Temp\\|\/AppData\/Local\/Temp\//i, category: "temp", confidence: 99, signal: "dossier Temp" },
  { regex: /\\Temp\\|\/Temp\//i, category: "temp", confidence: 80, signal: "dossier nommé Temp" },
  { regex: /\\Temp|\\tmp\b/i, category: "temp", confidence: 60, signal: "cache temporaire" },
  { regex: /\\Cache\\|\/Cache\//i, category: "caches", confidence: 85, signal: "dossier Cache" },
  { regex: /\\caches\\|\/caches\//i, category: "caches", confidence: 85, signal: "dossier Caches" },
  { regex: /\\Downloads\\|\/Downloads\//i, category: "downloads", confidence: 96, signal: "dossier Téléchargements" },
  { regex: /\\Telechargements\\|\/Telechargements\//i, category: "downloads", confidence: 96, signal: "dossier Téléchargements" },
  { regex: /\\Documents\\|\/Documents\//i, category: "documents", confidence: 85, signal: "dossier Documents" },
  { regex: /\\Pictures\\|\/Pictures\//i, category: "images", confidence: 90, signal: "dossier Images" },
  { regex: /\\Images\\|\/Images\//i, category: "images", confidence: 80, signal: "dossier Images" },
  { regex: /\\Videos\\|\/Videos\//i, category: "videos", confidence: 90, signal: "dossier Vidéos" },
  { regex: /\\Music\\|\/Music\//i, category: "audio", confidence: 90, signal: "dossier Musique" },
  { regex: /\\Musique\\|\/Musique\//i, category: "audio", confidence: 90, signal: "dossier Musique" },
  { regex: /\\Desktop\\|\/Desktop\//i, category: "other", confidence: 60, signal: "Bureau" },
  { regex: /\\Backup\\|\/Backup\//i, category: "backups", confidence: 85, signal: "dossier Backup" },
  { regex: /\\Sauvegardes?\\/i, category: "backups", confidence: 85, signal: "dossier Sauvegarde" },
  { regex: /\\Backups?\\/i, category: "backups", confidence: 80, signal: "dossier Backup" },
  { regex: /\\node_modules\\|\/node_modules\//i, category: "apps", confidence: 92, signal: "node_modules" },
  { regex: /\\\.git\\|\/\.git\//i, category: "other", confidence: 70, signal: "dossier .git" },
];

const SPECIAL_NAMES = new Set([
  "node_modules", ".git", ".venv", "venv", "site-packages", "dist", "build",
]);

function classifyByLocation(path: string): ClassificationResult | null {
  for (const rule of LOCATION_RULES) {
    if (rule.regex.test(path)) {
      return { category: rule.category, confidence: rule.confidence, signals: [rule.signal] };
    }
  }
  return null;
}

export function classify(path: string, name: string, isDir: boolean): ClassificationResult {
  const ext = isDir ? "" : extensionOf(name);

  const byLocation = classifyByLocation(path);
  if (byLocation) {
    // Un dossier nommé Temp prime sur l'extension d'un fichier qu'il contient.
    return byLocation;
  }

  // Signaux par nom de dossier pour les répertoires
  if (isDir) {
    const lower = name.toLowerCase();
    if (SPECIAL_NAMES.has(lower)) {
      return { category: "apps", confidence: 80, signals: ["nom de dossier connu"] };
    }
  }

  let category: Category | null = null;
  let confidence = 0;
  let signal = "";

  if (ext) {
    if (SYSTEM.has(ext)) {
      category = "system";
      confidence = ext === "dll" || ext === "sys" || ext === "drv" ? 90 : 75;
      signal = `extension .${ext}`;
    } else if (DOCUMENTS.has(ext)) {
      category = "documents";
      confidence = 88;
      signal = `extension .${ext}`;
    } else if (IMAGES.has(ext)) {
      category = "images";
      confidence = 92;
      signal = `extension .${ext}`;
    } else if (VIDEOS.has(ext)) {
      category = "videos";
      confidence = 92;
      signal = `extension .${ext}`;
    } else if (AUDIO.has(ext)) {
      category = "audio";
      confidence = 92;
      signal = `extension .${ext}`;
    } else if (ARCHIVES.has(ext)) {
      category = "archives";
      confidence = 90;
      signal = `extension .${ext}`;
    } else if (APPS.has(ext)) {
      category = "apps";
      confidence = 90;
      signal = `extension .${ext}`;
    } else if (CACHES.has(ext)) {
      category = "caches";
      confidence = 75;
      signal = `extension .${ext}`;
    } else if (TEMP.has(ext)) {
      category = "temp";
      confidence = 80;
      signal = `extension .${ext}`;
    } else if (BACKUPS.has(ext)) {
      category = "backups";
      confidence = 70;
      signal = `extension .${ext}`;
    } else if (DOWNLOADS.has(ext)) {
      category = "downloads";
      confidence = 85;
      signal = `extension .${ext}`;
    }
  }

  if (category) {
    return { category, confidence, signals: [signal] };
  }

  // Fichiers cachés / dotfiles sous un profil utilisateur → configuration
  if (!isDir && name.startsWith(".")) {
    return { category: "apps", confidence: 60, signals: ["fichier de configuration"] };
  }

  return { category: "other", confidence: 40, signals: ["signal faible"] };
}

/** Extension classée pour un fichier — utilisée par les listes. */
export function categoryForExtension(ext: string): Category | null {
  const e = ext.toLowerCase();
  if (SYSTEM.has(e)) return "system";
  if (DOCUMENTS.has(e)) return "documents";
  if (IMAGES.has(e)) return "images";
  if (VIDEOS.has(e)) return "videos";
  if (AUDIO.has(e)) return "audio";
  if (ARCHIVES.has(e)) return "archives";
  if (APPS.has(e)) return "apps";
  if (CACHES.has(e)) return "caches";
  if (TEMP.has(e)) return "temp";
  if (BACKUPS.has(e)) return "backups";
  if (DOWNLOADS.has(e)) return "downloads";
  return null;
}
