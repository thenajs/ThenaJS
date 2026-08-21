import { readFileSync, existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as core from "@thenajs/core";

/**
 * Invariantes de **arquitetura** — as que não têm como quebrar um teste de
 * comportamento, e por isso não tinham nada as segurando.
 *
 * As três aqui não medem o que o framework faz; medem a forma dele. Todas já
 * passavam quando foram escritas: elas não consertam nada, só trancam a porta.
 */

const raiz = fileURLToPath(new URL("../../..", import.meta.url));

/** Todos os `.ts` de uma pasta, recursivamente. */
function arquivosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      saida.push(...arquivosTs(caminho));
    } else if (extname(entrada.name) === ".ts") {
      saida.push(caminho);
    }
  }
  return saida;
}

describe("camadas", () => {
  /**
   * O engine é mecanismo; o core é política. A direção da seta é a arquitetura
   * inteira — e nada no toolchain a segura: o symlink do workspace resolve
   * `@thenajs/core` de dentro do agentflow, e o `tsc` aceita sem reclamar.
   */
  it("o engine NÃO importa o core — a seta só aponta para um lado", () => {
    // Casa **import**, não menção: `state.types.ts` cita o `@thenajs/core` num
    // comentário de propósito, para separar o `ProviderToolCall` do `ToolCall`
    // dos hooks. Um `includes()` reprovaria esse comentário — e a lição do
    // repositório é que comentário explicando o porquê é para ser escrito, não
    // evitado por causa de um teste desajeitado.
    const IMPORTA_CORE = /(?:from|import|require)\s*\(?\s*["']@thenajs\/core["']/;

    const infratores = arquivosTs(join(raiz, "packages/agentflow/src")).filter((f) =>
      IMPORTA_CORE.test(readFileSync(f, "utf-8")),
    );

    expect(infratores).toEqual([]);
  });

  /**
   * Uma tool pode disparar um workflow, e um workflow contém tools: importar
   * `runtime/` daqui fecharia o ciclo. É por isso que o `resolveTool` recebe
   * um `createRuntime` de quem o chama, em vez de importar o `WorkflowRuntime`.
   */
  it("a camada de DI não alcança o runtime — senão o ciclo fecha", () => {
    const infratores = arquivosTs(join(raiz, "packages/core/src/di")).filter((f) =>
      /from\s+"\.\.\/runtime\//.test(readFileSync(f, "utf-8")),
    );

    expect(infratores).toEqual([]);
  });
});

describe("nomes de arquivo que são contrato", () => {
  /**
   * O `resolveCallerFile` acha o `.agent.ts` do usuário pulando os frames
   * internos do stack, e o filtro é por **nome de arquivo** — de propósito,
   * porque source map reescreve os caminhos de `dist/` de volta para `src/`.
   *
   * Renomear qualquer um dos dois faz a regex parar de casar, o
   * `resolveCallerFile` passa a devolver o arquivo do próprio framework, e todo
   * `@Agent({ prompt: "./x.agent.md" })` com caminho relativo quebra. Já
   * aconteceu uma vez.
   */
  it("os dois arquivos que a regex do resolveCallerFile persegue continuam lá", () => {
    const decorators = join(raiz, "packages/core/src/decorators");

    expect(existsSync(join(decorators, "agent.decorator.ts"))).toBe(true);
    expect(existsSync(join(decorators, "resolve-caller.ts"))).toBe(true);
  });

  it("a regex INTERNAL ainda casa com os nomes que ela precisa pular", () => {
    const fonte = readFileSync(
      join(raiz, "packages/core/src/decorators/resolve-caller.ts"),
      "utf-8",
    );
    // Extrai a regex do fonte para testá-la contra os nomes reais, em vez de
    // duplicá-la aqui — uma cópia divergiria em silêncio.
    const literal = fonte.match(/const INTERNAL = (\/.+\/);/)?.[1];
    expect(literal).toBeDefined();

    const corpo = literal!.slice(1, literal!.lastIndexOf("/"));
    const INTERNAL = new RegExp(corpo);

    expect(INTERNAL.test("/qualquer/lugar/agent.decorator.ts")).toBe(true);
    expect(INTERNAL.test("/qualquer/lugar/resolve-caller.js")).toBe(true);
    // E não pode pular o arquivo do usuário.
    expect(INTERNAL.test("/projeto/src/agents/explorer/explorer.agent.ts")).toBe(false);
  });
});

describe("superfície pública do @thenajs/core", () => {
  /**
   * `packages/core/src/index.ts` é a fronteira de compatibilidade: sumir com um
   * nome daqui é breaking change, e em `0.x` isso sobe o **minor** e entra no
   * CHANGELOG com a migração.
   *
   * A lista é deliberadamente escrita à mão, e não um snapshot gerado: um
   * `toMatchSnapshot()` é atualizado sem ninguém ler o diff, que é exatamente o
   * descuido que este teste existe para pegar. Acrescentar um export é uma
   * linha aqui; remover um exige apagar uma linha, de propósito.
   */
  const EXPORTS_DE_VALOR = [
    "Agent",
    "BudgetExceededError",
    "DEFAULT_MAX_FAILS",
    "DEFAULT_MAX_ITERATIONS",
    "FatalToolError",
    "HttpTransport",
    "OllamaProvider",
    "OpenAIProvider",
    "Pipeline",
    "Providers",
    "StateManager",
    "Thena",
    "Tool",
    "VectorMemory",
    "VectorStore",
    "Workflow",
    "WorkflowRuntime",
    "bootstrapWorkflow",
    "buildAgentStep",
    "calledTool",
    "context",
    "contextWindow",
    "getAgentMetadata",
    "getWorkflowMetadata",
    "input",
    "loop",
    "md",
    "memory",
    "normalizeToolCallEnvelope",
    "parallel",
    "parser",
    "pruneUndefined",
    "redactSecrets",
    "run",
    "runWorkflow",
    "state",
    "toToolOutput",
    "turnOf",
    "untilAnswered",
    "wasExhausted",
  ];

  it("nenhum export de valor sumiu nem apareceu sem querer", () => {
    expect(Object.keys(core).sort()).toEqual(EXPORTS_DE_VALOR);
  });

  /**
   * Aliases mantidos só para não quebrar quem já escreveu código. Não são
   * limpeza pendente — apagá-los é breaking change. `EventQueue` e
   * `bootstrapWorkflow` são valores e já estão na lista acima; estes são os que
   * só existem no nível de tipo, onde o `import *` não alcança.
   */
  it("os aliases @deprecated do nível de tipo continuam exportados", () => {
    const indice = readFileSync(join(raiz, "packages/core/src/index.ts"), "utf-8");

    // `AgentContext` foi renomeado para `Context`, mas continua válido.
    expect(indice).toMatch(/\bAgentContext\b/);
  });
});
