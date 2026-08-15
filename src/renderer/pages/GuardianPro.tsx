import { useEffect, useState } from "react";
import { useApp } from "../state/store";
import type { GuardianDriveStatus, ScanResult, StorageTrend } from "../../shared/types";
import { CATEGORY_LABELS, formatBytes } from "../../shared/types";
import { analyzeGrowth } from "../../shared/guardianPro";
import { EmptyState, LoadingBar, ProgressBar } from "../components/ui";
import { ProBadge } from "../components/ProBadge";

export function GuardianProPage() {
  const { can, openPro, license, setPage } = useApp();
  const [drives, setDrives] = useState<GuardianDriveStatus[] | null>(null);
  const [trend, setTrend] = useState<StorageTrend | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);

  const hasAccess = can("advancedGuardian");

  const load = () => {
    void Promise.all([window.nova.getGuardianReport(), window.nova.getTrend(), window.nova.getLastScanResult()])
      .then(([r, t, s]) => {
        setDrives(r.drives);
        setTrend(t);
        setScan(s);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="loading-block-centered" style={{ maxWidth: 560, margin: "0 auto", paddingTop: 64 }}>
        <LoadingBar label="Chargement du Gardien Pro…" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">
              <span className="row" style={{ gap: 10, alignItems: "center" }}>
                <span className="title-emoji">🛡️</span> Gardien Pro <ProBadge />
              </span>
            </h1>
            <p className="page-sub">La surveillance intelligente au-dessus du Gardien essentiel.</p>
          </div>
        </div>
        <div className="card mt-5" style={{ borderColor: "rgba(242, 182, 60, 0.35)" }}>
          <h3>Le Gardien Pro, c'est Nova Pro</h3>
          <p className="muted" style={{ lineHeight: 1.6, maxWidth: 660 }}>
            Le Gardien essentiel (seuils, alertes, notifications, résumé hebdomadaire) reste gratuit. Nova Pro ajoute la
            détection de croissance anormale, les causes principales par catégorie et la bascule directe vers
            l'optimisation automatique.
          </p>
          <div className="row mt-4" style={{ gap: 10 }}>
            <button className="btn btn-pro" onClick={() => openPro("advancedGuardian")}>
              {license?.trialUsed ? "Passer à Nova Pro" : "Essayer Nova Pro gratuitement — 7 jours"}
            </button>
            <button className="btn" onClick={() => setPage("guardian")}>👁️ Gardien essentiel (gratuit)</button>
          </div>
        </div>
      </div>
    );
  }

  const growth = analyzeGrowth(trend?.points.map((p) => ({ at: p.at, used: p.used })) ?? []);
  const categories = (scan?.categories ?? []).slice().sort((a, b) => b.bytes - a.bytes).slice(0, 4);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">              <span className="row" style={{ gap: 10, alignItems: "center" }}>
                <span className="title-emoji">🛡️</span> Gardien Pro <ProBadge />
              </span>
            </h1>
            <p className="page-sub">Détection de croissance anormale, causes principales et passage à l'action.</p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn" onClick={load}>🔄 Actualiser</button>
          <button className="btn btn-primary" onClick={() => setPage("autoclean")}>🪄 Optimiser maintenant</button>
        </div>
      </div>

      {/* Détection de croissance anormale */}
      <div className={`card hero mb-5 ${growth.anomalous ? "" : ""}`} style={{ borderColor: growth.anomalous ? "rgba(245,158,11,0.5)" : "var(--border)" }}>
        <div className="row-between" style={{ flexWrap: "wrap", gap: 16 }}>
          <div style={{ maxWidth: 560 }}>
            <div className="stat-label">{growth.anomalous ? "⚠ Croissance anormale" : "✅ Croissance surveillée"}</div>
            <div className="mt-2" style={{ lineHeight: 1.6 }}>{growth.message}</div>
            <div className="xs muted mt-2">
              Rythme récent : {formatBytes(growth.rateRecent)}/jour · moyenne : {formatBytes(growth.rateAll)}/jour
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
            {growth.anomalous && (
              <button className="btn btn-pro" onClick={() => setPage("autoclean")}>
                🪄 Configurer une optimisation
              </button>
            )}
            <span className="xs muted">Basé sur {trend?.points.length ?? 0} mesure(s) réelle(s)</span>
          </div>
        </div>
      </div>

      <div className="grid mt-5" style={{ gridTemplateColumns: "1.15fr 1fr" }}>
        {/* Disques */}
        <div className="card">
          <h3>État des disques</h3>
          <div className="card-sub">Niveaux actuels surveillés par le Gardien.</div>
          <div className="mt-4" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {(drives ?? []).length === 0 && <div className="muted small">Aucun disque détecté.</div>}
            {(drives ?? []).map((d) => (
              <div key={d.name}>
                <div className="row-between">
                  <span style={{ fontWeight: 600 }}>{d.label || d.name}</span>
                  <span className="small">{d.pct.toFixed(1)} %</span>
                </div>
                <div className="mt-1">
                  <ProgressBar
                    value={d.pct}
                    tone={d.level === "critical" || d.level === "alert" ? "danger" : d.level === "warn" ? "warn" : "accent"}
                    height={10}
                  />
                </div>
                <div className="xs muted mt-1">{formatBytes(d.free)} libres sur {formatBytes(d.total)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Causes principales */}
        <div className="card">
          <h3>Principales causes</h3>
          <div className="card-sub">Ce qui occupe le plus d'espace, selon votre dernière analyse.</div>
          <div className="mt-4" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {categories.length === 0 && <EmptyState icon="🗂" title="Aucune analyse" sub="Lancez une analyse pour identifier ce qui occupe votre espace." />}
            {categories.map((c) => (
              <div key={c.category} className="file-row" style={{ gap: 10 }}>
                <span className="tag">{CATEGORY_LABELS[c.category as keyof typeof CATEGORY_LABELS] ?? c.category}</span>
                <div className="flex-1" style={{ textAlign: "right" }}>
                  <strong>{formatBytes(c.bytes)}</strong>
                  <div className="xs muted">{scan?.totalBytes ? ((c.bytes / scan.totalBytes) * 100).toFixed(1) : 0} % de l'analyse</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card mt-5" style={{ borderColor: "rgba(242, 182, 60, 0.25)", background: "rgba(242, 182, 60, 0.03)" }}>
        <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
          <span style={{ fontSize: 26 }}>🪄</span>
          <div>
            <strong>Passez à l'action :</strong> une anomalie ou un seuil proche ? Nova AutoClean applique les
            opérations que vous avez autorisées (fichiers temporaires, téléchargements anciens, gros fichiers) en
            quarantaine restaurable — après simulation et avec historique.
            <div className="mt-3">
              <button className="btn btn-pro" onClick={() => setPage("autoclean")}>Ouvrir Nova AutoClean</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
