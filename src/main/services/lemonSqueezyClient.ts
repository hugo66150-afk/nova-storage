import { MONETIZATION } from "../../shared/monetization.js";

/**
 * Client réseau Lemon Squeezy (validation / activation de licences).
 *
 * Règles :
 *  - L'application n'envoie JAMAIS de données bancaires et n'implémente aucun
 *    paiement : elle n'utilise que les endpoints publics de validation et
 *    d'activation, avec la clé de licence saisie par l'utilisateur.
 *  - Aucun secret n'est embarqué (la clé d'API admin vit uniquement dans les
 *    outils backend, hors application).
 *  - Toutes les erreurs sont mappées en codes utilisateur compréhensibles
 *    (jamais de "HTTP 401" brut).
 */

export type LicenseErrorCode =
  | "offline" // réseau indisponible
  | "timeout" // délai dépassé
  | "invalid" // clé invalide / inconnue
  | "revoked" // licence révoquée
  | "expired" // licence expirée
  | "used" // trop d'activations (licence déjà utilisée sur un autre poste)
  | "invalid_response"; // réponse API illisible

export class LicenseApiError extends Error {
  readonly code: LicenseErrorCode;
  constructor(code: LicenseErrorCode, message?: string) {
    super(message ?? code);
    this.name = "LicenseApiError";
    this.code = code;
  }
}

export interface LicenseApiResult {
  valid: boolean;
  instanceId: string | null;
  /** statut serveur brut (active / expired / revoked / …) ou null. */
  serverStatus: string | null;
}

interface RawValidateBody {
  valid?: boolean;
  activated?: boolean;
  error?: string;
  instance?: { id?: string | number };
  license_key?: { status?: string };
  meta?: { status?: string };
}

const TIMEOUT_MS = MONETIZATION.payment.requestTimeoutMs;

async function request(url: string, body: unknown): Promise<RawValidateBody> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new LicenseApiError(aborted ? "timeout" : "offline");
  } finally {
    clearTimeout(timer);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new LicenseApiError("invalid_response");
  }
  if (typeof data !== "object" || data === null) {
    throw new LicenseApiError("invalid_response");
  }
  return data as RawValidateBody;
}

function mapErrorCode(status: string | undefined, error?: string): LicenseErrorCode {
  if (error === "activation_count_is_zero" || error === "activation_limit_reached" || error === "license_has_been_activated_too_many_times") {
    return "used";
  }
  if (status === "revoked" || status === "disabled") return "revoked";
  if (status === "expired" || status === "pending") return "expired";
  return "invalid";
}

/** Active une licence Lemon Squeezy sur cette machine (instance). */
export async function activateLicense(
  licenseKey: string,
  instanceName: string,
): Promise<LicenseApiResult> {
  const body = await request(MONETIZATION.payment.activateApiUrl, {
    license_key: licenseKey,
    instance_name: instanceName,
  });
  const status = body.meta?.status ?? body.license_key?.status ?? null;
  if (body.valid === true || body.activated === true) {
    const id = body.instance?.id;
    return { valid: true, instanceId: id != null ? String(id) : null, serverStatus: status };
  }
  throw new LicenseApiError(mapErrorCode(status ?? undefined, body.error), body.error);
}

/** Valide une licence déjà activée (revalidation périodique / hors ligne). */
export async function validateLicense(
  licenseKey: string,
  instanceId: string | null,
): Promise<LicenseApiResult> {
  const body = await request(MONETIZATION.payment.licenseApiUrl, {
    license_key: licenseKey,
    instance_id: instanceId ?? undefined,
  });
  const status = body.meta?.status ?? body.license_key?.status ?? null;
  if (body.valid === true) {
    return { valid: true, instanceId, serverStatus: status };
  }
  throw new LicenseApiError(mapErrorCode(status ?? undefined, body.error), body.error);
}
