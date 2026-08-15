import { useEffect, useState } from "react";
import { useApp } from "../state/store";
import novaLogo from "../../../assets/branding/nova.png";

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const { version } = useApp();

  useEffect(() => {
    return window.nova.isMaximized(setMaximized);
  }, []);

  return (
    <header className="titlebar">
      <div className="titlebar-logo">
        <img src={novaLogo} alt="Nova" className="titlebar-logo-img" />
        <span>Nova Storage</span>
        <span className="titlebar-title">Gestionnaire intelligent du stockage · v{version}</span>
      </div>
      <LicenseStatusBadge />
      <div className="titlebar-controls no-drag">
        <button className="tb-btn" onClick={() => window.nova.minimize()} aria-label="Réduire">─</button>
        <button className="tb-btn" onClick={() => window.nova.maximize()} aria-label="Agrandir">{maximized ? "❐" : "□"}</button>
        <button className="tb-btn close" onClick={() => window.nova.close()} aria-label="Fermer">✕</button>
      </div>
    </header>
  );
}

/**
 * Badge de statut Nova (barre de titre).
 * - PRO : licence achetée réellement active (doré, glow premium).
 * - PRO · ESSAI : essai gratuit en cours (apparence clairement différente, jamais confondu avec un achat).
 * - FREE : discret.
 * Basé exclusivement sur la source de vérité (license.status calculé côté MAIN).
 * Le clic ouvre Paramètres → Nova Pro.
 */
function LicenseStatusBadge() {
  const { license, setPage } = useApp();
  if (!license) return null;
  const openSettings = () => setPage("settings");

  if (license.status === "pro") {
    return (
      <button className="tb-license pro no-drag" onClick={openSettings} title="Nova Pro actif — ouvrir Paramètres → Nova Pro" aria-label="Nova Pro actif">
        <span className="tb-license-ico">✦</span>
        <span className="tb-license-txt">PRO</span>
      </button>
    );
  }

  if (license.status === "trial_pro") {
    const d = license.trialDaysLeft;
    return (
      <button
        className="tb-license trial no-drag"
        onClick={openSettings}
        title={`Essai Nova Pro · il vous reste ${d} jour${d > 1 ? "s" : ""} — ouvrir Paramètres → Nova Pro`}
        aria-label="Essai Nova Pro"
      >
        <span className="tb-license-ico">⏳</span>
        <span className="tb-license-txt">PRO · ESSAI</span>
      </button>
    );
  }

  return (
    <button className="tb-license free no-drag" onClick={openSettings} title="Nova Free — gratuit pour toujours" aria-label="Nova Free">
      <span className="tb-license-txt">FREE</span>
    </button>
  );
}
