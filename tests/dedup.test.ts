import { describe, expect, it } from "vitest";
import { dedupeCandidates } from "../src/main/engine/candidateDedup";
import { buildRecoverableFromSummary } from "../src/main/engine/analysis";

describe("dedupeCandidates", () => {
  it("garde un seul candidat par chemin", () => {
    const out = dedupeCandidates([
      { path: "C:\\a.txt", kind: "temp", size: 10 },
      { path: "C:\\a.txt", kind: "large", size: 10 },
      { path: "C:\\a.txt", kind: "old", size: 10 },
      { path: "C:\\b.txt", kind: "large", size: 5 },
    ]);
    expect(out).toHaveLength(2);
  });

  it("le kind le plus spécifique gagne (temp > large)", () => {
    const out = dedupeCandidates([
      { path: "C:\\a.txt", kind: "large", size: 10 },
      { path: "C:\\a.txt", kind: "temp", size: 10 },
    ]);
    expect(out[0].kind).toBe("temp");
  });

  it("ordre de priorité temp > cache > download > archive > old > large", () => {
    const cases: Array<[string, string, string]> = [
      ["large", "temp", "temp"],
      ["large", "cache", "cache"],
      ["large", "download", "download"],
      ["old", "download", "download"],
      ["large", "old", "old"],
      ["archive", "old", "archive"],
    ];
    for (const [loser, winner, expected] of cases) {
      const out = dedupeCandidates([
        { path: "C:\\x.bin", kind: loser as never, size: 1 },
        { path: "C:\\x.bin", kind: winner as never, size: 1 },
      ]);
      expect(out[0].kind).toBe(expected);
    }
  });

  it("trie par taille décroissante", () => {
    const out = dedupeCandidates([
      { path: "C:\\small.bin", kind: "temp", size: 1 },
      { path: "C:\\big.bin", kind: "temp", size: 100 },
    ]);
    expect(out[0].path).toBe("C:\\big.bin");
  });
});

describe("buildRecoverableFromSummary", () => {
  it("construit les groupes depuis des agrégats SQL", () => {
    const rec = buildRecoverableFromSummary([
      { kind: "temp", bytes: 1000, files: 10 },
      { kind: "download", bytes: 5000, files: 2 },
    ]);
    expect(rec.totalBytes).toBe(6000);
    const groups = new Map(rec.groups.map((g) => [g.key, g]));
    expect(groups.get("temp")).toMatchObject({ bytes: 1000, files: 10, confidence: 92 });
    expect(groups.get("download")).toMatchObject({ bytes: 5000, files: 2, confidence: 70 });
  });

  it("ignore les kinds sans octets", () => {
    const rec = buildRecoverableFromSummary([{ kind: "temp", bytes: 0, files: 0 }]);
    expect(rec.groups).toHaveLength(0);
    expect(rec.totalBytes).toBe(0);
  });
});
