import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:\\mock\\userData",
    getVersion: () => "0.0.0-test",
  },
}));

import {
  msiProductCode,
  parseCommand,
  resolveUninstaller,
} from "../src/main/services/uninstaller";
import type { AppInfo } from "../src/shared/types";

function makeApp(overrides: Partial<AppInfo>): AppInfo {
  return {
    name: "Test App",
    publisher: "Test Corp",
    version: "1.0.0",
    installLocation: "",
    estimatedSize: 0,
    installDate: "",
    size: 0,
    files: 0,
    key: "test",
    type: "win32",
    protected: false,
    protectionReason: "",
    uninstallString: "",
    quietUninstallString: "",
    displayIcon: "",
    registryPath: "",
    displayVersion: "1.0.0",
    lastUsed: null,
    ...overrides,
  };
}

describe("parseCommand", () => {
  it("renvoie exe + args pour une commande simple", () => {
    expect(parseCommand('C:\\Program Files\\App\\uninstall.exe /S --quiet')).toEqual({
      exe: "C:\\Program Files\\App\\uninstall.exe",
      args: ["/S", "--quiet"],
    });
  });

  it("gère les chemins entre guillemets", () => {
    expect(parseCommand('"C:\\Program Files\\App\\uninst.exe" /x {GUID}')).toEqual({
      exe: "C:\\Program Files\\App\\uninst.exe",
      args: ["/x", "{GUID}"],
    });
  });

  it("renvoie une commande vide pour une chaîne vide", () => {
    expect(parseCommand("")).toEqual({ exe: "", args: [] });
    expect(parseCommand("   ")).toEqual({ exe: "", args: [] });
  });
});

describe("msiProductCode", () => {
  const GUID = "{12345678-ABCD-EF01-2345-6789ABCDEF01}";

  it("reconnaît un GUID dans le leaf de la clé registre (case conservée)", () => {
    const app = makeApp({ registryPath: `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${GUID}` });
    expect(msiProductCode(app)).toBe("12345678-ABCD-EF01-2345-6789ABCDEF01");
  });

  it("reconnaît un GUID sans accolades", () => {
    const app = makeApp({ registryPath: `HKLM\\...\\Uninstall\\12345678-ABCD-EF01-2345-6789ABCDEF01` });
    expect(msiProductCode(app)).toBeTruthy();
  });

  it("détecte le GUID dans une commande msiexec", () => {
    const app = makeApp({
      uninstallString: `MsiExec.exe /I${GUID}`,
    });
    const code = msiProductCode(app);
    expect(code).toBe("12345678-abcd-ef01-2345-6789abcdef01");
  });

  it("renvoie null si aucun GUID fiable", () => {
    const app = makeApp({ registryPath: "HKLM\\...\\Uninstall\\Firefox", uninstallString: '"C:\\Program Files\\Mozilla Firefox\\uninstall\\helper.exe"' });
    expect(msiProductCode(app)).toBeNull();
  });
});

describe("resolveUninstaller", () => {
  it("privilégie le MSI quand un code produit est détecté", () => {
    const app = makeApp({ registryPath: `HKLM\\...\\Uninstall\\{12345678-ABCD-EF01-2345-6789ABCDEF01}` });
    const u = resolveUninstaller(app);
    expect(u.type).toBe("msi");
    expect(u.command).toContain("msiexec /x");
    expect(u.productCode).toBeTruthy();
  });

  it("utilise uninstallString en secours", () => {
    const app = makeApp({ uninstallString: "C:\\Tools\\uninstaller.exe /full", quietUninstallString: "C:\\Tools\\uninstaller.exe /quiet" });
    const u = resolveUninstaller(app);
    expect(u.type).toBe("win32");
    expect(u.command).toBe("C:\\Tools\\uninstaller.exe /full");
    expect(u.quiet).toBe("C:\\Tools\\uninstaller.exe /quiet");
  });

  it("utilise modifyPath si uninstallString est vide", () => {
    const app = makeApp({ modifyPath: "C:\\Tools\\setup.exe /modify" });
    const u = resolveUninstaller(app);
    expect(u.command).toBe("C:\\Tools\\setup.exe /modify");
  });

  it("retourne unknown sans commande si rien n'est trouvé", () => {
    const app = makeApp({});
    const u = resolveUninstaller(app);
    expect(u.type).toBe("unknown");
    expect(u.command).toBe("");
  });
});
