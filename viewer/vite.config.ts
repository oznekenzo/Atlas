import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const hash = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
})();

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  build: { target: "es2022" },
  define: { __GIT_HASH__: JSON.stringify(hash) },
  optimizeDeps: { exclude: ["@sparkjsdev/spark"] },
});
