import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Tool, Workflow, Thena, context, runWorkflow } from "@thenajs/core";
import type { BudgetUsage, ExecutionNode, WorkflowRuntime } from "@thenajs/core";
import { FakeProvider, makeAgent, makeWorkflow } from "./harness.js";

/**
 * O orçamento atravessa a fronteira da run aninhada.
 *
 * Antes, `childRunContext` criava um `BudgetTracker` novo mesmo sem `budget`
 * informado — e o sub-workflow ficava **sem teto nenhum**. Qualquer agente que
 * chamasse uma tool disparadora de workflow contornava o `maxCostUsd` do topo,
 * e o gasto de dentro não aparecia em lugar nenhum. Todos os testes deste
 * arquivo falham contra aquela versão.
 */

const schema = z.object({ x: z.string() });

/** Tool que roda `SubFluxo` pelo `WorkflowRuntime` injetado. */
function toolQueRoda(SubFluxo: Function, budget?: object) {
  const Classe = class {
    constructor(private readonly runtime: WorkflowRuntime) {}
    execute() {
      return this.runtime.run<string>(SubFluxo, {
        prompt: "sub",
        ...(budget ? { budget } : {}),
      });
    }
  };
  Tool({ name: "sub", description: "roda um sub-workflow", schema })(Classe as never);
  return Classe as never;
}

/** Workflow de um agente que chama a tool `sub` uma vez. */
function fluxoQueChamaSub(
  tool: unknown,
  provider = new FakeProvider([{ tool: { name: "sub", arguments: { x: "1" } } }]),
) {
  return makeWorkflow([makeAgent({ provider, tools: [tool as never] })]);
}

describe("orçamento em run aninhada", () => {
  it("um sub-workflow SEM teto próprio não escapa do teto do pai", async () => {
    // Cinco agentes lá dentro; o pai só tem crédito para uma chamada, e a
    // gasta no turno que dispara a tool.
    const dentro = new FakeProvider([{ content: "caro" }]);
    const Sub = makeWorkflow([
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
    ]);

    const app = Thena.create(fluxoQueChamaSub(toolQueRoda(Sub)), {});
    await app.run({ prompt: "vai", budget: { maxChatCalls: 1 } });
    await app.dispose();

    // Sem a correção: 5 (o sub rodava inteiro). Com ela: no máximo 1 — a
    // chamada do pai ainda não estava contabilizada quando o sub começou, e é
    // esse o excedente conhecido de um nível de aninhamento.
    expect(dentro.chamadas.length).toBeLessThanOrEqual(1);
  });

  it("o gasto do filho é somado no orçamento do pai", async () => {
    const dentro = new FakeProvider([
      { content: "f", usage: { promptTokens: 500, completionTokens: 500 } },
    ]);
    const Sub = makeWorkflow([makeAgent({ provider: dentro })]);

    // Passo 1 dispara a tool; passo 2 lê o consumo acumulado da run.
    let depois: BudgetUsage | undefined;
    const disparador = new FakeProvider([
      { tool: { name: "sub", arguments: { x: "1" } } },
    ]);
    const leitor = new FakeProvider([{ content: "fim" }]);

    const app = Thena.create(
      makeWorkflow([
        makeAgent({ provider: disparador, tools: [toolQueRoda(Sub)] }),
        makeAgent(
          { provider: leitor },
          { beforePrompt: () => void (depois = context().usage()) },
        ),
      ]),
      {},
    );
    await app.run({ prompt: "vai", budget: { maxTokens: 100_000 } });
    await app.dispose();

    // Os 1000 tokens gastos dentro do sub-workflow contam na run de cima.
    expect(depois?.tokens).toBe(1000);
    expect(depois?.chatCalls).toBe(2); // o turno do pai + o turno do filho
  });

  it("com teto próprio mais APERTADO, quem corta é o do filho", async () => {
    const dentro = new FakeProvider([{ content: "f" }]);
    const Sub = makeWorkflow([
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
    ]);

    const app = Thena.create(
      fluxoQueChamaSub(toolQueRoda(Sub, { maxChatCalls: 1 })),
      {},
    );
    await app.run({ prompt: "vai", budget: { maxChatCalls: 50 } });
    await app.dispose();

    // O pai deixaria passar 50; o filho para na 1ª.
    expect(dentro.chamadas.length).toBe(1);
  });

  it("com teto próprio mais LARGO, o do pai continua valendo", async () => {
    const dentro = new FakeProvider([{ content: "f" }]);
    const Sub = makeWorkflow([
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
    ]);

    // O filho pede 999; não é dele a última palavra.
    const app = Thena.create(
      fluxoQueChamaSub(toolQueRoda(Sub, { maxChatCalls: 999 })),
      {},
    );
    await app.run({ prompt: "vai", budget: { maxChatCalls: 1 } });
    await app.dispose();

    expect(dentro.chamadas.length).toBeLessThanOrEqual(1);
  });

  it('o modo "throw" do pai lança de dentro do filho', async () => {
    const dentro = new FakeProvider([{ content: "f" }]);
    const Sub = makeWorkflow([
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
    ]);

    const app = Thena.create(fluxoQueChamaSub(toolQueRoda(Sub)), {});
    // O `mode` que decide é o de quem estourou — aqui, o do pai.
    await expect(
      app.run({
        prompt: "vai",
        budget: { maxChatCalls: 1, mode: "throw" },
      }),
    ).rejects.toThrow(/Run budget exhausted/);
    await app.dispose();
  });

  it("onExceeded do pai dispara uma vez só, mesmo estourando dentro do filho", async () => {
    const estouros: string[] = [];
    const dentro = new FakeProvider([{ content: "f" }]);
    const Sub = makeWorkflow([
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
    ]);

    const app = Thena.create(fluxoQueChamaSub(toolQueRoda(Sub)), {});
    await app.run({
      prompt: "vai",
      budget: { maxChatCalls: 1, onExceeded: (i) => estouros.push(i.reason) },
    });
    await app.dispose();

    expect(estouros).toEqual(["maxChatCalls"]);
  });

  it("no report, o nó do sub-workflow mostra o gasto DELE, não o da run", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "thena-nb-"));

    const dentro = new FakeProvider([
      { content: "f", usage: { promptTokens: 7, completionTokens: 0 } },
    ]);
    const Sub = makeWorkflow([makeAgent({ provider: dentro })]);
    const parent = new FakeProvider([
      {
        tool: { name: "sub", arguments: { x: "1" } },
        usage: { promptTokens: 100, completionTokens: 0 },
      },
    ]);

    const app = Thena.create(fluxoQueChamaSub(toolQueRoda(Sub), parent), {
      report: { dir },
    });
    await app.run({ prompt: "vai", budget: { maxTokens: 9999 } });
    await app.dispose();

    const [pasta] = readdirSync(dir, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    );
    const raiz: ExecutionNode = JSON.parse(
      readFileSync(join(dir, pasta.name, "report.json"), "utf-8"),
    );
    // workflow > agent > chat > tool > workflow
    const sub = raiz.children[0].children[0].children[0].children[0];
    expect(sub.kind).toBe("workflow");

    // Compartilhar o tracker com o pai não pode fazer o nó do filho exibir o
    // gasto do pai: são 2 chamadas na run, mas 1 dentro do sub-workflow.
    expect(sub.data.chatCalls).toBe(1);
    expect(sub.data.tokens).toBe(7);
    // A raiz, essa sim, soma tudo.
    expect(raiz.data.chatCalls).toBe(2);
    expect(raiz.data.tokens).toBe(107);
  });

  it("recursão (workflow → tool → o mesmo workflow) para no teto do topo", async () => {
    const provider = new FakeProvider([
      { tool: { name: "sub", arguments: { x: "1" } } },
    ]);

    let profundidade = 0;
    const Recursivo = class {};
    const RecursivoTool = class {
      constructor(private readonly runtime: WorkflowRuntime) {}
      execute() {
        // Trava de segurança do teste: sem a correção o orçamento não segura
        // nada, e sem isto a suíte inteira travaria em vez de falhar.
        if (++profundidade > 40) throw new Error("recursão sem freio");
        return this.runtime.run<string>(Recursivo, { prompt: "again" });
      }
    };
    Tool({ name: "sub", description: "recursa", schema })(RecursivoTool as never);
    // O workflow referencia uma tool que roda o próprio workflow — o ciclo só
    // fecha depois que as duas classes existem, então o decorator vai aqui.
    Workflow({
      steps: [makeAgent({ provider, tools: [RecursivoTool as never] })],
    })(Recursivo);

    const app = Thena.create(Recursivo, {});
    await app.run({ prompt: "vai", budget: { maxChatCalls: 3 } });
    await app.dispose();

    // O orçamento é global à run: a recursão morre no teto, não na stack.
    expect(profundidade).toBeLessThanOrEqual(4);
    expect(provider.chamadas.length).toBeLessThanOrEqual(4);
  });

  it("runs concorrentes continuam com orçamentos independentes", async () => {
    // Trava de regressão: compartilhar o tracker com o PAI não pode ter
    // virado compartilhar entre execuções distintas.
    const a = new FakeProvider([
      { content: "a1" },
      { content: "a2" },
      { content: "a3" },
    ]);
    const b = new FakeProvider([
      { content: "b1" },
      { content: "b2" },
      { content: "b3" },
    ]);
    const tres = (p: FakeProvider) =>
      makeWorkflow([
        makeAgent({ provider: p }),
        makeAgent({ provider: p }),
        makeAgent({ provider: p }),
      ]);

    const appA = Thena.create(tres(a), {});
    const appB = Thena.create(tres(b), {});

    const [saidaA, saidaB] = await Promise.all([
      appA.run({ prompt: "a", budget: { maxChatCalls: 1 } }),
      appB.run({ prompt: "b" }),
    ]);
    await Promise.all([appA.dispose(), appB.dispose()]);

    expect(saidaA).toBe("a1");
    expect(a.chamadas).toHaveLength(1);
    expect(saidaB).toBe("b3");
    expect(b.chamadas).toHaveLength(3);
  });

  it("sem orçamento nenhum, nada é medido nem cortado — nem no filho", async () => {
    const dentro = new FakeProvider([{ content: "f" }]);
    const Sub = makeWorkflow([
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
      makeAgent({ provider: dentro }),
    ]);

    await runWorkflow(fluxoQueChamaSub(toolQueRoda(Sub)), "vai");

    expect(dentro.chamadas).toHaveLength(3);
  });
});
