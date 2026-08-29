import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  DefaultAgentContract,
  Tool,
  Workflow,
  getAgentMetadata,
  getWorkflowMetadata,
  runWorkflow,
} from "@thenajs/core";
import { FakeProvider, PROMPT, makeAgent, makeWorkflow } from "./harness.js";

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

    @Agent({
      provider,
      prompt: new URL("./fixtures/agente.md", import.meta.url),
      contract: DefaultAgentContract,
    })
    class ComUrl {}

    expect(getAgentMetadata(ComUrl).prompt).toContain("test agent");
  });

  it("aceita caminho absoluto", () => {
    const provider = new FakeProvider();
    const absoluto = fileURLToPath(new URL("./fixtures/agente.md", import.meta.url));

    @Agent({ provider, prompt: absoluto, contract: DefaultAgentContract })
    class ComAbsoluto {}

    expect(getAgentMetadata(ComAbsoluto).prompt).toContain("test agent");
  });

  it("aceita caminho relativo ao arquivo do agente", () => {
    const provider = new FakeProvider();

    // Relativo é resolvido pelo `resolveCallerFile`, que inspeciona o stack
    // trace para achar este arquivo de teste.
    @Agent({
      provider,
      prompt: "./fixtures/agente.md",
      contract: DefaultAgentContract,
    })
    class ComRelativo {}

    expect(getAgentMetadata(ComRelativo).prompt).toContain("test agent");
  });

  it("erro claro quando o markdown não existe", () => {
    const provider = new FakeProvider();

    expect(() => {
      @Agent({
        provider,
        prompt: "./fixtures/nao-existe.md",
        contract: DefaultAgentContract,
      })
      class Fantasma {}
      void Fantasma;
    }).toThrow(/Prompt markdown not found.*nao-existe\.md/s);
  });

  it("erro claro quando `prompt` não é informado", () => {
    const provider = new FakeProvider();

    expect(() => {
      @Agent({ provider, contract: DefaultAgentContract } as never)
      class SemPrompt {}
      void SemPrompt;
    }).toThrow(/'prompt' field is required/);
  });

  it("erro claro quando `contract` não é informado", () => {
    const provider = new FakeProvider();
    expect(() => Agent({ provider, prompt: PROMPT } as never)).toThrow(
      /'contract' field is required/,
    );
  });

  it("o prompt vira a mensagem system enviada ao modelo", async () => {
    const provider = new FakeProvider();
    await runWorkflow(makeWorkflow([makeAgent({ provider })]), "vai");

    expect(provider.chamadas[0].messages[0]).toEqual({
      role: "system",
      content: "You are a test agent.\n",
    });
  });
});

describe("metadados", () => {
  it("@Agent registra provider, tools, prompt e sampling", () => {
    const provider = new FakeProvider();
    class Contract {
      build() {
        return {};
      }
    }

    @Agent({
      provider,
      prompt: PROMPT,
      tools: [],
      sampling: { temperature: 0.3 },
      contract: Contract,
    })
    class Anotado {}

    const meta = getAgentMetadata(Anotado);
    expect(meta.provider).toBe(provider);
    expect(meta.tools).toEqual([]);
    expect(meta.sampling).toEqual({ temperature: 0.3 });
    expect(meta.contract).toBe(Contract);
  });

  it("@Workflow registra steps e state", () => {
    class MeuEstado {}
    const Agente = makeAgent({ provider: new FakeProvider() });

    @Workflow({ steps: [Agente], state: MeuEstado })
    class Fluxo {}

    const meta = getWorkflowMetadata(Fluxo);
    expect(meta.steps).toEqual([Agente]);
    expect(meta.state).toBe(MeuEstado);
  });

  it("classe sem @Agent falha nomeando a classe", () => {
    class Nu {}
    expect(() => getAgentMetadata(Nu)).toThrow(/"Nu" is not decorated with @Agent/);
  });

  it("classe sem @Workflow falha nomeando a classe", () => {
    class Nu {}
    expect(() => getWorkflowMetadata(Nu)).toThrow(
      /"Nu" is not decorated with @Workflow/,
    );
  });

  it("tool sem @Tool falha na hora de resolver, nomeando a classe", async () => {
    class ToolNua {
      execute() {
        return "x";
      }
    }
    const Agente = makeAgent({
      provider: new FakeProvider(),
      tools: [ToolNua as never],
    });

    await expect(runWorkflow(makeWorkflow([Agente]), "vai")).rejects.toThrow(
      /"ToolNua" is not decorated with @Tool/,
    );
  });

  it("classe decorada com @Tool mas sem execute falha na resolução", async () => {
    const SemExecute = class {};
    Tool({ name: "x", description: "x", schema: z.object({}) })(SemExecute as never);

    const Agente = makeAgent({
      provider: new FakeProvider(),
      tools: [SemExecute as never],
    });

    await expect(runWorkflow(makeWorkflow([Agente]), "vai")).rejects.toThrow(
      /does not implement execute\(input\)/,
    );
  });
});
