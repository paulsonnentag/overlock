import { defineConfig, type Plugin } from "vite";
import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyOnLoad } from "./verify-plugin.js";

function copyTools(): Plugin {
  return {
    name: "overlock-copy-tools",
    apply: "build",
    async closeBundle() {
      const from = resolve(process.cwd(), "tools");
      const to = resolve(process.cwd(), "dist/tools");
      await cp(from, to, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [verifyOnLoad(), copyTools()],
  server: { port: 5173 },
});
