import { ESLint } from "eslint";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test, expect } from "vitest";

const eslint = new ESLint({ overrideConfigFile: "eslint.config.js" });

function parseExpect(source) {
  const match = /^\s*\/\/\s*expect:\s*([^\n]+)/m.exec(source);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

describe("passing examples", () => {
  for (const file of readdirSync("test/examples/passing")) {
    if (!file.endsWith(".js")) continue;
    test(`passing/${file}`, async () => {
      const [result] = await eslint.lintFiles([
        `test/examples/passing/${file}`,
      ]);
      expect(
        result.errorCount,
        `Expected no errors, got:\n${JSON.stringify(result.messages, null, 2)}`,
      ).toBe(0);
    });
  }
});

describe("failing examples", () => {
  for (const file of readdirSync("test/examples/failing")) {
    if (!file.endsWith(".js")) continue;
    test(`failing/${file}`, async () => {
      const path = `test/examples/failing/${file}`;
      const expected = parseExpect(readFileSync(path, "utf8"));
      expect(expected.length, `${file} must have an // expect: comment`).toBeGreaterThan(0);
      const [result] = await eslint.lintFiles([path]);
      const ids = new Set(result.messages.map((m) => m.ruleId));
      for (const id of expected) {
        expect(
          ids,
          `expected rule overlock/${id} to fire on ${file}; messages: ${JSON.stringify(
            result.messages,
            null,
            2,
          )}`,
        ).toContain(`overlock/${id}`);
      }
      expect(
        result.errorCount,
        `${file} must have at least one error; got: ${JSON.stringify(result.messages, null, 2)}`,
      ).toBeGreaterThan(0);
    });
  }
});
