import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { bootstrapWorkflow, loop, runWorkflow, untilAnswered } from "@thenajs/core";
import { FakeProvider, criarAgente, criarTool, criarWorkflow } from "./harness.js";

/**
 * A régua.
 *
 * Num framework de agente o custo é dominado por round-trips ao modelo e
 * tokens enviados — o overhead de CPU é ruído. O que estes testes protegem é
 * exatamente o que **regride em silêncio**: ninguém quebra, nenhum teste de
 * correção falha, e a conta triplica no fim do mês.
 *
 * Medem contagem, não tempo: cronômetro em CI é instável e não diz nada sobre
 * o que importa aqui.
 */

const schema = z.object({ x: z.string() });
const eco = () =>
  criarTool({ name: "eco", description: "eco", schema }, ({ x }: any) => x);

/** Soma o tamanho de tudo que foi enviado ao modelo, em todas as chamadas. */
function totalEnviado(provider: FakeProvider): number {
  return provider.chamadas.reduce(
    (soma, c) => soma + c.messages.reduce((s, m) => s + m.content.length, 0),
    0,
  );
}

describe("round-trips ao modelo", () => {
  it("um turno sem tool = uma chamada", async () => {
    const provider = new FakeProvider([{ content: "pronto" }]);
    await runWorkflow(criarWorkflow([criarAgente({ provider })]), "vai");

    expect(provider.chamadas).toHaveLength(1);
  });

  it("um turno com tool = uma chamada (a tool não custa outra)", async () => {
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "1" } } },
    ]);
    await runWorkflow(
      criarWorkflow([criarAgente({ provider, tools: [eco()] })]),
      "vai",
    );

    expect(provider.chamadas).toHaveLength(1);
  });

  it("N tools em sequência custam N turnos — o teto de 1 tool por turno", async () => {
    // Documenta a limitação atual: o provider só honra `toolCalls[0]`, então
    // ler 3 arquivos são 3 round-trips. Quando tool calls paralelas entrarem,
    // este número cai para 1 e este teste muda junto — de propósito.
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "a" } } },
      { tool: { name: "eco", arguments: { x: "b" } } },
      { tool: { name: "eco", arguments: { x: "c" } } },
      { content: "terminei" },
    ]);
    await runWorkflow(
      criarWorkflow([
        loop({
          steps: [criarAgente({ provider, tools: [eco()] })],
          until: untilAnswered,
          maxIterations: 10,
        }),
      ]),
      "vai",
    );

    expect(provider.chamadas).toHaveLength(4);
  });
});

describe("tokens enviados", () => {
  it("o custo é QUADRÁTICO no número de turnos", async () => {
    // Cada volta reenvia todo o histórico. Dez turnos não custam 10× o
    // primeiro. Este teste existe para o dia em que a janela deslizante
    // entrar: o número tem que cair, e a queda tem que ser visível.
    const provider = new FakeProvider([{ content: "x".repeat(200) }]);
    await runWorkflow(
      criarWorkflow([
        loop({
          steps: [criarAgente({ provider })],
          until: () => false,
          maxIterations: 10,
        }),
      ]),
      "pergunta inicial",
    );

    const enviado = totalEnviado(provider);
    const primeira = provider.chamadas[0].messages.reduce(
      (s, m) => s + m.content.length,
      0,
    );

    // Linear seria ~10×. O crescimento real fica bem acima disso.
    expect(enviado).toBeGreaterThan(primeira * 20);

    // Trava de regressão: se alguém acrescentar algo ao prompt a cada volta,
    // este teto estoura antes da fatura.
    expect(enviado).toBeLessThan(30_000);
  });

  it("o prefixo do prompt é ESTÁVEL entre turnos", async () => {
    // Pré-requisito do prompt caching: o provider cobra ~10% por prefixo já
    // visto. Um `beforePrompt` dinâmico quebra o prefixo e anula o cache
    // inteiro — sem quebrar nada, só encarecendo.
    const provider = new FakeProvider([{ content: "resposta" }]);
    await runWorkflow(
      criarWorkflow([
        loop({
          steps: [criarAgente({ provider })],
          until: () => false,
          maxIterations: 4,
        }),
      ]),
      "oi",
    );

    const prefixos = provider.chamadas.map((c) => c.messages[0].content);
    expect(new Set(prefixos).size).toBe(1);

    // E cada chamada é um prefixo da seguinte: o histórico só cresce por append.
    for (let i = 1; i < provider.chamadas.length; i++) {
      const antes = provider.chamadas[i - 1].messages;
      const agora = provider.chamadas[i].messages;
      expect(agora.length).toBeGreaterThan(antes.length);
      for (let j = 0; j < antes.length; j++) {
        expect(agora[j].content).toBe(antes[j].content);
      }
    }
  });
});

describe("trabalho repetido por chamada", () => {
  it("a MESMA instância de schema atravessa os turnos", async () => {
    // A memoização da conversão para JSON Schema é chaveada pelo objeto do
    // schema (ver `json-schema.test.ts` no engine). O framework remonta o
    // objeto da tool a cada turno, para injetar o contexto nos hooks — o que
    // não pode mudar é o `schema` que ela carrega.
    const schema = z.object({ x: z.string() });
    const provider = new FakeProvider([{ content: "x" }]);
    const Ferramenta = criarTool(
      { name: "eco", description: "eco", schema },
      () => "ok",
    );

    await runWorkflow(
      criarWorkflow([
        loop({
          steps: [criarAgente({ provider, tools: [Ferramenta] })],
          until: () => false,
          maxIterations: 5,
        }),
      ]),
      "vai",
    );

    const schemas = provider.chamadas.map((c) => c.tools[0].schema);
    expect(new Set(schemas).size).toBe(1);
    expect(schemas[0]).toBe(schema);
  });

  it("a cadeia de middleware não é remontada a cada execução de tool", async () => {
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "1" } } },
      { tool: { name: "eco", arguments: { x: "2" } } },
      { content: "fim" },
    ]);

    const montagens: number[] = [];
    const app = await bootstrapWorkflow(
      criarWorkflow([
        loop({
          steps: [criarAgente({ provider, tools: [eco()] })],
          until: untilAnswered,
          maxIterations: 10,
        }),
      ]),
      {},
    );
    await app.use({
      name: "conta",
      tool: async (inv, next) => {
        montagens.push(inv.run.budget.usage().toolCalls);
        return next();
      },
    });

    await app.run({ input: { message: "vai" } });
    await app.dispose();

    // Duas execuções de tool, duas passagens pela cadeia — e nenhuma a mais.
    expect(montagens).toHaveLength(2);
  });
});

describe("memória do report", () => {
  it("o conteúdo capturado é truncado, não guardado inteiro", async () => {
    const gigante = "x".repeat(60_000);
    const provider = new FakeProvider([{ content: gigante }]);

    const eventos: number[] = [];
    const app = await bootstrapWorkflow(criarWorkflow([criarAgente({ provider })]), {
      log: (e) => e.data?.response && eventos.push(String(e.data.response).length),
    });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    // O teto de 20 KB por campo é o que impede uma run longa de estourar heap.
    expect(Math.max(...eventos)).toBeLessThanOrEqual(20_001);
  });
});
