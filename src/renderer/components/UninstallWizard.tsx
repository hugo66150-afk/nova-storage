import { useEffect, useRef, useState } from "react";
import type {
  AppInfo,
  CleanRemainsResult,
  RemainConfidence,
  UninstallAnalysis,
  UninstallProgress,
  UninstallRemain,
  UninstallRunResult,
} from "../../shared/types";
import { formatBytes, formatNumber } from "../../shared/types";
import { useApp } from "../state/store";
import { Modal, ProgressBar } from "./ui";

const CONF_META: Record<RemainConfidence, { icon: string; label: string; cls: string }> = {
  certain: { icon: "🟢", label: "Certain", cls: "badge-safe" },
  likely: { icon: "🟢", label: "Très probable", cls: "badge-safe" },
  examine: { icon: "🟡", label: "À examiner", cls: "badge-review" },
  uncertain: { icon: "🟠", label: "Incertain", cls: "badge-caution" },
  protected: { icon: "🛡️", label: "Protégé / partagé", cls: "badge-protected" },
};

const KIND_LABEL: Record<string, string> = {
  file: "Fichier",
  folder: "Dossier",
  registry: "Registre",
  service: "Service",
  task: "Tâche",
  startup: "Démarrage",
};

export function UninstallWizard({
  app,
  mode,
  onClose,
}: {
  app: AppInfo;
  mode: "simple" | "advanced";
  onClose: () => void;
}) {
  const { pushToast } = useApp();
  const [analysis, setAnalysis] = useState<UninstallAnalysis | null>(null);
  const [phase, setPhase] = useState<UninstallProgress | null>(null);
  const [step, setStep] = useState<"pre" | "running" | "remains" | "cleaning" | "error">("pre");
  const [runResult, setRunResult] = useState<UninstallRunResult | null>(null);
  const [remains, setRemains] = useState<UninstallRemain[]>([]);
  const [cleanRes, setCleanRes] = useState<CleanRemainsResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [cleanPct, setCleanPct] = useState(0);
  const sessionId = useRef<string>("");

  useEffect(() => {
    let off = () => {};
    void window.nova
      .preAnalyzeApp(app)
      .then(async (a) => {
        setAnalysis(a);
        sessionId.current = a.sessionId;
        off = window.nova.onUninstallProgress((p) => {
          setPhase(p);
          if (p.phase === "cleaning") setCleanPct(p.percent);
        });
        if (mode === "simple") {
          await startUninstall(a.sessionId);
        }
      })
      .catch((e) => {
        setStep("error");
        setError((e as Error).message);
      });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startUninstall = async (sid?: string) => {
    const id = sid ?? sessionId.current;
    if (!id) return;
    setStep("running");
    setError(null);
    try {
      const result = await window.nova.runUninstaller(id);
      setRunResult(result);
      const r = await window.nova.getRemains(id);
      setRemains(r);
      setStep("remains");
    } catch (e) {
      setStep("error");
      setError((e as Error).message);
    }
  };

  const clean = async () => {
    if (selected.size === 0 || !sessionId.current) return;
    setStep("cleaning");
    setCleanPct(0);
    try {
      const res = await window.nova.cleanRemains(sessionId.current, Array.from(selected));
      setCleanRes(res);
      setRemains(res.items);
      setSelected(new Set());
      const handled = res.handled ?? res.moved + res.registryExported;
      if (handled > 0) {
        const parts: string[] = [];
        if (res.moved > 0) parts.push(`${res.moved} fichier(s)/dossier(s) déplacé(s) en quarantaine (${formatBytes(res.bytesQuarantined)})`);
        if (res.registryExported > 0) parts.push(`${res.registryExported} clé(s) de registre supprimée(s) (sauvegardées en .reg)`);
        pushToast({
          kind: "success",
          title: "Restes traités",
          message: `${parts.join(" · ")}.${res.failed > 0 ? ` ${res.failed} élément(s) non supprimé(s) (permissions).` : ""}`,
        });
      } else {
        pushToast({
          kind: "warning",
          title: "Restes non supprimés",
          message: `Aucun élément n'a pu être nettoyé${res.failed > 0 ? ` (${res.failed} refus, permissions administrateur requises ?)` : ""}.`,
        });
      }
      setStep("remains");
    } catch (e) {
      setError((e as Error).message);
      setStep("remains");
    }
  };

  const restore = async () => {
    if (!sessionId.current) return;
    try {
      const res = await window.nova.restoreQuarantine(sessionId.current);
      pushToast({
        kind: res.restored > 0 ? "success" : "info",
        title: "Restauration",
        message: `${res.restored} élément(s) restauré(s)${res.failed > 0 ? `, ${res.failed} échec(s)` : ""}.`,
      });
      const r = await window.nova.getRemains(sessionId.current);
      setRemains(r);
    } catch (e) {
      pushToast({ kind: "error", title: "Restauration impossible", message: (e as Error).message });
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selSelectable = remains.filter((r) => selected.has(r.id) && r.exists && r.confidence !== "protected").length;

  return (
    <Modal title={`Désinstaller ${app.name}`} onClose={onClose} wide>
      {step === "pre" && !analysis && (
        <div style={{ padding: "16px 4px" }}>
          <div className="row-between mb-2">
            <strong>Analyse de l'application…</strong>
            <span className="small" style={{ fontWeight: 650 }}>…</span>
          </div>
          <ProgressBar value={14} indeterminate height={12} />
          <p className="small muted mt-3">
            Nova inspecte le dossier d'installation, les données utilisateur et le registre pour établir un état de référence.
          </p>
        </div>
      )}
      {step === "pre" && analysis && (
        <PreScreen analysis={analysis} app={app} onCancel={onClose} onUninstall={() => void startUninstall()} />
      )}
      {step === "running" && (
        <div style={{ padding: "12px 4px" }}>
          <div className="row-between mb-2">
            <strong>{phase?.label ?? "Désinstallation en cours…"}</strong>
            <span className="small" style={{ fontWeight: 650 }}>{phase ? `${phase.percent}%` : "…"}</span>
          </div>
          <ProgressBar value={phase?.percent ?? 12} indeterminate={!phase || phase.percent === 0} height={12} />
          <p className="small muted mt-3">
            {phase?.detail ?? "Nova exécute le désinstallateur officiel de l'application. Une fenêtre d'installation peut s'ouvrir : suivez ses instructions."}
          </p>
        </div>
      )}
      {step === "remains" && (
        <RemainsScreen
          app={app}
          runResult={runResult}
          remains={remains}
          cleanRes={cleanRes}
          selected={selected}
          selSelectable={selSelectable}
          onToggle={toggle}
          onClean={() => void clean()}
          onRestore={() => void restore()}
          onClose={onClose}
          onRetry={() => void startUninstall()}
        />
      )}
      {step === "cleaning" && (
        <div style={{ padding: "12px 4px" }}>
          <div className="row-between mb-2">
            <strong>Nettoyage des restes</strong>
            <span className="small" style={{ fontWeight: 650 }}>{Math.round(cleanPct)}%</span>
          </div>
          <ProgressBar value={cleanPct > 0 ? cleanPct : 8} indeterminate={cleanPct === 0} height={12} />
          <p className="small muted mt-3">
            {phase?.label && phase.phase === "cleaning" ? phase.label : "Déplacement des restes vers la quarantaine Nova…"}
          </p>
        </div>
      )}
      {step === "error" && (
        <div className="insight warning" style={{ marginBottom: 16 }}>
          <span className="insight-ico">⚠️</span>
          <div>
            <div className="insight-title">Échec de la désinstallation</div>
            <p className="insight-msg">{error}</p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function PreScreen({
  analysis,
  app,
  onCancel,
  onUninstall,
}: {
  analysis: UninstallAnalysis;
  app: AppInfo;
  onCancel: () => void;
  onUninstall: () => void;
}) {
  const rows = [
    { label: "Application", value: analysis.breakdown.install, icon: "📦" },
    { label: "Données utilisateur", value: analysis.breakdown.userData, icon: "🗂" },
    { label: "Données programme", value: analysis.breakdown.programData, icon: "🖥" },
    { label: "Cache", value: analysis.breakdown.cache, icon: "🧹" },
  ];
  return (
    <div>
      <div className="row mt-2 mb-4" style={{ gap: 14, flexWrap: "wrap" }}>
        {rows
          .filter((r) => r.value > 0)
          .map((r) => (
            <div key={r.label} className="stat-card" style={{ flex: "1 1 160px", animation: "none" }}>
              <div className="stat-label">
                <span>{r.icon}</span>
                {r.label}
              </div>
              <div className="stat-value">{formatBytes(r.value)}</div>
            </div>
          ))}
      </div>

      <div className="insight info" style={{ marginBottom: 16 }}>
        <span className="insight-ico">🔍</span>
        <div>
          <div className="insight-title">Nova a identifié l'état de référence</div>
          <p className="insight-msg">
            {formatNumber(analysis.items.length)} élément(s) associés à <b>{app.name}</b>. Après la désinstallation, Nova analysera les restes et ne
            proposera la suppression que des éléments à correspondance fiable.
          </p>
          {app.installLocation && (
            <div className="xs muted mt-2" style={{ wordBreak: "break-all" }}>
              Emplacement : <span className="mono">{app.installLocation}</span>
            </div>
          )}
        </div>
      </div>

      <div className="insight info" style={{ marginBottom: 24 }}>
        <span className="insight-ico">🗑</span>
        <div>
          <div className="insight-title">Le désinstallateur officiel sera utilisé</div>
          <p className="insight-msg">
            {analysis.uninstaller.type === "msi"
              ? "Nova exécutera msiexec (Windows Installer) avec le code produit officiel."
              : analysis.uninstaller.command
                ? "Nova exécutera le désinstallateur fourni par l'éditeur, puis vérifiera les restes."
                : "Aucun désinstallateur officiel n'a été détecté : Nova ne peut pas désinstaller cette application."}
          </p>
          {analysis.uninstaller.command && (
            <div className="xs muted mt-2" style={{ wordBreak: "break-all" }}>
              Commande : <span className="mono">{analysis.uninstaller.command}</span>
            </div>
          )}
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>
        <button className="btn btn-danger" onClick={onUninstall} disabled={!analysis.uninstaller.command && analysis.uninstaller.type !== "msi"}>
          🗑 Désinstaller {formatBytes(analysis.totalBytes) === "0 o" ? "" : `(${formatBytes(analysis.totalBytes)})`}
        </button>
      </div>
    </div>
  );
}

function RemainsScreen({
  app,
  runResult,
  remains,
  cleanRes,
  selected,
  selSelectable,
  onToggle,
  onClean,
  onRestore,
  onClose,
  onRetry,
}: {
  app: AppInfo;
  runResult: UninstallRunResult | null;
  remains: UninstallRemain[];
  cleanRes: CleanRemainsResult | null;
  selected: Set<string>;
  selSelectable: number;
  onToggle: (id: string) => void;
  onClean: () => void;
  onRestore: () => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const statusCfg: Record<string, { icon: string; label: string; tone: string }> = {
    success: { icon: "✅", label: "Application désinstallée", tone: "var(--good)" },
    alreadyGone: { icon: "ℹ️", label: "Déjà désinstallée", tone: "var(--info)" },
    cancelled: { icon: "↩️", label: "Désinstallation annulée", tone: "var(--warn)" },
    failed: { icon: "❌", label: "Échec de la désinstallation", tone: "var(--danger)" },
    pending: { icon: "⏳", label: "Désinstalleur toujours actif", tone: "var(--warn)" },
    restartRequired: { icon: "🔄", label: "Redémarrage requis", tone: "var(--warn)" },
  };
  const cfg = statusCfg[runResult?.status ?? "success"] ?? statusCfg.success;
  const existing = remains.filter((r) => r.exists);
  const recovered = (cleanRes?.bytesQuarantined ?? 0) + (runResult?.status === "success" ? app.size : 0);

  return (
    <div>
      <div
        className="insight"
        style={{ marginBottom: 16, borderLeft: `3px solid ${cfg.tone}`, background: "var(--bg-glass)" }}
      >
        <span className="insight-ico">{cfg.icon}</span>
        <div>
          <div className="insight-title" style={{ color: cfg.tone }}>{cfg.label}</div>
          <p className="insight-msg">{runResult?.message}</p>
        </div>
      </div>

      {runResult?.status === "pending" && (
        <div className="modal-note" style={{ marginBottom: 16 }}>
          Terminez le désinstallateur, puis <button className="btn btn-sm btn-ghost" onClick={onRetry}>vérifiez à nouveau</button>
        </div>
      )}

      <div className="row-between mb-2">
        <h3 style={{ margin: 0 }}>Restes détectés</h3>
        <div className="row" style={{ gap: 10 }}>
          <span className="tag">{formatBytes(existing.reduce((a, r) => a + r.size, 0))}</span>
          <span className="tag">{existing.length} élément(s)</span>
        </div>
      </div>

      {existing.length === 0 ? (
        <div className="insight positive" style={{ marginBottom: 16 }}>
          <span className="insight-ico">✨</span>
          <div>
            <div className="insight-title">Aucun reste détecté</div>
            <p className="insight-msg">Nova n'a trouvé aucun élément associé encore présent après la désinstallation.</p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
          {remainingRows(remains).map((r) => {
            const meta = CONF_META[r.confidence];
            const disabled = r.confidence === "protected" || !r.exists;
            return (
              <div
                key={r.id}
                className="file-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  opacity: r.exists ? 1 : 0.55,
                }}
              >
                {disabled ? (
                  <span style={{ width: 18 }} />
                ) : (
                  <div className={`checkbox ${selected.has(r.id) ? "checked" : ""}`} onClick={() => onToggle(r.id)}>
                    {selected.has(r.id) ? "✓" : ""}
                  </div>
                )}
                <span className={`badge ${meta.cls}`} style={{ whiteSpace: "nowrap" }}>
                  {meta.icon} {meta.label}
                </span>
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.label}</div>
                  <div className="path-cell">{r.path}</div>
                  {r.note && <div className="xs muted" style={{ marginTop: 2 }}>{r.note}</div>}
                </div>
                <span className="tag" style={{ whiteSpace: "nowrap" }}>{formatBytes(r.size)}</span>
                <span className="xs muted" style={{ width: 84, textAlign: "right" }}>{KIND_LABEL[r.kind]}</span>
              </div>
            );
          })}
        </div>
      )}

      {cleanRes && (
        <div className="insight info" style={{ marginBottom: 8 }}>
          <span className="insight-ico">🗄</span>
          <div>
            <div className="insight-title">Éléments déplacés en quarantaine (restaurables)</div>
            <p className="insight-msg">
              {formatBytes(cleanRes.bytesQuarantined)} mis de côté · {cleanRes.registryExported} clé(s) de registre sauvegardée(s) en .reg.
            </p>
          </div>
        </div>
      )}

      <div className="modal-note" style={{ marginBottom: 8 }}>
        <strong>Prudence</strong> — les éléments « Protégé / partagé » ne sont jamais supprimés automatiquement. Les éléments
        sélectionnés sont <strong>déplacés vers la quarantaine Nova</strong> (jamais détruits immédiatement) et sont restaurables.
      </div>

      <div className="modal-actions" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 10 }}>
          {selSelectable > 0 && (
            <button className="btn btn-danger" onClick={onClean} disabled={selSelectable === 0}>
              🧹 Nettoyer ({selSelectable} restes · {formatBytes(selectedBytes(remains, selected))})
            </button>
          )}
          <button className="btn btn-ghost" onClick={onRestore} disabled={cleanRes?.moved ? cleanRes.moved === 0 : true}>
            ↩️ Restaurer la quarantaine
          </button>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
          <span className="small muted" style={{ alignSelf: "center" }}>{formatBytes(recovered)} récupérables estimés</span>
        </div>
      </div>
    </div>
  );
}

function remainingRows(remains: UninstallRemain[]): UninstallRemain[] {
  return remains;
}

function selectedBytes(remains: UninstallRemain[], selected: Set<string>): number {
  return remains.filter((r) => selected.has(r.id)).reduce((a, r) => a + r.size, 0);
}