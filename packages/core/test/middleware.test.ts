import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FatalToolError, Thena } from "@thenajs/core";
import type { ChatMiddleware, ExecutionNode, ToolMiddleware } from "@thenajs/core";
import { FakeProvider, criarAgente, criarTool, criarWorkflow } from "./harness.js";

/**
 * Middlewares de plugin. O que se testa aqui não é "funciona" — é a
 * **posição** na cadeia, que é o que decide o comportamento observável.
 */

const schema = z.object({ x: z.string() });
const eco = (impl: (...a: any[]) => unknown = ({ x }: any) => x) =>
  criarTool({ name: "eco", description: "eco", schema }, impl);

function fluxoComTool(impl?: (...a: any[]) => unknown) {
  const provider = new FakeProvider([
    { tool: { name: "eco", arguments: { x: "original" } } },
  ]);
  return {
    provider,
    Fluxo: criarWorkflow([criarAgente({ provider, tools: [eco(impl)] })]),
  };
}

function lerArvore(dir: string): ExecutionNode {
  const [run] = readdirSync(dir, { withFileTypes: true }).filter((e) =>
    e.isDirectory(),
  );
  return JSON.parse(readFileSync(join(dir, run.name, "report.json"), "utf-8"));
}

afterEach(() => vi.restoreAllMocks());

describe("middleware de tool", () => {
  it("envolve a execução: vê antes e depois", async () => {
    const ordem: string[] = [];
    const espia: ToolMiddleware = async (inv, next) => {
      ordem.push(`antes:${inv.name}`);
      const r = await next();
      ordem.push(`depois:${r.content}`);
      return r;
    };

    const { Fluxo } = fluxoComTool();
    const app = Thena.create(Fluxo, {});
    await app.use({ name: "espia", tool: espia });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(ordem).toEqual(["antes:eco", "depois:original"]);
  });

  it("pode substituir o resultado sem executar a tool", async () => {
    let executou = false;
    const cache: ToolMiddleware = async () => ({ content: "do cache" });

    const { Fluxo } = fluxoComTool(() => {
      executou = true;
      return "da tool";
    });

    const app = Thena.create(Fluxo, {});
    await app.use({ name: "cache", tool: cache });
    const saida = await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(saida).toBe("do cache");
    expect(executou).toBe(false);
  });

  it("roda DEPOIS do beforeTool — enxerga os argumentos que vão executar", async () => {
    let vistoPeloMiddleware: unknown;

    const auditor: ToolMiddleware = async (inv, next) => {
      vistoPeloMiddleware = inv.args;
      return next();
    };

    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "original" } } },
    ]);
    const Agente = criarAgente(
      { provider, tools: [eco()] },
      // o agente reescreve os args depois que o modelo decidiu
      { beforeTool: (call: any) => ({ ...call, args: { x: "reescrito" } }) },
    );

    const app = Thena.create(criarWorkflow([Agente]), {});
    await app.use({ name: "auditor", tool: auditor });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    // Se o middleware rodasse antes do beforeTool, uma autorização checaria
    // "original" e executaria "reescrito" — contornável pelo próprio agente.
    expect(vistoPeloMiddleware).toEqual({ x: "reescrito" });
  });

  it("um curto-circuito NÃO conta no orçamento", async () => {
    const { loop, untilAnswered } = await import("@thenajs/core");
    let acertos = 0;
    const cache: ToolMiddleware = async () => {
      acertos++;
      return { content: "do cache" };
    };

    // Três turnos com tool, depois um que responde e encerra o loop.
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "1" } } },
      { tool: { name: "eco", arguments: { x: "2" } } },
      { tool: { name: "eco", arguments: { x: "3" } } },
      { content: "terminei" },
    ]);
    const Fluxo = criarWorkflow([
      loop({
        steps: [criarAgente({ provider, tools: [eco()] })],
        until: untilAnswered,
        maxIterations: 10,
      }),
    ]);

    const app = Thena.create(Fluxo, {});
    await app.use({ name: "cache", tool: cache });
    const saida = await app.run({
      input: { message: "vai" },
      budget: { maxToolCalls: 1 },
    });
    await app.dispose();

    // O teto é de 1 tool. Como nenhuma executou de verdade, o contador nunca
    // subiu e as três voltas aconteceram. Se o `contarTool` estivesse acima do
    // middleware, a run teria parado na segunda.
    expect(acertos).toBe(3);
    expect(saida).toBe("terminei");
  });

  it("um throw do middleware derruba a run — não vira observação", async () => {
    const nega: ToolMiddleware = async () => {
      throw new FatalToolError("sem permissão");
    };
    const { Fluxo } = fluxoComTool();

    const app = Thena.create(Fluxo, {});
    await app.use({ name: "authz", tool: nega });

    await expect(app.run({ input: { message: "vai" } })).rejects.toThrow(
      "sem permissão",
    );
    await app.dispose();
  });

  it("negar devolvendo isError vira observação para o modelo", async () => {
    const nega: ToolMiddleware = async (inv) => ({
      content: `Sem permissão para ${inv.name}.`,
      isError: true,
    });
    const { Fluxo } = fluxoComTool();

    const app = Thena.create(Fluxo, {});
    await app.use({ name: "authz", tool: nega });
    const saida = await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(saida).toBe("Sem permissão para eco.");
  });

  it("vários middlewares rodam na ordem de registro, o primeiro por fora", async () => {
    const ordem: string[] = [];
    const marcar =
      (nome: string): ToolMiddleware =>
      async (_inv, next) => {
        ordem.push(`${nome}:entra`);
        const r = await next();
        ordem.push(`${nome}:sai`);
        return r;
      };

    const { Fluxo } = fluxoComTool();
    const app = Thena.create(Fluxo, {});
    await app.use({ name: "a", tool: marcar("a") });
    await app.use({ name: "b", tool: marcar("b") });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(ordem).toEqual(["a:entra", "b:entra", "b:sai", "a:sai"]);
  });
});

describe("middleware de chat", () => {
  it("pode substituir a chamada ao modelo", async () => {
    const provider = new FakeProvider([{ content: "do modelo" }]);
    const cache: ChatMiddleware = async () => ({
      assistant: { role: "assistant", content: "do cache" },
    });

    const app = Thena.create(criarWorkflow([criarAgente({ provider })]), {});
    await app.use({ name: "cache", chat: cache });
    const saida = await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(saida).toBe("do cache");
    expect(provider.chamadas).toHaveLength(0);
  });

  it("um cache que acerta NÃO soma tokens já pagos no orçamento", async () => {
    const provider = new FakeProvider([{ content: "x" }]);
    let acertos = 0;
    const cache: ChatMiddleware = async () => {
      acertos++;
      return {
        assistant: { role: "assistant", content: "do cache" },
        // O turno cacheado carrega o usage da chamada original — somá-lo de
        // novo cobraria duas vezes tokens que já foram pagos.
        usage: { promptTokens: 1000, completionTokens: 1000 },
      };
    };

    const app = Thena.create(
      criarWorkflow([
        criarAgente({ provider }),
        criarAgente({ provider }),
        criarAgente({ provider }),
      ]),
      {},
    );
    await app.use({ name: "cache", chat: cache });

    await app.run({ input: { message: "vai" }, budget: { maxTokens: 100 } });
    await app.dispose();

    // Se o `contarChat` rodasse por fora do middleware, o 1º turno somaria
    // 2000 tokens, estouraria o teto de 100 e os outros dois seriam pulados.
    expect(acertos).toBe(3);
  });
});

describe("inv.meta — o middleware escreve no report", () => {
  it("aparece no nó do chat, ao lado da telemetria do framework", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "thena-mw-"));

    const cache: ChatMiddleware = async (inv) => {
      inv.meta({ cacheHit: true, chave: "abc" });
      return { assistant: { role: "assistant", content: "do cache" } };
    };

    const app = Thena.create(
      criarWorkflow([criarAgente({ provider: new FakeProvider() })]),
      { report: { dir } },
    );
    await app.use({ name: "cache", chat: cache });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    // O nó existe (o middleware não o apagou ao curto-circuitar) e carrega o
    // que o middleware escreveu — é o que o Flow mostra ao clicar nele.
    const chat = lerArvore(dir).children[0].children[0];
    expect(chat.kind).toBe("chat");
    expect(chat.data.cacheHit).toBe(true);
    expect(chat.data.chave).toBe("abc");
  });

  it("o passo continua no report mesmo quando a tool não executa", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "thena-mw-tool-"));

    const cache: ToolMiddleware = async (inv) => {
      inv.meta({ cacheHit: true });
      return { content: "do cache" };
    };

    const { Fluxo } = fluxoComTool();
    const app = Thena.create(Fluxo, { report: { dir } });
    await app.use({ name: "cache", tool: cache });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    const tool = lerArvore(dir).children[0].children[0].children[0];
    expect(tool.kind).toBe("tool");
    expect(tool.data.cacheHit).toBe(true);
    expect(tool.data.output).toBe("do cache");
  });

  it("meta() sem observação ativa é no-op, não quebra", async () => {
    const cache: ToolMiddleware = async (inv) => {
      inv.meta({ cacheHit: true });
      return { content: "do cache" };
    };

    const { Fluxo } = fluxoComTool();
    // sem `report` nem `log`: o recorder fica inativo
    const app = Thena.create(Fluxo, {});
    await app.use({ name: "cache", tool: cache });

    await expect(app.run({ input: { message: "vai" } })).resolves.toBe("do cache");
    await app.dispose();
  });
});

describe("herança em run aninhada", () => {
  it("o sub-workflow passa pelos mesmos middlewares do pai", async () => {
    const vistos: string[] = [];
    const espia: ChatMiddleware = async (inv, next) => {
      vistos.push(String(inv.messages.at(-1)?.content));
      return next();
    };

    const SubFluxo = criarWorkflow([
      criarAgente({ provider: new FakeProvider([{ content: "filho" }]) }),
    ]);

    const { Tool, WorkflowRuntime } = await import("@thenajs/core");
    const SubTool = class {
      constructor(private readonly runtime: any) {}
      execute() {
        return this.runtime.run(SubFluxo, { input: { message: "sub" } });
      }
    };
    Tool({ name: "sub", description: "sub", schema })(SubTool as never);
    void WorkflowRuntime;

    const providerPai = new FakeProvider([
      { tool: { name: "sub", arguments: { x: "1" } } },
    ]);
    const app = Thena.create(
      criarWorkflow([
        criarAgente({ provider: providerPai, tools: [SubTool as never] }),
      ]),
      {},
    );
    await app.use({ name: "espia", chat: espia });
    await app.run({ input: { message: "pai" } });
    await app.dispose();

    // Duas chamadas ao modelo — a do pai e a do filho — ambas pela cadeia.
    expect(vistos).toEqual(["pai", "sub"]);
  });
});
