import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  server: { open: true },
  build: { target: "es2020", outDir: "dist" },
});
