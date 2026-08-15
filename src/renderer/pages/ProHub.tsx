import type React from "react";
import { useApp } from "../state/store";
import { MONETIZATION, formatPrice, checkoutReady } from "../../shared/monetization";
import { ProBadge } from "../components/ProBadge";

/**
 * Hub « Nova Pro » : la vitrine de l'offre payante. Toujours accessible (même
 * en Free) pour comprendre ce que Nova Pro apporte — jamais de faux paiement,
 * jamais de Pro débloqué par l'affichage : l'état vient exclusivement du
 * système de licence (source de vérité MAIN).
 */
const FEATURES: Array<{ icon: React.ReactNode; page: "autoclean" | "automation" | "guardianPro" | "forecasts"; title: string; desc: string; points: string[] }> = [
  {
    icon: <span className="title-emoji" style={{ fontSize: 28 }}>🪄</span>,
    page: "autoclean",
    title: "Nova AutoClean",
    desc: "Nova surveille votre stockage et applique automatiquement les opérations que vous avez autorisées — chaque jour, chaque semaine, au démarrage ou quand un disque dépasse un seuil.",
    points: ["Déclencheurs : quotidien, hebdomadaire, démarrage, seuil disque", "Aperçu complet avant activation (simulation)", "Quarantaine restaurable par défaut · historique"],
  },
  {
    icon: <span className="title-emoji" style={{ fontSize: 28 }}>⚙️</span>,
    page: "automation",
    title: "Automatisation par règles",
    desc: "Créez des règles SI/ALORS qui nettoient automatiquement les fichiers que vous définissez — sans y penser, sans tout faire à la main.",
    points: ["Conditions combinables : taille, ancienneté, extension, dossier, catégorie", "Actions : corbeille, quarantaine, notification", "Simulation (dry-run) avant toute action réelle"],
  },
  {
    icon: <span className="title-emoji" style={{ fontSize: 28 }}>🛡️</span>,
    page: "guardianPro",
    title: "Gardien Pro",
    desc: "La couche de surveillance intelligente au-dessus du Gardien essentiel : croissance anormale détectée, causes principales identifiées, actions recommandées.",
    points: ["Détection de croissance anormale", "Causes principales par catégorie", "Bascule directe vers AutoClean pour agir"],
  },
  {
    icon: <span className="title-emoji" style={{ fontSize: 28 }}>📈</span>,
    page: "forecasts",
    title: "Prévisions de stockage",
    desc: "Voyez quand vos disques atteindront les seuils d'alerte et leur saturation, à partir de l'évolution réelle enregistrée par Nova.",
    points: ["Estimation des seuils 80 / 90 / 95 % et de la saturation", "Basé uniquement sur votre historique réel", "« Pas assez de données » plutôt qu'une fausse précision"],
  },
];

export function ProHub() {
  const { license, can, setPage, startTrial, openCheckout, pushToast } = useApp();
  const isPro = can("automation");
  const storeReady = checkoutReady();
  const price = formatPrice(MONETIZATION.pricing.proPrice, MONETIZATION.pricing.currency);

  const beginTrial = async () => {
    try {
      const info = await startTrial();
      pushToast({
        kind: "success",
        title: "Essai Nova Pro activé",
        message: `Vous avez ${info.trialDaysLeft} jour(s) pour découvrir toutes les fonctionnalités Pro.`,
      });
    } catch (err) {
      pushToast({ kind: "error", title: "Essai indisponible", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const buy = async () => {
    const res = await openCheckout();
    if (!res.opened) pushToast({ kind: "warning", title: "Achat indisponible", message: res.message });
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            <span className="row" style={{ gap: 10, alignItems: "center" }}>
              <span className="title-emoji">✨</span> Nova Pro
              <ProBadge />
            </span>
          </h1>
          <p className="page-sub">Automatisez votre stockage. Nova s'occupe du reste.</p>
        </div>
      </div>

      {/* Hero : état de licence honnête */}
      <div className="card pro-hero">
        <div className="row-between" style={{ flexWrap: "wrap", gap: 16 }}>
          <div style={{ maxWidth: 560 }}>
            <div className="stat-label">Votre statut Nova Pro</div>
            {isPro ? (
              <div className="pro-hero-active mt-2">
                {license?.status === "trial_pro" ? (
                  <>
                    <div className="pro-hero-title">⏳ Essai Nova Pro</div>
                    <div className="muted mt-1">Il vous reste {license?.trialDaysLeft ?? 0} jour(s) d'essai gratuit — toutes les fonctions Pro sont actives.</div>
                  </>
                ) : (
                  <>
                    <div className="pro-hero-title">✨ Nova Pro actif</div>
                    <div className="muted mt-1">Licence valide · toutes les fonctions Pro sont débloquées.</div>
                  </>
                )}
              </div>
            ) : (
              <div className="pro-hero-free mt-2">
                <div className="pro-hero-title">🆓 Nova Free</div>
                <div className="muted mt-1">Complet et gratuit pour toujours. Nova Pro automatise votre stockage pour vous.</div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
            {!isPro && (
              <>
                {!license?.trialUsed && (
                  <button className="btn btn-pro" onClick={() => void beginTrial()} style={{ minWidth: 240 }}>
                    🎁 Essayer gratuitement 7 jours
                  </button>
                )}
                {storeReady ? (
                  <button className="btn btn-pro" onClick={() => void buy()} style={{ minWidth: 240 }}>
                    Acheter Nova Pro · {price}
                  </button>
                ) : (
                  <div className="pro-store-pending" style={{ maxWidth: 300 }}>
                    Achat unique · {price}
                    <div className="xs muted mt-1">La boutique est en cours d'activation par Lemon Squeezy — le paiement sera disponible prochainement.</div>
                  </div>
                )}
                <span className="xs muted">Paiement unique, sans abonnement · sans carte pour l'essai</span>
              </>
            )}
            {isPro && <span className="badge badge-safe">✓ Nova Pro débloqué</span>}
          </div>
        </div>
      </div>

      {/* Cartes fonctionnalités */}
      <div className="pro-feature-grid mt-5">
        {FEATURES.map((f) => (
          <button key={f.page} className="pro-feature-card" onClick={() => setPage(f.page)}>
            <div className="row-between">
              <span className="pro-feature-icon">{f.icon}</span>
              <ProBadge />
            </div>
            <h3 style={{ margin: "10px 0 4px" }}>{f.title}</h3>
            <p className="muted small" style={{ lineHeight: 1.55 }}>{f.desc}</p>
            <ul className="pro-feature-points">
              {f.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <span className="link-btn mt-2" style={{ alignSelf: "flex-start" }}>
              {isPro ? "Ouvrir →" : "Découvrir →"}
            </span>
          </button>
        ))}
      </div>

      {/* Rappel philosophie */}
      <div className="card mt-5" style={{ borderColor: "rgba(242, 182, 60, 0.25)", background: "rgba(242, 182, 60, 0.03)" }}>
        <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
          <span style={{ fontSize: 26 }}>💡</span>
          <div>
            <strong>Nova Free vous donne les outils. Nova Pro automatise votre stockage pour vous.</strong>
            <p className="muted small mt-1" style={{ maxWidth: 720, lineHeight: 1.6 }}>
              Tout ce qui vous permet de comprendre et nettoyer votre PC reste gratuit : analyse, gros fichiers, doublons,
              applications, jeux, nettoyage manuel, quarantaine, historique, Coach et Gardien essentiel. Nova Pro ajoute
              l'automatisation : des règles, une maintenance planifiée, des prévisions avancées et un Gardien intelligent
              qui agissent pour vous. Local-first : aucune donnée ne quitte votre ordinateur.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
