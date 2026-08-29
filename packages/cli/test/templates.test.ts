import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agentContractTsTemplate,
  agentMdTemplate,
  agentTsTemplate,
  classNameFromAgent,
  pascal,
  projectFiles,
} from "../src/templates.js";

/**
 * O CLI é o primeiro contato de todo usuário: `thena create` roda antes de
 * qualquer linha de documentação ser lida. Um defeito aqui não vira issue —
 * vira desistência silenciosa.
 *
 * O que estes testes protegem não é a formatação dos arquivos gerados, e sim os
 * **contratos** deles: o que o projeto pede no `package.json`, que nomes as
 * classes recebem e onde o prompt é procurado.
 */

const raiz = fileURLToPath(new URL("../../..", import.meta.url));
const versaoDoCli = JSON.parse(
  readFileSync(join(raiz, "packages/cli/package.json"), "utf-8"),
).version as string;

const arquivo = (nome: string, caminho: string) => {
  const f = projectFiles(nome).find((a) => a.path === caminho);
  expect(f, `arquivo ausente no scaffold: ${caminho}`).toBeDefined();
  return f!.content;
};

describe("nomes", () => {
  it("pascal converte kebab, snake e espaço", () => {
    expect(pascal("meu-agente")).toBe("MeuAgente");
    expect(pascal("meu_agente")).toBe("MeuAgente");
    expect(pascal("meu agente")).toBe("MeuAgente");
    expect(pascal("agente")).toBe("Agente");
  });

  it("classNameFromAgent acrescenta o sufixo Agent", () => {
    expect(classNameFromAgent("explorer")).toBe("ExplorerAgent");
  });

  it("o sufixo é acrescentado sem olhar se já estava lá", () => {
    // Verruga conhecida, fixada aqui como comportamento e não como intenção:
    // `thena g agent explorer-agent` gera `ExplorerAgentAgent`. O caminho
    // documentado é `thena g agent explorer`, então isso não morde ninguém que
    // siga a doc — e consertar muda o nome de classe gerado, o que é outra
    // tarefa, com outro nome.
    expect(classNameFromAgent("explorer-agent")).toBe("ExplorerAgentAgent");
  });
});

describe("o projeto gerado", () => {
  it("traz todos os arquivos que o README dele promete", () => {
    const caminhos = projectFiles("app").map((a) => a.path);

    expect(caminhos).toEqual(
      expect.arrayContaining([
        "package.json",
        "tsconfig.json",
        "src/main.ts",
        "src/config.ts",
        "src/providers/ollama.provider.ts",
        "src/agents/assistant/assistant.agent.ts",
        "src/agents/assistant/assistant.agent.md",
        "src/contracts/assistant.contract.ts",
        "src/tools/.gitkeep",
        "src/workflows/assistant.workflow.ts",
      ]),
    );
  });

  it("o package.json é JSON válido e usa o nome que foi pedido", () => {
    const pkg = JSON.parse(arquivo("meu-app", "package.json"));
    expect(pkg.name).toBe("meu-app");
    expect(pkg.private).toBe(true);
    // CommonJS de propósito (ADR-017): é o que permite `from "./config"` sem
    // extensão. `type: module` quebraria todos os imports do template.
    expect(pkg.type).toBeUndefined();
  });

  it("a versão pedida do @thenajs/core acompanha a do próprio CLI", () => {
    // Esta é a trava que faltava. O `THENA_VERSION` é um literal no
    // `templates.ts`, e numa release já ficou para trás — o projeto gerado
    // passa a pedir uma versão que não existe no npm, e o usuário novo
    // esbarra nisso no primeiro `npm install`.
    const pkg = JSON.parse(arquivo("app", "package.json"));
    expect(pkg.dependencies["@thenajs/core"]).toBe(versaoDoCli);
  });

  it("o tsconfig liga os decorators, sem os quais o @Agent não compila", () => {
    const ts = JSON.parse(arquivo("app", "tsconfig.json"));
    expect(ts.compilerOptions.experimentalDecorators).toBe(true);
  });

  it("o build copia os .md, senão o @Agent não acha o prompt em produção", () => {
    const pkg = JSON.parse(arquivo("app", "package.json"));
    expect(pkg.scripts.build).toContain("copyfiles");
    expect(pkg.scripts.build).toContain("*.md");
  });
});

describe("o agente gerado", () => {
  it("a classe recebe o nome derivado e aponta para o .md ao lado", () => {
    const ts = agentTsTemplate("explorer");

    expect(ts).toContain("export class ExplorerAgent {}");
    expect(ts).toContain('prompt: "./explorer.agent.md"');
    expect(ts).toContain('from "@thenajs/core"');
    expect(ts).toContain("contract: ExplorerAgentContract");
  });

  it("gera um contrato explícito na pasta contracts", () => {
    const ts = agentContractTsTemplate("explorer");
    expect(ts).toContain("export class ExplorerAgentContract");
    expect(ts).toContain("ctx.memory");
    expect(ts).toContain("ctx.history");
  });

  it("o .md sai com o nome no título, para não nascer anônimo", () => {
    expect(agentMdTemplate("explorer")).toContain("explorer");
  });
});
