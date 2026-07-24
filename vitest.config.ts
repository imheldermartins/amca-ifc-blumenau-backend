import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config de teste do backend.
 *
 * Os aliases do tsconfig são espelhados na mão (só os que os testes usam) em
 * vez de via `vite-tsconfig-paths`: aquele plugin arrasta o `vite` como
 * dependência, e o backend não é um projeto Vite — não faz sentido instalar o
 * bundler inteiro para resolver dois caminhos. Mudou um alias no tsconfig e um
 * teste passou a usá-lo? Espelhe aqui, como o resto do projeto faz com config
 * que não importa TS.
 *
 * Escopo (decisão do plano): SÓ o que decide segurança e é puro, sem rqlite e
 * sem express — a política do cookie e o fail-fast dos segredos.
 */
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src");

export default defineConfig({
  resolve: {
    alias: {
      "@core": path.resolve(src, "core"),
      "@models": path.resolve(src, "models"),
      "@controllers": path.resolve(src, "controllers"),
      "@db": path.resolve(src, "core/db"),
      "@routes": path.resolve(src, "routes"),
      "@": src,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
