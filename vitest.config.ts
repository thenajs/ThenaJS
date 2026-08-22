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
      "@thenajs/tools": src("tools"),
      "@thenajs/qdrant-client": src("qdrant-client"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // O ponto do trabalho: se o isolamento por execução estiver certo, os
    // arquivos podem rodar em paralelo sem se contaminar.
    pool: "threads",

    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html"],
      // Só o que é publicado. `src/` na raiz é o app de exemplo, `test/` é o
      // próprio instrumento, e a UI do Flow tem build e tsconfig separados —
      // medi-la aqui daria zero e afundaria o número sem dizer nada.
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/flow/src/ui/**", "**/*.d.ts", "**/index.ts"],

      // Os limiares são a **linha de base medida**, não uma meta aspiracional.
      // Servem para travar regressão: passar disto é o piso, e subi-lo é uma
      // decisão consciente, não um efeito colateral.
      // Medido em 22/ago/2026 com 477 testes: 89,29 / 88,76 / 84,00 / 77,78.
      // Um ponto abaixo de cada, para variação de instrumentação não reprovar
      // build honesto — e qualquer queda real reprovar.
      thresholds: {
        lines: 88,
        statements: 88,
        functions: 83,
        branches: 76,
      },
    },
  },
});
