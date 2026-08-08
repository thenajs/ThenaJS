import { describe, expect, it, vi } from "vitest";
import { BudgetExceededError, loop, runWorkflow } from "@thenajs/core";
import type { BudgetExceeded } from "@thenajs/core";
import { FakeProvider, makeAgent, makeWorkflow } from "./harness.js";

/** Caracterização do `RunBudget`: teto da execução inteira. */
describe("budget", () => {
  it('modo "stop" pula os passos seguintes e preserva o output que já havia', async () => {
    const provider = new FakeProvider([
      { content: "primeiro" },
      { content: "segundo" },
      { content: "terceiro" },
    ]);
    const Fluxo = makeWorkflow([
      makeAgent({ provider }),
      makeAgent({ provider }),
      makeAgent({ provider }),
    ]);

    const saida = await runWorkflow(Fluxo, "vai", undefined, {
      maxChatCalls: 2,
    });

    // O terceiro passo é pulado; a saída é a do segundo.
    expect(saida).toBe("segundo");
    expect(provider.chamadas).toHaveLength(2);
  });

  it('modo "throw" lança BudgetExceededError', async () => {
    const provider = new FakeProvider([{ content: "a" }, { content: "b" }]);
    const Fluxo = makeWorkflow([makeAgent({ provider }), makeAgent({ provider })]);

    await expect(
      runWorkflow(Fluxo, "vai", undefined, {
        maxChatCalls: 1,
        mode: "throw",
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("onExceeded dispara uma única vez, mesmo com o loop reavaliando", async () => {
    const provider = new FakeProvider([{ content: "sempre" }]);
    const onExceeded = vi.fn<(info: BudgetExceeded) => void>();

    const Fluxo = makeWorkflow([
      loop({
        steps: [makeAgent({ provider })],
        until: () => false, // nunca converge: quem para é o orçamento
        maxIterations: 10,
      }),
    ]);

    await runWorkflow(Fluxo, "vai", undefined, {
      maxChatCalls: 2,
      onExceeded,
    });

    expect(onExceeded).toHaveBeenCalledTimes(1);
    expect(onExceeded.mock.calls[0][0].reason).toBe("maxChatCalls");
  });

  it("sem budget configurado, nada é medido nem interrompido", async () => {
    const provider = new FakeProvider([{ content: "a" }, { content: "b" }]);
    const Fluxo = makeWorkflow([makeAgent({ provider }), makeAgent({ provider })]);

    const saida = await runWorkflow(Fluxo, "vai");

    expect(saida).toBe("b");
    expect(provider.chamadas).toHaveLength(2);
  });

  it("contabiliza tokens reportados pelo provider", async () => {
    const provider = new FakeProvider([
      { content: "a", usage: { promptTokens: 30, completionTokens: 30 } },
      { content: "b", usage: { promptTokens: 30, completionTokens: 30 } },
    ]);
    const Fluxo = makeWorkflow([makeAgent({ provider }), makeAgent({ provider })]);

    const saida = await runWorkflow(Fluxo, "vai", undefined, {
      maxTokens: 60,
    });

    // O primeiro turno já atinge 60 tokens; o segundo passo é pulado.
    expect(saida).toBe("a");
    expect(provider.chamadas).toHaveLength(1);
  });
});
