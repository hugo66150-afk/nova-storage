import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// En dev, le preamble React refresh est un script inline : on assouplit la CSP
// UNIQUEMENT en dev. En build, la CSP stricte d'index.html s'applique.
function devCspPlugin(): Plugin {
  return {
    name: "dev-csp",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        /content="default-src 'self'; script-src 'self';/,
        "content=\"default-src 'self'; script-src 'self' 'unsafe-inline';",
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), devCspPlugin()],
  base: "./",
  root: ".",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Ne pas surveiller les sorties de build : chokidar tiendrait un handle sur
    // release/ et bloquerait le rename de electron-builder (EPERM win-unpacked).
    watch: {
      ignored: ["**/release/**", "**/dist/**", "**/.freebuff/**"],
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
