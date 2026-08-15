import { describe, expect, it } from "vitest";
import { BoundedList } from "../src/main/engine/scanWorker";
import type { WorkerCandidate } from "../src/main/engine/scanWorker";

function cand(size: number, name = `f${size}`): WorkerCandidate {
  return {
    path: `C:\\${name}`,
    name,
    extension: "",
    size,
    created: 0,
    modified: 0,
    isDir: false,
    category: "other",
    safety: "review",
    confidence: 50,
    reasons: [],
    kind: "large",
  };
}

describe("BoundedList (non trié)", () => {
  it("plafonne à cap en préservant l'ordre d'insertion", () => {
    const l = new BoundedList(3, false);
    for (let i = 1; i <= 5; i++) l.push(cand(i));
    expect(l.get()).toHaveLength(3);
    expect(l.get().map((c) => c.size)).toEqual([1, 2, 3]);
  });
});

describe("BoundedList (par taille)", () => {
  it("conserve les cap plus gros, triés décroissant", () => {
    const l = new BoundedList(3, true);
    for (const s of [5, 1, 4, 2, 9, 3, 8]) l.push(cand(s));
    expect(l.get().map((c) => c.size)).toEqual([9, 8, 5]);
  });

  it("ne dépasse jamais cap éléments", () => {
    const l = new BoundedList(10, true);
    for (let i = 0; i < 1000; i++) l.push(cand(i));
    expect(l.get()).toHaveLength(10);
  });

  it("équivaut à un tri de référence sur données pseudo-aléatoires", () => {
    const cap = 25;
    const l = new BoundedList(cap, true);
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const all: number[] = [];
    for (let i = 0; i < 5000; i++) {
      const s = next() % 1_000_000;
      all.push(s);
      l.push(cand(s));
    }
    const expected = [...all].sort((a, b) => b - a).slice(0, cap);
    expect(l.get().map((c) => c.size)).toEqual(expected);
  });

  it("les valeurs égales ne cassent pas le tas", () => {
    const l = new BoundedList(4, true);
    for (let i = 0; i < 50; i++) l.push(cand(7));
    expect(l.get()).toHaveLength(4);
    expect(l.get().every((c) => c.size === 7)).toBe(true);
  });

  it("accepte les tailles nulles sans erreur", () => {
    const l = new BoundedList(2, true);
    for (let i = 0; i < 10; i++) l.push(cand(0));
    expect(l.get()).toHaveLength(2);
    expect(l.get().every((c) => c.size === 0)).toBe(true);
  });
});
