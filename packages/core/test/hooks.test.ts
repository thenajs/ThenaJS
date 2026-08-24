import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runWorkflow } from "@thenajs/core";
import type { AgentContext, ToolCall, ToolResult } from "@thenajs/core";
import { FakeProvider, makeAgent, makeTool, makeWorkflow } from "./harness.js";

/**
 * Os cinco hooks do agente. Contrato dos transformadores: retornar um valor
 * **substitui**; retornar `undefined` **mantém** o original.
 */

const schema = z.object({ x: z.string() });

const eco = (impl: (...a: any[]) => unknown = ({ x }: any) => x) =>
  makeTool({ name: "eco", description: "eco", schema }, impl);

describe("beforePrompt", () => {
  it("substitui o system prompt quando devolve string", async () => {
    const provider = new FakeProvider();
    const Agente = makeAgent({ provider }, { beforePrompt: () => "PROMPT TROCADO" });

    await runWorkflow(makeWorkflow([Agente]), "vai");

    expect(provider.chamadas[0].messages[0]).toEqual({
      role: "system",
      content: "PROMPT TROCADO",
    });
  });

  it("mantém o original quando devolve undefined", async () => {
    const provider = new FakeProvider();
    const Agente = makeAgent({ provider }, { beforePrompt: () => undefined });

    await runWorkflow(makeWorkflow([Agente]), "vai");

    expect(provider.chamadas[0].messages[0].content).toContain("test agent");
  });

  it("recebe o prompt e o contexto", async () => {
    const provider = new FakeProvider();
    let recebido: { prompt?: string; temCtx?: boolean } = {};
    const Agente = makeAgent(
      { provider },
      {
        beforePrompt: (prompt: string, ctx: AgentContext) => {
          recebido = { prompt, temCtx: typeof ctx?.state?.append === "function" };
        },
      },
    );

    await runWorkflow(makeWorkflow([Agente]), "vai");

    expect(recebido.prompt).toContain("test agent");
    expect(recebido.temCtx).toBe(true);
  });
});

describe("beforeTool", () => {
  it("troca os argumentos quando devolve um ToolCall novo", async () => {
    let recebido: unknown;
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "original" } } },
    ]);
    const Agente = makeAgent(
      { provider, tools: [eco((args: any) => ((recebido = args), args.x))] },
      { beforeTool: (call: ToolCall) => ({ ...call, args: { x: "trocado" } }) },
    );

    const saida = await runWorkflow(makeWorkflow([Agente]), "vai");

    expect(recebido).toEqual({ x: "trocado" });
    expect(saida).toBe("trocado");
  });

  it("um throw cancela a execução da tool e derruba a run", async () => {
    let executou = false;
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "1" } } },
    ]);
    const Agente = makeAgent(
      { provider, tools: [eco(() => ((executou = true), "nunca"))] },
      {
        beforeTool: () => {
          throw new Error("cancelado pela política");
        },
      },
    );

    await expect(runWorkflow(makeWorkflow([Agente]), "vai")).rejects.toThrow(
      "cancelado pela política",
    );
    // O cancelamento do beforeTool é o caminho documentado: **não** vira
    // observação, diferente de um throw dentro do execute.
    expect(executou).toBe(false);
  });
});

describe("afterTool", () => {
  it("string troca só o texto e PRESERVA o isError", async () => {
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "1" } } },
    ]);
    // Um segundo agente com afterTool observa nada; o que confirma o `isError`
    // preservado é o `ctx.turn.toolError`, lido depois pelo until de um loop.
    let erroNoTurno: boolean | undefined;

    const Agente = makeAgent(
      { provider, tools: [eco(() => ({ content: "falhou", isError: true }))] },
      { afterTool: () => "texto novo" },
    );

    const { loop } = await import("@thenajs/core");
    await runWorkflow(
      makeWorkflow([
        loop({
          steps: [Agente],
          until: (ctx) => {
            erroNoTurno = ctx.turn?.toolError;
            return true;
          },
        }),
      ]),
      "vai",
    );

    // O texto trocou, mas a marca de erro sobreviveu — que é o contrato.
    expect(erroNoTurno).toBe(true);
  });

  it("um ToolOutput completo substitui inclusive o isError", async () => {
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "1" } } },
    ]);
    const Agente = makeAgent(
      { provider, tools: [eco(() => ({ content: "falhou", isError: true }))] },
      { afterTool: () => ({ content: "na verdade deu certo", isError: false }) },
    );

    const saida = await runWorkflow(makeWorkflow([Agente]), "vai");

    expect(saida).toBe("na verdade deu certo");
  });

  it("undefined mantém a saída original", async () => {
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "intacto" } } },
    ]);
    const Agente = makeAgent(
      { provider, tools: [eco()] },
      { afterTool: () => undefined },
    );

    await expect(runWorkflow(makeWorkflow([Agente]), "vai")).resolves.toBe("intacto");
  });

  it("recebe nome, args, output e isError", async () => {
    let visto: ToolResult | undefined;
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "1" } } },
    ]);
    const Agente = makeAgent(
      { provider, tools: [eco(() => ({ content: "ops", isError: true }))] },
      { afterTool: (r: ToolResult) => void (visto = r) },
    );

    await runWorkflow(makeWorkflow([Agente]), "vai");

    expect(visto).toMatchObject({
      name: "eco",
      args: { x: "1" },
      output: "ops",
      isError: true,
    });
  });
});

describe("afterResponse", () => {
  it("substitui a resposta final do passo", async () => {
    const provider = new FakeProvider([{ content: "original" }]);
    const Agente = makeAgent({ provider }, { afterResponse: (r: string) => `[${r}]` });

    await expect(runWorkflow(makeWorkflow([Agente]), "vai")).resolves.toBe(
      "[original]",
    );
  });

  it("undefined mantém a resposta", async () => {
    const provider = new FakeProvider([{ content: "original" }]);
    const Agente = makeAgent({ provider }, { afterResponse: () => undefined });

    await expect(runWorkflow(makeWorkflow([Agente]), "vai")).resolves.toBe("original");
  });
});

describe("onError", () => {
  it("o retorno vira a saída do agente e a run continua", async () => {
    const provider = new FakeProvider();
    const Agente = makeAgent(
      { provider },
      {
        beforePrompt: () => {
          throw new Error("explodiu");
        },
        onError: (err: Error) => `recuperado de: ${err.message}`,
      },
    );

    await expect(runWorkflow(makeWorkflow([Agente]), "vai")).resolves.toBe(
      "recuperado de: explodiu",
    );
  });

  it("sem retorno, o erro continua subindo", async () => {
    const provider = new FakeProvider();
    const Agente = makeAgent(
      { provider },
      {
        beforePrompt: () => {
          throw new Error("explodiu");
        },
        onError: () => undefined,
      },
    );

    await expect(runWorkflow(makeWorkflow([Agente]), "vai")).rejects.toThrow(
      "explodiu",
    );
  });

  it("a saída do onError entra no history como assistant", async () => {
    const provider = new FakeProvider([{ content: "segundo agente" }]);
    const Quebrado = makeAgent(
      { provider: new FakeProvider() },
      {
        beforePrompt: () => {
          throw new Error("x");
        },
        onError: () => "fallback",
      },
    );
    const Seguinte = makeAgent({ provider });

    await runWorkflow(makeWorkflow([Quebrado, Seguinte]), "vai");

    const historico = provider.chamadas[0].messages;
    expect(
      historico.some((m) => m.role === "assistant" && m.content === "fallback"),
    ).toBe(true);
  });
});

describe("escape hatch run(input, ctx)", () => {
  it("assume o controle e os hooks automáticos não são chamados", async () => {
    const chamados: string[] = [];
    const provider = new FakeProvider([{ content: "não deveria ser usado" }]);

    const Agente = makeAgent(
      { provider },
      {
        run: (entrada: string) => `controlei: ${entrada}`,
        beforePrompt: () => void chamados.push("beforePrompt"),
        afterResponse: () => void chamados.push("afterResponse"),
      },
    );

    const saida = await runWorkflow(makeWorkflow([Agente]), "olá");

    expect(saida).toBe("controlei: olá");
    expect(chamados).toEqual([]);
    // Nem o provider foi chamado: quem manda é o `run`.
    expect(provider.chamadas).toHaveLength(0);
  });

  it("grava turn.calledTool: false, então untilAnswered encerra o loop", async () => {
    const { loop, untilAnswered } = await import("@thenajs/core");
    let voltas = 0;

    const Agente = makeAgent(
      { provider: new FakeProvider() },
      {
        run: () => {
          voltas++;
          return "pronto";
        },
      },
    );

    await runWorkflow(
      makeWorkflow([loop({ steps: [Agente], until: untilAnswered, maxIterations: 5 })]),
      "vai",
    );

    expect(voltas).toBe(1);
  });
});
