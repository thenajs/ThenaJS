import { describe, expect, it } from "vitest";
import { runWorkflow } from "@thenajs/core";
import { FakeProvider, criarAgente, criarWorkflow } from "./harness.js";

describe("harness", () => {
  it("executa um workflow de um agente e devolve a resposta", async () => {
    const provider = new FakeProvider([{ content: "olá do fake" }]);
    const Agente = criarAgente({ provider });
    const Fluxo = criarWorkflow([Agente]);

    const saida = await runWorkflow(Fluxo, "oi");

    expect(saida).toBe("olá do fake");
    expect(provider.chamadas).toHaveLength(1);
  });

  it("envia o prompt do markdown como mensagem system", async () => {
    const provider = new FakeProvider();
    const Fluxo = criarWorkflow([criarAgente({ provider })]);

    await runWorkflow(Fluxo, "oi");

    const [system] = provider.chamadas[0].messages;
    expect(system.role).toBe("system");
    expect(system.content).toContain("agente de teste");
  });
});
