import type { SafetyLevel } from "../../shared/types.js";

export interface SafetyResult {
  safety: SafetyLevel;
  reasons: string[];
}

interface SafetyRule {
  regex: RegExp;
  safety: SafetyLevel;
  reason: string;
}

// Ordre d'évaluation : plus restrictif d'abord. Un match PROTÉGÉ gagne toujours.
const RULES: SafetyRule[] = [
  { regex: /^\\\\\?\\/i, safety: "protected", reason: "Chemin de niveau noyau." },
  { regex: /\\Windows\\System32\\|\/System32\//i, safety: "protected", reason: "Élément essentiel de Windows." },
  { regex: /\\Windows\\SysWOW64\\/i, safety: "protected", reason: "Élément essentiel de Windows." },
  { regex: /\\Windows\\WinSxS\\/i, safety: "protected", reason: "Composants Windows (WinSxS)." },
  { regex: /\\Windows\\servicing\\/i, safety: "protected", reason: "Composants de maintenance Windows." },
  { regex: /\\Windows\\System32\\drivers\\/i, safety: "protected", reason: "Pilotes système." },
  { regex: /\\Windows\\Boot\\/i, safety: "protected", reason: "Fichiers de démarrage Windows." },
  { regex: /\\Boot\\/i, safety: "protected", reason: "Fichiers de démarrage." },
  { regex: /\\Windows\\/i, safety: "protected", reason: "Dossier Windows." },
  { regex: /\\System Volume Information\\/i, safety: "protected", reason: "Données système du volume." },
  { regex: /\\\$Recycle\.Bin\\/i, safety: "caution", reason: "Corbeille — gérer via l'outil de nettoyage dédié." },
  { regex: /\\System32\\|\/System32\//i, safety: "protected", reason: "Élément essentiel de Windows." },
  { regex: /pagefile\.sys$/i, safety: "protected", reason: "Fichier d'échange mémoire." },
  { regex: /hiberfil\.sys$/i, safety: "protected", reason: "Fichier d'hibernation." },
  { regex: /swapfile\.sys$/i, safety: "protected", reason: "Fichier système." },
  { regex: /ntuser\.dat$/i, safety: "protected", reason: "Registre du profil utilisateur." },
  { regex: /\\bootmgr$/i, safety: "protected", reason: "Gestionnaire de démarrage." },
  { regex: /\\Program Files\\/i, safety: "caution", reason: "Application installée — utiliser la désinstallation." },
  { regex: /\\Program Files \(x86\)\\/i, safety: "caution", reason: "Application installée — utiliser la désinstallation." },
  { regex: /\\Windows\.old\\/i, safety: "review", reason: "Ancien Windows — vérifier avant suppression." },
  { regex: /\\AppData\\Local\\Temp\\|\/AppData\/Local\/Temp\//i, safety: "safe", reason: "Fichiers temporaires recréables." },
  { regex: /\\AppData\\/i, safety: "review", reason: "Données d'application — supprimer avec précaution." },
  { regex: /\\Temp\\|\/Temp\//i, safety: "safe", reason: "Fichiers temporaires." },
  { regex: /\.(?:tmp|temp|part|crdownload)$/i, safety: "safe", reason: "Fichier temporaire." },
  { regex: /\\Code\sCache\\/i, safety: "safe", reason: "Cache de code." },
  { regex: /(?:Cache|Caches|\.cache)\\?$/i, safety: "safe", reason: "Cache d'application." },
  { regex: /\\node_modules\\/i, safety: "review", reason: "Dépendances — régénérables mais supprimer via le gestionnaire." },
];

export function assessSafety(path: string, isDir: boolean, category?: string): SafetyResult {
  for (const rule of RULES) {
    if (rule.regex.test(path)) {
      return { safety: rule.safety, reasons: [rule.reason] };
    }
  }

  if (category === "system") {
    return { safety: "protected", reasons: ["Élément classé comme système Windows."] };
  }

  if (isDir) {
    return { safety: "review", reasons: ["Dossier — vérifier son contenu avant suppression."] };
  }

  return { safety: "review", reasons: ["Fichier — suppression à confirmer."] };
}

export function isProtected(safety: SafetyLevel): boolean {
  return safety === "protected" || safety === "risky";
}
