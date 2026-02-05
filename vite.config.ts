import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@wasm": fileURLToPath(new URL("./src/wasm", import.meta.url)),
    },
  },
  assetsInclude: ["**/*.wasm"],
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["@wasm/meshlib_fill_holes.js"],
  },
  esbuild: {
    target: "esnext",
  },
  build: {
    target: "esnext",
    assetsInlineLimit: 0,
  },
});
