import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BudgetExceededError, FatalToolError, Tool, Thena } from "@thenajs/core";
import type { WorkflowRuntime } from "@thenajs/core";
import {
  FakeProvider,
  captureError,
  makeAgent,
  makeTool,
  makeWorkflow,
} from "./harness.js";

/**
 * As formas de uma tool falhar. Todas viram **observação** para o modelo —
 * uma só, a `FatalToolError`, encerra a run.
 */

const schema = z.object({ x: z.string() });

function montar(
  tool: ReturnType<typeof makeTool>,
  chamada: { name: string; arguments?: unknown },
) {
  const provider = new FakeProvider([{ tool: chamada }]);
  return makeWorkflow([makeAgent({ provider, tools: [tool] })]);
}

const eco = () =>
  makeTool({ name: "eco", description: "eco", schema }, ({ x }: any) => x);

describe("falhas de tool", () => {
  it("execute que lança vira observação", async () => {
    const tool = makeTool({ name: "eco", description: "eco", schema }, () => {
      throw new Error("boom");
    });
    const app = Thena.create(montar(tool, { name: "eco", arguments: { x: "1" } }), {});

    await expect(app.run({ input: { message: "vai" } })).resolves.toBe("boom");
    await app.dispose();
  });

  it("execute que devolve isError vira observação", async () => {
    const tool = makeTool({ name: "eco", description: "eco", schema }, () => ({
      content: "não deu",
      isError: true,
    }));
    const app = Thena.create(montar(tool, { name: "eco", arguments: { x: "1" } }), {});

    await expect(app.run({ input: { message: "vai" } })).resolves.toBe("não deu");
    await app.dispose();
  });

  it("tool inexistente vira observação", async () => {
    const app = Thena.create(
      montar(eco(), { name: "nao_existe", arguments: { x: "1" } }),
      {},
    );

    await expect(app.run({ input: { message: "vai" } })).resolves.toContain(
      "não encontrada",
    );
    await app.dispose();
  });

  it("argumentos fora do schema viram observação, com a mensagem do zod", async () => {
    const app = Thena.create(
      // o schema pede { x: string }; o modelo mandou { y: 1 }
      montar(eco(), { name: "eco", arguments: { y: 1 } }),
      {},
    );

    // É a falha mais recuperável de todas: o modelo errou o formato e pode
    // acertar no turno seguinte. Antes ela derrubava a run.
    const saida = await app.run({ input: { message: "vai" } });
    expect(saida).toContain("Argumentos inválidos");
    expect(saida).toContain("eco");
    await app.dispose();
  });

  it("uma chamada resgatada do texto diz isso na mensagem de erro", async () => {
    // Sem tool call nativa: o resgate extrai do conteúdo, e os args não batem.
    const provider = new FakeProvider([
      { content: '{"name":"eco","arguments":{"y":1}}' },
    ]);
    const Fluxo = makeWorkflow([makeAgent({ provider, tools: [eco()] })]);
    const app = Thena.create(Fluxo, {});

    await expect(app.run({ input: { message: "vai" } })).resolves.toContain(
      "resgatada do texto",
    );
    await app.dispose();
  });

  it("FatalToolError atravessa o agente e encerra a run", async () => {
    const tool = makeTool({ name: "eco", description: "eco", schema }, () => {
      throw new FatalToolError("banco indisponível");
    });
    const app = Thena.create(montar(tool, { name: "eco", arguments: { x: "1" } }), {});

    await expect(app.run({ input: { message: "vai" } })).rejects.toBeInstanceOf(
      FatalToolError,
    );
    await app.dispose();
  });

  it("FatalToolError preserva o erro original em `cause`", async () => {
    const original = new Error("ECONNREFUSED 10.0.0.1:5432");
    const tool = makeTool({ name: "eco", description: "eco", schema }, () => {
      throw new FatalToolError("banco indisponível", { cause: original });
    });
    const app = Thena.create(montar(tool, { name: "eco", arguments: { x: "1" } }), {});

    const fail = await app
      .run({ input: { message: "vai" } })
      .catch((e) => e as FatalToolError);

    expect((fail as FatalToolError).message).toBe("banco indisponível");
    expect((fail as FatalToolError).cause).toBe(original);
    await app.dispose();
  });

  it("um loop deixa o agente corrigir depois de uma falha", async () => {
    const tentativas: string[] = [];
    const tool = makeTool(
      {
        name: "ler",
        description: "lê um arquivo",
        schema: z.object({ path: z.string() }),
      },
      ({ path }: { path: string }) => {
        tentativas.push(path);
        if (path === "certo.ts") return "conteúdo";
        throw new Error(`ENOENT: ${path}`);
      },
    );

    // 1º turno erra o caminho, 2º acerta, 3º responde sem tool (encerra o loop).
    const provider = new FakeProvider([
      { tool: { name: "ler", arguments: { path: "errado.ts" } } },
      { tool: { name: "ler", arguments: { path: "certo.ts" } } },
      { content: "achei o arquivo" },
    ]);
    const { loop, untilAnswered } = await import("@thenajs/core");
    const Fluxo = makeWorkflow([
      loop({
        steps: [makeAgent({ provider, tools: [tool] })],
        until: untilAnswered,
        maxIterations: 5,
      }),
    ]);

    const app = Thena.create(Fluxo, {});
    const saida = await app.run({ input: { message: "leia o arquivo" } });
    await app.dispose();

    // É o ponto do default: a falha não derruba a run, vira informação.
    expect(tentativas).toEqual(["errado.ts", "certo.ts"]);
    expect(saida).toBe("achei o arquivo");
  });
});

/**
 * O que **não** pode virar observação.
 *
 * Uma tool executa dentro de `provider.chat`, então tudo que é lançado lá
 * dentro atravessa o `execute` na volta — inclusive coisas que não são "a tool
 * falhou". Transformá-las em texto para o modelo é pior do que engolir um erro:
 * é entregar a ele o aviso de parada e deixá-lo tentar de novo.
 *
 * Estes dois casos só aparecem com sub-workflow, porque é lá dentro que os
 * checkpoints de orçamento e de cancelamento rodam.
 */
describe("erros de controle de fluxo não viram observação", () => {
  const runtimeQueRoda = (SubFluxo: Function) => {
    const Classe = class {
      constructor(private readonly runtime: WorkflowRuntime) {}
      execute() {
        return this.runtime.run<string>(SubFluxo, { input: { message: "sub" } });
      }
    };
    Tool({ name: "sub", description: "sub", schema })(Classe as never);
    return Classe as never;
  };

  it("BudgetExceededError sobe em vez de voltar como texto para o modelo", async () => {
    const dentro = new FakeProvider([{ content: "nunca" }]);
    const Sub = makeWorkflow([makeAgent({ provider: dentro })]);
    const parent = new FakeProvider([{ tool: { name: "sub", arguments: { x: "1" } } }]);

    const app = Thena.create(
      makeWorkflow([makeAgent({ provider: parent, tools: [runtimeQueRoda(Sub)] })]),
      {},
    );

    // O teto estoura dentro do sub-workflow. Sem a correção isto resolvia com
    // a mensagem do erro como saída — o modelo "lia" que ficou sem orçamento.
    await expect(
      app.run({
        input: { message: "vai" },
        budget: { maxChatCalls: 1, mode: "throw" },
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    await app.dispose();
  });

  it("cancelamento sobe em vez de voltar como texto para o modelo", async () => {
    const dentro = new FakeProvider([{ content: "nunca" }], { delayMs: 50 });
    const Sub = makeWorkflow([makeAgent({ provider: dentro })]);
    const parent = new FakeProvider([{ tool: { name: "sub", arguments: { x: "1" } } }]);

    const app = Thena.create(
      makeWorkflow([makeAgent({ provider: parent, tools: [runtimeQueRoda(Sub)] })]),
      {},
    );

    const runCtx = app.run({ input: { message: "vai" } });
    setTimeout(() => runCtx.abort(new Error("chega")), 10);

    const fail = await captureError(runCtx.result);
    // Sem a correção, o abort virava `{ content: "chega", isError: true }` e a
    // run seguia em frente com "a tool falhou" no histórico.
    expect((fail as Error).message).toBe("chega");
    await app.dispose();
  });

  it("uma falha comum continua virando observação, com sub-workflow no meio", async () => {
    // Trava de regressão: o filtro acima não pode ter engolido o caso normal.
    const Quebrada = class {
      execute(): string {
        throw new Error("quebrou de verdade");
      }
    };
    Tool({ name: "sub", description: "sub", schema })(Quebrada as never);

    const parent = new FakeProvider([{ tool: { name: "sub", arguments: { x: "1" } } }]);
    const app = Thena.create(
      makeWorkflow([makeAgent({ provider: parent, tools: [Quebrada as never] })]),
      {},
    );

    await expect(app.run({ input: { message: "vai" } })).resolves.toBe(
      "quebrou de verdade",
    );
    await app.dispose();
  });
});
