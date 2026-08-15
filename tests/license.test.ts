import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Le mock electron est autonome (appelé à l'import du service) : app.isPackaged
// est contrôlable depuis les tests via vi.hoisted.
const mockElectron = vi.hoisted(() => ({ isPackaged: false }));
const mockPrefs = vi.hoisted(() => ({ store: new Map<string, string>() }));

// Client Lemon Squeezy mocké : les implémentations sont injectées par test.
const mockLemon = vi.hoisted(() => ({
  activateImpl: null as null | ((key: string, name: string) => { valid: boolean; instanceId: string | null; serverStatus: string | null }),
  validateImpl: null as null | ((key: string, id: string | null) => { valid: boolean; instanceId: string | null; serverStatus: string | null }),
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return mockElectron.isPackaged;
    },
    getPath: () => require("node:os").tmpdir(),
    getVersion: () => "1.0.0-test",
  },
  shell: {
    trashItem: vi.fn().mockResolvedValue(undefined),
  },
  Notification: class {
    show(): void {
      /* noop */
    }
  },
}));

vi.mock("../src/main/services/lemonSqueezyClient.js", () => {
  class LicenseApiError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.name = "LicenseApiError";
      this.code = code;
    }
  }
  return {
    LicenseApiError,
    activateLicense: (key: string, name: string) => {
      if (!mockLemon.activateImpl) throw new LicenseApiError("invalid");
      return mockLemon.activateImpl(key, name);
    },
    validateLicense: (key: string, id: string | null) => {
      if (!mockLemon.validateImpl) throw new LicenseApiError("invalid");
      return mockLemon.validateImpl(key, id);
    },
  };
});

vi.mock("../src/main/data/repositories.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/data/repositories.js")>();
  return {
    ...actual,
    getPreferences: () => Object.fromEntries(mockPrefs.store),
    setPreference: (key: string, value: string) => {
      mockPrefs.store.set(key, value);
    },
  };
});

import { computeLicenseStatus, licenseService, trialDaysLeft, type LicenseRawState } from "../src/main/services/licenseService.js";
import { checkoutReady, FREE_ENTITLEMENTS, MONETIZATION, PRO_ENTITLEMENTS } from "../src/shared/monetization.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function raw(partial: Partial<LicenseRawState> = {}): LicenseRawState {
  return {
    trialStartedAt: partial.trialStartedAt ?? null,
    trialEndsAt: partial.trialEndsAt ?? null,
    licenseKey: partial.licenseKey ?? null,
    activatedAt: partial.activatedAt ?? null,
    instanceId: partial.instanceId ?? null,
    lastValidatedAt: partial.lastValidatedAt ?? null,
    invalidReason: partial.invalidReason ?? null,
    licenseType: partial.licenseType ?? null,
  };
}

function trialRaw(now = NOW): LicenseRawState {
  return { ...raw(), trialStartedAt: now, trialEndsAt: now + MONETIZATION.trialDays * DAY };
}

describe("computeLicenseStatus — fonction pure", () => {
  it("aucune donnée → free", () => {
    expect(computeLicenseStatus(raw(), NOW)).toBe("free");
  });

  it("essai en cours → trial_pro", () => {
    expect(computeLicenseStatus(trialRaw(NOW), NOW)).toBe("trial_pro");
  });

  it("essai expiré → trial_expired", () => {
    const r = trialRaw(NOW);
    expect(computeLicenseStatus(r, NOW + 8 * DAY)).toBe("trial_expired");
  });

  it("jour exact de l'expiration → trial_expired", () => {
    const r = trialRaw(NOW);
    expect(computeLicenseStatus(r, NOW + MONETIZATION.trialDays * DAY)).toBe("trial_expired");
  });

  it("horloge système reculée → essai reste actif (pas d'allongement au-delà de la durée nominale)", () => {
    const r = trialRaw(NOW);
    // L'horloge a reculé de 10 jours : l'essai ne doit pas être considéré expiré.
    expect(computeLicenseStatus(r, NOW - 10 * DAY)).toBe("trial_pro");
  });

  it("licence activée (future) → pro", () => {
    expect(computeLicenseStatus(raw({ licenseKey: "X-1", activatedAt: NOW }), NOW)).toBe("pro");
  });

  it("licence sans activation → pas pro (aucun déblocage sans validation)", () => {
    expect(computeLicenseStatus(raw({ licenseKey: "X-1" }), NOW)).toBe("free");
  });
});

describe("trialDaysLeft — jours restants bornés", () => {
  it("7 jours au démarrage", () => {
    expect(trialDaysLeft(trialRaw(NOW), NOW)).toBe(MONETIZATION.trialDays);
  });

  it("arrondi à la borne supérieure en cours de journée", () => {
    const r = trialRaw(NOW);
    expect(trialDaysLeft(r, NOW + 3 * DAY + 1)).toBe(4);
  });

  it("0 une fois expiré", () => {
    const r = trialRaw(NOW);
    expect(trialDaysLeft(r, NOW + 8 * DAY)).toBe(0);
  });

  it("jamais négatif ni supérieur à la durée nominale (horloge reculée)", () => {
    const r = trialRaw(NOW);
    expect(trialDaysLeft(r, NOW - 10 * DAY)).toBe(MONETIZATION.trialDays);
  });
});

describe("licenseService — activation / licence Lemon Squeezy", () => {
  beforeEach(() => {
    mockPrefs.store.clear();
    mockLemon.activateImpl = null;
    mockLemon.validateImpl = null;
  });

  it("l'activation réussie stocke la licence et active immédiatement le Pro", async () => {
    mockLemon.activateImpl = () => ({ valid: true, instanceId: "inst-1", serverStatus: "active" });
    const result = await licenseService.activateLicense("NOVA-KEY-1234", NOW);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("✨ Nova Pro est activé.");
    const info = result.info;
    expect(info.status).toBe("pro");
    expect(info.isPro).toBe(true);
    expect(info.licenseKeyHint).toContain("1234");
    expect(info.validationStatus).toBe("valid");
    expect(info.lastValidatedAt).toBe(NOW);
    expect(licenseService.can("automation", NOW)).toBe(true);
    // Persistance brute (aucun isPro) :
    expect(mockPrefs.store.get("license.key")).toBe("NOVA-KEY-1234");
    expect(mockPrefs.store.get("license.instanceId")).toBe("inst-1");
    expect(mockPrefs.store.get("license.type")).toBe("PRO_PURCHASE");
    expect([...mockPrefs.store.keys()].some((k) => /ispro|status/i.test(k))).toBe(false);
  });

  it("clé vide → refusée, rien n'est stocké", async () => {
    const result = await licenseService.activateLicense("   ", NOW);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("clé de licence");
    expect(result.info.status).toBe("free");
    expect(mockPrefs.store.get("license.key")).toBeUndefined();
  });

  it("licence révoquée par le serveur → activation refusée, statut Free", async () => {
    const { LicenseApiError } = await import("../src/main/services/lemonSqueezyClient.js");
    mockLemon.activateImpl = () => {
      throw new LicenseApiError("revoked");
    };
    const result = await licenseService.activateLicense("KEY", NOW);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("révoquée");
    expect(result.info.isPro).toBe(false);
  });

  it("réseau indisponible à l'activation → erreur claire, rien n'est stocké", async () => {
    const { LicenseApiError } = await import("../src/main/services/lemonSqueezyClient.js");
    mockLemon.activateImpl = () => {
      throw new LicenseApiError("offline");
    };
    const result = await licenseService.activateLicense("KEY", NOW);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("connexion");
    expect(mockPrefs.store.get("license.key")).toBeUndefined();
  });

  it("restauration sans licence stockée → message clair", async () => {
    const result = await licenseService.restoreLicense(NOW);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Aucune licence");
  });

  it("restauration valide → revalide et met à jour la dernière validation", async () => {
    mockLemon.activateImpl = () => ({ valid: true, instanceId: "inst-1", serverStatus: "active" });
    await licenseService.activateLicense("KEY", NOW);
    mockLemon.validateImpl = () => ({ valid: true, instanceId: "inst-1", serverStatus: "active" });
    const result = await licenseService.restoreLicense(NOW + DAY);
    expect(result.ok).toBe(true);
    expect(result.info.lastValidatedAt).toBe(NOW + DAY);
    expect(result.info.validationStatus).toBe("valid");
  });

  it("révocation confirmée par le serveur → statut license_revoked, retour Free", async () => {
    mockLemon.activateImpl = () => ({ valid: true, instanceId: "inst-1", serverStatus: "active" });
    await licenseService.activateLicense("KEY", NOW);
    const { LicenseApiError } = await import("../src/main/services/lemonSqueezyClient.js");
    mockLemon.validateImpl = () => {
      throw new LicenseApiError("revoked");
    };
    const result = await licenseService.restoreLicense(NOW + DAY);
    expect(result.ok).toBe(false);
    expect(result.info.status).toBe("license_revoked");
    expect(result.info.isPro).toBe(false);
    expect(licenseService.can("automation", NOW + DAY)).toBe(false);
    expect(mockPrefs.store.get("license.invalidReason")).toBe("revoked");
  });

  it("hors ligne pendant la restauration → Nova reste Pro (aucun blocage brutal)", async () => {
    mockLemon.activateImpl = () => ({ valid: true, instanceId: "inst-1", serverStatus: "active" });
    await licenseService.activateLicense("KEY", NOW);
    const { LicenseApiError } = await import("../src/main/services/lemonSqueezyClient.js");
    mockLemon.validateImpl = () => {
      throw new LicenseApiError("offline");
    };
    const result = await licenseService.restoreLicense(NOW + DAY);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("hors ligne");
    expect(result.info.status).toBe("pro");
    expect(result.info.isPro).toBe(true);
  });

  it("revalidation périodique : pas avant la période, déclenchée après", async () => {
    mockLemon.activateImpl = () => ({ valid: true, instanceId: "inst-1", serverStatus: "active" });
    await licenseService.activateLicense("KEY", NOW);
    const validate = vi.fn(() => ({ valid: true, instanceId: "inst-1", serverStatus: "active" }));
    mockLemon.validateImpl = validate;
    await licenseService.revalidateIfDue(NOW);
    expect(validate).not.toHaveBeenCalled();
    await licenseService.revalidateIfDue(NOW + 2 * DAY);
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it("une licence révoquée n'est plus revalidée (constat déjà connu)", async () => {
    mockLemon.activateImpl = () => ({ valid: true, instanceId: "inst-1", serverStatus: "active" });
    await licenseService.activateLicense("KEY", NOW);
    const { LicenseApiError } = await import("../src/main/services/lemonSqueezyClient.js");
    mockLemon.validateImpl = () => {
      throw new LicenseApiError("revoked");
    };
    await licenseService.restoreLicense(NOW + DAY);
    const validate = vi.fn();
    mockLemon.validateImpl = validate;
    await licenseService.revalidateIfDue(NOW + 3 * DAY);
    expect(validate).not.toHaveBeenCalled();
  });
});

describe("licenseService — Free", () => {
  beforeEach(() => mockPrefs.store.clear());

  it("statut free par défaut, aucune fonctionnalité Pro", () => {
    const info = licenseService.getInfo(NOW);
    expect(info.status).toBe("free");
    expect(info.isPro).toBe(false);
    expect(info.trialActive).toBe(false);
    expect(info.trialUsed).toBe(false);
    expect(info.trialDaysLeft).toBe(0);
    expect(licenseService.can("automation", NOW)).toBe(false);
    expect(licenseService.can("scheduledMaintenance", NOW)).toBe(false);
    expect(licenseService.can("advancedGuardian", NOW)).toBe(false);
    expect(licenseService.can("guardianPredictions", NOW)).toBe(false);
  });
});

describe("licenseService — essai Pro unique", () => {
  beforeEach(() => mockPrefs.store.clear());

  it("startTrial démarre un essai de 7 jours, accès Pro complet", () => {
    const info = licenseService.startTrial(NOW);
    expect(info.status).toBe("trial_pro");
    expect(info.isPro).toBe(true);
    expect(info.trialActive).toBe(true);
    expect(info.trialDaysLeft).toBe(MONETIZATION.trialDays);
    expect(info.trialUsed).toBe(true);
    expect(licenseService.can("automation", NOW)).toBe(true);
    expect(licenseService.can("guardianPredictions", NOW)).toBe(true);
  });

  it("l'essai est persistant (relecture depuis le stockage)", () => {
    licenseService.startTrial(NOW);
    const info = licenseService.getInfo(NOW);
    expect(info.trialActive).toBe(true);
    expect(info.trialStartedAt).toBe(NOW);
    expect(info.trialEndsAt).toBe(NOW + MONETIZATION.trialDays * DAY);
  });

  it("l'essai ne peut PAS être redémarré une seconde fois", () => {
    const first = licenseService.startTrial(NOW);
    const second = licenseService.startTrial(NOW + DAY);
    expect(second.trialStartedAt).toBe(first.trialStartedAt);
    expect(second.trialEndsAt).toBe(first.trialEndsAt);
    // L'horloge n'est pas décalée : l'essai initial reste la référence.
    expect(second.status).toBe("trial_pro");
  });

  it("après expiration : trial_expired, plus aucun droit Pro, données intactes", () => {
    licenseService.startTrial(NOW);
    const expired = licenseService.getInfo(NOW + 8 * DAY);
    expect(expired.status).toBe("trial_expired");
    expect(expired.isPro).toBe(false);
    expect(expired.trialDaysLeft).toBe(0);
    expect(licenseService.can("automation", NOW + 8 * DAY)).toBe(false);
    // Les données brutes restent stockées (règles conservées, essai consommé).
    expect(expired.trialUsed).toBe(true);
    expect(mockPrefs.store.get("license.trialStartedAt")).toBe(String(NOW));
  });
});

describe("licenseService — sécurité", () => {
  beforeEach(() => mockPrefs.store.clear());

  it("données corrompues → traitées comme absentes (free, jamais pro)", () => {
    mockPrefs.store.set("license.trialStartedAt", "pas-un-nombre");
    mockPrefs.store.set("license.trialEndsAt", "abc");
    const info = licenseService.getInfo(NOW);
    expect(info.status).toBe("free");
    expect(info.isPro).toBe(false);
    expect(info.trialUsed).toBe(false);
  });

  it("aucun champ isPro persisté : le statut est toujours recalculé", () => {
    licenseService.startTrial(NOW);
    const keys = [...mockPrefs.store.keys()];
    expect(keys.some((k) => /ispro|status|trial_active/i.test(k))).toBe(false);
    expect(keys).toContain("license.trialStartedAt");
    expect(keys).toContain("license.trialEndsAt");
  });

  it("DEV_PRO_OVERRIDE n'active le Pro QUE sur un build non packagé", () => {
    process.env.DEV_PRO_OVERRIDE = "true";
    try {
      mockElectron.isPackaged = false;
      const dev = licenseService.getInfo(NOW);
      expect(dev.status).toBe("pro");
      expect(dev.devOverride).toBe(true);

      // Build de production : l'override est ignoré, on reste free.
      mockElectron.isPackaged = true;
      const prod = licenseService.getInfo(NOW);
      expect(prod.status).toBe("free");
      expect(prod.devOverride).toBe(false);
      expect(licenseService.can("automation", NOW)).toBe(false);
    } finally {
      delete process.env.DEV_PRO_OVERRIDE;
      mockElectron.isPackaged = false;
    }
  });

  it("sans override, la variable DEV_PRO_OVERRIDE seule ne débloque rien en production", () => {
    process.env.DEV_PRO_OVERRIDE = "true";
    try {
      mockElectron.isPackaged = true;
      expect(licenseService.getInfo(NOW).status).toBe("free");
    } finally {
      delete process.env.DEV_PRO_OVERRIDE;
      mockElectron.isPackaged = false;
    }
  });

  it("le statut ne dépend d'aucun réseau (fonctionnement hors ligne complet)", () => {
    // Aucun fetch/HTTP dans le service : l'appel direct prouve l'absence de dépendance.
    const info = licenseService.getInfo(NOW);
    expect(info.status).toBe("free");
    expect(licenseService.can("automation", NOW)).toBe(false);
  });
});

describe("licenseService — configuration centralisée", () => {
  it("la durée d'essai et les prix viennent de la config unique", () => {
    expect(MONETIZATION.trialDays).toBe(7);
    expect(MONETIZATION.pricing.proPrice).toBe(9.97);
    expect(MONETIZATION.pricing.currency).toBe("EUR");
    expect(MONETIZATION.payment.provider).toBe("lemon_squeezy");
    // Checkout réel configuré : UNE seule URL officielle (le même checkout
    // que le site Nova Storage — aucun second checkout). Les identifiants du
    // produit sont publics et centralisés ici, jamais dupliqués ailleurs.
    expect(MONETIZATION.payment.productId).toBe("1292367");
    expect(MONETIZATION.payment.variantId).toBe("2022137");
    expect(MONETIZATION.payment.checkoutUrl).toBe(
      "https://novastorage.lemonsqueezy.com/checkout/buy/18829073-b7bc-4459-84c6-13ee2874c8a7",
    );
    expect(checkoutReady()).toBe(true);
  });

  it("toutes les clés Pro sont déclarées dans la config (aucun droit sauvage)", () => {
    expect(PRO_ENTITLEMENTS).toContain("automation");
    expect(PRO_ENTITLEMENTS).toContain("guardianPredictions");
    // Aucun chevauchement Free/Pro : une clé est soit Free, soit Pro.
    for (const k of FREE_ENTITLEMENTS) {
      expect(PRO_ENTITLEMENTS.includes(k)).toBe(false);
    }
  });
});

afterEach(() => {
  delete process.env.DEV_PRO_OVERRIDE;
  mockElectron.isPackaged = false;
  mockPrefs.store.clear();
  mockLemon.activateImpl = null;
  mockLemon.validateImpl = null;
});
