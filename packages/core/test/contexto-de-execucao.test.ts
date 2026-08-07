import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Tool, Thena, loop, runWorkflow, untilAnswered } from "@thenajs/core";
import type { Context, ExecutionEvent, WorkflowRuntime } from "@thenajs/core";
import { FakeProvider, capturarErro, criarAgente, criarWorkflow } from "./harness.js";

/**
 * O que uma tool alcança da **execução**, e não só do passo.
 *
 * Antes, `@context()` — a porta documentada — entregava só o ctx do pipeline:
 * `state`, `output`, `turn`. Quem quisesse o `signal` para cancelar um `fetch`,
 * o `runId` para correlacionar log, ou soltar um recurso no fim tinha que
 * descobrir sozinho o `currentRun()`. Agora está tudo no mesmo objeto.
 *
 * A adição é **aditiva**: nada do que o ctx já tinha mudou de lugar.
 */

const schema = z.object({ x: z.string() });

/** Monta um app de um agente que chama a tool `alvo` uma vez. */
async function appComTool(Classe: unknown, turnos = [{ tool: { name: "alvo" } }]) {
  const provider = new FakeProvider(
    turnos.map((t) => ({ tool: { name: t.tool.name, arguments: { x: "1" } } })),
  );
  const app = Thena.create(
    criarWorkflow([criarAgente({ provider, tools: [Classe as never] })]),
    {},
  );
  return { app, provider };
}

/** Declara uma tool com o `execute` dado. */
function tool(execute: (...args: any[]) => unknown, nome = "alvo") {
  const Classe = class {
    execute(...args: any[]) {
      return execute(...args);
    }
  };
  Tool({ name: nome, description: nome, schema })(Classe as never);
  return Classe;
}

describe("o ctx da tool traz a execução", () => {
  it("continua trazendo o que já trazia — nada mudou de lugar", async () => {
    let visto: Record<string, boolean> = {};
    const T = tool((_args: unknown, ctx: Context) => {
      visto = {
        state: ctx.state !== undefined,
        data: ctx.data !== undefined,
        logs: Array.isArray(ctx.logs),
      };
      return "ok";
    });
    // O 2º parâmetro sem decorator não é injetado; usamos o decorator abaixo.
    const { app } = await appComTool(comContexto(T));
    await app.run({ input: { message: "vai" }, data: { conta: "acme" } });
    await app.dispose();

    expect(visto).toEqual({ state: true, data: true, logs: true });
  });

  it("expõe runId — o mesmo que aparece nos eventos", async () => {
    let doCtx = "";
    const T = tool((_a: unknown, ctx: Context) => {
      doCtx = ctx.runId;
      return "ok";
    });
    const { app } = await appComTool(comContexto(T));
    const exec = app.run({ input: { message: "vai" } });
    await exec;
    await app.dispose();

    expect(doCtx).toBe(exec.runId);
  });

  it("expõe usage() — o consumo acumulado até aqui", async () => {
    let chatCalls = -1;
    const T = tool((_a: unknown, ctx: Context) => {
      chatCalls = ctx.usage().chatCalls;
      return "ok";
    });
    const { app } = await appComTool(comContexto(T));
    await app.run({ input: { message: "vai" }, budget: { maxChatCalls: 9 } });
    await app.dispose();

    // A tool roda dentro da 1ª chamada ao modelo, que já foi contabilizada.
    expect(chatCalls).toBe(1);
  });
});

describe("ctx.signal", () => {
  it("chega na tool e é abortado junto com a run", async () => {
    let interrompida = false;

    const T = tool(async (_a: unknown, ctx: Context) => {
      await new Promise((res, rej) => {
        const t = setTimeout(res, 400);
        ctx.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            interrompida = true;
            rej(ctx.signal.reason);
          },
          { once: true },
        );
      });
      return "terminei os 400ms";
    });

    const { app } = await appComTool(comContexto(T));
    const exec = app.run({ input: { message: "vai" } });
    setTimeout(() => exec.abort(new Error("parou")), 20);

    const erro = await capturarErro(exec.result);
    await app.dispose();

    expect(interrompida).toBe(true);
    expect((erro as Error).message).toBe("parou");
  });

  it("existe mesmo sem app — `runWorkflow` direto também tem controller", async () => {
    let tinha = false;
    const T = tool((_a: unknown, ctx: Context) => {
      tinha = ctx.signal instanceof AbortSignal;
      return "ok";
    });
    const provider = new FakeProvider([
      { tool: { name: "alvo", arguments: { x: "1" } } },
    ]);
    await runWorkflow(
      criarWorkflow([criarAgente({ provider, tools: [comContexto(T) as never] })]),
      "vai",
    );

    expect(tinha).toBe(true);
  });
});

describe("ctx.abort()", () => {
  it("uma tool cancela a execução inteira, de dentro", async () => {
    const T = tool((_a: unknown, ctx: Context) => {
      ctx.abort(new Error("a tool desistiu"));
      return "ok";
    });
    const { app } = await appComTool(comContexto(T));

    const erro = await capturarErro(app.run({ input: { message: "vai" } }).result);
    await app.dispose();

    expect((erro as Error).message).toBe("a tool desistiu");
  });
});

describe("ctx.stop()", () => {
  it("encerra graciosamente: pula o resto e devolve o output que havia", async () => {
    const depois = new FakeProvider([{ content: "NÃO deveria rodar" }]);
    const T = tool((_a: unknown, ctx: Context) => {
      ctx.stop();
      return "já basta";
    });

    const provider = new FakeProvider([
      { tool: { name: "alvo", arguments: { x: "1" } } },
    ]);
    const app = Thena.create(
      criarWorkflow([
        criarAgente({ provider, tools: [comContexto(T) as never] }),
        criarAgente({ provider: depois }),
      ]),
      {},
    );

    const saida = await app.run({ input: { message: "vai" } });
    await app.dispose();

    // Não lançou, e o 2º agente foi pulado.
    expect(saida).toBe("já basta");
    expect(depois.chamadas).toHaveLength(0);
  });

  it("corta um loop, e o report registra stoppedBy: stop", async () => {
    const eventos: ExecutionEvent[] = [];
    const T = tool((_a: unknown, ctx: Context) => {
      ctx.stop();
      return "chega";
    });

    const provider = new FakeProvider([
      { tool: { name: "alvo", arguments: { x: "1" } } },
    ]);
    const app = Thena.create(
      criarWorkflow([
        loop({
          steps: [criarAgente({ provider, tools: [comContexto(T) as never] })],
          until: untilAnswered,
          maxIterations: 50,
        }),
      ]),
      { log: (e) => eventos.push(e) },
    );

    await app.run({ input: { message: "vai" } });
    await app.dispose();

    // Sem o `stop`, o loop giraria as 50 voltas: o roteiro do provider repete.
    expect(provider.chamadas.length).toBeLessThanOrEqual(2);
    const no = eventos.find((e) => e.kind === "loop" && e.phase === "end");
    expect(no?.data?.stoppedBy).toBe("stop");
  });
});

describe("ctx.onDispose()", () => {
  it("roda ao fim da execução, na ordem inversa do registro", async () => {
    const ordem: string[] = [];
    const T = tool((_a: unknown, ctx: Context) => {
      ctx.onDispose(() => void ordem.push("primeiro-registrado"));
      ctx.onDispose(() => void ordem.push("segundo-registrado"));
      return "ok";
    });
    const { app } = await appComTool(comContexto(T));
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    // Como um `defer`: quem abriu por último fecha primeiro.
    expect(ordem).toEqual(["segundo-registrado", "primeiro-registrado"]);
  });

  it("roda mesmo quando a execução falha", async () => {
    let limpou = false;
    const T = tool((_a: unknown, ctx: Context) => {
      ctx.onDispose(() => void (limpou = true));
      throw new (class extends Error {})("quebrou");
    });

    const provider = new FakeProvider([
      { tool: { name: "alvo", arguments: { x: "1" } } },
    ]);
    const app = Thena.create(
      criarWorkflow([criarAgente({ provider, tools: [comContexto(T) as never] })]),
      {},
    );
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(limpou).toBe(true);
  });

  it("uma limpeza que lança não derruba a execução", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const T = tool((_a: unknown, ctx: Context) => {
      ctx.onDispose(() => {
        throw new Error("limpeza ruim");
      });
      return "ok";
    });
    const { app } = await appComTool(comContexto(T));

    await expect(app.run({ input: { message: "vai" } })).resolves.toBeDefined();
    await app.dispose();
  });

  it("o fim de um sub-workflow NÃO solta o que é do pai", async () => {
    const ordem: string[] = [];

    const SubTool = tool((_a: unknown, ctx: Context) => {
      ctx.onDispose(() => void ordem.push("filho"));
      return "sub ok";
    }, "dofilho");
    const SubFluxo = criarWorkflow([
      criarAgente({
        provider: new FakeProvider([
          { tool: { name: "dofilho", arguments: { x: "1" } } },
        ]),
        tools: [comContexto(SubTool) as never],
      }),
    ]);

    const PaiTool = class {
      constructor(private readonly runtime: WorkflowRuntime) {}
      async execute(_args: unknown, ctx: Context) {
        ctx.onDispose(() => void ordem.push("pai"));
        return this.runtime.run<string>(SubFluxo, { input: { message: "sub" } });
      }
    };
    Tool({ name: "alvo", description: "alvo", schema })(PaiTool as never);

    const { app } = await appComTool(comContexto(PaiTool));
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    // O filho fecha quando o sub-workflow acaba; o pai só no fim da run.
    expect(ordem).toEqual(["filho", "pai"]);
  });
});

describe("ctx.meta()", () => {
  it("escreve no nó do passo em que a tool está", async () => {
    const eventos: ExecutionEvent[] = [];
    const T = tool((_a: unknown, ctx: Context) => {
      ctx.meta({ cacheHit: true, itens: 3 });
      return "ok";
    });
    const { app } = await appComTool(comContexto(T));
    await app.run({ input: { message: "vai" }, log: (e) => eventos.push(e) });
    await app.dispose();

    const no = eventos.find((e) => e.kind === "tool" && e.phase === "end");
    expect(no?.data?.cacheHit).toBe(true);
    expect(no?.data?.itens).toBe(3);
  });

  it("é no-op sem observação ativa — não quebra", async () => {
    const T = tool((_a: unknown, ctx: Context) => {
      ctx.meta({ qualquer: "coisa" });
      return "ok";
    });
    const { app } = await appComTool(comContexto(T));
    await expect(app.run({ input: { message: "vai" } })).resolves.toBeDefined();
    await app.dispose();
  });
});

// ---------------------------------------------------------------------------
// O `@context()` como decorator de parâmetro precisa ser aplicado na classe.
// Estas fábricas fazem isso sem a sintaxe `@`, que é avaliada no import.
// ---------------------------------------------------------------------------

import { context, input } from "@thenajs/core";

/**
 * Equivale a `execute(@input() args, @context() ctx)`.
 *
 * Aplicado como função porque a sintaxe `@` é avaliada no import, e aqui cada
 * teste monta a própria tool.
 */
function comContexto<T>(Classe: T): T {
  const proto = (Classe as { prototype: object }).prototype;
  input()(proto, "execute", 0);
  context()(proto, "execute", 1);
  return Classe;
}
