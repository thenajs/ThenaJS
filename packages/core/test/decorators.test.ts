import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  Tool,
  Workflow,
  getAgentMetadata,
  getWorkflowMetadata,
  runWorkflow,
} from "@thenajs/core";
import { FakeProvider, PROMPT, criarAgente, criarWorkflow } from "./harness.js";

/**
 * Os decorators: carga do prompt e registro de metadados.
 *
 * O `@Agent` lê o markdown **na avaliação do decorator** (import do módulo),
 * não na execução — então um caminho errado falha ao carregar o arquivo, não
 * no meio de uma run.
 */

describe("@Agent — origem do prompt", () => {
  it("aceita URL (import.meta.url), sem depender de stack trace", () => {
    const provider = new FakeProvider();

    @Agent({ provider, prompt: new URL("./fixtures/agente.md", import.meta.url) })
    class ComUrl {}

    expect(getAgentMetadata(ComUrl).prompt).toContain("agente de teste");
  });

  it("aceita caminho absoluto", () => {
    const provider = new FakeProvider();
    const absoluto = fileURLToPath(new URL("./fixtures/agente.md", import.meta.url));

    @Agent({ provider, prompt: absoluto })
    class ComAbsoluto {}

    expect(getAgentMetadata(ComAbsoluto).prompt).toContain("agente de teste");
  });

  it("aceita caminho relativo ao arquivo do agente", () => {
    const provider = new FakeProvider();

    // Relativo é resolvido pelo `resolveCallerFile`, que inspeciona o stack
    // trace para achar este arquivo de teste.
    @Agent({ provider, prompt: "./fixtures/agente.md" })
    class ComRelativo {}

    expect(getAgentMetadata(ComRelativo).prompt).toContain("agente de teste");
  });

  it("erro claro quando o markdown não existe", () => {
    const provider = new FakeProvider();

    expect(() => {
      @Agent({ provider, prompt: "./fixtures/nao-existe.md" })
      class Fantasma {}
      void Fantasma;
    }).toThrow(/Prompt markdown não encontrado.*nao-existe\.md/s);
  });

  it("erro claro quando `prompt` não é informado", () => {
    const provider = new FakeProvider();

    expect(() => {
      @Agent({ provider } as never)
      class SemPrompt {}
      void SemPrompt;
    }).toThrow(/'prompt' é obrigatório/);
  });

  it("o prompt vira a mensagem system enviada ao modelo", async () => {
    const provider = new FakeProvider();
    await runWorkflow(criarWorkflow([criarAgente({ provider })]), "vai");

    expect(provider.chamadas[0].messages[0]).toEqual({
      role: "system",
      content: "Você é um agente de teste.\n",
    });
  });
});

describe("metadados", () => {
  it("@Agent registra provider, tools, prompt e sampling", () => {
    const provider = new FakeProvider();

    @Agent({ provider, prompt: PROMPT, tools: [], sampling: { temperature: 0.3 } })
    class Anotado {}

    const meta = getAgentMetadata(Anotado);
    expect(meta.provider).toBe(provider);
    expect(meta.tools).toEqual([]);
    expect(meta.sampling).toEqual({ temperature: 0.3 });
  });

  it("@Workflow registra steps e state", () => {
    class MeuEstado {}
    const Agente = criarAgente({ provider: new FakeProvider() });

    @Workflow({ steps: [Agente], state: MeuEstado })
    class Fluxo {}

    const meta = getWorkflowMetadata(Fluxo);
    expect(meta.steps).toEqual([Agente]);
    expect(meta.state).toBe(MeuEstado);
  });

  it("classe sem @Agent falha nomeando a classe", () => {
    class Nu {}
    expect(() => getAgentMetadata(Nu)).toThrow(/"Nu" não está decorada com @Agent/);
  });

  it("classe sem @Workflow falha nomeando a classe", () => {
    class Nu {}
    expect(() => getWorkflowMetadata(Nu)).toThrow(
      /"Nu" não está decorada com @Workflow/,
    );
  });

  it("tool sem @Tool falha na hora de resolver, nomeando a classe", async () => {
    class ToolNua {
      execute() {
        return "x";
      }
    }
    const Agente = criarAgente({
      provider: new FakeProvider(),
      tools: [ToolNua as never],
    });

    await expect(runWorkflow(criarWorkflow([Agente]), "vai")).rejects.toThrow(
      /"ToolNua" não está decorada com @Tool/,
    );
  });

  it("classe decorada com @Tool mas sem execute falha na resolução", async () => {
    const SemExecute = class {};
    Tool({ name: "x", description: "x", schema: z.object({}) })(SemExecute as never);

    const Agente = criarAgente({
      provider: new FakeProvider(),
      tools: [SemExecute as never],
    });

    await expect(runWorkflow(criarWorkflow([Agente]), "vai")).rejects.toThrow(
      /não implementa execute\(input\)/,
    );
  });
});
