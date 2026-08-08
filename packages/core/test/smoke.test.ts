import { describe, expect, it } from "vitest";
import { runWorkflow } from "@thenajs/core";
import { FakeProvider, makeAgent, makeWorkflow } from "./harness.js";

describe("harness", () => {
  it("executa um workflow de um agente e devolve a resposta", async () => {
    const provider = new FakeProvider([{ content: "olá do fake" }]);
    const Agente = makeAgent({ provider });
    const Fluxo = makeWorkflow([Agente]);

    const saida = await runWorkflow(Fluxo, "oi");

    expect(saida).toBe("olá do fake");
    expect(provider.chamadas).toHaveLength(1);
  });

  it("envia o prompt do markdown como mensagem system", async () => {
    const provider = new FakeProvider();
    const Fluxo = makeWorkflow([makeAgent({ provider })]);

    await runWorkflow(Fluxo, "oi");

    const [system] = provider.chamadas[0].messages;
    expect(system.role).toBe("system");
    expect(system.content).toContain("agente de teste");
  });
});
