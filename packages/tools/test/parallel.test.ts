import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Thena, loop } from "@thenajs/core";
import { ParallelTool } from "@thenajs/tools";
import {
  FakeProvider,
  makeAgent,
  makeTool,
  makeWorkflow,
} from "../../core/test/harness.js";
import type { TurnoFalso } from "../../core/test/harness.js";

/**
 * A `ParallelTool` empacota N chamadas num turno só. O que estes testes fixam
 * não é a concorrência — é que ela despacha as tools **do próprio agente, já
 * embrulhadas**, e não uma lista que alguém passou por fora.
 *
 * É essa distinção que mantém nó no report, hooks, autorização, orçamento e
 * política de erro rodando **por chamada**. Uma versão que recebesse as tools
 * cruas passaria nestes mesmos testes de resultado e falharia no que importa.
 */

const schema = z.object({ x: z.string() });

/** Um agente com duas tools mais a `parallel`, e um provider roteirizado. */
function cenario(turnos: TurnoFalso[]) {
  const chamadas: string[] = [];

  const eco = makeTool({ name: "eco", description: "eco", schema }, ({ x }: any) => {
    chamadas.push(`eco:${x}`);
    return `eco ${x}`;
  });
  const grito = makeTool(
    { name: "grito", description: "grito", schema },
    ({ x }: any) => {
      chamadas.push(`grito:${x}`);
      return String(x).toUpperCase();
    },
  );

  const provider = new FakeProvider(turnos);
  const Fluxo = makeWorkflow([
    loop({
      steps: [makeAgent({ provider, tools: [eco, grito, ParallelTool] })],
      until: () => false,
      maxIterations: 1,
    }),
  ]);

  return { chamadas, provider, Fluxo };
}

/** O turno em que o modelo pede o lote. */
const lote = (calls: { tool: string; args: unknown }[]) => ({
  tool: { name: "parallel", arguments: { calls } },
});

describe("ParallelTool", () => {
  it("despacha as tools do agente sem receber nenhuma", async () => {
    const { chamadas, Fluxo } = cenario([
      lote([
        { tool: "eco", args: { x: "a" } },
        { tool: "grito", args: { x: "b" } },
      ]),
    ]);

    const app = Thena.create(Fluxo, {});
    const saida = await app.run({ prompt: "vai" });
    await app.dispose();

    expect(chamadas).toEqual(["eco:a", "grito:b"]);
    expect(saida).toContain("eco a");
    expect(saida).toContain("B");
  });

  it("cada chamada interna vira um nó do report, aninhado no `parallel`", async () => {
    // O motivo de a tool receber as irmãs **embrulhadas**. Com as cruas, o
    // report mostraria um passo só e a autorização não veria o que autoriza.
    const nos: { kind: string; name: string }[] = [];
    const { Fluxo } = cenario([
      lote([
        { tool: "eco", args: { x: "a" } },
        { tool: "grito", args: { x: "b" } },
      ]),
    ]);

    const app = Thena.create(Fluxo, {
      log: (e) => e.phase === "start" && nos.push({ kind: e.kind, name: e.name }),
    });
    await app.run({ prompt: "vai" });
    await app.dispose();

    const tools = nos.filter((n) => n.kind === "tool").map((n) => n.name);
    expect(tools).toEqual(["parallel", "eco", "grito"]);
  });

  it("uma chamada que falha não derruba as outras", async () => {
    const { chamadas, Fluxo } = cenario([
      lote([
        { tool: "eco", args: { x: "a" } },
        { tool: "nao_existe", args: {} },
      ]),
    ]);

    const app = Thena.create(Fluxo, {});
    const saida = await app.run({ prompt: "vai" });
    await app.dispose();

    // A boa rodou e o resultado dela chegou ao modelo.
    expect(chamadas).toEqual(["eco:a"]);
    expect(saida).toContain("eco a");
    expect(saida).toContain("error");
    // E o erro diz o que existe, em vez de só reclamar.
    expect(saida).toContain("eco");
  });

  it("argumento inválido é observação, e a irmã boa sobrevive", async () => {
    const { chamadas, Fluxo } = cenario([
      lote([
        { tool: "eco", args: { x: "a" } },
        { tool: "grito", args: { x: 42 } }, // schema pede string
      ]),
    ]);

    const app = Thena.create(Fluxo, {});
    const saida = await app.run({ prompt: "vai" });
    await app.dispose();

    expect(chamadas).toEqual(["eco:a"]);
    expect(saida).toContain("error");
  });

  it("não despacha a si mesma", async () => {
    const { Fluxo } = cenario([
      lote([
        { tool: "parallel", args: { calls: [] } },
        { tool: "eco", args: { x: "a" } },
      ]),
    ]);

    const app = Thena.create(Fluxo, {});
    const saida = await app.run({ prompt: "vai" });
    await app.dispose();

    // `parallel` dentro de `parallel` só aninharia lote em lote, sem ganho.
    expect(saida).toContain("unknown tool");
  });
});
