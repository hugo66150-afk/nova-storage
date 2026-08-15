import { describe, expect, it } from "vitest";
import { parseRegOutput } from "../src/main/services/apps";
import type { RegEntry } from "../src/main/services/apps";

const SAMPLE = `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\FooApp
    DisplayName    REG_SZ    Foo App
    Publisher    REG_SZ    Acme
    DisplayVersion    REG_SZ    1.2.3
    EstimatedSize    REG_DWORD    0x1234
    InstallLocation    REG_SZ    C:\\Program Files\\Foo
    UninstallString    REG_SZ    C:\\Program Files\\Foo\\uninstall.exe

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Google Chrome
    DisplayName    REG_SZ    Google Chrome
    Publisher    REG_SZ    Google LLC

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{GUID-CAFE}
    DisplayName    REG_SZ    Some MSI App
    UninstallString    REG_SZ    MsiExec.exe /X{GUID-CAFE}
`;

describe("parseRegOutput", () => {
  it("reconnaît les clés dont le dernier segment contient des espaces", () => {
    const entries = new Map<string, RegEntry>();
    parseRegOutput(SAMPLE, entries);
    expect(entries.size).toBe(3);

    const foo = [...entries.values()].find((e) => e.name === "Foo App");
    expect(foo?.publisher).toBe("Acme");
    expect(foo?.version).toBe("1.2.3");
    expect(foo?.estimatedSize).toBe(0x1234);
    expect(foo?.installLocation).toBe("C:\\Program Files\\Foo");
    expect(foo?.isMsi).toBe(false);

    const chrome = [...entries.values()].find((e) => e.name === "Google Chrome");
    expect(chrome?.publisher).toBe("Google LLC");
    expect(chrome?.name).toBe("Google Chrome");

    const msi = [...entries.values()].find((e) => e.name === "Some MSI App");
    expect(msi?.isMsi).toBe(true);
  });

  it("n'hérite pas des valeurs de la clé précédente", () => {
    const entries = new Map<string, RegEntry>();
    parseRegOutput(SAMPLE, entries);
    const chrome = [...entries.values()].find((e) => e.name === "Google Chrome");
    expect(chrome?.version).toBe("");
    expect(chrome?.publisher).toBe("Google LLC");
  });

  it("ignore les clés sans DisplayName", () => {
    const entries = new Map<string, RegEntry>();
    parseRegOutput(`HKEY_LOCAL_MACHINE\\SOFTWARE\\NoName
    Publisher    REG_SZ    Acme
`, entries);
    expect(entries.size).toBe(0);
  });
});
