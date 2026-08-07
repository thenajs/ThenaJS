import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FatalToolError, bootstrapWorkflow } from "@thenajs/core";
import { FakeProvider, criarAgente, criarTool, criarWorkflow } from "./harness.js";

/**
 * As formas de uma tool falhar. Todas viram **observação** para o modelo —
 * uma só, a `FatalToolError`, encerra a run.
 */

const schema = z.object({ x: z.string() });

function montar(
  tool: ReturnType<typeof criarTool>,
  chamada: { name: string; arguments?: unknown },
) {
  const provider = new FakeProvider([{ tool: chamada }]);
  return criarWorkflow([criarAgente({ provider, tools: [tool] })]);
}

const eco = () =>
  criarTool({ name: "eco", description: "eco", schema }, ({ x }: any) => x);

describe("falhas de tool", () => {
  it("execute que lança vira observação", async () => {
    const tool = criarTool({ name: "eco", description: "eco", schema }, () => {
      throw new Error("boom");
    });
    const app = await bootstrapWorkflow(
      montar(tool, { name: "eco", arguments: { x: "1" } }),
      {},
    );

    await expect(app.run({ input: { message: "vai" } })).resolves.toBe("boom");
    await app.dispose();
  });

  it("execute que devolve isError vira observação", async () => {
    const tool = criarTool({ name: "eco", description: "eco", schema }, () => ({
      content: "não deu",
      isError: true,
    }));
    const app = await bootstrapWorkflow(
      montar(tool, { name: "eco", arguments: { x: "1" } }),
      {},
    );

    await expect(app.run({ input: { message: "vai" } })).resolves.toBe("não deu");
    await app.dispose();
  });

  it("tool inexistente vira observação", async () => {
    const app = await bootstrapWorkflow(
      montar(eco(), { name: "nao_existe", arguments: { x: "1" } }),
      {},
    );

    await expect(app.run({ input: { message: "vai" } })).resolves.toContain(
      "não encontrada",
    );
    await app.dispose();
  });

  it("argumentos fora do schema viram observação, com a mensagem do zod", async () => {
    const app = await bootstrapWorkflow(
      // o schema pede { x: string }; o modelo mandou { y: 1 }
      montar(eco(), { name: "eco", arguments: { y: 1 } }),
      {},
    );

    // É a falha mais recuperável de todas: o modelo errou o formato e pode
    // acertar no turno seguinte. Antes ela derrubava a run.
    const saida = await app.run({ input: { message: "vai" } });
    expect(saida).toContain("Argumentos inválidos");
    expect(saida).toContain("eco");
    await app.dispose();
  });

  it("uma chamada resgatada do texto diz isso na mensagem de erro", async () => {
    // Sem tool call nativa: o resgate extrai do conteúdo, e os args não batem.
    const provider = new FakeProvider([
      { content: '{"name":"eco","arguments":{"y":1}}' },
    ]);
    const Fluxo = criarWorkflow([criarAgente({ provider, tools: [eco()] })]);
    const app = await bootstrapWorkflow(Fluxo, {});

    await expect(app.run({ input: { message: "vai" } })).resolves.toContain(
      "resgatada do texto",
    );
    await app.dispose();
  });

  it("FatalToolError atravessa o agente e encerra a run", async () => {
    const tool = criarTool({ name: "eco", description: "eco", schema }, () => {
      throw new FatalToolError("banco indisponível");
    });
    const app = await bootstrapWorkflow(
      montar(tool, { name: "eco", arguments: { x: "1" } }),
      {},
    );

    await expect(app.run({ input: { message: "vai" } })).rejects.toBeInstanceOf(
      FatalToolError,
    );
    await app.dispose();
  });

  it("FatalToolError preserva o erro original em `cause`", async () => {
    const original = new Error("ECONNREFUSED 10.0.0.1:5432");
    const tool = criarTool({ name: "eco", description: "eco", schema }, () => {
      throw new FatalToolError("banco indisponível", { cause: original });
    });
    const app = await bootstrapWorkflow(
      montar(tool, { name: "eco", arguments: { x: "1" } }),
      {},
    );

    const erro = await app
      .run({ input: { message: "vai" } })
      .catch((e: FatalToolError) => e);

    expect((erro as FatalToolError).message).toBe("banco indisponível");
    expect((erro as FatalToolError).cause).toBe(original);
    await app.dispose();
  });

  it("um loop deixa o agente corrigir depois de uma falha", async () => {
    const tentativas: string[] = [];
    const tool = criarTool(
      {
        name: "ler",
        description: "lê um arquivo",
        schema: z.object({ path: z.string() }),
      },
      ({ path }: { path: string }) => {
        tentativas.push(path);
        if (path === "certo.ts") return "conteúdo";
        throw new Error(`ENOENT: ${path}`);
      },
    );

    // 1º turno erra o caminho, 2º acerta, 3º responde sem tool (encerra o loop).
    const provider = new FakeProvider([
      { tool: { name: "ler", arguments: { path: "errado.ts" } } },
      { tool: { name: "ler", arguments: { path: "certo.ts" } } },
      { content: "achei o arquivo" },
    ]);
    const { loop, untilAnswered } = await import("@thenajs/core");
    const Fluxo = criarWorkflow([
      loop({
        steps: [criarAgente({ provider, tools: [tool] })],
        until: untilAnswered,
        maxIterations: 5,
      }),
    ]);

    const app = await bootstrapWorkflow(Fluxo, {});
    const saida = await app.run({ input: { message: "leia o arquivo" } });
    await app.dispose();

    // É o ponto do default: a falha não derruba a run, vira informação.
    expect(tentativas).toEqual(["errado.ts", "certo.ts"]);
    expect(saida).toBe("achei o arquivo");
  });
});
