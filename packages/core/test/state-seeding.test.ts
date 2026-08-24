import { describe, expect, it } from "vitest";
import { Thena, contextWindow } from "@thenajs/core";
import { FakeProvider, makeAgent, makeWorkflow } from "./harness.js";

/**
 * `run({ state })` e `handle.state`: as duas metades de continuar uma conversa.
 *
 * Sem a primeira, o segundo turno nasce amnésico. Sem a segunda, não há de onde
 * tirar o que semear. Uma sem a outra não serve para nada, e é por isso que elas
 * estão no mesmo arquivo.
 */

const app = (p: FakeProvider) =>
  Thena.create(makeWorkflow([makeAgent({ provider: p })]), {});

describe("continuar uma conversa", () => {
  it("o segundo turno enxerga o primeiro, com os papéis preservados", async () => {
    const p1 = new FakeProvider([{ content: "o config liga log e report" }]);
    const a1 = app(p1);
    const t1 = a1.run({ prompt: "leia o config.ts" });
    await t1;
    const anterior = await t1.state;
    await a1.dispose();

    const p2 = new FakeProvider([{ content: "o main cria o app" }]);
    const a2 = app(p2);
    await a2.run({ prompt: "e o main.ts?", state: anterior });
    await a2.dispose();

    const vistas = p2.chamadas[0].messages.map((m) => `${m.role}: ${m.content}`);

    // A conversa inteira, na ordem, e como turnos — não como texto no system.
    expect(vistas).toEqual([
      expect.stringContaining("system:"),
      "user: leia o config.ts",
      "assistant: o config liga log e report",
      "user: e o main.ts?",
    ]);
  });

  it("a mensagem nova entra depois do que foi semeado", async () => {
    const p = new FakeProvider([{ content: "ok" }]);
    const a = app(p);
    await a.run({
      prompt: "terceira",
      state: {
        history: [
          { role: "user", content: "primeira" },
          { role: "assistant", content: "segunda" },
        ],
      },
    });
    await a.dispose();

    const conversa = p.chamadas[0].messages.filter((m) => m.role !== "system");
    expect(conversa.map((m) => m.content)).toEqual(["primeira", "segunda", "terceira"]);
  });

  it("a execução não escreve no array de quem semeou", async () => {
    const meu = { history: [{ role: "user" as const, content: "minha" }] };
    const antes = meu.history.length;

    const a = app(new FakeProvider([{ content: "ok" }]));
    await a.run({ prompt: "nova", state: meu });
    await a.dispose();

    // Sem a cópia, o transcript do chamador cresceria por baixo dele — e duas
    // runs semeadas com o mesmo objeto se contaminariam (R-13).
    expect(meu.history).toHaveLength(antes);
  });

  it("semear é parcial: só `history` já serve", async () => {
    const p = new FakeProvider([{ content: "ok" }]);
    const a = app(p);
    await a.run({
      prompt: "b",
      state: { history: [{ role: "user", content: "a" }] },
    });
    await a.dispose();

    expect(p.chamadas[0].messages.some((m) => m.content === "a")).toBe(true);
  });

  it("o estado devolvido já inclui o turno que acabou de acontecer", async () => {
    const a = app(new FakeProvider([{ content: "resposta" }]));
    const exec = a.run({ prompt: "pergunta" });
    await exec;
    const estado = await exec.state;
    await a.dispose();

    expect(estado.history.map((m) => m.content)).toEqual(["pergunta", "resposta"]);
  });

  it("uma run que falha não devolve estado — não houve conversa", async () => {
    const Quebrado = makeAgent(
      { provider: new FakeProvider() },
      {
        beforePrompt: () => {
          throw new Error("quebrou");
        },
      },
    );
    const a = Thena.create(makeWorkflow([Quebrado]), {});
    const exec = a.run({ prompt: "vai" });

    await expect(exec).rejects.toThrow("quebrou");
    await expect(exec.state).rejects.toThrow("quebrou");
    await a.dispose();
  });
});

describe("por que não é o `memory`", () => {
  it("o histórico semeado é aparável pela janela; o `memory` não é", async () => {
    // A diferença que decide o desenho. `contextWindow` nunca corta o bloco
    // `system` do topo (R-17) — então transcript posto no `memory` cresce no
    // único lugar que a janela não alcança.
    const longo = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 ? ("assistant" as const) : ("user" as const),
      content: `turno ${i}`,
    }));

    const p = new FakeProvider([{ content: "ok" }]);
    const a = Thena.create(makeWorkflow([makeAgent({ provider: p })]), {});
    await a.use({ name: "janela", chat: contextWindow({ maxTurns: 4 }) });
    await a.run({ prompt: "nova", state: { history: longo } });
    await a.dispose();

    const conversa = p.chamadas[0].messages.filter((m) => m.role !== "system");
    expect(conversa.length).toBeLessThanOrEqual(4);
  });
});
