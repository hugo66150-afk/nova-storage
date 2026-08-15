import type { RuleConditionGroup, RuleCondition, FileCandidate } from "../../shared/types.js";

export function evaluateCondition(cond: RuleCondition, candidate: FileCandidate): boolean {
  let fieldValue: string | number | undefined;

  switch (cond.field) {
    case "kind":
      fieldValue = candidate.kind;
      break;
    case "category":
      fieldValue = candidate.category;
      break;
    case "size":
      fieldValue = candidate.size;
      break;
    case "ageDays":
      fieldValue = Math.floor((Date.now() - candidate.modified) / 86400000);
      break;
    case "path":
      fieldValue = candidate.path;
      break;
    case "extension":
      fieldValue = candidate.extension.toLowerCase();
      break;
    case "drive":
      fieldValue = candidate.path.split(/[\\/]/)[0] + "\\";
      break;
    case "safety":
      fieldValue = candidate.safety;
      break;
    case "lastScanId":
      fieldValue = candidate.sourceScanId ?? 0;
      break;
    default:
      return false;
  }

  const condValue = cond.value;

  if (cond.operator === "in") {
    if (!Array.isArray(condValue)) return false;
    const arr = condValue as (string | number)[];
    if (typeof fieldValue === "string") return arr.includes(fieldValue);
    if (typeof fieldValue === "number") return arr.includes(fieldValue);
    return false;
  }
  if (cond.operator === "notIn") {
    if (!Array.isArray(condValue)) return false;
    const arr = condValue as (string | number)[];
    if (typeof fieldValue === "string") return !arr.includes(fieldValue);
    if (typeof fieldValue === "number") return !arr.includes(fieldValue);
    return false;
  }
  if (cond.operator === "contains") {
    if (typeof fieldValue !== "string" || typeof condValue !== "string") return false;
    return fieldValue.toLowerCase().includes(condValue.toLowerCase());
  }
  if (cond.operator === "startsWith") {
    if (typeof fieldValue !== "string" || typeof condValue !== "string") return false;
    return fieldValue.toLowerCase().startsWith(condValue.toLowerCase());
  }
  if (cond.operator === "endsWith") {
    if (typeof fieldValue !== "string" || typeof condValue !== "string") return false;
    return fieldValue.toLowerCase().endsWith(condValue.toLowerCase());
  }
  if (cond.operator === "matches") {
    if (typeof fieldValue !== "string" || typeof condValue !== "string") return false;
    try {
      return new RegExp(condValue).test(fieldValue);
    } catch {
      return false;
    }
  }

  if (typeof fieldValue === "number" && typeof condValue === "number") {
    switch (cond.operator) {
      case "eq":
        return fieldValue === condValue;
      case "neq":
        return fieldValue !== condValue;
      case "gt":
        return fieldValue > condValue;
      case "gte":
        return fieldValue >= condValue;
      case "lt":
        return fieldValue < condValue;
      case "lte":
        return fieldValue <= condValue;
    }
  }
  if (typeof fieldValue === "string" && typeof condValue === "string") {
    switch (cond.operator) {
      case "eq":
        return fieldValue === condValue;
      case "neq":
        return fieldValue !== condValue;
    }
  }
  return false;
}

export function evaluateConditionGroup(group: RuleConditionGroup, candidate: FileCandidate): boolean {
  const conds =
    group.operator === "AND"
      ? group.conditions.every((c) => evaluateCondition(c, candidate))
      : group.conditions.some((c) => evaluateCondition(c, candidate));
  const groups =
    group.groups && group.groups.length > 0
      ? group.operator === "AND"
        ? group.groups.every((g) => evaluateConditionGroup(g, candidate))
        : group.groups.some((g) => evaluateConditionGroup(g, candidate))
      : true;
  // Un groupe vide (aucune condition ni sous-groupe) matche tout : une règle
  // sans condition concerne tous les fichiers. Avec des sous-groupes, le
  // résultat combine conditions ET sous-groupes selon l'opérateur.
  if (!group.groups || group.groups.length === 0) return conds;
  if (group.conditions.length === 0) return groups;
  return group.operator === "AND" ? conds && groups : conds || groups;
}

/* ------------------------------------------------------------------ */
/* Pré-filtre SQL : accélère l'exécution des règles. Le filtre mémoire  */
/* (evaluateConditionGroup) reste la source de vérité : le SQL ne doit  */
/* JAMAIS exclure un candidat qui matcherait en mémoire.                */
/* ------------------------------------------------------------------ */

/** Échappe une valeur pour un LIKE avec ESCAPE '\'. */
function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

/**
 * Construit le fragment SQL d'une condition simple, en ajoutant ses
 * paramètres à `params`. Retourne null si la condition ne peut pas être
 * exprimée en SQL (elle sera alors appliquée par le filtre mémoire).
 */
export function conditionToSql(cond: RuleCondition, params: Array<string | number>): string | null {
  switch (cond.field) {
    case "kind":
      if (cond.operator === "eq") {
        params.push(String(cond.value));
        return "kind = ?";
      }
      if (cond.operator === "in" && Array.isArray(cond.value) && cond.value.length > 0) {
        params.push(...cond.value.map((v) => String(v)));
        return `kind IN (${placeholders(cond.value.length)})`;
      }
      return null;
    case "category":
      if (cond.operator === "eq") {
        params.push(String(cond.value));
        return "category = ?";
      }
      if (cond.operator === "in" && Array.isArray(cond.value) && cond.value.length > 0) {
        params.push(...cond.value.map((v) => String(v)));
        return `category IN (${placeholders(cond.value.length)})`;
      }
      return null;
    case "size": {
      const n = Number(cond.value);
      if (!Number.isFinite(n)) return null;
      if (cond.operator === "gt") {
        params.push(n);
        return "size > ?";
      }
      if (cond.operator === "gte") {
        params.push(n);
        return "size >= ?";
      }
      if (cond.operator === "lt") {
        params.push(n);
        return "size < ?";
      }
      if (cond.operator === "lte") {
        params.push(n);
        return "size <= ?";
      }
      if (cond.operator === "eq") {
        params.push(n);
        return "size = ?";
      }
      return null;
    }
    case "ageDays": {
      const n = Number(cond.value);
      if (!Number.isFinite(n)) return null;
      const cutoff = Date.now() - n * 86400000;
      // ageDays > X  <=>  modifié il y a plus de X jours  <=>  modified < cutoff
      if (cond.operator === "gt" || cond.operator === "gte") {
        params.push(cutoff);
        return "modified < ?";
      }
      if (cond.operator === "lt" || cond.operator === "lte") {
        params.push(cutoff);
        return "modified > ?";
      }
      return null;
    }
    case "path": {
      const v = String(cond.value);
      if (cond.operator === "contains" && v) {
        params.push(`%${escapeLike(v)}%`);
        return "path LIKE ? ESCAPE '\\'";
      }
      if (cond.operator === "startsWith" && v) {
        params.push(`${escapeLike(v)}%`);
        return "path LIKE ? ESCAPE '\\'";
      }
      if (cond.operator === "endsWith" && v) {
        params.push(`%${escapeLike(v)}`);
        return "path LIKE ? ESCAPE '\\'";
      }
      return null;
    }
    case "drive": {
      const v = String(cond.value);
      if (v && (cond.operator === "eq" || cond.operator === "startsWith")) {
        params.push(`${escapeLike(v)}%`);
        return "path LIKE ? ESCAPE '\\'";
      }
      return null;
    }
    case "extension": {
      const values = Array.isArray(cond.value) ? cond.value.map((v) => String(v).toLowerCase()) : [];
      if (cond.operator === "eq" && typeof cond.value === "string") {
        params.push(cond.value.toLowerCase());
        return "extension = ?";
      }
      if (cond.operator === "in" && values.length > 0) {
        params.push(...values);
        return `extension IN (${placeholders(values.length)})`;
      }
      return null;
    }
    case "safety":
      if (cond.operator === "eq") {
        params.push(String(cond.value));
        return "safety = ?";
      }
      if (cond.operator === "in" && Array.isArray(cond.value) && cond.value.length > 0) {
        params.push(...cond.value.map((v) => String(v)));
        return `safety IN (${placeholders(cond.value.length)})`;
      }
      return null;
    case "lastScanId":
      if (cond.operator === "eq") {
        params.push(Number(cond.value));
        return "scan_id = ?";
      }
      return null;
    default:
      return null;
  }
}

/**
 * Construit la clause WHERE SQL complète d'un groupe de conditions.
 * Retourne null si le groupe ne peut pas être exprimé en SQL — dans ce cas
 * le filtre mémoire fera l'intégralité du travail.
 *
 * Règle de sécurité : pour un groupe OR, une condition non exprimable rend
 * tout le pré-filtre inutilisable (il exclurait des candidats valides).
 * Pour un groupe AND, on peut omettre la condition (sur-ensemble correct).
 */
export function conditionGroupToSql(group: RuleConditionGroup, params: Array<string | number>): string | null {
  // Les sous-groupes (ex. règle interne AutoClean) ne sont pas exprimables en
  // SQL : le pré-filtre renvoie null → aucun candidat exclu, la source de
  // vérité reste le filtre mémoire evaluateConditionGroup.
  if (group.groups && group.groups.length > 0) return null;
  if (!group || !Array.isArray(group.conditions) || group.conditions.length === 0) return null;
  const frags: string[] = [];
  const local: Array<string | number> = [];
  for (const c of group.conditions) {
    const f = conditionToSql(c, local);
    if (!f) {
      if (group.operator === "AND") continue;
      // Groupe OR : une condition non exprimable invalide le pré-filtre entier.
      return null;
    }
    frags.push(f);
  }
  if (frags.length === 0) return null;
  params.push(...local);
  const op = group.operator === "OR" ? " OR " : " AND ";
  return `(${frags.join(op)})`;
}
