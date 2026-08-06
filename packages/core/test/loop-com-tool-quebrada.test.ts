import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  MAX_FAILS_PADRAO,
  MAX_ITERATIONS_PADRAO,
  bootstrapWorkflow,
  loop,
  untilAnswered,
} from "@thenajs/core";
import type { ExecutionNode, LoopFailure } from "@thenajs/core";
import { FakeProvider, criarAgente, criarTool, criarWorkflow } from "./harness.js";

/**
 * Os freios do loop.
 *
 * Falha de tool vira observação, então um agente preso não morre — ele repete.
 * `maxFails` (consecutivas) e `maxIterations` vêm ligados justamente porque um
 * loop sem teto gasta o cartão de quem usa o framework.
 */

const schema = z.object({ path: z.string() });

/** Tool que falha sempre, contando quantas vezes foi chamada. */
function toolQuebrada(tentativas: { n: number }) {
  return criarTool({ name: "ler", description: "lê", schema }, () => {
    tentativas.n++;
    throw new Error("ENOENT: disco cheio");
  });
}

/** O modelo insiste na tool a cada turno — o comportamento realista. */
function agenteTeimoso(tentativas: { n: number }) {
  const provider = new FakeProvider([
    { tool: { name: "ler", arguments: { path: "x.ts" } } },
  ]);
  return {
    provider,
    Agente: criarAgente({ provider, tools: [toolQuebrada(tentativas)] }),
  };
}

function lerNoDoLoop(dir: string): ExecutionNode {
  const [run] = readdirSync(dir, { withFileTypes: true }).filter((e) =>
    e.isDirectory(),
  );
  const raiz: ExecutionNode = JSON.parse(
    readFileSync(join(dir, run.name, "report.json"), "utf-8"),
  );
  return raiz.children[0];
}

describe("freios do loop", () => {
  it("sem configurar nada, maxFails corta o agente preso", async () => {
    const tentativas = { n: 0 };
    const { provider, Agente } = agenteTeimoso(tentativas);

    // Nenhum teto declarado: os defaults é que seguram.
    const Fluxo = criarWorkflow([loop({ steps: [Agente], until: untilAnswered })]);

    const app = await bootstrapWorkflow(Fluxo, {});
    await app.run({ input: { message: "leia" } });
    await app.dispose();

    expect(provider.chamadas).toHaveLength(MAX_FAILS_PADRAO);
    expect(tentativas.n).toBe(MAX_FAILS_PADRAO);
  });

  it("sem configurar nada, maxIterations corta o loop que não converge", async () => {
    // Tools funcionando, mas o `until` nunca fica verdadeiro — `maxFails` não
    // tem o que contar, e quem segura é o teto de voltas.
    const provider = new FakeProvider([{ content: "não terminei" }]);
    const Fluxo = criarWorkflow([
      loop({ steps: [criarAgente({ provider })], until: () => false }),
    ]);

    const app = await bootstrapWorkflow(Fluxo, {});
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(provider.chamadas).toHaveLength(MAX_ITERATIONS_PADRAO);
  });

  it("conta falhas CONSECUTIVAS: quem erra e corrige não é punido", async () => {
    const tentativas: string[] = [];
    const tool = criarTool({ name: "ler", description: "lê", schema }, ({ path }: any) => {
      tentativas.push(path);
      if (path === "bom.ts") return "conteúdo";
      throw new Error(`ENOENT: ${path}`);
    });

    // Padrão ✗ ✗ ✓ ✗ ✗ ✓ … — 4 falhas no total, nunca 3 seguidas.
    const provider = new FakeProvider([
      { tool: { name: "ler", arguments: { path: "ruim.ts" } } },
      { tool: { name: "ler", arguments: { path: "ruim.ts" } } },
      { tool: { name: "ler", arguments: { path: "bom.ts" } } },
      { tool: { name: "ler", arguments: { path: "ruim.ts" } } },
      { tool: { name: "ler", arguments: { path: "ruim.ts" } } },
      { tool: { name: "ler", arguments: { path: "bom.ts" } } },
      { content: "terminei" },
    ]);

    const Fluxo = criarWorkflow([
      loop({
        steps: [criarAgente({ provider, tools: [tool] })],
        until: untilAnswered,
        maxFails: 3,
        maxIterations: 20,
      }),
    ]);

    const app = await bootstrapWorkflow(Fluxo, {});
    const saida = await app.run({ input: { message: "leia" } });
    await app.dispose();

    // Chegou ao fim: 4 falhas totais não mataram, porque nunca houve 3 seguidas.
    expect(saida).toBe("terminei");
    expect(tentativas).toHaveLength(6);
  });

  it("uma tool que funciona zera a sequência", async () => {
    const registradas: LoopFailure[] = [];
    const tool = criarTool({ name: "ler", description: "lê", schema }, ({ path }: any) => {
      if (path === "bom.ts") return "ok";
      throw new Error("ENOENT");
    });

    const provider = new FakeProvider([
      { tool: { name: "ler", arguments: { path: "ruim.ts" } } },
      { tool: { name: "ler", arguments: { path: "ruim.ts" } } },
      { tool: { name: "ler", arguments: { path: "bom.ts" } } },
      { tool: { name: "ler", arguments: { path: "ruim.ts" } } },
      { content: "fim" },
    ]);

    const Fluxo = criarWorkflow([
      loop({
        steps: [criarAgente({ provider, tools: [tool] })],
        until: untilAnswered,
        maxFails: 3,
        maxIterations: 20,
        onFail: (_ctx, info) => registradas.push({ ...info }),
      }),
    ]);

    const app = await bootstrapWorkflow(Fluxo, {});
    await app.run({ input: { message: "leia" } });
    await app.dispose();

    expect(registradas.map((f) => f.consecutive)).toEqual([1, 2, 1]);
    expect(registradas.map((f) => f.total)).toEqual([1, 2, 3]);
    expect(registradas[0].toolName).toBe("ler");
    expect(registradas[0].message).toContain("ENOENT");
  });

  it("onFail dispara antes do corte, para dar tempo de alertar", async () => {
    const tentativas = { n: 0 };
    const { Agente } = agenteTeimoso(tentativas);
    const alertas: number[] = [];

    const Fluxo = criarWorkflow([
      loop({
        steps: [Agente],
        until: untilAnswered,
        maxFails: 3,
        onFail: (_ctx, info) => alertas.push(info.consecutive),
      }),
    ]);

    const app = await bootstrapWorkflow(Fluxo, {});
    await app.run({ input: { message: "leia" } });
    await app.dispose();

    // Avisou em 1 e 2 antes de cortar em 3 — é o que um número só não daria.
    expect(alertas).toEqual([1, 2, 3]);
  });

  it("o report diz por que o loop parou", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "thena-stop-"));
    const tentativas = { n: 0 };
    const { Agente } = agenteTeimoso(tentativas);

    const Fluxo = criarWorkflow([
      loop({ steps: [Agente], until: untilAnswered, maxFails: 2 }),
    ]);

    const app = await bootstrapWorkflow(Fluxo, { report: { dir } });
    await app.run({ input: { message: "leia" } });
    await app.dispose();

    const no = lerNoDoLoop(dir);
    expect(no.kind).toBe("loop");
    // Sem `stoppedBy`, este loop pareceria ter convergido: `exhausted` é
    // `false`, porque quem parou foi o `until`, não o teto de voltas.
    expect(no.data.stoppedBy).toBe("fails");
    expect(no.data.exhausted).toBe(false);
    expect(no.data.fails).toBe(2);
  });

  it("maxFails: Infinity desliga o freio — sobra o orçamento", async () => {
    const tentativas = { n: 0 };
    const { provider, Agente } = agenteTeimoso(tentativas);

    const Fluxo = criarWorkflow([
      loop({
        steps: [Agente],
        until: untilAnswered,
        maxFails: Infinity,
        maxIterations: Infinity,
      }),
    ]);

    const app = await bootstrapWorkflow(Fluxo, {});
    await app.run({
      input: { message: "leia" },
      // Sem este teto, este teste rodaria para sempre. É o risco que os
      // defaults acima existem para evitar.
      budget: { maxChatCalls: 25 },
    });
    await app.dispose();

    expect(provider.chamadas).toHaveLength(25);
  });

  it("loop aninhado zera os contadores a cada volta do de fora", async () => {
    const tool = criarTool({ name: "ler", description: "lê", schema }, ({ path }: any) => {
      if (path === "bom.ts") return "ok";
      throw new Error("ENOENT");
    });

    // Cada volta do loop externo: ✗ ✓ no interno. Se o contador não zerasse
    // entre as voltas, o `maxFails: 2` cortaria na segunda.
    const provider = new FakeProvider([
      { tool: { name: "ler", arguments: { path: "ruim.ts" } } },
      { tool: { name: "ler", arguments: { path: "bom.ts" } } },
      { content: "interno terminou" },
      { tool: { name: "ler", arguments: { path: "ruim.ts" } } },
      { tool: { name: "ler", arguments: { path: "bom.ts" } } },
      { content: "interno terminou" },
    ]);

    let voltas = 0;
    const Fluxo = criarWorkflow([
      loop({
        steps: [
          loop({
            steps: [criarAgente({ provider, tools: [tool] })],
            until: untilAnswered,
            maxFails: 2,
            maxIterations: 10,
          }),
        ],
        until: () => ++voltas >= 2,
        maxIterations: 5,
      }),
    ]);

    const app = await bootstrapWorkflow(Fluxo, {});
    await app.run({ input: { message: "leia" } });
    await app.dispose();

    // 6 turnos = as duas voltas completas. Contador vazando cortaria em 4.
    expect(provider.chamadas).toHaveLength(6);
  });
});
