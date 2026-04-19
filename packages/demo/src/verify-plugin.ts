import type { Plugin } from "vite";
import { ESLint } from "eslint";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function verifyOnLoad(): Plugin {
  // ignore: false ensures the dev-time verifier lints every tool source the
  // runtime asks for, even ones the CLI eslint config opts out of (the demo
  // checks in tools/bad-line/ as a verify-on-load fixture and excludes it
  // from `pnpm lint` so CI stays green; the gatekeeper here cannot opt out).
  const eslint = new ESLint({
    overrideConfigFile: "eslint.config.js",
    ignore: false,
  });
  return {
    name: "overlock-verify-on-load",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? "";
        const url = rawUrl.split("?")[0]!.split("#")[0]!;
        if (!url.startsWith("/tools/")) return next();
        const filePath = resolve(process.cwd(), "." + url);
        if (url.endsWith(".json")) {
          let json: string;
          try {
            json = await readFile(filePath, "utf8");
          } catch {
            return next();
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(json);
          return;
        }
        if (!url.endsWith(".js")) return next();
        let source: string;
        try {
          source = await readFile(filePath, "utf8");
        } catch {
          return next();
        }
        let result;
        try {
          [result] = await eslint.lintText(source, { filePath });
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain");
          res.end(`overlock verify-on-load failed: ${(err as Error).message}`);
          return;
        }
        if (!result || result.errorCount === 0) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/javascript");
          res.end(source);
          return;
        }
        const fileName = result.filePath.split("/").pop() ?? url;
        const summary = result.messages
          .map(
            (m) =>
              `  ${fileName}:${m.line}:${m.column}  ${m.ruleId ?? "unknown-rule"}  ${m.message}`,
          )
          .join("\n");
        const body = `throw new Error(${JSON.stringify(
          `[overlock verify] ${url} failed verification:\n${summary}`,
        )});`;
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/javascript");
        res.end(body);
      });
    },
  };
}
