import { useApp } from "../state/store";

/**
 * Seuil (jours restants) à partir duquel l'essai est signalé comme
 * « se terminant bientôt » sur le Dashboard. Affichage uniquement :
 * aucune incidence sur la logique d'essai (côté main).
 */
export const TRIAL_ENDING_SOON_DAYS = 3;

/** True si l'essai touche à sa fin (0 à TRIAL_ENDING_SOON_DAYS jours restants). */
export function isTrialEndingSoon(daysLeft: number): boolean {
  return daysLeft >= 0 && daysLeft <= TRIAL_ENDING_SOON_DAYS;
}

/**
 * Bandeau discret du statut Nova Free / Essai Pro / Pro.
 * Sobre, jamais agressif : il informe sans interrompre.
 * Quand l'essai touche à sa fin, un rappel doux (⏳) apparaît quelques jours
 * avant l'expiration — sans message alarmiste, sans popup.
 */
export function LicenseBanner() {
  const { license, openPro } = useApp();
  if (!license) return null;

  if (license.trialActive) {
    const d = license.trialDaysLeft;
    const endingSoon = isTrialEndingSoon(d);
    return (
      <div className={`license-banner trial${endingSoon ? " ending-soon" : ""}`}>
        <span>
          {endingSoon ? "⏳" : "✨"} Nova Pro · il vous reste {d} jour{d > 1 ? "s" : ""} d'essai
          {endingSoon ? " — votre essai se termine bientôt." : " gratuits."}
        </span>
        <button className="btn btn-sm" onClick={() => openPro("automation")}>
          Découvrir Nova Pro
        </button>
      </div>
    );
  }

  if (license.isPro) {
    return (
      <div className="license-banner pro">
        <span>✨ Nova Pro ✓</span>
      </div>
    );
  }

  // Free : invitation cohérente, non intrusive.
  return (
    <div className="license-banner free">
      <span>Nova Free, gratuit pour toujours · Automatisez votre nettoyage avec Nova Pro</span>
      <button className="btn btn-sm" onClick={() => openPro("automation")}>
        Découvrir
      </button>
    </div>
  );
}
