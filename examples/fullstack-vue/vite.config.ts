import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/** The framework packages of this monorepo, from their sources, as the example's tsconfig `paths` do. */
const packageSource = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@laratype/client": packageSource("client"),
      "@laratype/contract": packageSource("contract"),
    },
  },
  server: {
    // `bun run dev` in examples/basic listens on 3000 (its README).
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
