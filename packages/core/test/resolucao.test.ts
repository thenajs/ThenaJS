import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runWorkflow } from "@thenajs/core";
import type { ToolType } from "@thenajs/core";
import { FakeProvider, criarAgente, criarTool, criarWorkflow } from "./harness.js";

/** Como `@Agent({ provider, tools })` vira instância na hora de executar. */

describe("provider", () => {
  it("aceita uma instância já configurada", async () => {
    const provider = new FakeProvider([{ content: "da instância" }]);

    await expect(
      runWorkflow(criarWorkflow([criarAgente({ provider })]), "vai"),
    ).resolves.toBe("da instância");
    expect(provider.chamadas).toHaveLength(1);
  });

  it("aceita uma classe, e a instancia com new", async () => {
    class ProviderProprio extends FakeProvider {
      constructor() {
        super([{ content: "da classe" }]);
      }
    }

    await expect(
      runWorkflow(criarWorkflow([criarAgente({ provider: ProviderProprio })]), "vai"),
    ).resolves.toBe("da classe");
  });

  it("a instância é compartilhada entre os passos que a declaram", async () => {
    const provider = new FakeProvider([{ content: "a" }, { content: "b" }]);

    await runWorkflow(
      criarWorkflow([criarAgente({ provider }), criarAgente({ provider })]),
      "vai",
    );

    // Uma instância só, dois turnos — a fila do fake avançou.
    expect(provider.chamadas).toHaveLength(2);
  });
});

describe("tools", () => {
  it("aceita um objeto ToolType direto", async () => {
    let chamada = false;
    const tool: ToolType = {
      name: "objeto",
      description: "uma tool sem classe",
      schema: z.object({ x: z.string() }),
      execute: async ({ x }: { x: string }) => {
        chamada = true;
        return `eco: ${x}`;
      },
    };

    const provider = new FakeProvider([
      { tool: { name: "objeto", arguments: { x: "oi" } } },
    ]);

    await expect(
      runWorkflow(criarWorkflow([criarAgente({ provider, tools: [tool] })]), "vai"),
    ).resolves.toBe("eco: oi");
    expect(chamada).toBe(true);
  });

  it("aceita uma classe @Tool", async () => {
    const Ferramenta = criarTool(
      {
        name: "classe",
        description: "com classe",
        schema: z.object({ x: z.string() }),
      },
      ({ x }: { x: string }) => `eco: ${x}`,
    );
    const provider = new FakeProvider([
      { tool: { name: "classe", arguments: { x: "oi" } } },
    ]);

    await expect(
      runWorkflow(
        criarWorkflow([criarAgente({ provider, tools: [Ferramenta] })]),
        "vai",
      ),
    ).resolves.toBe("eco: oi");
  });

  it("nome, descrição e schema do @Tool chegam ao provider", async () => {
    const provider = new FakeProvider();
    const Ferramenta = criarTool(
      {
        name: "com_schema",
        description: "descrição da tool",
        schema: z.object({ caminho: z.string() }),
      },
      () => "ok",
    );

    await runWorkflow(
      criarWorkflow([criarAgente({ provider, tools: [Ferramenta] })]),
      "vai",
    );

    const [tool] = provider.chamadas[0].tools;
    expect(tool.name).toBe("com_schema");
    expect(tool.description).toBe("descrição da tool");
    // O schema é o mesmo objeto zod — é dele que sai o JSON Schema no provider real.
    expect(tool.schema.safeParse({ caminho: "a.ts" }).success).toBe(true);
    expect(tool.schema.safeParse({ outro: 1 }).success).toBe(false);
  });

  it("um agente sem tools envia lista vazia", async () => {
    const provider = new FakeProvider();
    await runWorkflow(criarWorkflow([criarAgente({ provider })]), "vai");

    expect(provider.chamadas[0].tools).toEqual([]);
  });
});

describe("sampling", () => {
  it("o do @Agent sobrescreve o do provider, chave a chave", async () => {
    const provider = new FakeProvider([{ content: "ok" }], {
      sampling: { temperature: 0.9, topP: 0.5, seed: 42 },
    });

    await runWorkflow(
      criarWorkflow([criarAgente({ provider, sampling: { temperature: 0 } })]),
      "vai",
    );

    // `temperature` veio do agente; `topP` e `seed` sobreviveram do provider.
    expect(provider.chamadas[0].sampling).toEqual({
      temperature: 0,
      topP: 0.5,
      seed: 42,
    });
  });

  it("sem sampling no agente, vale o do provider", async () => {
    const provider = new FakeProvider([{ content: "ok" }], {
      sampling: { temperature: 0.7 },
    });

    await runWorkflow(criarWorkflow([criarAgente({ provider })]), "vai");

    expect(provider.chamadas[0].sampling).toEqual({ temperature: 0.7 });
  });

  it("sem sampling em lugar nenhum, não envia nada", async () => {
    const provider = new FakeProvider();

    await runWorkflow(criarWorkflow([criarAgente({ provider })]), "vai");

    expect(provider.chamadas[0].sampling).toEqual({});
  });
});
