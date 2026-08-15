import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store";
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type Category,
  type CoachReport,
  type ScanResult,
  formatBytes,
  relativeTime,
} from "../../shared/types";
import { DonutChart, LineChart } from "../components/charts";
import { AnimatedNumber, EmptyState, LoadingBar, ProgressBar, StatCard } from "../components/ui";
import { LicenseBanner } from "../components/LicenseBanner";

export function Dashboard() {
  const { overview, scanState, setPage } = useApp();
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [coach, setCoach] = useState<CoachReport | null>(null);

  useEffect(() => {
    void window.nova.getLastScanResult().then(setLastScan);
  }, [scanState.lastResult]);

  useEffect(() => {
    void window.nova.getCoachReport().then(setCoach);
  }, [scanState.lastResult, overview?.lastScanAt]);

  const primary = overview?.drives?.[0];
  const usagePct = primary && primary.total > 0 ? (primary.used / primary.total) * 100 : 0;
  const recoverableGo = (overview?.recoverable.totalBytes ?? 0) / 1024 ** 3;

  const categoryData = useMemo(() => {
    if (!lastScan) return [];
    return lastScan.categories
      .filter((c) => c.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes)
      .map((c) => ({
        key: c.category,
        label: CATEGORY_LABELS[c.category as Category],
        value: c.bytes,
        color: CATEGORY_COLORS[c.category as Category],
        sub: `${c.files.toLocaleString("fr-FR")} fichiers`,
      }));
  }, [lastScan]);

  if (!overview) {
    return (
      <div className="loading-block-centered" style={{ maxWidth: 560, margin: "0 auto", paddingTop: 64 }}>
        <LoadingBar label="Chargement des données…" />
      </div>
    );
  }

  return (
    <div>
      <LicenseBanner />
      <div className="page-head">
        <div>
          <h1 className="page-title">Tableau de bord</h1>
          <p className="page-sub">Comprendre en un coup d'œil où part votre espace et quoi nettoyer en toute sécurité.</p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn" onClick={() => setPage("cleanup")}>🧹 Libérer de l'espace</button>
          <button className="btn btn-primary" onClick={() => setPage("analyze")}>🔍 Analyser</button>
        </div>
      </div>

      <div className="grid grid-stats">
        <StatCard
          icon="💽"
          label="Espace utilisé"
          value={<AnimatedNumber value={primary?.used ?? 0} />}
          sub={primary ? `sur ${formatBytes(primary.total)} · ${usagePct.toFixed(0)} %` : "Aucun disque"}
          tone="accent"
          delay={0}
        />
        <StatCard
          icon="🟦"
          label="Espace disponible"
          value={<AnimatedNumber value={primary?.free ?? 0} />}
          sub={primary ? `${formatBytes(primary.total)} au total` : undefined}
          delay={60}
        />
        <StatCard
          icon="💾"
          label="Espace récupérable"
          value={<AnimatedNumber value={overview.recoverable.totalBytes} />}
          sub={recoverableGo >= 1 ? `${recoverableGo.toFixed(1)} Go identifiés en sécurité` : "Rien d'identifié pour l'instant"}
          tone="good"
          delay={120}
        />
        <StatCard
          icon="🗂"
          label="Fichiers analysés"
          value={(overview.filesAnalyzed || 0).toLocaleString("fr-FR")}
          sub={`Dernière analyse : ${relativeTime(overview.lastScanAt)}`}
          delay={180}
        />
      </div>

      {coach && coach.recommendations.length > 0 && (
        <div className="card hero mt-5 coach-dash">
          <div className="row-between" style={{ flexWrap: "wrap", gap: 12 }}>
            <div className="row" style={{ gap: 14 }}>
              <span style={{ fontSize: 30, filter: "drop-shadow(0 0 14px var(--accent-glow))" }}>🧠</span>
              <div>
                <div className="stat-label">Nova Coach</div>
                <div className="coach-dash-title">{coach.headline}</div>
              </div>
            </div>
            <div className="row" style={{ gap: 14 }}>
              <div style={{ textAlign: "right" }}>
                <div className="stat-label">Récupérable estimé</div>
                <div className="coach-dash-value">{formatBytes(coach.totalRecoverable)}</div>
              </div>
              <button className="btn btn-primary" onClick={() => setPage("coach")}>Voir les recommandations</button>
            </div>
          </div>
          <div className="row mt-4" style={{ gap: 10, flexWrap: "wrap" }}>
            {coach.recommendations.slice(0, 4).map((r) => (
              <span key={r.key} className="tag" style={{ padding: "6px 12px" }}>
                {r.risk === "safe" ? "🟢" : r.risk === "review" ? "🟡" : "🟠"} {r.title} · {formatBytes(r.bytes)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 grid" style={{ gridTemplateColumns: "1.15fr 1fr" }}>
        <div className="card hero">
          <h3>Utilisation du disque {primary?.name ?? ""}</h3>
          <div className="card-sub">
            {formatBytes(primary?.used ?? 0)} utilisés / {formatBytes(primary?.total ?? 0)} · {usagePct.toFixed(1)} % du volume
          </div>
          <ProgressBar value={usagePct} tone={usagePct > 90 ? "danger" : usagePct > 75 ? "warn" : "accent"} height={14} />
          <div className="row-between mt-4">
            <div>
              <div className="stat-label">Disponible</div>
              <div className="stat-value" style={{ fontSize: 24 }}>{formatBytes(primary?.free ?? 0)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="stat-label">Récupérable</div>
              <div className="stat-value good" style={{ fontSize: 24 }}>{formatBytes(overview.recoverable.totalBytes)}</div>
            </div>
          </div>
          {lastScan && (
            <div className="row mt-4" style={{ gap: 10 }}>
              <span className="tag">📅 {new Date(lastScan.finishedAt).toLocaleString("fr-FR")}</span>
              <span className="tag">🗂 {lastScan.totalFiles.toLocaleString("fr-FR")} fichiers</span>
              <span className="tag">📂 {lastScan.totalDirs.toLocaleString("fr-FR")} dossiers</span>
              <span className="tag">{lastScan.errors.length > 0 ? `⚠ ${lastScan.errors.length} erreurs` : "✓ aucun accès refusé"}</span>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Alertes intelligentes</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {overview.insights.length === 0 && (
              <div className="muted small">Aucune alerte pour le moment.</div>
            )}
            {overview.insights.map((ins, i) => (
              <div key={i} className={`insight ${ins.kind}`}>
                <span className="insight-ico">{ins.kind === "warning" ? "⚠️" : ins.kind === "positive" ? "🟢" : "💡"}</span>
                <div>
                  <div className="insight-title">{ins.title}</div>
                  <p className="insight-msg">{ins.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid" style={{ gridTemplateColumns: "1fr 1.15fr" }}>
        <div className="card">
          <h3>Contenu par catégorie</h3>
          <div className="card-sub">Ce qui prend de la place, classé automatiquement par Nova.</div>
          {categoryData.length > 0 ? (
            <DonutChart data={categoryData} centerTitle="Analyse totale" centerSub={formatBytes(lastScan?.totalBytes ?? 0)} />
          ) : (
            <EmptyState
              icon="📊"
              title="Aucune analyse disponible"
              sub="Lancez une analyse pour découvrir la répartition de votre stockage."
              action={<button className="btn btn-primary" onClick={() => setPage("analyze")}>Lancer une analyse</button>}
            />
          )}
        </div>

        <div className="card">
          <h3>Évolution du stockage</h3>
          <div className="card-sub">Tendances d'utilisation suivies à chaque analyse.</div>
          {overview.trend && overview.trend.points.length >= 2 ? (
            <>
              <LineChart
                points={overview.trend.points.map((p) => ({ at: p.at, value: p.used }))}
                width={620}
                height={240}
              />
              <div className="mt-4 small muted">
                {overview.trend.weeklyGrowth > 0
                  ? `📈 Votre stockage augmente en moyenne de ${(overview.trend.weeklyGrowth / 1024 ** 3).toFixed(1)} Go par semaine.`
                  : overview.trend.weeklyGrowth < 0
                    ? `📉 Votre stockage diminue en moyenne de ${(-overview.trend.weeklyGrowth / 1024 ** 3).toFixed(1)} Go par semaine.`
                    : "Stockage stable."}
              </div>
            </>
          ) : (
            <EmptyState
              icon="📈"
              title="Pas encore de tendance"
              sub="Chaque analyse complète d'un disque enregistre un point d'évolution."
            />
          )}
        </div>
      </div>
    </div>
  );
}
