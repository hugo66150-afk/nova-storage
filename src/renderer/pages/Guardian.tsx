import { useEffect, useState } from "react";
import { useApp } from "../state/store";
import type { GuardianEvent, GuardianReport } from "../../shared/types";
import { formatBytes, formatDate, relativeTime } from "../../shared/types";
import { EmptyState, ProgressBar, LoadingBar } from "../components/ui";
import { LineChart } from "../components/charts";

const LEVEL_BADGE: Record<string, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "badge-safe" },
  warn: { label: "Surveillance", cls: "badge-review" },
  alert: { label: "Alerte", cls: "badge-caution" },
  critical: { label: "Critique", cls: "badge-risky" },
  info: { label: "Info", cls: "badge-neutral" },
};

export function GuardianPage() {
  const { prefs, refreshPrefs, pushToast, setPage, can, openPro } = useApp();
  const [report, setReport] = useState<GuardianReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setReport(await window.nova.getGuardianReport());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleEnabled = async () => {
    const next = !(report?.enabled ?? false);
    // Si les préférences ne sont pas encore chargées, on les récupère plutôt
    // que d'abandonner silencieusement (bouton « mort »).
    let current = prefs;
    if (!current) {
      current = await window.nova.getPreferences();
    }
    if (!current) return;
    await window.nova.savePreferences({ ...current, guardianEnabled: next });
    await refreshPrefs();
    if (next) {
      await window.nova.runGuardianCheck();
      pushToast({ kind: "success", title: "Gardien activé", message: "Nova surveille maintenant votre stockage en arrière-plan, même lorsque l'application est fermée." });
    } else {
      pushToast({ kind: "info", title: "Gardien désactivé", message: "Aucune surveillance en arrière-plan n'est active." });
    }
    await load();
  };

  const runNow = async () => {
    pushToast({ kind: "info", title: "Vérification en cours…" });
    const r = await window.nova.runGuardianCheck();
    setReport(r);
    pushToast({ kind: "success", title: "Vérification terminée" });
  };

  if (loading && !report) {
    return (
      <div className="loading-block-centered" style={{ maxWidth: 560, margin: "0 auto", paddingTop: 64 }}>
        <LoadingBar label="Chargement du Gardien…" />
      </div>
    );
  }

  if (!report) {
    return (
      <div style={{ paddingTop: 60, textAlign: "center", color: "var(--text-dim)" }}>
        <p>Impossible de charger les données du Gardien.</p>
        <button className="btn btn-primary mt-4" onClick={() => void load()}>Réessayer</button>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            <span className="row" style={{ gap: 10, alignItems: "center" }}>
              <span className="title-emoji">👁️</span>
              Gardien du stockage
            </span>
          </h1>
          <p className="page-sub">
            Nova surveille vos disques en arrière-plan, détecte les seuils critiques et vous prévient avant que
            votre espace ne manque — même lorsque l'interface est fermée.
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn" onClick={() => void runNow()}>🔍 Vérifier maintenant</button>
          <button className="btn" onClick={() => setPage("settings")}>⚙️ Paramètres</button>
        </div>
      </div>

      <div className="card hero mb-5 guardian-hero">
        <div className="row-between" style={{ flexWrap: "wrap", gap: 16 }}>
          <div>
            <div className="stat-label">État du Gardien</div>
            <div className="row mt-2" style={{ gap: 12 }}>
              <button
                className={`btn ${report.enabled ? "btn-primary" : ""}`}
                onClick={() => void toggleEnabled()}
                aria-pressed={report.enabled}
              >
                {report.enabled ? "🟢 Actif" : "⚪ Désactivé"}
              </button>
              <span className="tag">{report.lastCheckAt ? `Dernière vérification : ${relativeTime(report.lastCheckAt)}` : "Aucune vérification"}</span>
            </div>
          </div>
          {report.prediction ? (
            <div style={{ maxWidth: 380 }}>
              <div className="stat-label">Prévision de remplissage</div>
              <div className={`mt-2 ${report.prediction.reliable ? "guardian-pred-good" : "muted small"}`}>
                {report.prediction.message}
              </div>
            </div>
          ) : !can("guardianPredictions") ? (
            <div style={{ maxWidth: 380 }}>
              <div className="stat-label">Prévisions de remplissage</div>
              <div className="pro-trial-note" style={{ marginTop: 8 }}>
                <div>Estimez le délai avant saturation de vos disques — fonctionnalité Nova Pro.</div>
                <button className="btn btn-sm mt-2" onClick={() => openPro("guardianPredictions")}>
                  Découvrir Nova Pro
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ForecastCard report={report} canForecast={can("advancedGuardian")} openPro={openPro} />

      <div className="grid grid-stats mb-5">
        {report.drives.map((d) => (
          <div key={d.name} className="stat-card">
            <div className="row-between">
              <div className="stat-label">{d.label || d.name}</div>
              <span className={`badge ${LEVEL_BADGE[d.level]?.cls}`}>{LEVEL_BADGE[d.level]?.label}</span>
            </div>
            <div className="stat-value" style={{ fontSize: 26 }}>{d.pct.toFixed(1)} %</div>
            <div className="stat-sub">
              {formatBytes(d.free)} libres sur {formatBytes(d.total)}
            </div>
            <div className="mt-3">
              <ProgressBar
                value={d.pct}
                tone={d.level === "critical" ? "danger" : d.level === "alert" ? "danger" : d.level === "warn" ? "warn" : "accent"}
                height={10}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid" style={{ gridTemplateColumns: "1.15fr 1fr" }}>
        <div className="card">
          <h3>Évolution du stockage</h3>
          <div className="card-sub">Basé sur les points enregistrés à chaque analyse et vérification.</div>
          <GuardianHistory />
        </div>

        <div className="card">
          <h3>Événements récents</h3>
          <div className="card-sub">Seuils franchis, alertes et résumés du Gardien.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
            {report.events.length === 0 && <div className="muted small">Aucun événement enregistré.</div>}
            {report.events.map((e) => (
              <GuardianEventRow key={e.id} event={e} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ForecastCard({ report, canForecast, openPro }: { report: GuardianReport; canForecast: boolean; openPro: (k: "advancedGuardian" | "guardianPredictions") => void }) {
  if (canForecast) {
    const f = report.forecast;
    return (
      <div className="card mt-5" style={{ borderColor: "rgba(242, 182, 60, 0.35)" }}>
        <div className="row-between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <h3 style={{ margin: 0 }}>📈 Prévisions avancées</h3>
            <span className="badge badge-neutral">✨ Nova Pro</span>
          </div>
          <span className="xs muted">Basées sur {f?.dataPoints ?? 0} mesure(s) sur {f?.spanDays ?? 0} jour(s)</span>
        </div>
        {!f ? (
          <div className="muted small mt-3">Pas assez de données pour établir des prévisions avancées. Les vérifications régulières du Gardien les enrichiront.</div>
        ) : (
          <>
            <div className="forecast-grid">
              {f.thresholds.map((t) => (
                <div key={t.pct} className="forecast-cell">
                  <span className="xs muted">Seuil {t.pct} %</span>
                  <span className="forecast-pct">{t.at ? new Date(t.at).toLocaleDateString("fr-FR") : "non prévisible"}</span>
                  <span className="xs muted">{t.at ? relativeTime(t.at) : "croissance stable ou négative"}</span>
                </div>
              ))}
              <div className="forecast-cell">
                <span className="xs muted">Saturation complète</span>
                <span className="forecast-pct">{f.fullAt ? new Date(f.fullAt).toLocaleDateString("fr-FR") : "non prévisible"}</span>
                <span className="xs muted">{f.fullAt ? relativeTime(f.fullAt) : "stockage stable"}</span>
              </div>
            </div>
            <div className="xs muted mt-3">
              Dates estimées à partir de l'évolution réelle de votre stockage. Vérifiez régulièrement : elles s'affinent avec le temps.
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card mt-5" style={{ borderColor: "rgba(242, 182, 60, 0.35)", background: "rgba(242, 182, 60, 0.03)" }}>
      <div className="row-between" style={{ flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h3 style={{ margin: 0 }}>📈 Prévisions avancées</h3>
            <span className="badge badge-neutral">✨ Nova Pro</span>
          </div>
          <div className="card-sub mt-1">
            Voyez quand vos disques atteindront les seuils d'alerte et leur saturation, à partir de votre historique réel.
          </div>
        </div>
        <button className="btn btn-pro" onClick={() => openPro("advancedGuardian")}>
          Découvrir Nova Pro
        </button>
      </div>
      <div className="xs muted mt-3" style={{ maxWidth: 640 }}>
        Le Gardien essentiel (seuils, alertes, notifications, résumé hebdomadaire) reste gratuit. Les prévisions avancées sont réservées à Nova Pro.
      </div>
    </div>
  );
}

function GuardianHistory() {
  const [points, setPoints] = useState<Array<{ at: number; value: number }> | null>(null);
  useEffect(() => {
    void window.nova.getTrend().then((t) => setPoints(t && t.points.length >= 2 ? t.points.map((p) => ({ at: p.at, value: p.used })) : null));
  }, []);
  if (!points) {
    return <EmptyState icon="📈" title="Pas encore de tendance" sub="Chaque analyse ou vérification enregistre un point d'évolution." />;
  }
  return <LineChart points={points} width={600} height={240} />;
}

function GuardianEventRow({ event }: { event: GuardianEvent }) {
  const badge = LEVEL_BADGE[event.level] ?? LEVEL_BADGE.info;
  return (
    <div className="file-row" style={{ padding: "8px 12px" }}>
      <span className={`badge ${badge.cls}`}>{badge.label}</span>
      <div className="flex-1">
        <div className="xs muted">{event.drive || "Nova"}</div>
        <div className="small" style={{ lineHeight: 1.4 }}>{event.message}</div>
      </div>
      <span className="xs muted nowrap">{formatDate(event.at)}</span>
    </div>
  );
}