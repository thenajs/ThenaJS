import { describe, expect, it } from "vitest";
import { context, parallel, runWorkflow } from "@thenajs/core";
import { FakeProvider, makeAgent, makeWorkflow } from "./harness.js";

/**
 * `parallel`: os passos rodam concorrentes, cada um sobre a **mesma leitura** do
 * histórico, e as escritas entram na **ordem de declaração** (ADR-022/ADR-023).
 *
 * Estes testes fixam as três garantias que a versão anterior não dava: a ordem
 * de anexação não dependia da latência do modelo, o isolamento entre ramos era
 * acidental, e um ramo que falhava deixava os irmãos rodando. O teste de
 * concorrência continua aqui porque ordenar a anexação **não pode** serializar a
 * execução — é o risco central da mudança.
 */

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("parallel", () => {
  it("executa os passos de forma concorrente, não em sequência", async () => {
    const ordem: string[] = [];

    const lento = new FakeProvider([{ content: "lento" }], { delayMs: 30 });
    const rapido = new FakeProvider([{ content: "rápido" }], { delayMs: 5 });

    const A = makeAgent(
      { provider: lento },
      { afterResponse: (r: string) => void ordem.push(r) },
    );
    const B = makeAgent(
      { provider: rapido },
      { afterResponse: (r: string) => void ordem.push(r) },
    );

    await runWorkflow(makeWorkflow([parallel([A, B])]), "vai");

    // Em sequência a ordem seria [lento, rápido]; concorrente, o rápido chega antes.
    expect(ordem).toEqual(["rápido", "lento"]);
  });

  it("todos os agentes recebem a mesma entrada", async () => {
    const a = new FakeProvider([{ content: "a" }]);
    const b = new FakeProvider([{ content: "b" }]);

    await runWorkflow(
      makeWorkflow([
        parallel([makeAgent({ provider: a }), makeAgent({ provider: b })]),
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
      makeWorkflow([
        parallel([makeAgent({ provider: a }), makeAgent({ provider: b })]),
        makeAgent({ provider: depois }),
      ]),
      "vai",
    );

    // O agente seguinte enxerga o que os dois escreveram.
    const conteudos = depois.chamadas[0].messages.map((m) => m.content);
    expect(conteudos).toContain("de A");
    expect(conteudos).toContain("de B");
  });

  it("ctx.output é o do último ramo declarado, não o de quem termina por último", async () => {
    const lento = new FakeProvider([{ content: "lento" }], { delayMs: 30 });
    const rapido = new FakeProvider([{ content: "rápido" }], { delayMs: 5 });

    const saida = await runWorkflow(
      makeWorkflow([
        parallel([makeAgent({ provider: lento }), makeAgent({ provider: rapido })]),
      ]),
      "vai",
    );

    // `rapido` é o último do array e vence, embora `lento` termine depois dele.
    // Antes o resultado era "lento", e mudava com a latência do modelo.
    expect(saida).toBe("rápido");
  });

  it("o histórico sai na ordem de declaração, não na de conclusão", async () => {
    // Latências invertidas de propósito: quem é declarado primeiro termina por
    // último. Se a anexação seguisse a conclusão, a ordem seria a inversa.
    const primeiro = new FakeProvider([{ content: "PRIMEIRO" }], { delayMs: 30 });
    const segundo = new FakeProvider([{ content: "SEGUNDO" }], { delayMs: 15 });
    const terceiro = new FakeProvider([{ content: "TERCEIRO" }], { delayMs: 1 });
    const depois = new FakeProvider([{ content: "fim" }]);

    await runWorkflow(
      makeWorkflow([
        parallel([
          makeAgent({ provider: primeiro }),
          makeAgent({ provider: segundo }),
          makeAgent({ provider: terceiro }),
        ]),
        makeAgent({ provider: depois }),
      ]),
      "vai",
    );

    const vistas = depois.chamadas[0].messages
      .map((m) => m.content)
      .filter((c) => ["PRIMEIRO", "SEGUNDO", "TERCEIRO"].includes(c));

    expect(vistas).toEqual(["PRIMEIRO", "SEGUNDO", "TERCEIRO"]);
  });

  it("um ramo que espera antes de ler não enxerga o irmão", async () => {
    // O cenário medido no ROADMAP: com o estado compartilhado, bastava um
    // `beforePrompt` que esperasse para o segundo ramo ler a resposta do
    // primeiro. Agora todos partem do mesmo snapshot.
    const rapido = new FakeProvider([{ content: "RESPOSTA-DE-A" }], { delayMs: 1 });
    const lento = new FakeProvider([{ content: "b" }]);

    const A = makeAgent({ provider: rapido });
    const B = makeAgent(
      { provider: lento },
      { beforePrompt: async (p: string) => (await espera(20), p) },
    );

    await runWorkflow(makeWorkflow([parallel([A, B])]), "pergunta");

    const vistoPorB = lento.chamadas[0].messages.map((m) => m.content);
    expect(vistoPorB).not.toContain("RESPOSTA-DE-A");
  });

  it("a função context() lê o ctx do próprio ramo", async () => {
    // `run.step` é um campo único no RunContext. Sem um escopo async por ramo,
    // o último ramo a se anexar sobrescreve o ponteiro e `context()` passa a
    // devolver o ctx do irmão — de dentro de uma tool, isso é ler o argumento
    // errado sem nenhum sinal.
    const vistos: string[] = [];

    const marcar = (marca: string) => ({
      beforePrompt: async (p: string, ctx: any) => {
        ctx.marca = marca;
        await espera(15); // dá tempo de o irmão se anexar
        vistos.push(String((context() as any).marca));
        return p;
      },
    });

    const A = makeAgent(
      { provider: new FakeProvider([{ content: "a" }]) },
      marcar("A"),
    );
    const B = makeAgent(
      { provider: new FakeProvider([{ content: "b" }]) },
      marcar("B"),
    );

    await runWorkflow(makeWorkflow([parallel([A, B])]), "vai");

    expect(vistos.sort()).toEqual(["A", "B"]);
  });

  it("um ramo que falha cancela o irmão em andamento", async () => {
    const concluidos: string[] = [];

    // O irmão está no meio da chamada ao modelo quando o outro ramo lança. O
    // `FakeProvider` respeita o signal, como um `fetch` de verdade.
    const irmao = new FakeProvider([{ content: "irmão" }], { delayMs: 40 });
    const Irmao = makeAgent(
      { provider: irmao },
      { afterResponse: (r: string) => void concluidos.push(r) },
    );
    const Quebrado = makeAgent(
      { provider: new FakeProvider() },
      {
        beforePrompt: () => {
          throw new Error("ramo quebrado");
        },
      },
    );

    await expect(
      runWorkflow(makeWorkflow([parallel([Irmao, Quebrado])]), "vai"),
    ).rejects.toThrow("ramo quebrado");

    // Tempo de sobra para o irmão terminar, se tivesse sobrevivido ao aborto.
    await espera(80);

    expect(irmao.chamadas).toHaveLength(1); // começou
    expect(concluidos).toEqual([]); // e foi cortado no meio
  });

  it("um parallel dentro de um passo sequencial continua a cadeia", async () => {
    const a = new FakeProvider([{ content: "a" }]);
    const b = new FakeProvider([{ content: "b" }]);
    const antes = new FakeProvider([{ content: "antes" }]);
    const depois = new FakeProvider([{ content: "depois" }]);

    const saida = await runWorkflow(
      makeWorkflow([
        makeAgent({ provider: antes }),
        parallel([makeAgent({ provider: a }), makeAgent({ provider: b })]),
        makeAgent({ provider: depois }),
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
    const Quebrado = makeAgent(
      { provider: new FakeProvider() },
      {
        beforePrompt: () => {
          throw new Error("ramo quebrado");
        },
      },
    );

    await expect(
      runWorkflow(
        makeWorkflow([parallel([makeAgent({ provider: ok }), Quebrado])]),
        "vai",
      ),
    ).rejects.toThrow("ramo quebrado");
  });
});
