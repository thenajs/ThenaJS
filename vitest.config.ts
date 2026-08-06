import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Os testes rodam contra o **código-fonte**, não contra `dist/`. Sem isto
    // seria preciso `npm run build` antes de cada execução, e um teste poderia
    // passar contra um build velho.
    alias: {
      "@thenajs/agentflow": src("agentflow"),
      "@thenajs/core": src("core"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // O ponto do trabalho: se o isolamento por execução estiver certo, os
    // arquivos podem rodar em paralelo sem se contaminar.
    pool: "threads",
  },
});
