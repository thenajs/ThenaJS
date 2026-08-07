import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  bootstrapWorkflow,
  calledTool,
  loop,
  runWorkflow,
  turnOf,
  untilAnswered,
  wasExhausted,
} from "@thenajs/core";
import type { TurnInfo, WorkflowContext } from "@thenajs/core";
import { FakeProvider, criarAgente, criarTool, criarWorkflow } from "./harness.js";

/** Os helpers que leem o último turno, e a entrada da run. */

const schema = z.object({ x: z.string() });
const eco = () =>
  criarTool({ name: "eco", description: "eco", schema }, ({ x }: any) => x);

/** Roda um passo e devolve o que os helpers enxergam no `until`. */
async function inspecionar(provider: FakeProvider, tools: unknown[] = []) {
  let visto: {
    turn?: TurnInfo;
    chamouTool?: boolean;
    exausto?: boolean;
  } = {};

  await runWorkflow(
    criarWorkflow([
      loop({
        steps: [criarAgente({ provider, tools: tools as never })],
        until: (ctx: WorkflowContext) => {
          visto = {
            turn: turnOf(ctx),
            chamouTool: calledTool(ctx),
            exausto: wasExhausted(ctx),
          };
          return true;
        },
      }),
    ]),
    "vai",
  );

  return visto;
}

describe("turnOf e calledTool", () => {
  it("depois de uma resposta sem tool", async () => {
    const visto = await inspecionar(new FakeProvider([{ content: "só texto" }]));

    expect(visto.chamouTool).toBe(false);
    expect(visto.turn).toMatchObject({ calledTool: false, response: "só texto" });
    expect(visto.turn?.toolName).toBeUndefined();
  });

  it("depois de um turno que chamou tool", async () => {
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "oi" } } },
    ]);
    const visto = await inspecionar(provider, [eco()]);

    expect(visto.chamouTool).toBe(true);
    expect(visto.turn).toMatchObject({
      calledTool: true,
      toolName: "eco",
      toolCallSource: "native",
      response: "oi",
    });
    expect(visto.turn?.toolError).toBeFalsy();
  });

  it("marca toolError quando a tool falhou", async () => {
    const falha = criarTool({ name: "eco", description: "eco", schema }, () => {
      throw new Error("ops");
    });
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "1" } } },
    ]);
    const visto = await inspecionar(provider, [falha]);

    expect(visto.turn?.toolError).toBe(true);
    expect(visto.turn?.response).toBe("ops");
  });

  it('marca toolCallSource "rescued" quando a chamada veio do texto', async () => {
    const provider = new FakeProvider([
      { content: '{"name":"eco","arguments":{"x":"resgatado"}}' },
    ]);
    const visto = await inspecionar(provider, [eco()]);

    expect(visto.turn?.toolCallSource).toBe("rescued");
    expect(visto.turn?.response).toBe("resgatado");
  });

  it("sem nenhum agente executado, turnOf devolve undefined", async () => {
    let visto: TurnInfo | undefined = { calledTool: true, response: "sujeira" };

    await runWorkflow(
      criarWorkflow([
        loop({
          steps: [],
          until: (ctx: WorkflowContext) => {
            visto = turnOf(ctx);
            return true;
          },
        }),
      ]),
      "vai",
    );

    expect(visto).toBeUndefined();
  });
});

describe("untilAnswered", () => {
  it("para quando o agente responde sem tool", async () => {
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "1" } } },
      { tool: { name: "eco", arguments: { x: "2" } } },
      { content: "respondi" },
    ]);

    const saida = await runWorkflow(
      criarWorkflow([
        loop({
          steps: [criarAgente({ provider, tools: [eco()] })],
          until: untilAnswered,
          maxIterations: 10,
        }),
      ]),
      "vai",
    );

    expect(saida).toBe("respondi");
    expect(provider.chamadas).toHaveLength(3);
  });

  it("resposta vazia conta como resposta — a armadilha documentada", async () => {
    const provider = new FakeProvider([{ content: "" }]);

    await runWorkflow(
      criarWorkflow([
        loop({
          steps: [criarAgente({ provider })],
          until: untilAnswered,
          maxIterations: 10,
        }),
      ]),
      "vai",
    );

    // Uma volta só: `calledTool` é false, então o loop entende que terminou.
    expect(provider.chamadas).toHaveLength(1);
  });
});

describe("wasExhausted", () => {
  it("false quando o loop parou pelo until", async () => {
    const visto = await inspecionar(new FakeProvider([{ content: "x" }]));
    expect(visto.exausto).toBe(false);
  });

  it("true depois de um loop que bateu no teto", async () => {
    const provider = new FakeProvider([{ content: "nunca converge" }]);
    let exausto: boolean | undefined;

    await runWorkflow(
      criarWorkflow([
        loop({
          steps: [criarAgente({ provider })],
          until: () => false,
          maxIterations: 2,
        }),
        // um segundo passo, para ler o `ctx.loop` deixado pelo loop anterior
        criarAgente({
          provider: new FakeProvider([{ content: "depois" }]),
        }),
        loop({
          steps: [],
          until: (ctx: WorkflowContext) => {
            exausto = wasExhausted(ctx);
            return true;
          },
        }),
      ]),
      "vai",
    );

    expect(exausto).toBe(true);
  });

  it("onExhausted é chamado com o número de voltas", async () => {
    const provider = new FakeProvider([{ content: "x" }]);
    let voltas: number | undefined;

    await runWorkflow(
      criarWorkflow([
        loop({
          steps: [criarAgente({ provider })],
          until: () => false,
          maxIterations: 3,
          onExhausted: (_ctx, n) => void (voltas = n),
        }),
      ]),
      "vai",
    );

    expect(voltas).toBe(3);
  });
});

describe("entrada da run", () => {
  it("input.message vira a primeira mensagem user", async () => {
    const provider = new FakeProvider();
    const app = await bootstrapWorkflow(criarWorkflow([criarAgente({ provider })]), {});
    await app.run({ input: { message: "olá mundo" } });
    await app.dispose();

    const user = provider.chamadas[0].messages.find((m) => m.role === "user");
    expect(user?.content).toBe("olá mundo");
  });

  it("sem message, o objeto inteiro é serializado", async () => {
    const provider = new FakeProvider();
    const app = await bootstrapWorkflow(criarWorkflow([criarAgente({ provider })]), {});
    await app.run({ input: { userId: 7, acao: "revisar" } });
    await app.dispose();

    const user = provider.chamadas[0].messages.find((m) => m.role === "user");
    expect(JSON.parse(user!.content)).toEqual({ userId: 7, acao: "revisar" });
  });

  it("memory da run é semeada no state e projetada como system", async () => {
    const provider = new FakeProvider();
    const app = await bootstrapWorkflow(criarWorkflow([criarAgente({ provider })]), {});
    await app.run({
      input: { message: "oi" },
      memory: { sessionId: "abc" },
    });
    await app.dispose();

    const systems = provider.chamadas[0].messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    expect(systems).toContain("abc");
  });
});
