import { useCallback, useEffect, useState } from "react";
import { useApp } from "../state/store";
import type { AutoCleanActionType, AutoCleanConfig, AutoCleanState, DryRunResult, RuleExecution } from "../../shared/types";
import { formatBytes, relativeTime, formatDate } from "../../shared/types";
import {
  AUTOCLEAN_ACTION_DESCRIPTIONS,
  AUTOCLEAN_ACTION_LABELS,
  AUTOCLEAN_DEFAULTS,
  summarizeAutoClean,
} from "../../shared/autoclean";
import { EmptyState, LoadingBar, Modal, Segmented } from "../components/ui";
import { ProBadge } from "../components/ProBadge";

const TRIGGER_OPTIONS: Array<{ value: AutoCleanConfig["trigger"]; label: string }> = [
  { value: "daily", label: "Chaque jour" },
  { value: "weekly", label: "Chaque semaine" },
  { value: "startup", label: "Au démarrage" },
  { value: "disk", label: "Seuil disque" },
];

const ACTION_TYPES: AutoCleanActionType[] = ["temp", "oldDownloads", "largeFiles"];

export function AutoCleanPage() {
  const { can, openPro, license, pushToast } = useApp();
  const [state, setState] = useState<AutoCleanState | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<AutoCleanConfig | null>(null);
  const [preview, setPreview] = useState<DryRunResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const hasAccess = can("automation");
  const hasSchedule = can("scheduledMaintenance");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await window.nova.getAutoCleanState();
      setState(s);
      setDraft(s.config);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleAction = (a: AutoCleanActionType) => {
    if (!draft) return;
    const actions = draft.actions.includes(a) ? draft.actions.filter((x) => x !== a) : [...draft.actions, a];
    setDraft({ ...draft, actions: actions.length > 0 ? actions : draft.actions });
  };

  const save = async (enabled: boolean) => {
    if (!draft) return;
    setRunning(true);
    try {
      const next = await window.nova.saveAutoCleanConfig({ ...draft, enabled });
      setState(next);
      setDraft(next.config);
      setPreview(null);
      pushToast({
        kind: "success",
        title: enabled ? "AutoClean activé" : "AutoClean enregistré",
        message: enabled
          ? `Nova exécutera : ${summarizeAutoClean(next.config)}.`
          : "Votre configuration est sauvegardée. Activez AutoClean pour l'exécution automatique.",
      });
    } catch (err) {
      pushToast({ kind: "error", title: "Impossible d'enregistrer", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
      setConfirmOpen(false);
    }
  };

  const simulate = async () => {
    if (!draft) return;
    setPreview(null);
    setPreviewBusy(true);
    try {
      await window.nova.saveAutoCleanConfig({ ...draft, enabled: draft.enabled });
      const r = await window.nova.runAutoClean(true);
      setPreview({
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        candidates: r.dryRunCandidates.map((c) => ({ ...c, category: "" })),
        totalBytes: r.bytesAffected,
        totalFiles: r.filesAffected,
        warnings: undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushToast({ kind: "error", title: "Simulation impossible", message: msg.includes("analyse") ? "Lancez d'abord une analyse de votre disque." : msg });
    } finally {
      setPreviewBusy(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const exec = await window.nova.runAutoClean(false);
      pushToast({
        kind: exec.status === "completed" ? "success" : "warning",
        title: "AutoClean exécuté",
        message: `${exec.filesAffected} fichier(s) · ${formatBytes(exec.bytesAffected)}${exec.error ? ` — ${exec.error}` : ""}`,
      });
      await load();
    } catch (err) {
      pushToast({ kind: "error", title: "Exécution impossible", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  };

  if (loading && !state) {
    return (
      <div className="loading-block-centered" style={{ maxWidth: 560, margin: "0 auto", paddingTop: 64 }}>
        <LoadingBar label="Chargement de Nova AutoClean…" />
      </div>
    );
  }

  if (!state || !draft) return null;

  // Écran verrouillé Free : la fonctionnalité reste visible et expliquée.
  if (!hasAccess) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">
              <span className="row" style={{ gap: 10, alignItems: "center" }}>
                <span className="title-emoji">🪄</span> AutoClean <ProBadge />
              </span>
            </h1>
            <p className="page-sub">Nova surveille votre stockage et applique automatiquement les opérations que vous avez autorisées.</p>
          </div>
        </div>
        <div className="card mt-5" style={{ borderColor: "rgba(242, 182, 60, 0.35)" }}>
          <h3>AutoClean, c'est Nova Pro</h3>
          <p className="muted" style={{ lineHeight: 1.6, maxWidth: 680 }}>
            Configurez une maintenance automatique : fichiers temporaires, téléchargements anciens, gros fichiers…
            Nova les traite selon votre planning — chaque jour, chaque semaine, au démarrage ou quand un disque dépasse
            un seuil. Tout passe d'abord par une simulation, et chaque action reste tracée dans l'historique.
          </p>
          <div className="row mt-4" style={{ gap: 10 }}>
            <button className="btn btn-pro" onClick={() => openPro("automation")}>
              {license?.trialUsed ? "Passer à Nova Pro" : "Essayer Nova Pro gratuitement — 7 jours"}
            </button>
            {!license?.trialUsed && <span className="xs muted" style={{ alignSelf: "center" }}>Sans carte bancaire · Nova Free reste gratuit pour toujours.</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">              <span className="row" style={{ gap: 10, alignItems: "center" }}>
                <span className="title-emoji">🪄</span> AutoClean <ProBadge />
              </span>
            </h1>
            <p className="page-sub">
              Nova surveille votre stockage et applique automatiquement les opérations que vous avez autorisées.
            </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn" onClick={() => void simulate()} disabled={previewBusy || running}>
            {previewBusy ? "Calcul…" : "🔍 Simuler (dry-run)"}
          </button>
          {!draft.enabled ? (
            <button className="btn btn-primary" onClick={() => setConfirmOpen(true)} disabled={running}>
              ▶ Activer AutoClean
            </button>
          ) : (
            <button className="btn" onClick={() => void save(false)} disabled={running}>
              ⏸ Désactiver
            </button>
          )}
        </div>
      </div>

      {/* État actuel */}
      <div className="card hero mb-5" style={{ borderColor: draft.enabled ? "rgba(34,197,94,0.35)" : "var(--border)" }}>
        <div className="row-between" style={{ flexWrap: "wrap", gap: 16 }}>
          <div>
            <div className="stat-label">État</div>
            <div className="row mt-2" style={{ gap: 12 }}>
              <span className={`badge ${draft.enabled ? "badge-safe" : "badge-neutral"}`}>{draft.enabled ? "🟢 Actif" : "⚪ Désactivé"}</span>
              <span className="tag">{summarizeAutoClean(draft)}</span>
            </div>
            <div className="xs muted mt-2" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <span>Dernière exécution : {state.lastRunAt ? relativeTime(state.lastRunAt) : "Jamais"}</span>
              {state.nextRunAt && <span>Prochaine : {formatDate(state.nextRunAt)}</span>}
              {!hasSchedule && draft.enabled && (
                <span className="warn">⚠ L'exécution planifiée requiert Nova Pro — elle reprendra dès l'activation d'une licence.</span>
              )}
            </div>
          </div>
          <div style={{ maxWidth: 420 }}>
            <div className="stat-label">Sécurité</div>
            <div className="xs muted mt-2" style={{ lineHeight: 1.6 }}>
              Les fichiers protégés et vos exclusions ne sont jamais touchés. Chaque action est d'abord simulée puis
              tracée dans l'historique. Par défaut, les fichiers sont déplacés en quarantaine (restaurables).
            </div>
          </div>
        </div>
      </div>

      <div className="grid mt-5" style={{ gridTemplateColumns: "1.1fr 1fr" }}>
        {/* Configuration */}
        <div className="card">
          <h3>Configuration</h3>
          <div className="card-sub">Ce que Nova fera automatiquement.</div>

          <div className="mt-4">
            <div className="small muted">Déclencheur</div>
            <div className="mt-2">
              <Segmented<AutoCleanConfig["trigger"]> options={TRIGGER_OPTIONS} value={draft.trigger} onChange={(v) => setDraft({ ...draft, trigger: v })} />
            </div>
            {(draft.trigger === "daily" || draft.trigger === "weekly") && (
              <div className="row mt-3" style={{ gap: 10 }}>
                <label className="small muted" style={{ minWidth: 130 }}>
                  Heure
                  <input type="time" className="input mt-2" value={draft.triggerTime} onChange={(e) => setDraft({ ...draft, triggerTime: e.target.value || AUTOCLEAN_DEFAULTS.triggerTime })} />
                </label>
                {draft.trigger === "weekly" && (
                  <label className="small muted" style={{ minWidth: 150 }}>
                    Jour
                    <select className="input mt-2" value={draft.triggerDay} onChange={(e) => setDraft({ ...draft, triggerDay: Number(e.target.value) })}>
                      {["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"].map((label, i) => (
                        <option key={i} value={i}>{label}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
            {draft.trigger === "disk" && (
              <label className="small muted mt-3" style={{ display: "block", minWidth: 150 }}>
                Seuil d'utilisation du disque
                <select className="input mt-2" value={draft.triggerPct} onChange={(e) => setDraft({ ...draft, triggerPct: Number(e.target.value) })}>
                  {[80, 85, 90].map((p) => (
                    <option key={p} value={p}>{p} %</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="mt-4">
            <div className="small muted">Opérations automatiques</div>
            <div className="mt-2" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ACTION_TYPES.map((a) => (
                <label key={a} className="file-row" style={{ cursor: "pointer", gap: 12 }}>
                  <button
                    className={`checkbox ${draft.actions.includes(a) ? "checked" : ""}`}
                    style={{ width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center", border: "1px solid var(--border-strong)", background: draft.actions.includes(a) ? "var(--accent-gradient)" : "rgba(255,255,255,0.05)" }}
                    onClick={() => toggleAction(a)}
                    aria-pressed={draft.actions.includes(a)}
                  >
                    {draft.actions.includes(a) && <span style={{ color: "#fff", fontSize: 13 }}>✓</span>}
                  </button>
                  <div className="flex-1">
                    <div style={{ fontWeight: 600 }}>{AUTOCLEAN_ACTION_LABELS[a]}</div>
                    <div className="xs muted">{AUTOCLEAN_ACTION_DESCRIPTIONS[a]}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {(draft.actions.includes("oldDownloads") || draft.actions.includes("largeFiles")) && (
            <div className="row mt-3" style={{ gap: 12 }}>
              {draft.actions.includes("oldDownloads") && (
                <label className="small muted">
                  Ancienneté (jours)
                  <input type="number" min={1} max={3650} className="input mt-2" style={{ width: 110 }} value={draft.oldDownloadsDays} onChange={(e) => setDraft({ ...draft, oldDownloadsDays: Math.max(1, Number(e.target.value) || 30) })} />
                </label>
              )}
              {draft.actions.includes("largeFiles") && (
                <label className="small muted">
                  Seuil des gros fichiers (Go)
                  <input type="number" min={0.1} max={1024} step={0.1} className="input mt-2" style={{ width: 110 }} value={draft.largeFilesGo} onChange={(e) => setDraft({ ...draft, largeFilesGo: Math.max(0.1, Number(e.target.value) || 1) })} />
                </label>
              )}
            </div>
          )}

          <div className="mt-4">
            <div className="small muted">Action appliquée aux fichiers ciblés</div>
            <div className="mt-2">
              <Segmented<AutoCleanConfig["action"]>
                options={[
                  { value: "quarantine", label: "🛡️ Quarantaine (restaurable)" },
                  { value: "recycleBin", label: "🗑️ Corbeille Windows" },
                ]}
                value={draft.action}
                onChange={(v) => setDraft({ ...draft, action: v })}
              />
            </div>
          </div>

          <div className="row mt-4" style={{ gap: 10 }}>
            <button className="btn" onClick={() => void save(draft.enabled)} disabled={running}>
              💾 Enregistrer la configuration
            </button>
            {draft.enabled && (
              <button className="btn btn-primary" onClick={() => void runNow()} disabled={running}>
                {running ? "Exécution…" : "▶ Exécuter maintenant"}
              </button>
            )}
          </div>
        </div>

        {/* Aperçu + historique */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {preview ? (
            <div className="card">
              <h3>🔍 Simulation — aucun fichier modifié</h3>
              <div className="stat-value mt-2" style={{ fontSize: 24 }}>
                {preview.totalFiles} fichier(s) · {formatBytes(preview.totalBytes)}
              </div>
              {preview.candidates.length > 0 && (
                <div className="xs muted mt-3" style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                  {preview.candidates.slice(0, 40).map((c, i) => (
                    <div key={i} style={{ display: "flex", gap: 8 }}>
                      <span className="mono" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
                      <span>{formatBytes(c.size)}</span>
                    </div>
                  ))}
                  {preview.candidates.length > 40 && <span>… et {preview.candidates.length - 40} autres</span>}
                </div>
              )}
              {preview.candidates.length === 0 && <div className="muted small mt-3">Aucun fichier ne correspond sur la dernière analyse.</div>}
            </div>
          ) : (
            <div className="card">
              <h3>🔍 Simulation</h3>
              <p className="muted small mt-2" style={{ lineHeight: 1.6 }}>
                Avant d'activer AutoClean, lancez une simulation : Nova affiche le nombre de fichiers concernés et
                l'espace récupérable, sans rien modifier sur le disque.
              </p>
              <button className="btn mt-3" onClick={() => void simulate()} disabled={previewBusy}>
                {previewBusy ? "Calcul…" : "🔍 Simuler maintenant"}
              </button>
            </div>
          )}

          <div className="card">
            <h3>📋 Historique AutoClean</h3>
            {state.executions.length === 0 && (
              <EmptyState icon="🪄" title="Aucune exécution" sub="Les exécutions d'AutoClean apparaîtront ici, avec fichiers et espace traités." />
            )}
            <div className="table-wrap mt-4">
              {state.executions.slice(0, 20).map((exec) => (
                <AutoCleanExecRow key={exec.id} exec={exec} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {confirmOpen && (
        <Modal title="Activer Nova AutoClean ?" onClose={() => setConfirmOpen(false)}>
          <p className="muted" style={{ lineHeight: 1.6 }}>
            Nova exécutera : <strong>{summarizeAutoClean(draft)}</strong>.
            <br />
            Chaque opération est d'abord simulée, respecte vos exclusions et les fichiers protégés, et utilise la
            quarantaine restaurable par défaut. Toutes les actions sont tracées dans l'historique.
          </p>
          <div className="row mt-4" style={{ justifyContent: "flex-end", gap: 10 }}>
            <button className="btn" onClick={() => setConfirmOpen(false)}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void save(true)} disabled={running}>
              ✅ Activer AutoClean
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AutoCleanExecRow({ exec }: { exec: RuleExecution }) {
  const statusBadge = exec.status === "completed" ? "badge-safe" : exec.status === "failed" ? "badge-risky" : exec.status === "dry-run" ? "badge-neutral" : "badge-review";
  const files = exec.status === "dry-run" ? exec.dryRunCandidates.length : exec.executedCandidates.length;
  return (
    <div className="file-row" style={{ alignItems: "flex-start", gap: 12 }}>
      <span className={`badge ${statusBadge}`}>{exec.status === "completed" ? "Terminé" : exec.status === "dry-run" ? "Simulation" : exec.status}</span>
      <div className="flex-1">
        <div className="xs muted">{relativeTime(exec.startedAt)}</div>
        <div className="small">{files} fichier(s) · {formatBytes(exec.bytesAffected)}</div>
        {exec.error && <div className="xs danger mt-1">{exec.error}</div>}
      </div>
    </div>
  );
}
