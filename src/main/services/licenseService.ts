import { app } from "electron";
import * as os from "node:os";
import { getPreferences, setPreference } from "../data/repositories.js";
import { FREE_ENTITLEMENTS, MONETIZATION, type EntitlementKey } from "../../shared/monetization.js";
import type { LicenseActivationResult, LicenseInfo, LicenseStatus, LicenseValidationStatus } from "../../shared/types.js";
import {
  activateLicense as lemonSqueezyActivate,
  LicenseApiError,
  type LicenseErrorCode,
  validateLicense as lemonSqueezyValidate,
} from "./lemonSqueezyClient.js";

/**
 * Service de licence — SOURCE DE VÉRITÉ du statut Free / Essai Pro / Pro.
 *
 * Règles de conception :
 *  - Le statut est TOUJOURS calculé (jamais stocké tel quel) à partir de
 *    données brutes (dates, licence) et de l'horloge. Aucun champ
 *    « isPro = true » n'est persisté. Seules des constatations serveur
 *    (invalid / revoked) sont conservées.
 *  - L'état est stocké dans la table `preferences` de la base locale du
 *    profil utilisateur (pas dans le localStorage du renderer) : l'essai et
 *    la licence survivent à la réinstallation de l'application.
 *  - La licence est activée puis validée auprès de Lemon Squeezy (endpoints
 *    publics). Hors ligne, une licence déjà validée reste active pendant une
 *    période de grâce raisonnable ; elle n'est jamais désactivée brutalement.
 *    Une révocation réelle est appliquée à la prochaine validation fiable.
 *  - Nova Free fonctionne intégralement hors ligne, sans aucune dépendance
 *    réseau pour déterminer le statut.
 */

const K_TRIAL_STARTED_AT = "license.trialStartedAt";
const K_TRIAL_ENDS_AT = "license.trialEndsAt";
const K_LICENSE_KEY = "license.key";
const K_ACTIVATED_AT = "license.activatedAt";
const K_INSTANCE_ID = "license.instanceId";
const K_LAST_VALIDATED_AT = "license.lastValidatedAt";
const K_INVALID_REASON = "license.invalidReason";
const K_LICENSE_TYPE = "license.type";

const DAY_MS = 24 * 60 * 60 * 1000;
const INSTANCE_NAME = `Nova Storage — ${os.hostname()}`;

export interface LicenseRawState {
  trialStartedAt: number | null;
  trialEndsAt: number | null;
  licenseKey: string | null;
  activatedAt: number | null;
  instanceId: string | null;
  lastValidatedAt: number | null;
  /** Constat serveur : "invalid" | "revoked" | null (aucune valeur = licence valide). */
  invalidReason: "invalid" | "revoked" | null;
  licenseType: string | null;
}

function toNumber(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 6) return "••••";
  return `…${key.slice(-6)}`;
}

/** Fonction pure : statut calculé à partir de l'état brut et de l'horloge. */
export function computeLicenseStatus(raw: LicenseRawState, now: number): LicenseStatus {
  // Constat serveur explicite (révocation / invalidité) → Free + statut clair.
  if (raw.licenseKey && raw.invalidReason === "revoked") return "license_revoked";
  if (raw.licenseKey && raw.invalidReason === "invalid") return "license_invalid";

  // Licence activée : pro tant que le serveur n'a pas dit le contraire.
  // Hors ligne, elle reste active (pas de désactivation brutale).
  if (raw.licenseKey && raw.activatedAt) return "pro";

  if (raw.trialStartedAt != null && raw.trialEndsAt != null) {
    // Horloge système reculée : l'essai reste actif, borné à sa durée nominale.
    if (now < raw.trialStartedAt) return "trial_pro";
    if (now < raw.trialEndsAt) return "trial_pro";
    return "trial_expired";
  }
  return "free";
}

/** Jours restants de l'essai, bornés entre 0 et la durée nominale. */
export function trialDaysLeft(raw: LicenseRawState, now: number): number {
  if (raw.trialStartedAt == null || raw.trialEndsAt == null) return 0;
  if (now >= raw.trialEndsAt) return 0;
  const start = Math.max(now, raw.trialStartedAt);
  const days = Math.ceil((raw.trialEndsAt - start) / DAY_MS);
  return Math.min(Math.max(days, 0), MONETIZATION.trialDays);
}

/** Message utilisateur clair par code d'erreur de licence (jamais technique). */
export function friendlyLicenseMessage(code: LicenseErrorCode): string {
  switch (code) {
    case "offline":
      return "Impossible de contacter le serveur de licence. Vérifiez votre connexion puis réessayez.";
    case "timeout":
      return "Le serveur de licence met trop de temps à répondre. Réessayez dans quelques instants.";
    case "invalid":
      return "Cette licence n'est pas valide. Vérifiez votre clé puis réessayez.";
    case "revoked":
      return "Cette licence a été révoquée. Contactez le support Nova Storage pour plus d'informations.";
    case "expired":
      return "Cette licence a expiré.";
    case "used":
      return "Cette licence a déjà été activée sur un autre poste. Réinitialisez son activation depuis votre espace client Lemon Squeezy.";
    case "invalid_response":
      return "Le serveur de licence a renvoyé une réponse inattendue. Réessayez plus tard.";
  }
}

function validationStatusOf(raw: LicenseRawState, now: number): LicenseValidationStatus {
  if (raw.invalidReason === "revoked") return "revoked";
  if (raw.invalidReason === "invalid") return "invalid";
  if (raw.licenseKey && raw.activatedAt) {
    if (raw.lastValidatedAt == null) return "never";
    if (now - raw.lastValidatedAt <= MONETIZATION.payment.offlineGraceMs) return "valid";
    return "unverified";
  }
  return "never";
}

class LicenseService {
  /** Override de développement EXPLICITE : uniquement si
   *  DEV_PRO_OVERRIDE=true ET build non packagé. Impossible en production. */
  private get devOverride(): boolean {
    return process.env.DEV_PRO_OVERRIDE === "true" && !app.isPackaged;
  }

  private readRaw(): LicenseRawState {
    const prefs = getPreferences();
    return {
      trialStartedAt: toNumber(prefs[K_TRIAL_STARTED_AT]),
      trialEndsAt: toNumber(prefs[K_TRIAL_ENDS_AT]),
      licenseKey: prefs[K_LICENSE_KEY] ?? null,
      activatedAt: toNumber(prefs[K_ACTIVATED_AT]),
      instanceId: prefs[K_INSTANCE_ID] ?? null,
      lastValidatedAt: toNumber(prefs[K_LAST_VALIDATED_AT]),
      invalidReason: prefs[K_INVALID_REASON] === "revoked" ? "revoked" : prefs[K_INVALID_REASON] === "invalid" ? "invalid" : null,
      licenseType: prefs[K_LICENSE_TYPE] ?? null,
    };
  }

  getInfo(now = Date.now()): LicenseInfo {
    const raw = this.readRaw();
    const status: LicenseStatus = this.devOverride ? "pro" : computeLicenseStatus(raw, now);
    const trialActive = status === "trial_pro";
    return {
      status,
      isPro: status === "pro" || status === "trial_pro",
      trialActive,
      trialDaysLeft: trialActive ? trialDaysLeft(raw, now) : 0,
      trialStartedAt: raw.trialStartedAt,
      trialEndsAt: raw.trialEndsAt,
      trialUsed: raw.trialStartedAt != null,
      licenseKey: raw.licenseKey,
      licenseKeyHint: maskKey(raw.licenseKey),
      activatedAt: raw.activatedAt,
      lastValidatedAt: raw.lastValidatedAt,
      validationStatus: validationStatusOf(raw, now),
      devOverride: this.devOverride,
    };
  }

  /**
   * Démarre l'essai Pro unique (7 jours). Ne peut être appelé qu'une seule
   * fois : une fois consommé, il ne recommence jamais (même après
   * réinstallation, l'état vit dans la base locale du profil utilisateur).
   */
  startTrial(now = Date.now()): LicenseInfo {
    const raw = this.readRaw();
    if (raw.trialStartedAt != null) {
      return this.getInfo(now);
    }
    const endsAt = now + MONETIZATION.trialDays * DAY_MS;
    setPreference(K_TRIAL_STARTED_AT, String(now));
    setPreference(K_TRIAL_ENDS_AT, String(endsAt));
    return this.getInfo(now);
  }

  /** Droit d'accès à une fonctionnalité. Le Pro (et l'essai Pro) a tout. */
  can(key: EntitlementKey, now = Date.now()): boolean {
    if (FREE_ENTITLEMENTS.includes(key)) return true;
    return this.getInfo(now).isPro;
  }

  /** Active une licence Lemon Squeezy sur cette machine. */
  async activateLicense(licenseKey: string, now = Date.now()): Promise<LicenseActivationResult> {
    const key = licenseKey.trim();
    if (!key) {
      return { ok: false, message: "Veuillez saisir votre clé de licence.", info: this.getInfo(now) };
    }
    try {
      const result = await lemonSqueezyActivate(key, INSTANCE_NAME);
      if (!result.valid) {
        return { ok: false, message: friendlyLicenseMessage("invalid"), info: this.getInfo(now) };
      }
      setPreference(K_LICENSE_KEY, key);
      setPreference(K_ACTIVATED_AT, String(now));
      setPreference(K_LAST_VALIDATED_AT, String(now));
      setPreference(K_LICENSE_TYPE, "PRO_PURCHASE");
      if (result.instanceId) setPreference(K_INSTANCE_ID, result.instanceId);
      setPreference(K_INVALID_REASON, "");
      const info = this.getInfo(now);
      return { ok: true, message: "✨ Nova Pro est activé.", info };
    } catch (err) {
      const code = err instanceof LicenseApiError ? err.code : "invalid";
      return { ok: false, message: friendlyLicenseMessage(code), info: this.getInfo(now) };
    }
  }

  /**
   * Restaure / revalide la licence déjà activée sur cette machine (utile
   * après réinstallation — les données sont conservées — ou pour repasser
   * en ligne). Hors ligne, la licence reste active (pas de blocage brutal).
   */
  async restoreLicense(now = Date.now()): Promise<LicenseActivationResult> {
    const raw = this.readRaw();
    if (!raw.licenseKey) {
      return { ok: false, message: "Aucune licence à restaurer. Activez votre clé pour retrouver Nova Pro.", info: this.getInfo(now) };
    }
    try {
      const result = await lemonSqueezyValidate(raw.licenseKey, raw.instanceId);
      if (result.valid) {
        setPreference(K_LAST_VALIDATED_AT, String(now));
        setPreference(K_INVALID_REASON, "");
        return { ok: true, message: "Votre licence Nova Pro a été restaurée.", info: this.getInfo(now) };
      }
      return { ok: false, message: friendlyLicenseMessage("invalid"), info: this.getInfo(now) };
    } catch (err) {
      const code = err instanceof LicenseApiError ? err.code : "invalid";
      if (code === "invalid" || code === "revoked" || code === "expired") {
        // Constat serveur explicite : on enregistre la révocation/invalidité.
        const reason = code === "revoked" ? "revoked" : "invalid";
        setPreference(K_INVALID_REASON, reason);
      }
      const message =
        code === "offline" || code === "timeout"
          ? "Impossible de vérifier votre licence pour le moment. Nova continue de fonctionner hors ligne."
          : friendlyLicenseMessage(code);
      return { ok: code === "offline" || code === "timeout", message, info: this.getInfo(now) };
    }
  }

  /** Revalidation périodique (au plus une fois par période, si connecté). */
  async revalidateIfDue(now = Date.now()): Promise<void> {
    const raw = this.readRaw();
    if (!raw.licenseKey || !raw.activatedAt) return;
    if (raw.invalidReason) return;
    const last = raw.lastValidatedAt ?? 0;
    if (now - last < MONETIZATION.payment.revalidateAfterMs) return;
    await this.restoreLicense(now);
  }
}

export const licenseService = new LicenseService();
