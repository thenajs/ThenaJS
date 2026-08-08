import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Tool, Thena, runWorkflow } from "@thenajs/core";
import type { ExecutionNode, WorkflowRuntime } from "@thenajs/core";
import { FakeProvider, makeAgent, makeWorkflow } from "./harness.js";

/**
 * Caracterização da run aninhada: uma tool que dispara outro workflow pelo
 * `WorkflowRuntime` injetado no construtor.
 */

const schema = z.object({ x: z.string() });

/** Tool que roda `SubFluxo` e devolve a saída dele. */
function criarToolQueRodaWorkflow(SubFluxo: Function) {
  const Classe = class {
    constructor(private readonly runtime: WorkflowRuntime) {}
    execute() {
      return this.runtime.run<string>(SubFluxo, {
        input: { message: "sub" },
      });
    }
  };
  Tool({ name: "sub", description: "roda um sub-workflow", schema })(Classe as any);
  return Classe as any;
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("run aninhada", () => {
  it("o sub-workflow herda o teto do pai — aninhar não é escapatória", async () => {
    const providerFilho = new FakeProvider([{ content: "resposta do filho" }]);
    const SubFluxo = makeWorkflow([makeAgent({ provider: providerFilho })]);

    const providerPai = new FakeProvider([
      { tool: { name: "sub", arguments: { x: "1" } } },
    ]);
    const Fluxo = makeWorkflow([
      makeAgent({
        provider: providerPai,
        tools: [criarToolQueRodaWorkflow(SubFluxo)],
      }),
    ]);

    // O pai esgota o teto no próprio turno que dispara a tool. O filho não
    // ganha crédito novo: sem `budget` próprio ele usa o tracker do pai.
    //
    // Este teste já afirmou o contrário ("orçamento próprio, independente do
    // pai"), e era o que tornava `maxCostUsd` contornável por qualquer agente
    // com uma tool que disparasse workflow. A matriz completa (teto próprio
    // mais apertado, mais largo, throw, recursão) está em `nested-budget`.
    await runWorkflow(Fluxo, "vai", undefined, { maxChatCalls: 1 });

    expect(providerFilho.chamadas).toHaveLength(0);
  });

  it("os nós do sub-workflow aninham sob o nó da tool no report do pai", async () => {
    const dir = mkdtempSync(join(tmpdir(), "thena-nested-"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    const SubFluxo = makeWorkflow([
      makeAgent({ provider: new FakeProvider([{ content: "filho" }]) }),
    ]);
    const providerPai = new FakeProvider([
      { tool: { name: "sub", arguments: { x: "1" } } },
    ]);
    const Fluxo = makeWorkflow([
      makeAgent({
        provider: providerPai,
        tools: [criarToolQueRodaWorkflow(SubFluxo)],
      }),
    ]);

    const app = Thena.create(Fluxo, { report: { dir } });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    const [pasta] = readdirSync(dir, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    );
    const raiz: ExecutionNode = JSON.parse(
      readFileSync(join(dir, pasta.name, "report.json"), "utf-8"),
    );
    // O sub-workflow herda o recorder do pai, então uma run aninhada continua
    // sendo **uma** árvore: workflow > agent > chat > tool > workflow > agent.
    const tool = raiz.children[0].children[0].children[0];
    expect(tool.kind).toBe("tool");
    const filho = tool.children[0];
    expect(filho.kind).toBe("workflow");
    expect(filho.children[0].kind).toBe("agent");
  });
});
