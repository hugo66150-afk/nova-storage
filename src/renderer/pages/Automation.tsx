import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store";
import type { AutomationRule, DryRunResult, RuleAction, RuleCondition, RuleConditionGroup, RuleExecution } from "../../shared/types";
import { formatBytes, relativeTime } from "../../shared/types";
import {
  ACTION_OPTIONS,
  CONDITION_FIELDS,
  CONDITION_FIELDS_ORDER,
  DESTRUCTIVE_ACTIONS,
  OPERATOR_LABELS,
  SCHEDULE_LABELS,
  WEEKDAY_OPTIONS,
  nextRunAt,
  summarizeRule,
} from "../../shared/automation";
import { EmptyState, LoadingBar, Modal, Segmented } from "../components/ui";
import { ProBadge } from "../components/ProBadge";

type Schedule = AutomationRule["schedule"];
type ConditionField = RuleCondition["field"];
type ConditionOperator = RuleCondition["operator"];

interface RuleDraft {
  name: string;
  description: string;
  enabled: boolean;
  condition: RuleConditionGroup;
  actions: RuleAction[];
  schedule: Schedule;
  scheduleTime: string;
  scheduleDay: number;
}

function blankDraft(): RuleDraft {
  return {
    name: "",
    description: "",
    enabled: false,
    condition: { operator: "AND", conditions: [{ field: "category", operator: "eq", value: "temp" }] },
    actions: [{ type: "moveToQuarantine" }],
    schedule: "manual",
    scheduleTime: "02:00",
    scheduleDay: 1,
  };
}

function draftFromRule(rule: AutomationRule): RuleDraft {
  return {
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    condition: JSON.parse(JSON.stringify(rule.condition)) as RuleConditionGroup,
    actions: JSON.parse(JSON.stringify(rule.actions)) as RuleAction[],
    schedule: rule.schedule,
    scheduleTime: rule.scheduleTime ?? "02:00",
    scheduleDay: rule.scheduleDay ?? 1,
  };
}

function draftToSave(draft: RuleDraft): Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "runCount" | "lastRunAt"> {
  return {
    name: draft.name.trim() || "Règle sans nom",
    description: draft.description.trim(),
    enabled: draft.enabled,
    condition: draft.condition,
    actions: draft.actions,
    schedule: draft.schedule,
    scheduleTime: draft.schedule === "daily" || draft.schedule === "weekly" || draft.schedule === "monthly" ? draft.scheduleTime : undefined,
    scheduleDay: draft.schedule === "weekly" || draft.schedule === "monthly" ? draft.scheduleDay : undefined,
  };
}

/** Convertit une valeur octets affichée (valeur + unité) en octets. */
function bytesFromUi(value: string, unit: "Ko" | "Mo" | "Go" | "To"): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  const mult = { Ko: 1024, Mo: 1024 ** 2, Go: 1024 ** 3, To: 1024 ** 4 }[unit];
  return Math.round(n * mult);
}

/** Convertit des octets en valeur/unité lisible pour l'édition. */
function bytesToUi(bytes: number): { value: string; unit: "Ko" | "Mo" | "Go" | "To" } {
  const units: Array<["Ko" | "Mo" | "Go" | "To", number]> = [
    ["To", 1024 ** 4],
    ["Go", 1024 ** 3],
    ["Mo", 1024 ** 2],
    ["Ko", 1024],
  ];
  for (const [unit, mult] of units) {
    if (bytes >= mult) return { value: (bytes / mult).toFixed(1), unit };
  }
  return { value: String(bytes), unit: "Ko" };
}

const ENUM_CHOICES = ["eq", "neq", "in", "notIn"] as ConditionOperator[];

export function AutomationPage() {
  const { can, openPro, license, pushToast } = useApp();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [executions, setExecutions] = useState<RuleExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ draft: RuleDraft; id: number | null } | null>(null);
  const [runModal, setRunModal] = useState<{ rule: AutomationRule; mode: "dry" | "run" } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);

  const hasAccess = can("automation");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, e] = await Promise.all([window.nova.getRules(), window.nova.getRuleExecutions(undefined, 100)]);
      // La règle interne de Nova AutoClean et ses exécutions appartiennent à la
      // page AutoClean — elles ne s'affichent pas ici (évite toute confusion).
      const ac = await window.nova.getAutoCleanState();
      const acRuleId = ac.ruleId;
      setRules(acRuleId === null ? r : r.filter((x) => x.id !== acRuleId));
      setExecutions(acRuleId === null ? e : e.filter((x) => x.ruleId !== acRuleId));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const requirePro = (key: "automation" | "advancedGuardian") => {
    if (!can(key)) openPro(key);
    return can(key);
  };

  const toggleEnabled = async (rule: AutomationRule) => {
    if (!requirePro("automation")) return;
    await window.nova.updateRule({ id: rule.id, enabled: !rule.enabled });
    pushToast({
      kind: "info",
      title: rule.enabled ? "Règle désactivée" : "Règle activée",
      message: rule.enabled ? `${rule.name} ne s'exécutera plus.` : `${rule.name} s'exécutera selon sa planification.`,
    });
    await load();
  };

  const duplicateRule = (rule: AutomationRule) => {
    if (!requirePro("automation")) return;
    const draft = draftFromRule(rule);
    draft.name = `${rule.name} (copie)`;
    draft.enabled = false;
    setEditor({ draft, id: null });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await window.nova.deleteRule(deleteTarget.id);
    pushToast({ kind: "info", title: "Règle supprimée", message: deleteTarget.name });
    setDeleteTarget(null);
    await load();
  };

  if (loading) {
    return (
      <div className="loading-block-centered" style={{ maxWidth: 560, margin: "0 auto", paddingTop: 64 }}>
        <LoadingBar label="Chargement de l'automatisation…" />
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            <span className="row" style={{ gap: 10, alignItems: "center" }}>
              <span className="title-emoji">⚙️</span>
              Automatisation
              <ProBadge />
            </span>
          </h1>
          <p className="page-sub">
            Créez des règles SI/ALORS pour automatiser le nettoyage. Testez toujours en mode simulation avant toute action réelle.
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {hasAccess ? (
            <button className="btn btn-primary" onClick={() => setEditor({ draft: blankDraft(), id: null })}>
              + Nouvelle règle
            </button>
          ) : (
            <button className="btn btn-pro" onClick={() => openPro("automation")}>
              {license?.trialUsed ? "Découvrir Nova Pro" : "Commencer l'essai gratuit"}
            </button>
          )}
          <button className="btn" onClick={() => void load()}>🔄 Actualiser</button>
        </div>
      </div>

      {!hasAccess && (
        <div className="card mt-5" style={{ borderColor: "rgba(242, 182, 60, 0.35)" }}>
          <h3>L'automatisation, c'est Nova Pro</h3>
          <p className="muted" style={{ lineHeight: 1.6 }}>
            Une règle décrit une condition (fichiers anciens, gros fichiers, extensions, dossiers…) et une action
            (supprimer, déplacer vers la quarantaine…). Nova l'exécute ensuite pour vous — une fois, chaque jour,
            chaque semaine ou chaque mois — sans que vous ayez à tout faire à la main.
          </p>
          <div className="row mt-4" style={{ gap: 10 }}>
            <button className="btn btn-pro" onClick={() => openPro("automation")}>
              {license?.trialUsed ? "Passer à Nova Pro" : "Essayer Nova Pro gratuitement — 7 jours"}
            </button>
            {!license?.trialUsed && (
              <span className="xs muted" style={{ alignSelf: "center" }}>
                Sans carte bancaire · Nova Free reste gratuit pour toujours.
              </span>
            )}
          </div>
        </div>
      )}

      <div className="card mt-5">
        <h3>Règles</h3>
        {rules.length === 0 && (
          <EmptyState
            icon="⚙️"
            title="Aucune règle"
            sub={
              hasAccess
                ? "Créez votre première règle : une condition, une action, une planification."
                : "Les règles sont créées avec Nova Pro. Vos règles existantes restent sauvegardées."
            }
            action={
              hasAccess ? (
                <button className="btn btn-primary" onClick={() => setEditor({ draft: blankDraft(), id: null })}>
                  + Créer une règle
                </button>
              ) : undefined
            }
          />
        )}
        <div className="table-wrap mt-4">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              hasAccess={hasAccess}
              onEdit={() => setEditor({ draft: draftFromRule(rule), id: rule.id })}
              onDuplicate={() => duplicateRule(rule)}
              onToggle={() => void toggleEnabled(rule)}
              onSimulate={() => setRunModal({ rule, mode: "dry" })}
              onRun={() => setRunModal({ rule, mode: "run" })}
              onDelete={() => setDeleteTarget(rule)}
              onLock={() => openPro("automation")}
            />
          ))}
        </div>
      </div>

      <div className="card mt-5">
        <h3>Historique d'exécution</h3>
        {executions.length === 0 && (
          <EmptyState icon="📋" title="Aucune exécution" sub="Les simulations et exécutions de règles apparaîtront ici." />
        )}
        <div className="table-wrap mt-4">
          {executions.slice(0, 50).map((exec) => (
            <ExecutionRow key={exec.id} exec={exec} />
          ))}
        </div>
      </div>

      {editor && (
        <RuleEditorModal
          draft={editor.draft}
          isNew={editor.id === null}
          onClose={() => setEditor(null)}
          onSaved={async (id: number | null) => {
            setEditor(null);
            pushToast({
              kind: "success",
              title: id === null ? "Règle modifiée" : "Règle créée",
              message: id === null ? "La règle a été mise à jour." : "La règle est prête. Simulez-la avant de l'activer.",
            });
            await load();
          }}
          existingId={editor.id}
          pushToast={pushToast}
        />
      )}

      {runModal && (
        <RunRuleModal
          rule={runModal.rule}
          mode={runModal.mode}
          onClose={() => setRunModal(null)}
          onDone={async () => {
            setRunModal(null);
            await load();
          }}
          pushToast={pushToast}
        />
      )}

      {deleteTarget && (
        <Modal title="Supprimer la règle ?" onClose={() => setDeleteTarget(null)}>
          <p className="muted">
            La règle <strong>{deleteTarget.name}</strong> sera définitivement supprimée. Les fichiers déjà traités ne sont pas affectés.
          </p>
          <div className="row mt-4" style={{ justifyContent: "flex-end", gap: 10 }}>
            <button className="btn" onClick={() => setDeleteTarget(null)}>Annuler</button>
            <button className="btn danger" onClick={() => void confirmDelete()}>Supprimer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------- Ligne de règle ---------- */
function RuleRow({
  rule,
  hasAccess,
  onEdit,
  onDuplicate,
  onToggle,
  onSimulate,
  onRun,
  onDelete,
  onLock,
}: {
  rule: AutomationRule;
  hasAccess: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onToggle: () => void;
  onSimulate: () => void;
  onRun: () => void;
  onDelete: () => void;
  onLock: () => void;
}) {
  const next = useMemo(() => nextRunAt(rule), [rule]);
  return (
    <div className="file-row" style={{ alignItems: "flex-start", gap: 12 }}>
      <div className="flex-1" style={{ minWidth: 0 }}>
        <div className="row-between">
          <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{rule.name}</span>
            <span className={`badge ${rule.enabled ? "badge-safe" : "badge-neutral"}`}>{rule.enabled ? "Actif" : "Inactif"}</span>
            <span className="badge badge-neutral">{SCHEDULE_LABELS[rule.schedule]}</span>
          </div>
        </div>
        <div className="xs muted mt-1" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {rule.description || "Sans description"}
        </div>
        <div className="xs muted mt-1" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span>{summarizeRule(rule)}</span>
          {rule.lastRunAt && <span>Dernière exécution : {relativeTime(rule.lastRunAt)}</span>}
          {rule.runCount > 0 && <span>{rule.runCount} exécution(s)</span>}
          {next ? <span>Prochaine : {relativeTime(next)}</span> : rule.schedule !== "manual" && <span className="badge badge-neutral">Désactivé</span>}
        </div>
      </div>
      {hasAccess ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="btn btn-sm" onClick={onSimulate} title="Simuler sans rien modifier">🔍 Simuler</button>
          <button className="btn btn-sm" onClick={onRun} title="Exécuter maintenant (après confirmation)">▶ Exécuter</button>
          <button className="btn btn-sm" onClick={onEdit} title="Modifier">✏️</button>
          <button className="btn btn-sm" onClick={onDuplicate} title="Dupliquer">⧉</button>
          <button className="btn btn-sm" onClick={onToggle} title={rule.enabled ? "Désactiver" : "Activer"}>
            {rule.enabled ? "⏸ Désactiver" : "▶ Activer"}
          </button>
          <button className="btn btn-sm danger" onClick={onDelete} title="Supprimer">🗑️</button>
        </div>
      ) : (
        <button className="btn btn-sm" onClick={onLock}>✨ Nova Pro</button>
      )}
    </div>
  );
}

/* ---------- Ligne d'historique ---------- */
function ExecutionRow({ exec }: { exec: RuleExecution }) {
  const [open, setOpen] = useState(false);
  const statusBadge =
    exec.status === "completed" ? "badge-safe" : exec.status === "failed" ? "badge-risky" : exec.status === "dry-run" ? "badge-neutral" : "badge-review";
  const statusLabel =
    exec.status === "completed" ? "Terminé" : exec.status === "failed" ? "Échec" : exec.status === "dry-run" ? "Simulation" : exec.status;
  const files = exec.status === "dry-run" ? exec.dryRunCandidates.length : exec.executedCandidates.length;
  return (
    <div className="file-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
      <div className="row-between">
        <div className="flex-1" style={{ minWidth: 0 }}>
          <div className="row-between">
            <span style={{ fontWeight: 500 }}>{exec.ruleName}</span>
            <span className={`badge ${statusBadge}`}>{statusLabel}</span>
          </div>
          <div className="xs muted mt-1">
            {files} fichier(s) · {formatBytes(exec.bytesAffected)} · {relativeTime(exec.startedAt)}
          </div>
          {exec.error && <div className="xs danger mt-1">{exec.error}</div>}
        </div>
        {(exec.dryRunCandidates.length > 0 || exec.executedCandidates.length > 0) && (
          <button className="btn btn-sm" onClick={() => setOpen(!open)}>{open ? "▲ Réduire" : "▼ Détails"}</button>
        )}
      </div>
      {open && (
        <div className="xs muted" style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {(exec.status === "dry-run" ? exec.dryRunCandidates : exec.executedCandidates).slice(0, 100).map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <span className="mono" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
              <span>{formatBytes(c.size)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Éditeur de règle ---------- */
function RuleEditorModal({
  draft,
  isNew,
  existingId,
  onClose,
  onSaved,
  pushToast,
}: {
  draft: RuleDraft;
  isNew: boolean;
  existingId: number | null;
  onClose: () => void;
  onSaved: (id: number | null) => Promise<void>;
  pushToast: (t: { kind: "success" | "info" | "error" | "warning"; title: string; message?: string }) => void;
}) {
  const [d, setD] = useState<RuleDraft>(draft);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dryError, setDryError] = useState<string | null>(null);

  const setCond = (next: RuleConditionGroup) => setD((p) => ({ ...p, condition: next }));
  const setActions = (next: RuleAction[]) => setD((p) => ({ ...p, actions: next }));

  const updateCondition = (i: number, patch: Partial<RuleCondition>) => {
    const conditions = d.condition.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    setCond({ ...d.condition, conditions });
  };
  const removeCondition = (i: number) => {
    const conditions = d.condition.conditions.filter((_, idx) => idx !== i);
    setCond({ ...d.condition, conditions });
  };
  const addCondition = () => {
    setCond({ ...d.condition, conditions: [...d.condition.conditions, { field: "category", operator: "eq", value: "temp" }] });
  };

  const updateAction = (i: number, patch: Partial<RuleAction>) => {
    setActions(d.actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };
  const removeAction = (i: number) => setActions(d.actions.filter((_, idx) => idx !== i));
  const addAction = () => setActions([...d.actions, { type: "moveToQuarantine" }]);

  const simulate = async () => {
    setDryRun(null);
    setDryError(null);
    try {
      const result = await window.nova.getDryRunPreview(draftToSave(d));
      setDryRun(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDryError(msg.includes("analyse") ? "Aucune analyse disponible. Lancez d'abord une analyse de votre disque." : msg);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      if (existingId === null) {
        await window.nova.saveRule(draftToSave(d));
      } else {
        await window.nova.updateRule({ ...draftToSave(d), id: existingId });
      }
      await onSaved(existingId);
    } catch (err) {
      pushToast({ kind: "error", title: "Impossible d'enregistrer la règle", message: err instanceof Error ? err.message : String(err) });
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? "Nouvelle règle" : "Modifier la règle"} onClose={onClose} wide>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <label className="small muted" style={{ flex: 2, minWidth: 220 }}>
          Nom
          <input className="input mt-2" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Ex. Nettoyer les temp de plus de 30 jours" />
        </label>
        <label className="small muted" style={{ flex: 1, minWidth: 180 }}>
          Planification
          <Segmented<Schedule>
            options={[
              { value: "manual", label: "Manuel" },
              { value: "hourly", label: "Horaire" },
              { value: "daily", label: "Quotidien" },
              { value: "weekly", label: "Hebdo" },
              { value: "monthly", label: "Mensuel" },
            ]}
            value={d.schedule}
            onChange={(v) => setD({ ...d, schedule: v })}
          />
        </label>
      </div>

      <div className="row mt-3" style={{ gap: 10, flexWrap: "wrap" }}>
        <label className="small muted" style={{ flex: 1, minWidth: 300 }}>
          Description
          <input className="input mt-2" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="Pourquoi cette règle ? (facultatif)" />
        </label>
        {(d.schedule === "daily" || d.schedule === "weekly" || d.schedule === "monthly") && (
          <label className="small muted" style={{ minWidth: 140 }}>
            Heure
            <input type="time" className="input mt-2" value={d.scheduleTime} onChange={(e) => setD({ ...d, scheduleTime: e.target.value || "02:00" })} />
          </label>
        )}
        {d.schedule === "weekly" && (
          <label className="small muted" style={{ minWidth: 150 }}>
            Jour
            <select className="input mt-2" value={d.scheduleDay} onChange={(e) => setD({ ...d, scheduleDay: Number(e.target.value) })}>
              {WEEKDAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        )}
        {d.schedule === "monthly" && (
          <label className="small muted" style={{ minWidth: 120 }}>
            Jour du mois
            <input type="number" min={1} max={31} className="input mt-2" value={d.scheduleDay} onChange={(e) => setD({ ...d, scheduleDay: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })} />
          </label>
        )}
        <label className="small muted row" style={{ gap: 10 }}>
          <button className={`checkbox ${d.enabled ? "checked" : ""}`} style={{ width: 44, height: 24, borderRadius: 20, display: "grid", placeItems: d.enabled ? "center right" : "center left", padding: 3, transition: "all 0.2s", background: d.enabled ? "var(--accent-gradient)" : "rgba(255,255,255,0.06)" }} onClick={() => setD({ ...d, enabled: !d.enabled })} aria-pressed={d.enabled}>
            <span style={{ width: 18, height: 18, borderRadius: 50, background: "#fff", display: "block", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
          </button>
          Activer la règle
        </label>
      </div>

      <div className="rule-editor-grid mt-4">
        <div className="rule-editor-col">
          <div className="row-between">
            <h3 style={{ margin: 0 }}>SI (conditions)</h3>
            <Segmented<"AND" | "OR">
              options={[
                { value: "AND", label: "Toutes (ET)" },
                { value: "OR", label: "Au moins une (OU)" },
              ]}
              value={d.condition.operator}
              onChange={(op) => setCond({ ...d.condition, operator: op })}
            />
          </div>
          <div className="mt-3" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {d.condition.conditions.length === 0 && <div className="muted small">Aucune condition — la règle concernera tous les fichiers.</div>}
            {d.condition.conditions.map((c, i) => (
              <ConditionRow key={i} cond={c} onChange={(patch) => updateCondition(i, patch)} onRemove={() => removeCondition(i)} />
            ))}
          </div>
          <button className="btn btn-sm mt-3" onClick={addCondition}>+ Condition</button>
        </div>

        <div className="rule-editor-col">
          <h3 style={{ margin: 0 }}>ALORS (actions)</h3>
          <div className="mt-3" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {d.actions.map((a, i) => (
              <div key={i} className="rule-action-row">
                <select className="input flex-1" value={a.type} onChange={(e) => updateAction(i, { type: e.target.value as RuleAction["type"], targetPath: undefined, message: undefined })}>
                  {ACTION_OPTIONS.map((o) => (
                    <option key={o.type} value={o.type}>{o.label}</option>
                  ))}
                </select>
                {a.type === "moveToFolder" && (
                  <input className="input flex-1" placeholder="Dossier cible (ex. D:\\À trier)" value={a.targetPath ?? ""} onChange={(e) => updateAction(i, { targetPath: e.target.value })} />
                )}
                {a.type === "notify" && (
                  <input className="input flex-1" placeholder="Message de notification" value={a.message ?? ""} onChange={(e) => updateAction(i, { message: e.target.value })} />
                )}
                <button className="btn btn-sm danger" onClick={() => removeAction(i)}>✕</button>
              </div>
            ))}
          </div>
          <button className="btn btn-sm mt-3" onClick={addAction}>+ Action</button>
          {d.actions.some((a) => DESTRUCTIVE_ACTIONS.has(a.type)) && (
            <div className="xs warn mt-2">⚠ Les actions destructives respectent vos exclusions et n'affectent jamais les fichiers protégés.</div>
          )}
        </div>
      </div>

      {dryError && (
        <div className="modal-note mt-4" style={{ borderColor: "rgba(239,68,68,0.4)" }}>
          <span className="danger">{dryError}</span>
        </div>
      )}

      {dryRun && (
        <div className="dryrun-panel mt-4">
          <div className="row-between">
            <div>
              <div className="stat-label">Simulation — aucun fichier n'a été modifié</div>
              <div className="stat-value" style={{ fontSize: 22 }}>
                {dryRun.totalFiles} fichier(s) · {formatBytes(dryRun.totalBytes)}
              </div>
            </div>
            <span className="badge badge-neutral">Aperçu sur la dernière analyse</span>
          </div>
          {dryRun.warnings && dryRun.warnings.length > 0 && (
            <div className="xs warn mt-2" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {dryRun.warnings.map((w, i) => (
                <span key={i}>⚠ {w}</span>
              ))}
            </div>
          )}
          {dryRun.candidates.length > 0 && (
            <div className="xs muted mt-3" style={{ maxHeight: 170, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
              {dryRun.candidates.slice(0, 60).map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <span className="mono" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
                  <span>{formatBytes(c.size)}</span>
                </div>
              ))}
              {dryRun.candidates.length > 60 && <span>… et {dryRun.candidates.length - 60} autres</span>}
            </div>
          )}
        </div>
      )}

      <div className="row mt-4" style={{ justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
        <button className="btn" onClick={() => void simulate()} disabled={busy}>
          🔍 Simuler (dry-run)
        </button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? "Enregistrement…" : isNew ? "Créer la règle" : "Enregistrer"}
        </button>
        <button className="btn" onClick={onClose}>Annuler</button>
      </div>
    </Modal>
  );
}

/* ---------- Ligne de condition ---------- */
function ConditionRow({ cond, onChange, onRemove }: { cond: RuleCondition; onChange: (patch: Partial<RuleCondition>) => void; onRemove: () => void }) {
  const meta = CONDITION_FIELDS[cond.field as ConditionField];
  const isMulti = cond.operator === "in" || cond.operator === "notIn";
  const isEnum = meta.valueKind === "enum";

  const switchField = (field: ConditionField) => {
    const m = CONDITION_FIELDS[field];
    const op = ENUM_CHOICES.includes(m.defaultOperator) ? m.defaultOperator : m.operators[0];
    onChange({ field, operator: op, value: m.defaultValue });
  };

  const switchOperator = (op: ConditionOperator) => {
    if (op === "in" || op === "notIn") {
      onChange({ operator: op, value: isEnum ? [String(cond.value) || (meta.defaultValue as string)] : cond.value });
      return;
    }
    const current = Array.isArray(cond.value) ? cond.value[0] : cond.value;
    onChange({ operator: op, value: current ?? meta.defaultValue });
  };

  const toggleEnum = (v: string) => {
    const arr = Array.isArray(cond.value) ? (cond.value as string[]) : [String(cond.value)];
    const next = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
    onChange({ value: next.length > 0 ? next : [v] });
  };

  return (
    <div className="rule-condition-row">
      <select className="input" value={cond.field} onChange={(e) => switchField(e.target.value as ConditionField)}>
        {CONDITION_FIELDS_ORDER.map((f) => (
          <option key={f} value={f}>{CONDITION_FIELDS[f].label}</option>
        ))}
      </select>
      <select className="input" value={cond.operator} onChange={(e) => switchOperator(e.target.value as ConditionOperator)}>
        {meta.operators.map((op) => (
          <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
        ))}
      </select>
      <ConditionValue cond={cond} meta={meta} isMulti={isMulti} onChange={onChange} onToggleEnum={toggleEnum} />
      <button className="btn btn-sm danger" onClick={onRemove}>✕</button>
    </div>
  );
}

function ConditionValue({
  cond,
  meta,
  isMulti,
  onChange,
  onToggleEnum,
}: {
  cond: RuleCondition;
  meta: { valueKind: "enum" | "number" | "text"; unit?: "bytes" | "days"; enumValues?: string[]; enumLabels?: Record<string, string> };
  isMulti: boolean;
  onChange: (patch: Partial<RuleCondition>) => void;
  onToggleEnum: (v: string) => void;
}) {
  if (meta.valueKind === "enum") {
    const values = isMulti && Array.isArray(cond.value) ? (cond.value as string[]) : [String(cond.value ?? meta.enumValues?.[0])];
    if (isMulti) {
      return (
        <div className="chips flex-1">
          {meta.enumValues!.map((v) => (
            <button key={v} className={`chip ${values.includes(v) ? "active" : ""}`} onClick={() => onToggleEnum(v)}>
              {meta.enumLabels?.[v] ?? v}
            </button>
          ))}
        </div>
      );
    }
    return (
      <select className="input flex-1" value={values[0]} onChange={(e) => onChange({ value: e.target.value })}>
        {meta.enumValues!.map((v) => (
          <option key={v} value={v}>{meta.enumLabels?.[v] ?? v}</option>
        ))}
      </select>
    );
  }
  if (meta.valueKind === "number" && meta.unit === "bytes") {
    const raw = Array.isArray(cond.value) ? cond.value[0] : (cond.value as number);
    const ui = bytesToUi(typeof raw === "number" ? raw : 0);
    return (
      <div className="row flex-1" style={{ gap: 6 }}>
        <input type="number" min={0} className="input" style={{ flex: 1 }} value={ui.value} onChange={(e) => onChange({ value: bytesFromUi(e.target.value, ui.unit) })} />
        <select className="input" style={{ width: 70 }} value={ui.unit} onChange={(e) => onChange({ value: bytesFromUi(ui.value, e.target.value as "Ko" | "Mo" | "Go" | "To") })}>
          <option value="Ko">Ko</option>
          <option value="Mo">Mo</option>
          <option value="Go">Go</option>
          <option value="To">To</option>
        </select>
      </div>
    );
  }
  if (meta.valueKind === "number") {
    const raw = Array.isArray(cond.value) ? cond.value[0] : (cond.value as number);
    return (
      <div className="row flex-1" style={{ gap: 6 }}>
        <input type="number" min={0} className="input flex-1" value={typeof raw === "number" ? raw : 0} onChange={(e) => onChange({ value: Number(e.target.value) || 0 })} />
        <span className="xs muted">{meta.unit === "days" ? "jour(s)" : ""}</span>
      </div>
    );
  }
  // texte (path / extension / drive) — pour in/notIn, valeurs séparées par des virgules.
  if (isMulti && Array.isArray(cond.value)) {
    return (
      <input
        className="input flex-1"
        value={(cond.value as string[]).join(", ")}
        onChange={(e) => onChange({ value: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        placeholder="valeurs séparées par des virgules"
      />
    );
  }
  return <input className="input flex-1" value={String(cond.value ?? "")} onChange={(e) => onChange({ value: e.target.value })} placeholder="valeur" />;
}

/* ---------- Modale simulation / exécution ---------- */
function RunRuleModal({
  rule,
  mode,
  onClose,
  onDone,
  pushToast,
}: {
  rule: AutomationRule;
  mode: "dry" | "run";
  onClose: () => void;
  onDone: () => Promise<void>;
  pushToast: (t: { kind: "success" | "info" | "error" | "warning"; title: string; message?: string }) => void;
}) {
  const [preview, setPreview] = useState<DryRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ files: number; bytes: number } | null>(null);

  const ruleToDraft = (): Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "runCount" | "lastRunAt"> => ({
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    condition: rule.condition,
    actions: rule.actions,
    schedule: rule.schedule,
    scheduleTime: rule.scheduleTime,
    scheduleDay: rule.scheduleDay,
  });

  useEffect(() => {
    let cancelled = false;
    window.nova
      .getDryRunPreview(ruleToDraft())
      .then((r) => {
        if (!cancelled) setPreview(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const exec = await window.nova.runRule(rule.id, false);
      setDone({ files: exec.filesAffected, bytes: exec.bytesAffected });
      pushToast({
        kind: exec.status === "completed" ? "success" : "warning",
        title: `Règle « ${rule.name} » exécutée`,
        message: `${exec.filesAffected} fichier(s) · ${formatBytes(exec.bytesAffected)}${exec.error ? ` — ${exec.error}` : ""}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal title={mode === "dry" ? "Simulation" : "Exécution de la règle"} onClose={onClose}>
      {loading && <LoadingBar label="Calcul de l'aperçu…" />}
      {error && (
        <div className="modal-note" style={{ borderColor: "rgba(239,68,68,0.4)" }}>
          <span className="danger">{error.includes("analyse") ? "Aucune analyse disponible. Lancez d'abord une analyse de votre disque." : error}</span>
        </div>
      )}
      {preview && !done && (
        <>
          <div className="pro-trial-note mt-3" style={{ borderColor: "rgba(242,182,60,0.4)" }}>
            <strong>{preview.totalFiles} fichier(s) · {formatBytes(preview.totalBytes)}</strong> seraient concernés par cette règle
            {mode === "dry" ? " — aucun fichier n'est modifié en simulation." : " — confirmez avant toute action réelle."}
          </div>
          {preview.warnings && preview.warnings.length > 0 && (
            <div className="xs warn mt-2" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {preview.warnings.map((w, i) => (
                <span key={i}>⚠ {w}</span>
              ))}
            </div>
          )}
          {preview.candidates.length > 0 && (
            <div className="xs muted mt-3" style={{ maxHeight: 190, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
              {preview.candidates.slice(0, 50).map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <span className="mono" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
                  <span>{formatBytes(c.size)}</span>
                </div>
              ))}
              {preview.candidates.length > 50 && <span>… et {preview.candidates.length - 50} autres</span>}
            </div>
          )}
          <div className="row mt-4" style={{ justifyContent: "flex-end", gap: 10 }}>
            <button className="btn" onClick={onClose}>Fermer</button>
            {mode === "run" && (
              <button className="btn btn-primary" onClick={() => void runNow()} disabled={running}>
                {running ? "Exécution…" : "✅ Confirmer l'exécution"}
              </button>
            )}
          </div>
        </>
      )}
      {done && (
        <>
          <div className="pro-trial-note mt-3" style={{ borderColor: "rgba(34,197,94,0.4)" }}>
            ✅ Règle exécutée : {done.files} fichier(s) · {formatBytes(done.bytes)}
          </div>
          <div className="row mt-4" style={{ justifyContent: "flex-end" }}>
            <button
              className="btn btn-primary"
              onClick={async () => {
                await onDone();
                onClose();
              }}
            >
              Terminer
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
