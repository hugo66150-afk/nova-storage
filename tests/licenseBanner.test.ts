import { describe, expect, it } from "vitest";
import { isTrialEndingSoon, TRIAL_ENDING_SOON_DAYS } from "../src/renderer/components/LicenseBanner";

describe("isTrialEndingSoon — rappel Dashboard (affichage uniquement)", () => {
  it("le seuil est de 3 jours", () => {
    expect(TRIAL_ENDING_SOON_DAYS).toBe(3);
  });

  it("signale un essai qui se termine bientôt (1 à 3 jours restants)", () => {
    expect(isTrialEndingSoon(1)).toBe(true);
    expect(isTrialEndingSoon(2)).toBe(true);
    expect(isTrialEndingSoon(3)).toBe(true);
  });

  it("signale le dernier jour (0 jour restant)", () => {
    expect(isTrialEndingSoon(0)).toBe(true);
  });

  it("ne signale PAS un essai encore confortable (> 3 jours)", () => {
    expect(isTrialEndingSoon(4)).toBe(false);
    expect(isTrialEndingSoon(5)).toBe(false);
    expect(isTrialEndingSoon(7)).toBe(false);
  });

  it("reste sûr sur des valeurs anormales (jamais de rappel hors essai actif)", () => {
    expect(isTrialEndingSoon(-1)).toBe(false);
    expect(isTrialEndingSoon(-7)).toBe(false);
    expect(isTrialEndingSoon(999)).toBe(false);
  });
});
