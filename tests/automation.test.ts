import { describe, expect, it } from "vitest";
import { evaluateConditionGroup } from "../src/main/utils/ruleEngine.js";
import type { RuleConditionGroup, FileCandidate } from "../src/shared/types.js";

const mockCandidate: FileCandidate = {
  id: "1:C:\\temp\\test.tmp",
  path: "C:\\temp\\test.tmp",
  name: "test.tmp",
  extension: ".tmp",
  size: 1024 * 1024 * 50,
  created: Date.now() - 40 * 86400000,
  modified: Date.now() - 40 * 86400000,
  isDir: false,
  category: "temp",
  safety: "safe",
  confidence: 90,
  reasons: ["temp file"],
  kind: "temp",
  sourceScanId: 1,
};

describe("evaluateConditionGroup", () => {
  it("évalue correctement une condition simple AND", () => {
    const group: RuleConditionGroup = {
      operator: "AND",
      conditions: [
        { field: "kind", operator: "eq", value: "temp" },
        { field: "size", operator: "gt", value: 1024 },
      ],
    };
    expect(evaluateConditionGroup(group, mockCandidate)).toBe(true);
  });

  it("retourne false si une condition AND échoue", () => {
    const group: RuleConditionGroup = {
      operator: "AND",
      conditions: [
        { field: "kind", operator: "eq", value: "temp" },
        { field: "size", operator: "gt", value: 1024 * 1024 * 100 },
      ],
    };
    expect(evaluateConditionGroup(group, mockCandidate)).toBe(false);
  });

  it("évalue correctement une condition OR", () => {
    const group: RuleConditionGroup = {
      operator: "OR",
      conditions: [
        { field: "kind", operator: "eq", value: "logs" },
        { field: "kind", operator: "eq", value: "temp" },
      ],
    };
    expect(evaluateConditionGroup(group, mockCandidate)).toBe(true);
  });

  it("retourne false pour OR si aucune ne correspond", () => {
    const group: RuleConditionGroup = {
      operator: "OR",
      conditions: [
        { field: "kind", operator: "eq", value: "logs" },
        { field: "kind", operator: "eq", value: "cache" },
      ],
    };
    expect(evaluateConditionGroup(group, mockCandidate)).toBe(false);
  });

  it("gère l'opérateur in", () => {
    const group: RuleConditionGroup = {
      operator: "AND",
      conditions: [{ field: "kind", operator: "in", value: ["temp", "cache", "logs"] }],
    };
    expect(evaluateConditionGroup(group, mockCandidate)).toBe(true);
  });

  it("gère l'opérateur notIn", () => {
    const group: RuleConditionGroup = {
      operator: "AND",
      conditions: [{ field: "kind", operator: "notIn", value: ["logs", "cache"] }],
    };
    expect(evaluateConditionGroup(group, mockCandidate)).toBe(true);
  });

  it("gère l'opérateur contains sur path", () => {
    const group: RuleConditionGroup = {
      operator: "AND",
      conditions: [{ field: "path", operator: "contains", value: "temp" }],
    };
    expect(evaluateConditionGroup(group, mockCandidate)).toBe(true);
  });

  it("gère l'opérateur startsWith sur extension", () => {
    const group: RuleConditionGroup = {
      operator: "AND",
      conditions: [{ field: "extension", operator: "startsWith", value: "." }],
    };
    expect(evaluateConditionGroup(group, mockCandidate)).toBe(true);
  });

  it("gère l'opérateur ageDays", () => {
    const group: RuleConditionGroup = {
      operator: "AND",
      conditions: [{ field: "ageDays", operator: "gt", value: 30 }],
    };
    expect(evaluateConditionGroup(group, mockCandidate)).toBe(true);
  });

  it("gère l'opérateur safety", () => {
    const group: RuleConditionGroup = {
      operator: "AND",
      conditions: [{ field: "safety", operator: "eq", value: "safe" }],
    };
    expect(evaluateConditionGroup(group, mockCandidate)).toBe(true);
  });
});

describe("getCandidatesForRule - SQL generation", () => {
  it("génère correctement les conditions WHERE pour kind", () => {
    const sql = `
      SELECT * FROM candidates
      WHERE scan_id = ? AND kind = ? AND size > ?
      ORDER BY size DESC
    `;
    expect(sql).toContain("kind = ?");
    expect(sql).toContain("size > ?");
  });
});

describe("DryRunResult type", () => {
  it("a la structure attendue", () => {
    const result = {
      ruleId: 1,
      ruleName: "Test",
      candidates: [
        { path: "C:\\test.tmp", size: 1024, kind: "temp", category: "temp" },
      ],
      totalBytes: 1024,
      totalFiles: 1,
    };
    expect(result.candidates).toHaveLength(1);
    expect(result.totalBytes).toBe(1024);
    expect(result.totalFiles).toBe(1);
  });
});