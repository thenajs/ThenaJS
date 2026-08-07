import { describe, expect, it } from "vitest";
import { Thena } from "@thenajs/core";
import type { ExecutionEvent } from "@thenajs/core";
import { FakeProvider, criarAgente, criarWorkflow } from "../../core/test/harness.js";
import { MemoriaDeRuns } from "../src/server/memoria.js";

/**
 * Ponta a ponta: eventos **reais** do core, de duas execuções concorrentes,
 * atravessando o Flow. É o caminho que antes embaralhava as duas runs numa só.
 */

/** Agente que demora `ms` para responder, forçando a intercalação. */
function fluxoLento(ms: number, resposta: string) {
  const provider = new FakeProvider([{ content: resposta }], { delayMs: ms });
  return criarWorkflow([criarAgente({ provider })]);
}

describe("Flow com execuções concorrentes", () => {
  it("registra duas runs distintas, cada uma com seus próprios passos", async () => {
    const memoria = new MemoriaDeRuns(20);
    const publicar = (e: ExecutionEvent) => memoria.registrar(e);

    // Um app por workflow, como no uso real; os dois publicam no mesmo Flow.
    const appA = Thena.create(fluxoLento(30, "A"), { log: publicar });
    const appB = Thena.create(fluxoLento(5, "B"), { log: publicar });

    const [a, b] = await Promise.all([
      appA.run({ input: { message: "a" } }),
      appB.run({ input: { message: "b" } }),
    ]);
    await Promise.all([appA.dispose(), appB.dispose()]);

    expect(a).toBe("A");
    expect(b).toBe("B");

    const { runs } = memoria.snapshot();
    expect(runs).toHaveLength(2);

    // Nenhuma run herdou evento da outra: cada uma tem a própria árvore
    // completa (workflow + agent + chat, começo e fim = 6 eventos).
    for (const run of runs) {
      const eventos = memoria.eventosDe(run.id)!;
      expect(eventos.every((e) => e.runId === run.id)).toBe(true);
      expect(eventos.filter((e) => e.depth === 0)).toHaveLength(2);
      expect(eventos.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(run.status).toBe("ok");
    }
  });

  it("uma run que falha não contamina o status da outra", async () => {
    const memoria = new MemoriaDeRuns(20);
    const publicar = (e: ExecutionEvent) => memoria.registrar(e);

    const Quebrado = criarWorkflow([
      criarAgente(
        { provider: new FakeProvider([{ content: "x" }]) },
        {
          beforePrompt() {
            throw new Error("falhou de propósito");
          },
        },
      ),
    ]);

    const appOk = Thena.create(fluxoLento(20, "ok"), { log: publicar });
    const appRuim = Thena.create(Quebrado, { log: publicar });

    const [ok, ruim] = await Promise.all([
      appOk.run({ input: { message: "a" } }),
      appRuim.run({ input: { message: "b" } }).catch(() => "REJEITOU"),
    ]);
    await Promise.all([appOk.dispose(), appRuim.dispose()]);

    expect(ok).toBe("ok");
    expect(ruim).toBe("REJEITOU");

    const { runs } = memoria.snapshot();
    expect(runs.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(runs.filter((r) => r.status === "error")).toHaveLength(1);
  });
});
