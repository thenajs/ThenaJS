import { describe, expect, it } from "vitest";
import { bootstrapWorkflow } from "@thenajs/core";
import { FakeProvider, criarAgente, criarWorkflow } from "./harness.js";

/**
 * O que cada opção de `app.run(...)` realmente faz com o dado — em especial o
 * `memory`, que é um canal de **prompt**, não de dados.
 */
describe("opções de run", () => {
  it("memory entra no system prompt enviado ao modelo", async () => {
    const provider = new FakeProvider([{ content: "ok" }]);
    const app = await bootstrapWorkflow(criarWorkflow([criarAgente({ provider })]), {});

    await app.run({
      input: { message: "Olá" },
      memory: { tenant: "acme", chaveInterna: "segredo-123" },
    });
    await app.dispose();

    const systems = provider.chamadas[0].messages.filter((m) => m.role === "system");
    const texto = systems.map((m) => m.content).join("\n");

    // `memory` é serializado e projetado como mensagem `system`: o que você
    // colocar aqui **o modelo lê**. Não é lugar para credencial nem para dado
    // de infraestrutura.
    expect(texto).toContain("acme");
    expect(texto).toContain("segredo-123");
  });

  it("não há canal para dado de execução que não vá para o prompt", async () => {
    const provider = new FakeProvider([{ content: "ok" }]);
    const app = await bootstrapWorkflow(criarWorkflow([criarAgente({ provider })]), {});

    await app.run({ input: { message: "Olá" } });
    await app.dispose();

    // O ctx nasce em `Pipeline.createContext()` com `{ state, logs }` e nada
    // mais — `run()` não tem por onde semear campos próprios. Enquanto isso
    // for verdade, `memory` é a única via, e ela passa pelo modelo.
    const [system] = provider.chamadas[0].messages;
    expect(system.role).toBe("system");
    expect(system.content).toBe("Você é um agente de teste.\n");
  });
});
