import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Thena, contextWindow, loop } from "@thenajs/core";
import { FakeProvider, makeAgent, makeTool, makeWorkflow } from "./harness.js";

/**
 * A janela de contexto. O que se mede é o que **chega ao modelo** — o
 * `FakeProvider` registra as mensagens de cada chamada.
 */

const schema = z.object({ x: z.string() });

/** Roda N turnos e devolve as mensagens da última chamada. */
async function rodar(
  janela: ReturnType<typeof contextWindow> | undefined,
  voltas: number,
  opcoes: { respostaLonga?: boolean } = {},
) {
  const provider = new FakeProvider([
    { content: opcoes.respostaLonga ? "x".repeat(500) : "resposta" },
  ]);
  const Fluxo = makeWorkflow([
    loop({
      steps: [makeAgent({ provider })],
      until: () => false,
      maxIterations: voltas,
    }),
  ]);

  const app = Thena.create(Fluxo, {});
  if (janela) await app.use({ name: "janela", chat: janela });
  await app.run({ input: { message: "pergunta inicial" } });
  await app.dispose();

  return { provider, ultima: provider.chamadas.at(-1)!.messages };
}

describe("sem janela", () => {
  it("o histórico cresce sem teto", async () => {
    const { ultima } = await rodar(undefined, 8);
    // system + user + 8 assistants
    expect(ultima.length).toBeGreaterThan(8);
  });
});

describe("maxTurnos", () => {
  it("mantém só as últimas mensagens da conversa", async () => {
    const { ultima } = await rodar(contextWindow({ maxTurns: 3 }), 8);

    // system do agente + aviso do corte + 3 da conversa
    const conversa = ultima.filter((m) => m.role !== "system");
    expect(conversa).toHaveLength(3);
  });

  it("NUNCA corta o bloco system do topo", async () => {
    const { ultima } = await rodar(contextWindow({ maxTurns: 1 }), 6);

    // O prompt do agente sobrevive — cortá-lo quebraria o agente.
    expect(ultima[0].role).toBe("system");
    expect(ultima[0].content).toContain("agente de teste");
  });

  it("não corta quando o histórico cabe", async () => {
    const { ultima } = await rodar(contextWindow({ maxTurns: 50 }), 3);
    expect(ultima.some((m) => m.content.includes("omitido"))).toBe(false);
  });
});

describe("maxChars", () => {
  it("corta do começo até caber", async () => {
    const { ultima } = await rodar(contextWindow({ maxChars: 1200 }), 8, {
      respostaLonga: true,
    });

    const conversa = ultima.filter((m) => m.role !== "system");
    const total = conversa.reduce((s, m) => s + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(1200);
  });
});

describe("maxCharsPorTool", () => {
  it("trunca a observação da tool, que é o que mais infla", async () => {
    const tool = makeTool({ name: "ler", description: "lê", schema }, () =>
      "y".repeat(5000),
    );
    const provider = new FakeProvider([
      { tool: { name: "ler", arguments: { x: "1" } } },
      { content: "fim" },
    ]);
    const Fluxo = makeWorkflow([
      loop({
        steps: [makeAgent({ provider, tools: [tool] })],
        until: () => false,
        maxIterations: 2,
      }),
    ]);

    const app = Thena.create(Fluxo, {});
    await app.use({ name: "janela", chat: contextWindow({ maxCharsPerTool: 100 }) });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    const obs = provider.chamadas.at(-1)!.messages.find((m) => m.role === "tool");
    expect(obs!.content.length).toBeLessThan(200);
    expect(obs!.content).toContain("[truncado]");
  });
});

describe("o aviso do corte", () => {
  it("entra como system, para o modelo não achar que a conversa começou ali", async () => {
    const { ultima } = await rodar(contextWindow({ maxTurns: 2 }), 6);
    const warnIndexFailure = ultima.find((m) => m.content.includes("omitido"));

    expect(warnIndexFailure).toBeDefined();
    expect(warnIndexFailure!.role).toBe("system");
  });

  it("pode ser trocado", async () => {
    const { ultima } = await rodar(
      contextWindow({ maxTurns: 2, warnIndexFailure: "…cortado…" }),
      6,
    );
    expect(ultima.some((m) => m.content === "…cortado…")).toBe(true);
  });

  it("`aviso: false` corta em silêncio", async () => {
    const { ultima } = await rodar(
      contextWindow({ maxTurns: 2, warnIndexFailure: false }),
      6,
    );
    expect(ultima.some((m) => m.content.includes("omitido"))).toBe(false);
  });
});

describe("telemetria", () => {
  it("registra no report quanto foi cortado", async () => {
    const events: Record<string, unknown>[] = [];
    const provider = new FakeProvider([{ content: "x" }]);
    const Fluxo = makeWorkflow([
      loop({
        steps: [makeAgent({ provider })],
        until: () => false,
        maxIterations: 6,
      }),
    ]);

    const app = Thena.create(Fluxo, {
      log: (e) => e.kind === "chat" && e.data && events.push(e.data),
    });
    await app.use({ name: "janela", chat: contextWindow({ maxTurns: 2 }) });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    const ultimo = events.at(-1)!;
    expect(ultimo.janelaCortou).toBe(true);
    expect(ultimo.mensagensEnviadas).toBeLessThan(ultimo.mensagensOriginais as number);
  });
});
