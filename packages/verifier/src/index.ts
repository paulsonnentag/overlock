import { Linter } from "eslint-linter-browserify";
import type { Linter as LinterNs } from "eslint";
import overlock from "./plugin.js";

const linter = new Linter();

const flatConfig: LinterNs.Config[] = [
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    plugins: { overlock },
    rules: overlock.configs.recommended.rules,
  },
];

export class VerificationError extends Error {
  readonly filePath: string;
  readonly messages: LinterNs.LintMessage[];
  constructor(filePath: string, messages: LinterNs.LintMessage[]) {
    super(formatSummary(filePath, messages));
    this.name = "VerificationError";
    this.filePath = filePath;
    this.messages = messages;
  }
}

/**
 * Run the overlock recommended ruleset against `source` and throw a
 * `VerificationError` if any error-severity rule fires. The thrown error
 * carries the raw `Linter.LintMessage[]` from ESLint so callers that want
 * to render them their own way can do so without reparsing the message.
 */
export function verify(source: string, filePath: string = "source.js"): void {
  const messages = linter.verify(source, flatConfig, { filename: filePath });
  const errors = messages.filter((m) => m.severity === 2);
  if (errors.length > 0) {
    throw new VerificationError(filePath, errors);
  }
}

function formatSummary(
  filePath: string,
  messages: LinterNs.LintMessage[],
): string {
  const fileName = filePath.split("/").pop() ?? filePath;
  const lines = messages.map(
    (m) =>
      `  ${fileName}:${m.line}:${m.column}  ${m.ruleId ?? "unknown-rule"}  ${m.message}`,
  );
  return `[overlock verify] ${filePath} failed verification:\n${lines.join("\n")}`;
}
