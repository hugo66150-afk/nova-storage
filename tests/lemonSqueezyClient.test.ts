import { afterEach, describe, expect, it, vi } from "vitest";
import { activateLicense, LicenseApiError, validateLicense } from "../src/main/services/lemonSqueezyClient.js";
import { MONETIZATION } from "../src/shared/monetization.js";

const INSTANCE_NAME = "Nova Storage — test";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("lemonSqueezyClient.activateLicense", () => {
  it("activation réussie → valid + instanceId", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ activated: true, instance: { id: "inst-42" }, meta: { status: "active" } })));
    const r = await activateLicense("KEY-123", INSTANCE_NAME);
    expect(r.valid).toBe(true);
    expect(r.instanceId).toBe("inst-42");
    expect(r.serverStatus).toBe("active");
  });

  it("clé inconnue → LicenseApiError invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_license_key" }, 404)));
    await expect(activateLicense("BAD", INSTANCE_NAME)).rejects.toMatchObject({ code: "invalid" });
  });

  it("licence révoquée → LicenseApiError revoked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ valid: false, meta: { status: "revoked" } })));
    await expect(activateLicense("KEY", INSTANCE_NAME)).rejects.toMatchObject({ code: "revoked" });
  });

  it("licence expirée → LicenseApiError expired", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ valid: false, meta: { status: "expired" } })));
    await expect(activateLicense("KEY", INSTANCE_NAME)).rejects.toMatchObject({ code: "expired" });
  });

  it("licence déjà activée ailleurs → LicenseApiError used", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "activation_count_is_zero" }, 422)));
    await expect(activateLicense("KEY", INSTANCE_NAME)).rejects.toMatchObject({ code: "used" });
  });

  it("réseau indisponible → LicenseApiError offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(activateLicense("KEY", INSTANCE_NAME)).rejects.toMatchObject({ code: "offline" });
  });

  it("timeout → LicenseApiError timeout", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));
    await expect(activateLicense("KEY", INSTANCE_NAME)).rejects.toMatchObject({ code: "timeout" });
  });

  it("réponse non JSON → LicenseApiError invalid_response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    await expect(activateLicense("KEY", INSTANCE_NAME)).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("lemonSqueezyClient.validateLicense", () => {
  it("licence valide → valid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ valid: true, meta: { status: "active" } })));
    const r = await validateLicense("KEY", "inst-1");
    expect(r.valid).toBe(true);
  });

  it("licence invalide → LicenseApiError invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ valid: false, error: "not_found" }, 404)));
    await expect(validateLicense("KEY", null)).rejects.toBeInstanceOf(LicenseApiError);
  });

  it("l'URL d'activation est l'endpoint officiel https (aucun secret)", () => {
    expect(MONETIZATION.payment.activateApiUrl).toMatch(/^https:\/\//);
    expect(MONETIZATION.payment.licenseApiUrl).toMatch(/^https:\/\//);
  });
});
