import { useEffect, useState } from "react";
import { useApp } from "../state/store";
import type { CoachRecommendation, CoachReport, SafetyLevel } from "../../shared/types";
import { formatBytes } from "../../shared/types";
import { SafetyBadge, LoadingBar } from "../components/ui";

const KIND_EMOJI: Record<string, string> = {
  temp: "🧹",
  cache: "🗄️",
  recyclebin: "🗑️",
  large: "🐘",
  old: "⏳",
  download: "📥",
  archive: "📦",
  duplicate: "📑",
  logs: "📃",
  crash: "💥",
  thumbnail: "🖼️",
  "apps-unused": "💻",
  "games-large": "🎮",
  growth: "📈",
  prediction: "🔮",
};

const RISK_COLOR: Record<SafetyLevel, string> = {
  safe: "var(--good)",
  review: "var(--warn)",
  caution: "#f97316",
  risky: "var(--danger)",
  protected: "#94a3b8",
};

export function Coach() {
  const { setPage } = useApp();
  const [report, setReport] = useState<CoachReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    void window.nova.getCoachReport().then((r) => {
      setReport(r);
      setLoading(false);
    });
  };

  useEffect(load, []);

  if (loading) {
    return (
      <div className="loading-block-centered" style={{ maxWidth: 560, margin: "0 auto", paddingTop: 64 }}>
        <LoadingBar label="Le Coach analyse vos données…" />
      </div>
    );
  }

  if (!report) {
    return (
      <div style={{ paddingTop: 60, textAlign: "center", color: "var(--text-dim)" }}>
        <p>Impossible de charger les recommandations du Coach.</p>
        <button className="btn btn-primary mt-4" onClick={load}>Réessayer</button>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">🧠 Nova Coach</h1>
          <p className="page-sub">
            Nova surveille votre stockage et vous explique ce que vous pouvez faire. Aucune suppression n'est
            jamais automatique : tout passe par un aperçu puis votre confirmation.
          </p>
        </div>
        <button className="btn" onClick={load}>🔄 Actualiser</button>
      </div>

      <div className={`card hero coach-hero ${report.status === "healthy" ? "coach-healthy" : ""}`}>
        <div className="coach-hero-top">
          <span className="coach-orb">{report.status === "healthy" ? "🟢" : "✨"}</span>
          <div>
            <h2 className="coach-headline">{report.headline}</h2>
            <p className="coach-sub">{report.sub}</p>
          </div>
        </div>
        {report.totalRecoverable > 0 && (
          <div className="coach-total">
            <span className="stat-label">Potentiel de récupération</span>
            <span className="coach-total-value">{formatBytes(report.totalRecoverable)}</span>
          </div>
        )}
        {report.protectedNote && (
          <div className="insight info" style={{ marginTop: 16 }}>
            <span className="insight-ico">🛡️</span>
            <div>
              <div className="insight-title">Éléments protégés</div>
              <p className="insight-msg">{report.protectedNote}</p>
            </div>
          </div>
        )}
      </div>

      {report.recommendations.length === 0 && (
        <div className="card mt-5 coach-empty">
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 44 }}>🌿</div>
            <h3 className="mt-4">Votre stockage est actuellement bien entretenu</h3>
            <p className="muted small mt-2">
              Nova n'a détecté aucune action pertinente à vous proposer pour le moment.
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 coach-list">
        {report.recommendations.map((rec, i) => (
          <CoachCard key={rec.key} rec={rec} index={i} onAction={() => setPage(rec.action)} />
        ))}
      </div>
    </div>
  );
}

function CoachCard({ rec, index, onAction }: { rec: CoachRecommendation; index: number; onAction: () => void }) {
  const color = RISK_COLOR[rec.risk];
  return (
    <div className="card coach-card" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
        <span className="coach-card-emoji">{KIND_EMOJI[rec.kind] ?? "✨"}</span>
        <div className="flex-1">
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <h3 className="coach-card-title">{rec.title}</h3>
            <SafetyBadge level={rec.risk} />
          </div>
          <p className="coach-card-desc">{rec.explanation}</p>
          <div className="row" style={{ gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <span className="tag">
              <span style={{ width: 8, height: 8, borderRadius: 50, background: color, display: "inline-block", boxShadow: `0 0 8px ${color}` }} />
              {rec.reason}
            </span>
            {rec.share > 0 && <span className="tag">{Math.round(rec.share * 100)} % du récupérable</span>}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div className="coach-card-bytes">{formatBytes(rec.bytes)}</div>
          {rec.files > 0 && <div className="xs muted">{rec.files.toLocaleString("fr-FR")} éléments</div>}
        </div>
      </div>
      <div className="row mt-4" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-sm btn-primary" onClick={onAction}>
          {rec.action === "cleanup"
            ? "🧹 Voir et nettoyer"
            : rec.action === "apps"
              ? "💻 Ouvrir les applications"
              : rec.action === "games"
                ? "🎮 Ouvrir les jeux"
                : rec.action === "history"
                  ? "📈 Voir l'évolution"
                  : "🔍 Analyser"}
        </button>
      </div>
    </div>
  );
}