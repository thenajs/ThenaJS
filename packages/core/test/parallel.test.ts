import { describe, expect, it } from "vitest";
import { parallel, runWorkflow } from "@thenajs/core";
import { FakeProvider, criarAgente, criarWorkflow } from "./harness.js";

/**
 * `parallel`: os passos rodam concorrentes **sobre o mesmo contexto**.
 *
 * Os testes aqui fixam o comportamento como ele é hoje, incluindo as duas
 * limitações conhecidas — `ctx.output` e `ctx.turn` são last-writer-wins, e o
 * `history` sai intercalado. Documentar isso em teste é o que impede uma
 * mudança futura de alterar o contrato sem querer.
 */

describe("parallel", () => {
  it("executa os passos de forma concorrente, não em sequência", async () => {
    const ordem: string[] = [];

    const lento = new FakeProvider([{ content: "lento" }], { delayMs: 30 });
    const rapido = new FakeProvider([{ content: "rápido" }], { delayMs: 5 });

    const A = criarAgente(
      { provider: lento },
      { afterResponse: (r: string) => void ordem.push(r) },
    );
    const B = criarAgente(
      { provider: rapido },
      { afterResponse: (r: string) => void ordem.push(r) },
    );

    await runWorkflow(criarWorkflow([parallel([A, B])]), "vai");

    // Em sequência a ordem seria [lento, rápido]; concorrente, o rápido chega antes.
    expect(ordem).toEqual(["rápido", "lento"]);
  });

  it("todos os agentes recebem a mesma entrada", async () => {
    const a = new FakeProvider([{ content: "a" }]);
    const b = new FakeProvider([{ content: "b" }]);

    await runWorkflow(
      criarWorkflow([
        parallel([criarAgente({ provider: a }), criarAgente({ provider: b })]),
      ]),
      "mesma pergunta",
    );

    const entradaDe = (p: FakeProvider) =>
      p.chamadas[0].messages.find((m) => m.role === "user")?.content;

    expect(entradaDe(a)).toBe("mesma pergunta");
    expect(entradaDe(b)).toBe("mesma pergunta");
  });

  it("os passos compartilham o mesmo state — as respostas se acumulam no history", async () => {
    const a = new FakeProvider([{ content: "de A" }]);
    const b = new FakeProvider([{ content: "de B" }]);
    const depois = new FakeProvider([{ content: "fim" }]);

    await runWorkflow(
      criarWorkflow([
        parallel([criarAgente({ provider: a }), criarAgente({ provider: b })]),
        criarAgente({ provider: depois }),
      ]),
      "vai",
    );

    // O agente seguinte enxerga o que os dois escreveram.
    const conteudos = depois.chamadas[0].messages.map((m) => m.content);
    expect(conteudos).toContain("de A");
    expect(conteudos).toContain("de B");
  });

  it("ctx.output é last-writer-wins — quem termina por último vence", async () => {
    const lento = new FakeProvider([{ content: "lento" }], { delayMs: 30 });
    const rapido = new FakeProvider([{ content: "rápido" }], { delayMs: 5 });

    const saida = await runWorkflow(
      criarWorkflow([
        parallel([
          criarAgente({ provider: lento }),
          criarAgente({ provider: rapido }),
        ]),
      ]),
      "vai",
    );

    // Limitação conhecida e documentada: leia os resultados em `ctx.state`,
    // não em `ctx.output`.
    expect(saida).toBe("lento");
  });

  it("um parallel dentro de um passo sequencial continua a cadeia", async () => {
    const a = new FakeProvider([{ content: "a" }]);
    const b = new FakeProvider([{ content: "b" }]);
    const antes = new FakeProvider([{ content: "antes" }]);
    const depois = new FakeProvider([{ content: "depois" }]);

    const saida = await runWorkflow(
      criarWorkflow([
        criarAgente({ provider: antes }),
        parallel([criarAgente({ provider: a }), criarAgente({ provider: b })]),
        criarAgente({ provider: depois }),
      ]),
      "vai",
    );

    expect(saida).toBe("depois");
    expect(antes.chamadas).toHaveLength(1);
    expect(a.chamadas).toHaveLength(1);
    expect(b.chamadas).toHaveLength(1);
  });

  it("um erro em qualquer ramo derruba o bloco", async () => {
    const ok = new FakeProvider([{ content: "ok" }], { delayMs: 5 });
    const Quebrado = criarAgente(
      { provider: new FakeProvider() },
      {
        beforePrompt: () => {
          throw new Error("ramo quebrado");
        },
      },
    );

    await expect(
      runWorkflow(
        criarWorkflow([parallel([criarAgente({ provider: ok }), Quebrado])]),
        "vai",
      ),
    ).rejects.toThrow("ramo quebrado");
  });
});
