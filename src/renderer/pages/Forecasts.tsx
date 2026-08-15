import { useEffect, useState } from "react";
import { useApp } from "../state/store";
import type { GuardianForecast, GuardianPrediction, StorageTrend } from "../../shared/types";
import { formatBytes, relativeTime } from "../../shared/types";
import { EmptyState, LoadingBar } from "../components/ui";
import { LineChart } from "../components/charts";
import { ProBadge } from "../components/ProBadge";

export function ForecastsPage() {
  const { can, openPro, license, setPage } = useApp();
  const [report, setReport] = useState<{ prediction: GuardianPrediction | null; forecast: GuardianForecast | null } | null>(null);
  const [trend, setTrend] = useState<StorageTrend | null>(null);
  const [loading, setLoading] = useState(true);

  const hasPredictions = can("guardianPredictions");
  const hasAdvanced = can("advancedGuardian");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([window.nova.getGuardianReport(), window.nova.getTrend()])
      .then(([r, t]) => {
        if (cancelled) return;
        setReport({ prediction: r.prediction, forecast: r.forecast });
        setTrend(t);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="loading-block-centered" style={{ maxWidth: 560, margin: "0 auto", paddingTop: 64 }}>
        <LoadingBar label="Chargement des prévisions…" />
      </div>
    );
  }

  if (!hasPredictions) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">
              <span className="row" style={{ gap: 10, alignItems: "center" }}>
                <span className="title-emoji">📈</span> Prévisions <ProBadge />
              </span>
            </h1>
            <p className="page-sub">Estimez le délai avant saturation de vos disques à partir de l'évolution réelle enregistrée par Nova.</p>
          </div>
        </div>
        <div className="card mt-5" style={{ borderColor: "rgba(242, 182, 60, 0.35)" }}>
          <h3>Les prévisions, c'est Nova Pro</h3>
          <p className="muted" style={{ lineHeight: 1.6, maxWidth: 640 }}>
            Nova enregistre l'évolution de votre stockage à chaque analyse et vérification. Avec Nova Pro, elle estime
            quand vos disques atteindront 80, 90, 95 % puis la saturation — pour agir avant qu'il ne soit trop tard.
          </p>
          <div className="row mt-4" style={{ gap: 10 }}>
            <button className="btn btn-pro" onClick={() => openPro("guardianPredictions")}>
              {license?.trialUsed ? "Passer à Nova Pro" : "Essayer Nova Pro gratuitement — 7 jours"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const points = trend && trend.points.length >= 2 ? trend.points.map((p) => ({ at: p.at, value: p.used })) : null;
  const forecast = hasAdvanced ? report?.forecast : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">              <span className="row" style={{ gap: 10, alignItems: "center" }}>
                <span className="title-emoji">📈</span> Prévisions <ProBadge />
              </span>
            </h1>
            <p className="page-sub">Basées uniquement sur l'évolution réelle de votre stockage.</p>
        </div>
        <button className="btn" onClick={() => setPage("guardian")}>👁️ Gardien</button>
      </div>

      <div className="grid grid-stats mb-5">
        <div className="stat-card">
          <div className="stat-label">Tendance actuelle</div>
          <div className="stat-value">{trend && trend.weeklyGrowth > 0 ? `+${formatBytes(trend.weeklyGrowth)}/semaine` : "Stable ou en baisse"}</div>
          <div className="stat-sub">Sur {trend?.points.length ?? 0} point(s) de mesure</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Saturation estimée</div>
          <div className="stat-value">{report?.prediction?.fullAt ? relativeTime(report.prediction.fullAt) : report?.prediction?.daysToFull !== null && report?.prediction?.daysToFull !== undefined ? `~${report.prediction.daysToFull} j` : "—"}</div>
          <div className="stat-sub">{report?.prediction?.reliable ? "Estimation fiable" : "Pas assez de données"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rythme de remplissage</div>
          <div className="stat-value">{report?.prediction && report.prediction.ratePerDay > 0 ? `+${formatBytes(report.prediction.ratePerDay)}/jour` : "—"}</div>
          <div className="stat-sub">Moyenne sur la période mesurée</div>
        </div>
      </div>

      <div className="grid mt-5" style={{ gridTemplateColumns: "1.15fr 1fr" }}>
        <div className="card">
          <h3>Évolution du stockage</h3>
          <div className="card-sub">Points enregistrés à chaque analyse et vérification.</div>
          {points ? (
            <div className="mt-4">
              <LineChart points={points} width={620} height={260} />
            </div>
          ) : (
            <EmptyState icon="📈" title="Pas encore de tendance" sub="Lancez une analyse ou activez le Gardien : chaque vérification enregistre un point d'évolution." />
          )}
        </div>

        <div className="card">
          <h3>🎯 Prévision de remplissage</h3>
          <div className="card-sub">Estimation de saturation du disque.</div>
          {report?.prediction ? (
            <div className={`mt-3 ${report.prediction.reliable ? "guardian-pred-good" : "muted small"}`} style={{ lineHeight: 1.6 }}>
              {report.prediction.message}
            </div>
          ) : (
            <div className="muted small mt-3">Pas assez de données pour établir une prévision fiable.</div>
          )}
        </div>
      </div>

      {/* Prévisions avancées : seuils */}
      <div className="card mt-5" style={{ borderColor: "rgba(242, 182, 60, 0.35)" }}>
        <div className="row-between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <h3 style={{ margin: 0 }}>📈 Prévisions avancées</h3>
            <ProBadge />
          </div>
          <span className="xs muted">Basées sur {forecast?.dataPoints ?? 0} mesure(s) sur {forecast?.spanDays ?? 0} jour(s)</span>
        </div>
        {!forecast ? (
          <div className="muted small mt-3">
            Pas assez de données pour établir des prévisions avancées (au moins 3 jours de mesures). Les vérifications
            régulières du Gardien les enrichiront — mieux vaut une estimation honnête qu'une fausse précision.
          </div>
        ) : (
          <>
            <div className="forecast-grid">
              {forecast.thresholds.map((t) => (
                <div key={t.pct} className="forecast-cell">
                  <span className="xs muted">Seuil {t.pct} %</span>
                  <span className="forecast-pct">{t.at ? new Date(t.at).toLocaleDateString("fr-FR") : "non prévisible"}</span>
                  <span className="xs muted">{t.at ? relativeTime(t.at) : "croissance stable ou négative"}</span>
                </div>
              ))}
              <div className="forecast-cell">
                <span className="xs muted">Saturation complète</span>
                <span className="forecast-pct">{forecast.fullAt ? new Date(forecast.fullAt).toLocaleDateString("fr-FR") : "non prévisible"}</span>
                <span className="xs muted">{forecast.fullAt ? relativeTime(forecast.fullAt) : "stockage stable"}</span>
              </div>
            </div>
            <div className="xs muted mt-3">Dates estimées à partir de l'évolution réelle de votre stockage. Vérifiez régulièrement : elles s'affinent avec le temps.</div>
          </>
        )}
      </div>
    </div>
  );
}
