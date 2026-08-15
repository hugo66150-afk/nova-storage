import { describe, expect, it } from "vitest";
import { checkoutReady, MONETIZATION, validateCheckoutUrl } from "../src/shared/monetization.js";

/**
 * Tests commerciaux du checkout Lemon Squeezy.
 *
 * Règles vérifiées :
 *  - aucune URL de checkout n'est configurée tant que le produit réel n'est
 *    pas publié (l'application ne simule jamais un paiement) ;
 *  - seule une URL https:// explicite peut être ouverte dans le navigateur
 *    (javascript:, file:, http:, espaces, protocoles arbitraires : refus) ;
 *  - l'état « prêt à vendre » est dérivé de l'URL unique (source de vérité),
 *    jamais d'un flag séparé.
 */

describe("validateCheckoutUrl — sécurité de l'ouverture du checkout", () => {
  it("URL vide → refusée avec message « bientôt disponible » (aucun faux paiement)", () => {
    const r = validateCheckoutUrl("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("bientôt disponible");
  });

  it("http:// est refusé (https uniquement)", () => {
    const r = validateCheckoutUrl("http://checkout.lemonsqueezy.com/buy/123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("invalide");
  });

  it("javascript: est refusé (aucune exécution de code)", () => {
    const r = validateCheckoutUrl("javascript:alert(1)");
    expect(r.ok).toBe(false);
  });

  it("file: est refusé (aucun accès au système de fichiers)", () => {
    const r = validateCheckoutUrl("file:///C:/Windows/System32/calc.exe");
    expect(r.ok).toBe(false);
  });

  it("protocole arbitraire est refusé", () => {
    const r = validateCheckoutUrl("chrome://settings");
    expect(r.ok).toBe(false);
  });

  it("URL avec espaces ou sauts de ligne est refusée (injection d'argument)", () => {
    expect(validateCheckoutUrl("https://checkout.example.com/buy\n--flag").ok).toBe(false);
    expect(validateCheckoutUrl("https://checkout.example.com/buy path").ok).toBe(false);
  });

  it("URL sans hôte valide est refusée", () => {
    const r = validateCheckoutUrl("https://example");
    expect(r.ok).toBe(false);
  });

  it("URL https valide est acceptée et renvoyée normalisée", () => {
    const r = validateCheckoutUrl("  https://store.lemonsqueezy.com/checkout/buy/abc-123?checkout=1  ");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.url).toBe("https://store.lemonsqueezy.com/checkout/buy/abc-123?checkout=1");
    }
  });
});

describe("checkoutReady — état honnête du paiement", () => {
  it("vrai dès que le checkout officiel est configuré (produit publié)", () => {
    expect(checkoutReady()).toBe(true);
  });

  it("le checkout configuré est EXACTEMENT le checkout officiel unique (aucun second checkout)", () => {
    expect(MONETIZATION.payment.checkoutUrl).toBe(
      "https://novastorage.lemonsqueezy.com/checkout/buy/18829073-b7bc-4459-84c6-13ee2874c8a7",
    );
    // https strict : la validation d'URL l'accepte (sinon le bouton d'achat
    // resterait inactif et le rapport de cohérence le signalerait).
    expect(validateCheckoutUrl(MONETIZATION.payment.checkoutUrl).ok).toBe(true);
  });
});
