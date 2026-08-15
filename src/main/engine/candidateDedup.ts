import type { CandidateKind } from "../../shared/types.js";

export interface KindedCandidate {
  path: string;
  kind: CandidateKind;
  size: number;
}

/**
 * Priorité de classification d'un fichier qui correspond à plusieurs listes.
 * Un fichier n'est émis qu'une seule fois, avec le kind le plus spécifique :
 * temp > cache > download > archive > old > large. Ça évite les doublons
 * multi-kind (le même fichier compté dans temp ET large, etc.).
 */
export const KIND_PRIORITY: Record<CandidateKind, number> = {
  temp: 6,
  cache: 5,
  download: 4,
  archive: 3,
  old: 2,
  large: 1,
  recyclebin: 0,
  duplicate: 0,
  logs: 0,
  crash: 0,
  thumbnail: 0,
};

/** Déduplique les candidats par chemin : le kind de plus haute priorité gagne. */
export function dedupeCandidates<T extends KindedCandidate>(list: T[]): T[] {
  const best = new Map<string, T>();
  for (const c of list) {
    const existing = best.get(c.path);
    if (!existing || KIND_PRIORITY[c.kind] > KIND_PRIORITY[existing.kind]) {
      best.set(c.path, c);
    }
  }
  return [...best.values()].sort((a, b) => b.size - a.size);
}
