import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:\\mock\\userData",
    getVersion: () => "0.0.0-test",
  },
  shell: {
    trashItem: vi.fn(),
  },
}));

import {
  dedupeNestedLibraries,
  dirnameOfExe,
  isLauncherFolder,
  libraryFromRegEntry,
  parseVdfFolders,
} from "../src/main/services/games";

function entry(
  overrides: Partial<{
    name: string
    publisher: string
    installLocation: string
    uninstallString: string
    displayIcon: string
  }>,
) {
  return {
    name: "Game",
    publisher: "Acme",
    installLocation: "",
    ...overrides,
  };
}

describe("libraryFromRegEntry", () => {
  it("détecte les jeux Riot (Valorant, League of Legends) via le registre", () => {
    const lib = libraryFromRegEntry(
      entry({ name: "VALORANT", publisher: "Riot Games, Inc.", installLocation: "C:\\Riot Games\\VALORANT" }),
    );
    expect(lib?.library).toBe("Riot");
    expect(lib?.root).toBe("C:\\Riot Games\\VALORANT");
  });

  it("mappe Blizzard sur Battle.net", () => {
    const lib = libraryFromRegEntry(
      entry({ name: "Diablo IV", publisher: "Blizzard Entertainment", installLocation: "D:\\Games\\Diablo IV" }),
    );
    expect(lib?.library).toBe("Battle.net");
  });

  it("mappe GOG / CD Projekt sur GOG", () => {
    const lib = libraryFromRegEntry(
      entry({ name: "The Witcher 3", publisher: "CD PROJEKT RED", installLocation: "C:\\GOG Games\\The Witcher 3" }),
    );
    expect(lib?.library).toBe("GOG");
  });

  it("mappe les autres éditeurs de jeux sur Other", () => {
    const lib = libraryFromRegEntry(
      entry({
        name: "Far Cry 6",
        publisher: "Ubisoft",
        installLocation: "C:\\Program Files (x86)\\Ubisoft\\Far Cry 6",
      }),
    );
    expect(lib?.library).toBe("Other");
  });

  it("ignore les entrées sans dossier exploitable", () => {
    expect(libraryFromRegEntry(entry({ publisher: "Ubisoft", installLocation: "" }))).toBeNull();
  });

  it("déduit le dossier du jeu depuis le chemin de désinstallation (indés sans InstallLocation)", () => {
    const lib = libraryFromRegEntry(
      entry({
        name: "Hollow Knight",
        publisher: "Team Cherry",
        installLocation: "",
        uninstallString: '"C:\\Games\\Hollow Knight\\unins000.exe"',
      }),
    );
    expect(lib?.root).toBe("C:\\Games\\Hollow Knight");
  });

  it("déduit le dossier depuis l'icône en dernier recours", () => {
    const lib = libraryFromRegEntry(
      entry({
        name: "Some Indie Game",
        publisher: "Devolver Digital",
        installLocation: "",
        uninstallString: "",
        displayIcon: "D:\\Indie\\Some Game\\game.exe",
      }),
    );
    expect(lib?.root).toBe("D:\\Indie\\Some Game");
  });

  it("ignore les éditeurs non-jeux", () => {
    expect(
      libraryFromRegEntry(entry({ publisher: "Google LLC", installLocation: "C:\\Program Files\\Chrome" })),
    ).toBeNull();
  });

  it("ignore Riot Vanguard (anti-triche, pas un jeu)", () => {
    expect(
      libraryFromRegEntry(
        entry({ name: "Riot Vanguard", publisher: "Riot Games, Inc.", installLocation: "C:\\Program Files\\Riot Vanguard" }),
      ),
    ).toBeNull();
  });

  it("ignore une commande msiexec sans chemin exploitable", () => {
    expect(libraryFromRegEntry(entry({ publisher: "Ubisoft", uninstallString: "MsiExec.exe /X{GUID}" }))).toBeNull();
  });

  it("ignore les launchers même si l'éditeur est un éditeur de jeux", () => {
    expect(
      libraryFromRegEntry(entry({ name: "Steam", publisher: "Valve Corporation", installLocation: "C:\\Program Files (x86)\\Steam" })),
    ).toBeNull();
    expect(
      libraryFromRegEntry(entry({ name: "Riot Client", publisher: "Riot Games, Inc.", installLocation: "C:\\Riot Games\\Riot Client" })),
    ).toBeNull();
  });
});

describe("isLauncherFolder", () => {
  it("exclut les dossiers de launchers connus", () => {
    expect(isLauncherFolder("Riot Client")).toBe(true);
    expect(isLauncherFolder("Battle.net")).toBe(true);
    expect(isLauncherFolder("Ubisoft Game Launcher")).toBe(true);
    expect(isLauncherFolder("steamapps")).toBe(true);
    expect(isLauncherFolder("common")).toBe(true);
  });

  it("garde les vrais dossiers de jeux", () => {
    expect(isLauncherFolder("Riot Vanguard")).toBe(true);
    expect(isLauncherFolder("League of Legends")).toBe(false);
    expect(isLauncherFolder("VALORANT")).toBe(false);
    expect(isLauncherFolder("Counter-Strike 2")).toBe(false);
  });
});

describe("dedupeNestedLibraries", () => {
  const lib = (library: string, root: string) => ({ name: library, library, root } as never);

  it("garde la racine la plus haute quand une entrée registre pointe dans un dossier déjà scanné", () => {
    const out = dedupeNestedLibraries([
      lib("Riot", "C:\\Riot Games"),
      lib("Riot", "C:/Riot Games/League of Legends"),
    ]);
    expect(out).toEqual([{ name: "Riot", library: "Riot", root: "C:\\Riot Games" }]);
  });

  it("garde des racines distinctes", () => {
    const out = dedupeNestedLibraries([
      lib("Steam", "c:\\program files (x86)\\steam\\steamapps\\common"),
      lib("Riot", "C:\\Riot Games"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("tolère / et \\ mélangés dans les chemins", () => {
    const out = dedupeNestedLibraries([
      lib("GOG", "C:\\GOG Games"),
      lib("GOG", "C:/GOG Games/Witcher 3"),
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("dirnameOfExe", () => {
  it("extrait le dossier d'un chemin entre guillemets", () => {
    expect(dirnameOfExe('"C:\\Games\\Titre\\unins000.exe" /S')).toBe("C:\\Games\\Titre");
  });

  it("gère les barres obliques", () => {
    expect(dirnameOfExe("C:/Riot Games/League of Legends/unins000.exe")).toBe("C:/Riot Games/League of Legends");
  });

  it("renvoie null sans chemin de lecteur", () => {
    expect(dirnameOfExe("MsiExec.exe /X{GUID}")).toBeNull();
    expect(dirnameOfExe("")).toBeNull();
  });
});

describe("parseVdfFolders", () => {
  it("extrait les chemins des bibliothèques Steam et dédoublonne", () => {
    const vdf = `"libraryfolders"
{
  "0"
  {
    "path" "C:\\\\Program Files (x86)\\\\Steam"
  }
  "1"
  {
    "path" "D:\\\\SteamLibrary"
  }
  "2"
  {
    "path" "D:\\\\SteamLibrary"
  }
}`;
    expect(parseVdfFolders(vdf)).toEqual(["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]);
  });
});
