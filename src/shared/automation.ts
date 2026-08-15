/**
 * Helpers purs + métadonnées UI pour l'automatisation par règles.
 * Utilisés par le renderer (éditeur de règles) et testables sans Electron.
 * Aucune logique d'exécution ici : le moteur reste côté MAIN (automation.ts).
 */
import type {
  ActionType,
  AutomationRule,
  CandidateKind,
  Category,
  ConditionField,
  ConditionOperator,
} from "./types.js";
import { CATEGORY_LABELS, SAFETY_LABELS } from "./types.js";

export const SCHEDULE_LABELS: Record<AutomationRule["schedule"], string> = {
  manual: "Manuel",
  hourly: "Toutes les heures",
  daily: "Quotidien",
  weekly: "Hebdomadaire",
  monthly: "Mensuel",
};

/** Jour de semaine affiché par l'utilisateur (1 = lundi) → getDay() (0 = dimanche). */
export const WEEKDAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 0, label: "Dimanche" },
];

export const KIND_LABELS: Record<CandidateKind, string> = {
  temp: "Fichiers temporaires",
  cache: "Caches",
  recyclebin: "Corbeille",
  large: "Gros fichiers",
  old: "Fichiers anciens",
  download: "Téléchargements",
  archive: "Archives",
  duplicate: "Doublons",
  logs: "Journaux",
  crash: "Crash dumps",
  thumbnail: "Miniatures",
};

export const FIELD_LABELS: Record<ConditionField, string> = {
  kind: "Type de fichier",
  category: "Catégorie",
  size: "Taille",
  ageDays: "Âge",
  path: "Chemin",
  extension: "Extension",
  drive: "Disque",
  safety: "Sécurité",
  lastScanId: "Analyse (id)",
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  in: "dans",
  notIn: "pas dans",
  contains: "contient",
  startsWith: "commence par",
  endsWith: "se termine par",
  matches: "correspond à",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  moveToQuarantine: "Déplacer en quarantaine",
  moveToFolder: "Déplacer vers un dossier",
  deleteToRecycleBin: "Envoyer à la corbeille",
  deletePermanent: "Supprimer définitivement",
  notify: "Notifier",
  logOnly: "Journaliser uniquement",
};

/** Actions qui modifient ou suppriment des données (utilisé par l'UI pour les avertissements). */
export const DESTRUCTIVE_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "moveToQuarantine",
  "moveToFolder",
  "deleteToRecycleBin",
  "deletePermanent",
]);

export interface FieldMeta {
  label: string;
  valueKind: "enum" | "number" | "text";
  /** unité d'affichage pour valueKind === "number" (octets ou jours). */
  unit?: "bytes" | "days";
  enumValues?: string[];
  enumLabels?: Record<string, string>;
  operators: ConditionOperator[];
  defaultValue: string | number | string[];
  /** Valeur par défaut d'un opérateur adapté au champ. */
  defaultOperator: ConditionOperator;
}

const CATEGORY_VALUES = Object.keys(CATEGORY_LABELS) as Category[];
const KIND_VALUES = Object.keys(KIND_LABELS) as CandidateKind[];
const SAFETY_VALUES = Object.keys(SAFETY_LABELS);

export const CONDITION_FIELDS: Record<ConditionField, FieldMeta> = {
  category: {
    label: "Catégorie",
    valueKind: "enum",
    enumValues: CATEGORY_VALUES,
    enumLabels: CATEGORY_LABELS as Record<string, string>,
    operators: ["eq", "neq", "in", "notIn"],
    defaultValue: "temp",
    defaultOperator: "eq",
  },
  kind: {
    label: "Type de fichier",
    valueKind: "enum",
    enumValues: KIND_VALUES,
    enumLabels: KIND_LABELS as Record<string, string>,
    operators: ["eq", "neq", "in", "notIn"],
    defaultValue: "temp",
    defaultOperator: "eq",
  },
  size: {
    label: "Taille",
    valueKind: "number",
    unit: "bytes",
    operators: ["gt", "gte", "lt", "lte", "eq", "neq"],
    defaultValue: 500 * 1024 * 1024,
    defaultOperator: "gte",
  },
  ageDays: {
    label: "Âge",
    valueKind: "number",
    unit: "days",
    operators: ["gt", "gte", "lt", "lte", "eq", "neq"],
    defaultValue: 90,
    defaultOperator: "gte",
  },
  path: {
    label: "Chemin",
    valueKind: "text",
    operators: ["contains", "startsWith", "endsWith", "eq", "neq", "matches"],
    defaultValue: "",
    defaultOperator: "contains",
  },
  extension: {
    label: "Extension",
    valueKind: "text",
    operators: ["eq", "neq", "contains", "in", "notIn"],
    defaultValue: "tmp",
    defaultOperator: "eq",
  },
  drive: {
    label: "Disque",
    valueKind: "text",
    operators: ["eq", "neq", "startsWith"],
    defaultValue: "C:\\",
    defaultOperator: "eq",
  },
  safety: {
    label: "Sécurité",
    valueKind: "enum",
    enumValues: SAFETY_VALUES,
    enumLabels: SAFETY_LABELS as Record<string, string>,
    operators: ["eq", "neq"],
    defaultValue: "safe",
    defaultOperator: "eq",
  },
  lastScanId: {
    label: "Analyse (id)",
    valueKind: "number",
    operators: ["eq", "neq"],
    defaultValue: 0,
    defaultOperator: "eq",
  },
};

export const CONDITION_FIELDS_ORDER: ConditionField[] = [
  "category",
  "kind",
  "size",
  "ageDays",
  "path",
  "extension",
  "drive",
  "safety",
];

/** Liste ordonnée des actions proposées dans l'éditeur. */
export const ACTION_OPTIONS: Array<{ type: ActionType; label: string; needsTarget: boolean; needsMessage: boolean; destructive: boolean }> = [
  { type: "moveToQuarantine", label: ACTION_LABELS.moveToQuarantine, needsTarget: false, needsMessage: false, destructive: true },
  { type: "deleteToRecycleBin", label: ACTION_LABELS.deleteToRecycleBin, needsTarget: false, needsMessage: false, destructive: true },
  { type: "moveToFolder", label: ACTION_LABELS.moveToFolder, needsTarget: true, needsMessage: false, destructive: true },
  { type: "deletePermanent", label: ACTION_LABELS.deletePermanent, needsTarget: false, needsMessage: false, destructive: true },
  { type: "notify", label: ACTION_LABELS.notify, needsTarget: false, needsMessage: true, destructive: false },
  { type: "logOnly", label: ACTION_LABELS.logOnly, needsTarget: false, needsMessage: false, destructive: false },
];

/**
 * Calcule la prochaine exécution d'une règle planifiée (heure locale).
 * `manual` n'a jamais de prochaine exécution (null).
 * Les règles dont l'échéance du jour est passée passent à la période suivante.
 */
export function nextRunAt(rule: Pick<AutomationRule, "schedule" | "scheduleTime" | "scheduleDay">, now = new Date()): number | null {
  if (rule.schedule === "manual") return null;
  const [h = 2, m = 0] = (rule.scheduleTime ?? "02:00").split(":").map(Number);
  const at = (d: Date): number => {
    const c = new Date(d);
    c.setHours(h, m, 0, 0);
    return c.getTime();
  };

  if (rule.schedule === "hourly") {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.getTime();
  }

  if (rule.schedule === "daily") {
    const today = at(now);
    return today > now.getTime() ? today : at(new Date(now.getTime() + 86400000));
  }

  if (rule.schedule === "weekly") {
    const day = rule.scheduleDay ?? 0;
    for (let i = 0; i < 8; i++) {
      const candidate = new Date(now);
      candidate.setDate(now.getDate() + i);
      if (candidate.getDay() === day) {
        const t = at(candidate);
        if (t > now.getTime()) return t;
      }
    }
    return null;
  }

  // monthly : jour du mois (clampé au dernier jour si le mois n'a pas ce jour).
  const dayOfMonth = Math.max(1, Math.min(31, rule.scheduleDay ?? 1));
  for (let i = 0; i < 13; i++) {
    const candidate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const lastDay = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
    const d = Math.min(dayOfMonth, lastDay);
    const t = at(new Date(candidate.getFullYear(), candidate.getMonth(), d));
    if (t > now.getTime()) return t;
  }
  return null;
}

/** Résumé lisible d'une règle pour la liste (« 2 conditions · 1 action »). */
export function summarizeRule(rule: Pick<AutomationRule, "condition" | "actions">): string {
  const groupCount = (rule.condition.groups?.length ?? 0) + rule.condition.conditions.length;
  const conds = Math.max(1, groupCount);
  const actions = rule.actions.length;
  return `${conds} condition${conds > 1 ? "s" : ""} · ${actions} action${actions > 1 ? "s" : ""}`;
}
