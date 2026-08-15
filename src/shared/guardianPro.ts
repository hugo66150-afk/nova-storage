/**
 * Analyse de croissance (Gardien Pro) — fonction pure, testable.
 * Détecte une croissance anormale en comparant le rythme récent au rythme
 * moyen de la période : si le rythme récent dépasse nettement la moyenne
 * (et un plancher d'au moins 100 Mo/jour), la croissance est signalée.
 */

export interface GrowthAnalysis {
  /** Rythme moyen sur toute la période (octets/jour). */
  rateAll: number;
  /** Rythme récent (dernière moitié de la période, octets/jour). */
  rateRecent: number;
  /** Ratio récent / moyen (1 = identique). */
  ratio: number;
  /** Vrai si la croissance récente est anormalement élevée. */
  anomalous: boolean;
  /** Message utilisateur clair (jamais technique). */
  message: string;
}

export const GROWTH_MIN_RECENT = 100 * 1024 * 1024; // 100 Mo/jour minimum pour signaler
export const GROWTH_RATIO = 1.5; // récent doit dépasser 1,5× la moyenne

export function analyzeGrowth(points: Array<{ at: number; used: number }>): GrowthAnalysis {
  if (points.length < 3) {
    return {
      rateAll: 0,
      rateRecent: 0,
      ratio: 1,
      anomalous: false,
      message: "Pas assez de mesures pour détecter une croissance anormale.",
    };
  }
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const spanMs = last.at - first.at;
  const spanDays = Math.max(1, spanMs / 86400000);
  const rateAll = (last.used - first.used) / spanDays;

  // Dernière moitié de la période.
  const midAt = first.at + spanMs / 2;
  const recent = sorted.filter((p) => p.at >= midAt);
  let rateRecent = rateAll;
  if (recent.length >= 2) {
    const rFirst = recent[0];
    const rDays = Math.max(1, (last.at - rFirst.at) / 86400000);
    rateRecent = (last.used - rFirst.used) / rDays;
  }

  const ratio = rateAll > 0 ? rateRecent / rateAll : rateRecent > 0 ? 2 : 1;
  const anomalous = rateRecent >= GROWTH_MIN_RECENT && rateRecent > rateAll * GROWTH_RATIO;

  const fmt = (b: number) => `${(b / 1024 ** 3).toFixed(1)} Go`;
  const message = anomalous
    ? `Croissance anormale détectée : +${fmt(rateRecent)}/jour récemment, contre +${fmt(Math.max(0, rateAll))}/jour en moyenne.`
    : rateAll > 0
      ? `Croissance régulière : +${fmt(rateAll)}/jour en moyenne — aucune anomalie détectée.`
      : "Votre stockage diminue ou reste stable — aucune anomalie détectée.";

  return { rateAll, rateRecent, ratio, anomalous, message };
}
