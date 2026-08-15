/**
 * Configuration centralisée du modèle économique Nova Storage.
 *
 * C'est LA source de vérité pour :
 *  - la durée de l'essai Pro ;
 *  - le prix unique Nova Pro (9,97 € TTC, achat unique, sans abonnement) ;
 *  - l'intégration Lemon Squeezy (checkout + API de licences) ;
 *  - la liste des droits Free et Pro ;
 *  - la description des fonctionnalités Pro affichées dans l'interface.
 *
 * Modifier ces valeurs ici uniquement — elles ne doivent jamais être
 * dupliquées ailleurs dans le code.
 *
 * SECRETS : aucun secret ne figure ici et n'en ajoutez jamais. Les URL
 * Lemon Squeezy (checkout et API de validation) sont publiques. La clé d'API
 * admin (création de licences gratuites) ne doit exister QUE dans un outil
 * backend via la variable d'environnement LEMON_SQUEEZY_API_KEY (jamais dans
 * l'application, le bundle, Git ou la configuration distribuée).
 */

export const MONETIZATION = {
  trialDays: 7,

  /** Prix UNIQUE officiel : 9,97 € TTC, paiement unique, sans abonnement. */
  pricing: {
    proPrice: 9.97,
    currency: "EUR",
  },

  payment: {
    provider: "lemon_squeezy",
    /**
     * Identifiants PUBLICS du produit Nova Pro (pas des secrets).
     * Source de vérité UNIQUE, partagée avec le site Nova Storage :
     * le site et l'application utilisent exactement le même produit,
     * le même prix et le même checkout — aucun second checkout, aucun
     * système de licence parallèle.
     */
    storeId: "novastorage", // slug public du store (sous-domaine du checkout)
    productId: "1292367",
    variantId: "2022137",
    /**
     * URL publique officielle du checkout Nova Pro (produit/variant).
     * Identique pour le site et l'application. HTTPS strictement.
     */
    checkoutUrl: "https://novastorage.lemonsqueezy.com/checkout/buy/18829073-b7bc-4459-84c6-13ee2874c8a7",
    /** Endpoints publics officiels Lemon Squeezy (validation / activation). */
    licenseApiUrl: "https://api.lemonsqueezy.com/v1/licenses/validate",
    activateApiUrl: "https://api.lemonsqueezy.com/v1/licenses/activate",
    /** Tolérance hors ligne : une licence validée reste active sans réseau. */
    offlineGraceMs: 30 * 24 * 60 * 60 * 1000,
    /** Revalidation réseau au plus une fois par période (si connecté). */
    revalidateAfterMs: 24 * 60 * 60 * 1000,
    /** Timeout des requêtes de licence (ms). */
    requestTimeoutMs: 10_000,
  },
} as const;

/** Vrai quand le checkout Lemon Squeezy est prêt à être ouvert. */
export function checkoutReady(): boolean {
  return MONETIZATION.payment.checkoutUrl.length > 0;
}

/**
 * Valide l'URL de checkout avant toute ouverture de navigateur externe.
 * Seules les URL https:// explicites sont acceptées — rien d'autre
 * (javascript:, file:, http:, protocoles arbitraires) ne peut être ouvert.
 * Retourne l'URL normalisée en cas de succès, ou un message utilisateur
 * clair (jamais technique) en cas d'échec.
 */
export function validateCheckoutUrl(url: string):
  | { ok: true; url: string }
  | { ok: false; message: string } {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, message: "Le paiement sera bientôt disponible." };
  }
  // URL https explicite uniquement, avec un hôte non vide — la classe
  // [^\s] exclut déjà tout espace, donc aucune injection d'argument n'est
  // possible. Aucune exécution de code : simple ouverture navigateur.
  const httpsOnly = /^https:\/\/[^\s]+\.[^\s]+$/i;
  if (!httpsOnly.test(trimmed)) {
    return { ok: false, message: "Le lien de paiement est invalide. Contactez le support." };
  }
  return { ok: true, url: trimmed };
}

/** Types de licences Nova Pro (usage conceptuel / admin). Une licence
 *  gratuite valide donne exactement les mêmes droits qu'une licence achetée. */
export type LicenseType = "PRO_PURCHASE" | "PRO_GIFT" | "PRO_TEST" | "PRO_INTERNAL";

export const LICENSE_TYPES: readonly LicenseType[] = [
  "PRO_PURCHASE",
  "PRO_GIFT",
  "PRO_TEST",
  "PRO_INTERNAL",
];

/** Droits (entitlements) du produit. Une fonctionnalité est Pro si sa clé
 *  figure dans PRO_ENTITLEMENTS (et pas dans FREE_ENTITLEMENTS). */
export type EntitlementKey =
  | "automation"
  | "scheduledMaintenance"
  | "advancedGuardian"
  | "guardianPredictions";

/** Droits accessibles sans licence. L'essai Pro et le Pro héritent de tout. */
export const FREE_ENTITLEMENTS: readonly EntitlementKey[] = [];

/** Droits réservés à Nova Pro (essai inclus). */
export const PRO_ENTITLEMENTS: readonly EntitlementKey[] = [
  "automation",
  "scheduledMaintenance",
  "advancedGuardian",
  "guardianPredictions",
];

export interface ProFeatureDef {
  key: EntitlementKey;
  title: string;
  /** Ce que la fonctionnalité apporte à l'utilisateur (ton produit). */
  value: string;
}

export const PRO_FEATURES: readonly ProFeatureDef[] = [
  {
    key: "automation",
    title: "Automatisation par règles",
    value:
      "Créez des règles SI/ALORS qui nettoient automatiquement les fichiers que vous définissez — sans y penser, sans tout faire à la main.",
  },
  {
    key: "scheduledMaintenance",
    title: "Maintenance planifiée",
    value:
      "Lancez vos règles automatiquement chaque jour, semaine ou mois, même lorsque vous n'êtes pas devant l'application.",
  },
  {
    key: "advancedGuardian",
    title: "Gardien avancé",
    value:
      "Actions automatiques et surveillance renforcée, en plus des alertes essentielles du Gardien.",
  },
  {
    key: "guardianPredictions",
    title: "Prévisions de remplissage",
    value:
      "Estimez le délai avant saturation de vos disques à partir de l'historique réel de Nova.",
  },
];

/** Formate un prix pour l'affichage (symbole € pour EUR). */
export function formatPrice(price: number, currency: string): string {
  const amount = price.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "EUR" ? `${amount} €` : `${amount} ${currency}`;
}
