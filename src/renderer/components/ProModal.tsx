import { useApp } from "../state/store";
import { MONETIZATION, checkoutReady, formatPrice } from "../../shared/monetization";

/**
 * Modale Nova Pro — affichée lorsqu'un utilisateur sans droit ouvre une
 * fonctionnalité Pro. Elle identifie la fonctionnalité, explique sa valeur,
 * propose l'essai gratuit de 7 jours et l'achat unique (checkout Lemon
 * Squeezy officiel). Le paiement n'est jamais simulé : si le checkout n'est
 * pas encore configuré (checkoutUrl vide), le bouton reste honnêtement en
 * état « bientôt disponible ».
 */
export function ProModal() {
  const { proFeature, closePro, license, startTrial, openCheckout, pushToast, setPage } = useApp();
  if (!proFeature) return null;

  const trialUsed = license?.trialUsed === true;
  const trialActive = license?.trialActive === true;
  const trialAvailable = !trialUsed;
  const price = formatPrice(MONETIZATION.pricing.proPrice, MONETIZATION.pricing.currency);

  const beginTrial = async () => {
    const info = await startTrial();
    closePro();
    pushToast({
      kind: "success",
      title: "Essai Nova Pro activé",
      message: `7 jours de Nova Pro gratuits — il vous en reste ${info.trialDaysLeft}.`,
    });
  };

  const buy = async () => {
    const result = await openCheckout();
    if (!result.opened && result.message) {
      pushToast({ kind: "info", title: "Nova Pro", message: result.message });
    }
  };

  return (
    <div className="pro-overlay" onClick={closePro}>
      <div
        className="pro-modal card"
        role="dialog"
        aria-modal="true"
        aria-label="Nova Pro"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between">
          <div className="pro-modal-title">✨ Nova Pro</div>
          <button className="icon-btn" onClick={closePro} aria-label="Fermer">
            ✕
          </button>
        </div>

        <h3 className="mt-4">{proFeature.title}</h3>
        <p className="muted" style={{ lineHeight: 1.55 }}>
          {proFeature.value}
        </p>

        {trialActive && (
          <div className="pro-trial-note">
            Essai Nova Pro · il vous reste {license?.trialDaysLeft ?? 0} jour{(license?.trialDaysLeft ?? 0) > 1 ? "s" : ""}.
          </div>
        )}
        {!trialActive && trialAvailable && (
          <div className="pro-trial-note">7 jours de Nova Pro gratuits, sans carte bancaire.</div>
        )}
        {!trialActive && !trialAvailable && (
          <div className="pro-trial-note">
            Votre essai Nova Pro est terminé — Nova Free reste disponible gratuitement.
          </div>
        )}

        <div className="pro-price mt-4">
          {price}
          <span className="muted small"> · achat unique, sans abonnement</span>
        </div>

        <div className="row mt-4" style={{ gap: 10 }}>
          {trialAvailable ? (
            <button className="btn btn-pro" onClick={() => void beginTrial()}>
              Commencer l'essai gratuit
            </button>
          ) : (
            <button
              className="btn btn-pro"
              onClick={() => void buy()}
              disabled={!checkoutReady()}
              title={checkoutReady() ? "Acheter Nova Pro" : "Le paiement sera bientôt disponible"}
            >
              Passer à Nova Pro · {price}
              {!checkoutReady() && " · bientôt disponible"}
            </button>
          )}
          <button className="btn" onClick={closePro}>
            Plus tard
          </button>
        </div>

        <button
          className="link-btn mt-3"
          onClick={() => {
            closePro();
            setPage("settings");
          }}
        >
          J'ai déjà une licence → l'activer
        </button>

        <div className="xs muted mt-3">
          Paiement sécurisé via Lemon Squeezy · achat unique · Nova Free reste gratuit pour toujours.
        </div>
      </div>
    </div>
  );
}
