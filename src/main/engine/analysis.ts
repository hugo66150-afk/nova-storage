import type {
  CandidateKind,
  FileCandidate,
  RecoverableSummary,
  RecommendationGroup,
  SafetyLevel,
} from "../../shared/types.js";

const KIND_TITLES: Record<CandidateKind, string> = {
  temp: "Fichiers temporaires",
  cache: "Caches d'applications",
  recyclebin: "Corbeille",
  large: "Fichiers volumineux",
  old: "Fichiers anciens",
  download: "Téléchargements",
  archive: "Archives",
  duplicate: "Doublons",
  logs: "Fichiers journaux",
  crash: "Rapports d'erreur",
  thumbnail: "Miniatures",
};

const KIND_DESCRIPTIONS: Record<CandidateKind, string> = {
  temp: "Ces fichiers sont utilisés temporairement par Windows ou certaines applications et peuvent généralement être recréés.",
  cache: "Ces caches sont recréés automatiquement par les applications lors de leur prochain usage.",
  recyclebin: "La corbeille conserve vos fichiers supprimés. La vider libère de l'espace définitivement.",
  large: "Ces fichiers volumineux méritent une vérification : déplacez-les, archivez-les ou supprimez-les.",
  old: "Ces fichiers n'ont pas été modifiés depuis longtemps. Un fichier ancien n'est pas forcément inutile.",
  download: "Vos téléchargements accumulés occupent de la place. Vérifiez avant suppression.",
  archive: "Ces archives volumineuses peuvent être déplacées vers un stockage externe.",
  duplicate: "Des copies identiques de fichiers existent à plusieurs endroits.",
  logs: "Les fichiers journaux d'applications peuvent être supprimés sans risque.",
  crash: "Les rapports d'erreur peuvent être supprimés en toute sécurité.",
  thumbnail: "Les miniatures Windows se recréent automatiquement.",
};

const KIND_RISK: Record<CandidateKind, SafetyLevel> = {
  temp: "safe",
  cache: "safe",
  recyclebin: "review",
  large: "review",
  old: "review",
  download: "review",
  archive: "review",
  duplicate: "review",
  logs: "safe",
  crash: "safe",
  thumbnail: "safe",
};

export function getKindMeta(kind: CandidateKind): { title: string; description: string; risk: SafetyLevel; confidence: number } {
  return {
    title: KIND_TITLES[kind],
    description: KIND_DESCRIPTIONS[kind],
    risk: KIND_RISK[kind],
    confidence: kind === "temp" || kind === "cache" ? 92 : kind === "download" ? 70 : 55,
  };
}

export function buildRecoverable(candidates: FileCandidate[]): RecoverableSummary {
  const byKind: Record<CandidateKind, number> = {
    temp: 0,
    cache: 0,
    recyclebin: 0,
    large: 0,
    old: 0,
    download: 0,
    archive: 0,
    duplicate: 0,
    logs: 0,
    crash: 0,
    thumbnail: 0,
  };
  const byKindCount: Record<CandidateKind, number> = {
    temp: 0,
    cache: 0,
    recyclebin: 0,
    large: 0,
    old: 0,
    download: 0,
    archive: 0,
    duplicate: 0,
    logs: 0,
    crash: 0,
    thumbnail: 0,
  };
  for (const c of candidates) {
    byKind[c.kind] += c.size;
    byKindCount[c.kind] += 1;
  }

  const groups: RecommendationGroup[] = (
    [
      "temp",
      "cache",
      "recyclebin",
      "download",
      "large",
      "old",
      "archive",
      "duplicate",
      "logs",
      "crash",
      "thumbnail",
    ] as CandidateKind[]
  )
    .map((kind) => ({
      key: kind,
      title: KIND_TITLES[kind],
      description: KIND_DESCRIPTIONS[kind],
      risk: KIND_RISK[kind],
      confidence: kind === "temp" || kind === "cache" ? 92 : kind === "download" ? 70 : 55,
      bytes: byKind[kind],
      files: byKindCount[kind],
    }))
    .filter((g) => g.bytes > 0);

  const totalBytes = Object.values(byKind).reduce((a, b) => a + b, 0);
  return { totalBytes, byKind, groups };
}

/** Construit un RecoverableSummary depuis des agrégats SQL GROUP BY kind. */
export function buildRecoverableFromSummary(
  summary: Array<{ kind: CandidateKind; bytes: number; files: number }>,
): RecoverableSummary {
  const byKind: Record<CandidateKind, number> = {
    temp: 0,
    cache: 0,
    recyclebin: 0,
    large: 0,
    old: 0,
    download: 0,
    archive: 0,
    duplicate: 0,
    logs: 0,
    crash: 0,
    thumbnail: 0,
  };
  const byKindCount: Record<CandidateKind, number> = {
    temp: 0,
    cache: 0,
    recyclebin: 0,
    large: 0,
    old: 0,
    download: 0,
    archive: 0,
    duplicate: 0,
    logs: 0,
    crash: 0,
    thumbnail: 0,
  };
  for (const s of summary) {
    byKind[s.kind] += s.bytes;
    byKindCount[s.kind] += s.files;
  }
  const groups: RecommendationGroup[] = (
    [
      "temp",
      "cache",
      "recyclebin",
      "download",
      "large",
      "old",
      "archive",
      "duplicate",
      "logs",
      "crash",
      "thumbnail",
    ] as CandidateKind[]
  )
    .map((kind) => ({
      key: kind,
      title: KIND_TITLES[kind],
      description: KIND_DESCRIPTIONS[kind],
      risk: KIND_RISK[kind],
      confidence: kind === "temp" || kind === "cache" ? 92 : kind === "download" ? 70 : 55,
      bytes: byKind[kind],
      files: byKindCount[kind],
    }))
    .filter((g) => g.bytes > 0);
  const totalBytes = Object.values(byKind).reduce((a, b) => a + b, 0);
  return { totalBytes, byKind, groups };
}
