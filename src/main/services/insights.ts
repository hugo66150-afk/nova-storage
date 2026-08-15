import type { DriveInfo, Insight, RecoverableSummary, StorageTrend } from "../../shared/types.js";
import { getSnapshots } from "../data/repositories.js";
import { logger } from "../infra/logger.js";

export function buildTrend(): StorageTrend | null {
  const snaps = getSnapshots();
  if (snaps.length < 1) return null;
  const sorted = [...snaps].sort((a, b) => a.at - b.at);
  const points = sorted.map((s) => ({ at: s.at, total: s.total, free: s.free, used: s.used }));

  let weeklyGrowth = 0;
  if (sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const days = Math.max(1, (last.at - first.at) / 86400000);
    const delta = last.used - first.used;
    weeklyGrowth = Math.round((delta / days) * 7);
  }
  return { points, weeklyGrowth };
}

export function buildInsights(drives: DriveInfo[], recoverable: RecoverableSummary, lastScanAt: number | null): Insight[] {
  const insights: Insight[] = [];

  for (const drive of drives) {
    if (drive.total > 0 && drive.used / drive.total > 0.9) {
      const pct = Math.round((drive.used / drive.total) * 100);
      insights.push({
        kind: "warning",
        title: `Disque ${drive.name} presque plein`,
        message: `Votre disque ${drive.name} est utilisé à ${pct} %. Un nettoyage est recommandé.`,
      });
    }
  }

  const recoverableGo = recoverable.totalBytes / 1024 ** 3;
  if (recoverableGo >= 1) {
    insights.push({
      kind: "positive",
      title: "Espace récupérable identifié",
      message: `Nova a identifié ${recoverableGo.toFixed(1)} Go pouvant être nettoyés en toute sécurité (temporaires, caches, corbeille).`,
    });
  }

  const trend = buildTrend();
  if (trend && trend.points.length >= 2) {
    if (trend.weeklyGrowth > 0) {
      insights.push({
        kind: "info",
        title: "Croissance du stockage",
        message: `Votre stockage augmente en moyenne de ${(trend.weeklyGrowth / 1024 ** 3).toFixed(1)} Go par semaine.`,
      });
    } else if (trend.weeklyGrowth < 0) {
      insights.push({
        kind: "positive",
        title: "Stockage en baisse",
        message: `Votre stockage diminue en moyenne de ${(-trend.weeklyGrowth / 1024 ** 3).toFixed(1)} Go par semaine.`,
      });
    }
  }

  if (lastScanAt) {
    const hoursAgo = (Date.now() - lastScanAt) / 3600000;
    if (hoursAgo > 72) {
      insights.push({
        kind: "info",
        title: "Analyse à actualiser",
        message: "Votre dernière analyse date de plusieurs jours. Lancez une nouvelle analyse pour des recommandations à jour.",
      });
    }
  }

  logger.debug(`Insights générés : ${insights.length}.`);
  return insights;
}