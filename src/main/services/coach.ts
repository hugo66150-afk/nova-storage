import type {
  CoachRecommendation,
  CoachReport,
  RecoverableSummary,
  SafetyLevel,
  StorageTrend,
} from "../../shared/types.js";
import { getKindMeta } from "../engine/analysis.js";
import { scanManager } from "../engine/scanManager.js";
import { getDrives } from "./drives.js";
import { buildTrend } from "./insights.js";
import { getInstalledApps } from "./apps.js";
import { getGames } from "./games.js";
import { getRecycleBinInfo } from "./recyclebin.js";
import { getLastScan } from "../data/repositories.js";
import { logger } from "../infra/logger.js";

const RECYCLE_CACHE_TTL = 30_000;
let recycleCache: { at: number; bytes: number; files: number } | null = null;

/** Reproduit le calcul de l'aperçu récupérable (groupes + corbeille). */
async function recoverableForCoach(scanId: number | null): Promise<RecoverableSummary> {
  const recoverable = scanId ? scanManager.getRecoverableFromDb(scanId) : scanManager.getRecoverableFromDb(null);
  const lastScan = getLastScan();
  if (lastScan && /^[a-zA-Z]:\\/.test(lastScan.root)) {
    if (!recycleCache || Date.now() - recycleCache.at > RECYCLE_CACHE_TTL) {
      const info = await getRecycleBinInfo();
      recycleCache = { at: Date.now(), bytes: info.bytes, files: info.files };
    }
    if (recycleCache.bytes > 0) {
      const existing = recoverable.groups.find((g) => g.key === "recyclebin");
      if (existing) {
        existing.bytes = recycleCache.bytes;
        existing.files = recycleCache.files;
      } else {
        recoverable.groups.push({
          key: "recyclebin",
          title: getKindMeta("recyclebin").title,
          description: getKindMeta("recyclebin").description,
          risk: "review",
          confidence: 90,
          bytes: recycleCache.bytes,
          files: recycleCache.files,
        });
      }
      recoverable.byKind.recyclebin = recycleCache.bytes;
      recoverable.totalBytes = recoverable.groups.reduce((a, g) => a + g.bytes, 0);
    }
  }
  return recoverable;
}

/** Seuil minimal pour proposer un groupe de nettoyage (sensible au risque). */
function minBytesForRisk(risk: SafetyLevel): number {
  switch (risk) {
    case "safe":
      return 50 * 1024 * 1024; // 50 Mo
    case "review":
      return 200 * 1024 * 1024; // 200 Mo
    default:
      return 500 * 1024 * 1024; // 500 Mo
  }
}

/** Poids de sécurité pour la priorisation : les éléments sûrs passent d'abord. */
function safetyWeight(risk: SafetyLevel): number {
  switch (risk) {
    case "safe":
      return 1;
    case "review":
      return 0.8;
    case "caution":
      return 0.6;
    case "risky":
      return 0.4;
    default:
      return 0.2;
  }
}

const GROWTH_THRESHOLD = 5 * 1024 ** 3; // 5 Go/semaine
const APP_UNUSED_DAYS = 180;
const APP_MIN_SIZE = 1024 ** 3; // 1 Go
const GAME_MIN_SIZE = 15 * 1024 ** 3; // 15 Go
const DRIVE_ALERT_PCT = 80;

function buildPredictionRecommendation(trend: StorageTrend, drives: { name: string; used: number; total: number }[]): CoachRecommendation | null {
  const fullDrive = drives.find((d) => d.total > 0 && d.used / d.total >= DRIVE_ALERT_PCT / 100);
  const growing = trend.weeklyGrowth >= GROWTH_THRESHOLD;
  if (!fullDrive && !growing) return null;

  const pct = fullDrive ? Math.round((fullDrive.used / fullDrive.total) * 100) : 0;
  const weekly = trend.weeklyGrowth / 1024 ** 3;
  const title = fullDrive ? `Disque ${fullDrive.name} utilisé à ${pct} %` : "Croissance rapide du stockage";
  const explanation = fullDrive
    ? `Votre disque ${fullDrive.name} est utilisé à ${pct} %. Au rythme actuel, surveillez son évolution et anticipez un nettoyage.`
    : `Votre stockage augmente en moyenne de ${weekly.toFixed(1)} Go par semaine, ce qui est inhabituel.`;
  return {
    key: "growth-prediction",
    kind: "prediction",
    title,
    explanation,
    reason: fullDrive ? `Utilisation ${pct} % · croissance ${weekly.toFixed(1)} Go/semaine` : `Croissance ${weekly.toFixed(1)} Go/semaine`,
    bytes: fullDrive ? Math.max(0, (fullDrive.used - fullDrive.total * 0.8)) : trend.weeklyGrowth,
    files: 0,
    risk: fullDrive && pct >= 90 ? "caution" : "review",
    confidence: 70,
    action: fullDrive ? "cleanup" : "history",
    targetKind: fullDrive ? "large" : undefined,
    share: 0,
  };
}

async function buildAppsRecommendation(): Promise<CoachRecommendation | null> {
  try {
    const apps = await getInstalledApps();
    const unused = apps.filter((a) => {
      if (a.protected) return false;
      if ((a.estimatedSize || 0) < APP_MIN_SIZE && (a.size || 0) < APP_MIN_SIZE) return false;
      if (a.lastUsed === null) return false; // usage inconnu : on ne l'invente pas
      return Date.now() - a.lastUsed > APP_UNUSED_DAYS * 86400000;
    });
    const bytes = unused.reduce((a, x) => a + (x.size || x.estimatedSize || 0), 0);
    if (unused.length === 0 || bytes < APP_MIN_SIZE) return null;
    return {
      key: "apps-unused",
      kind: "apps-unused",
      title: "Applications peu utilisées",
      explanation: `${unused.length} applications n'ont pas été utilisées depuis plus de ${APP_UNUSED_DAYS} jours. Les désinstaller libère de l'espace et allège Windows.`,
      reason: `Dernière utilisation : il y a plus de ${APP_UNUSED_DAYS} jours · ${bytes / 1024 ** 3 >= 1 ? `${(bytes / 1024 ** 3).toFixed(1)} Go` : `${Math.round(bytes / 1024 ** 2)} Mo`} estimés`,
      bytes,
      files: unused.length,
      risk: "review",
      confidence: 75,
      action: "apps",
      share: 0,
    };
  } catch {
    return null;
  }
}

async function buildGamesRecommendation(): Promise<CoachRecommendation | null> {
  try {
    const games = await getGames();
    const large = games.filter((g) => g.size >= GAME_MIN_SIZE);
    const bytes = large.reduce((a, g) => a + g.size, 0);
    if (large.length === 0) return null;
    return {
      key: "games-large",
      kind: "games-large",
      title: "Jeux volumineux",
      explanation: `${large.length} jeux occupent plus de ${(GAME_MIN_SIZE / 1024 ** 3).toFixed(0)} Go chacun. Vous pouvez les déplacer vers un autre disque sans les désinstaller.`,
      reason: `${large[0].name} et ${large.length - 1} autre(s) · ${(bytes / 1024 ** 3).toFixed(1)} Go au total`,
      bytes,
      files: large.length,
      risk: "review",
      confidence: 80,
      action: "games",
      share: 0,
    };
  } catch {
    return null;
  }
}

/**
 * Moteur du Nova Coach : analyse les données déjà disponibles (sans scan
 * supplémentaire) et produit des recommandations priorisées.
 */
export async function buildCoachReport(): Promise<CoachReport> {
  const lastScan = getLastScan();
  const scanId = lastScan ? lastScan.id : null;
  const recoverable = await recoverableForCoach(scanId);
  const drives = await getDrives();
  const trend = buildTrend();

  const recommendations: CoachRecommendation[] = [];
  const totalRecoverable = recoverable.totalBytes;

  // 1) Groupes de nettoyage issus de l'analyse.
  for (const g of recoverable.groups) {
    if (g.bytes < minBytesForRisk(g.risk)) continue;
    const meta = getKindMeta(g.key);
    recommendations.push({
      key: `cleanup:${g.key}`,
      kind: g.key,
      title: meta.title,
      explanation: meta.description,
      reason: `Détecté lors de la dernière analyse · confiance ${g.confidence} %`,
      bytes: g.bytes,
      files: g.files,
      risk: g.risk,
      confidence: g.confidence,
      action: "cleanup",
      targetKind: g.key,
      share: 0,
    });
  }

  // 2) Prédiction / croissance.
  if (trend && trend.points.length >= 2) {
    const rec = buildPredictionRecommendation(trend, drives);
    if (rec) recommendations.push(rec);
  }

  // 3) Applications peu utilisées (si les données existent).
  const appsRec = await buildAppsRecommendation();
  if (appsRec) recommendations.push(appsRec);

  // 4) Jeux volumineux.
  const gamesRec = await buildGamesRecommendation();
  if (gamesRec) recommendations.push(gamesRec);

  // Priorisation : score = octets × poids de sécurité × confiance.
  // La part ne peut jamais dépasser 100 % du récupérable (les recommandations
  // apps/jeux/prédiction ne font pas partie de ce total).
  for (const rec of recommendations) {
    rec.share = totalRecoverable > 0 ? Math.min(1, rec.bytes / totalRecoverable) : 0;
  }
  recommendations.sort((a, b) => {
    const sa = a.bytes * safetyWeight(a.risk) * (a.confidence / 100);
    const sb = b.bytes * safetyWeight(b.risk) * (b.confidence / 100);
    return sb - sa;
  });

  const top = recommendations.slice(0, 8);
  const totalTop = top.reduce((a, r) => a + r.bytes, 0);

  const status: CoachReport["status"] = totalTop >= 500 * 1024 * 1024 ? "attention" : "healthy";
  const headline =
    status === "healthy"
      ? "Votre stockage est actuellement bien entretenu"
      : "Voici ce qu'il est intelligent de faire";

  const sub =
    totalTop > 0
      ? `Vous pourriez récupérer jusqu'à ${totalTop / 1024 ** 3 >= 1 ? `${(totalTop / 1024 ** 3).toFixed(1)} Go` : `${Math.round(totalTop / 1024 ** 2)} Mo`}`
      : "Aucune action pertinente détectée pour l'instant.";

  let protectedNote: string | null = null;
  const sysDrive = drives.find((d) => d.name.toLowerCase() === "c:");
  if (sysDrive && sysDrive.total > 0 && sysDrive.used / sysDrive.total >= 0.9 && totalRecoverable < sysDrive.total * 0.03) {
    protectedNote =
      "Votre disque système est très rempli mais peu d'éléments nettoyables ont été identifiés : une partie de l'espace est protégée (Windows, pilotes).";
  }

  logger.debug(`Coach : ${recommendations.length} recommandations générées.`);
  return { status, headline, sub, totalRecoverable, recommendations: top, protectedNote, generatedAt: Date.now() };
}
