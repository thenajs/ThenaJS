import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Thena, loop, untilAnswered } from "@thenajs/core";
import type { ExecutionEvent, RunHandle } from "@thenajs/core";
import {
  FakeProvider,
  captureError,
  makeAgent,
  makeTool,
  makeWorkflow,
} from "./harness.js";

/**
 * `app.run()` devolve a execução, de forma síncrona.
 *
 * Com `await`, você pede o resultado; sem `await`, a execução — `runId`,
 * `abort()`, `onEvent()`. Uma Promise não expressa cancelar, observar nem
 * **guardar** a execução para reencontrá-la depois.
 */

const schema = z.object({ x: z.string() });

function fluxo(resposta = "ok", delayMs = 0) {
  const provider = new FakeProvider([{ content: resposta }], { delayMs });
  return { provider, Fluxo: makeWorkflow([makeAgent({ provider })]) };
}

afterEach(() => vi.restoreAllMocks());

describe("o handle é thenable", () => {
  it("`await` devolve o resultado, como antes", async () => {
    const { Fluxo } = fluxo("resultado");
    const app = Thena.create(Fluxo, {});

    await expect(app.run({ input: { message: "vai" } })).resolves.toBe("resultado");
    await app.dispose();
  });

  it("`.result` é uma Promise comum", async () => {
    const { Fluxo } = fluxo("resultado");
    const app = Thena.create(Fluxo, {});

    const exec = app.run({ input: { message: "vai" } });
    expect(exec.result).toBeInstanceOf(Promise);
    await expect(exec.result).resolves.toBe("resultado");
    await app.dispose();
  });

  it("`.catch()` e `.finally()` funcionam", async () => {
    const Quebrado = makeWorkflow([
      makeAgent(
        { provider: new FakeProvider() },
        {
          beforePrompt: () => {
            throw new Error("falhou");
          },
        },
      ),
    ]);
    const app = Thena.create(Quebrado, {});

    let passouNoFinally = false;
    const saida = await app
      .run({ input: { message: "vai" } })
      .finally(() => void (passouNoFinally = true))
      .catch((e) => `peguei: ${(e as Error).message}`);

    expect(saida).toBe("peguei: falhou");
    expect(passouNoFinally).toBe(true);
    await app.dispose();
  });

  it("compõe com Promise.all", async () => {
    const { Fluxo } = fluxo("x");
    const app = Thena.create(Fluxo, {});

    await expect(
      Promise.all([
        app.run({ input: { message: "1" } }),
        app.run({ input: { message: "2" } }),
      ]),
    ).resolves.toEqual(["x", "x"]);
    await app.dispose();
  });
});

describe("runId síncrono", () => {
  it("está disponível antes do primeiro turno", async () => {
    const { Fluxo } = fluxo("x", 30);
    const app = Thena.create(Fluxo, {});

    // Sem await: é o que permite responder `{ runId }` num POST.
    const exec = app.run({ input: { message: "vai" } });
    expect(exec.runId).toMatch(/^[0-9a-f-]{36}$/);

    await exec;
    await app.dispose();
  });

  it("cada execução tem o seu", async () => {
    const { Fluxo } = fluxo();
    const app = Thena.create(Fluxo, {});

    const a = app.run({ input: { message: "1" } });
    const b = app.run({ input: { message: "2" } });
    expect(a.runId).not.toBe(b.runId);

    await Promise.all([a, b]);
    await app.dispose();
  });

  it("é o mesmo id que aparece nos eventos", async () => {
    const { Fluxo } = fluxo();
    const app = Thena.create(Fluxo, {});

    const events: ExecutionEvent[] = [];
    const exec = app.run({ input: { message: "vai" }, observe: true });
    exec.onEvent((e) => events.push(e));
    await exec;
    await app.dispose();

    expect(new Set(events.map((e) => e.runId))).toEqual(new Set([exec.runId]));
  });
});

describe("abort", () => {
  it("corta a chamada em voo, sem esperar ela terminar", async () => {
    const { provider, Fluxo } = fluxo("nunca", 500);
    const app = Thena.create(Fluxo, {});

    const inicio = Date.now();
    const exec = app.run({ input: { message: "vai" } });
    exec.abort();

    const erro = await captureError(exec);
    expect(erro.name).toBe("AbortError");
    // A chamada chegou a sair, mas o provider foi cancelado no meio: o teste
    // não espera os 500ms. É o `signal` chegando até o `fetch`.
    expect(provider.chamadas).toHaveLength(1);
    expect(Date.now() - inicio).toBeLessThan(200);
    await app.dispose();
  });

  it("no meio de um loop, para na volta seguinte", async () => {
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "1" } } },
    ]);
    const eco = makeTool(
      { name: "eco", description: "eco", schema },
      ({ x }: any) => x,
    );

    // O `until` precisa do handle, que só existe depois do `run()` — a caixa
    // resolve o ovo-e-galinha sem `let` reatribuído.
    const caixa: { exec?: RunHandle<string> } = {};
    const Fluxo = makeWorkflow([
      loop({
        steps: [makeAgent({ provider, tools: [eco] })],
        until: () => {
          // aborta ao fim da segunda volta
          if (provider.chamadas.length >= 2) caixa.exec!.abort();
          return false;
        },
        maxIterations: 50,
        maxFails: Infinity,
      }),
    ]);

    const app = Thena.create(Fluxo, {});
    const exec = (caixa.exec = app.run({ input: { message: "vai" } }));

    expect((await captureError(exec)).name).toBe("AbortError");
    expect(provider.chamadas).toHaveLength(2);
    await app.dispose();
  });

  it("a razão do abort chega inteira no catch", async () => {
    const { Fluxo } = fluxo("x", 30);
    const app = Thena.create(Fluxo, {});
    const minhaRazao = new Error("usuário desistiu");

    const exec = app.run({ input: { message: "vai" } });
    exec.abort(minhaRazao);

    expect(await captureError(exec)).toBe(minhaRazao);
    await app.dispose();
  });

  it("sem razão, é AbortError — distinguível de um erro comum", async () => {
    const { Fluxo } = fluxo("x", 30);
    const app = Thena.create(Fluxo, {});

    const exec = app.run({ input: { message: "vai" } });
    exec.abort();

    expect((await captureError(exec)).name).toBe("AbortError");
    await app.dispose();
  });

  it("o onError do agente NÃO transforma cancelamento em resposta", async () => {
    const provider = new FakeProvider([{ content: "x" }], { delayMs: 30 });
    const Agente = makeAgent(
      { provider },
      { onError: () => "recuperei" }, // tentaria engolir o abort
    );
    const app = Thena.create(makeWorkflow([Agente]), {});

    const exec = app.run({ input: { message: "vai" } });
    exec.abort();

    expect((await captureError(exec)).name).toBe("AbortError");
    await app.dispose();
  });
});

describe("signal vindo de fora", () => {
  it("um signal já abortado impede a execução", async () => {
    const { provider, Fluxo } = fluxo();
    const app = Thena.create(Fluxo, {});

    const controller = new AbortController();
    controller.abort();

    const erro = await captureError(
      app.run({ input: { message: "vai" }, signal: controller.signal }),
    );
    expect(erro.name).toBe("AbortError");
    expect(provider.chamadas).toHaveLength(0);
    await app.dispose();
  });

  it("AbortSignal.timeout corta, com TimeoutError", async () => {
    const { Fluxo } = fluxo("x", 200);
    const app = Thena.create(Fluxo, {});

    const erro = await captureError(
      app.run({ input: { message: "vai" }, signal: AbortSignal.timeout(20) }),
    );
    expect(erro.name).toBe("TimeoutError");
    await app.dispose();
  });

  it("o signal externo e o abort() do handle valem os dois", async () => {
    const { Fluxo } = fluxo("x", 200);
    const app = Thena.create(Fluxo, {});
    const controller = new AbortController();

    // O handle aborta primeiro; o externo nunca dispara.
    const exec = app.run({ input: { message: "vai" }, signal: controller.signal });
    exec.abort(new Error("pelo handle"));

    expect((await captureError(exec)).message).toBe("pelo handle");
    await app.dispose();
  });

  it("uma run aninhada herda o signal do pai", async () => {
    const providerFilho = new FakeProvider([{ content: "filho" }]);
    const SubFluxo = makeWorkflow([makeAgent({ provider: providerFilho })]);

    const { Tool } = await import("@thenajs/core");
    const SubTool = class {
      constructor(private readonly runtime: any) {}
      execute() {
        return this.runtime.run(SubFluxo, { input: { message: "sub" } });
      }
    };
    Tool({ name: "sub", description: "sub", schema })(SubTool as never);

    const providerPai = new FakeProvider(
      [{ tool: { name: "sub", arguments: { x: "1" } } }],
      { delayMs: 20 },
    );
    const app = Thena.create(
      makeWorkflow([makeAgent({ provider: providerPai, tools: [SubTool as never] })]),
      {},
    );

    const exec = app.run({ input: { message: "pai" } });
    exec.abort();

    expect((await captureError(exec)).name).toBe("AbortError");
    // O filho nem chegou a rodar.
    expect(providerFilho.chamadas).toHaveLength(0);
    await app.dispose();
  });
});

describe("onEvent e eventStream", () => {
  it("quem assina DEPOIS do início recebe o que já passou", async () => {
    const { Fluxo } = fluxo("x", 40);
    const app = Thena.create(Fluxo, {});

    const exec = app.run({ input: { message: "vai" }, observe: true });
    // deixa a execução andar antes de assinar — o caso do SSE que conecta tarde
    await new Promise((r) => setTimeout(r, 15));

    const vistos: ExecutionEvent[] = [];
    exec.onEvent((e) => vistos.push(e));
    await exec;

    // O `start` do workflow aconteceu antes da assinatura e mesmo assim veio.
    expect(vistos.some((e) => e.kind === "workflow" && e.phase === "start")).toBe(true);
    await app.dispose();
  });

  it("a assinatura pode ser cancelada", async () => {
    const { Fluxo } = fluxo("x", 30);
    const app = Thena.create(Fluxo, {});

    const vistos: ExecutionEvent[] = [];
    const exec = app.run({ input: { message: "vai" }, observe: true });
    const stop = exec.onEvent((e) => vistos.push(e));
    const quantosAoParar = vistos.length;
    stop();

    await exec;
    expect(vistos).toHaveLength(quantosAoParar);
    await app.dispose();
  });

  it("eventStream termina quando a execução acaba", async () => {
    const { Fluxo } = fluxo();
    const app = Thena.create(Fluxo, {});

    const exec = app.run({ input: { message: "vai" }, observe: true });
    const vistos: ExecutionEvent[] = [];
    for await (const e of exec.eventStream) vistos.push(e);

    expect(vistos.length).toBeGreaterThan(0);
    expect(vistos.at(-1)?.phase).toBe("end");
    await app.dispose();
  });

  it("um assinante que lança não derruba a execução", async () => {
    const { Fluxo } = fluxo("intacto");
    const app = Thena.create(Fluxo, {});

    const exec = app.run({ input: { message: "vai" }, observe: true });
    exec.onEvent(() => {
      throw new Error("assinante ruim");
    });

    await expect(exec).resolves.toBe("intacto");
    await app.dispose();
  });
});

describe("dispose drena as execuções em voo", () => {
  it("aborta o que está rodando e espera soltar", async () => {
    const { Fluxo } = fluxo("x", 500);
    const app = Thena.create(Fluxo, {});

    const exec = app.run({ input: { message: "vai" } });
    const capturado = captureError(exec);

    const inicio = Date.now();
    await app.dispose();

    // Não esperou os 500ms do provider: abortou e seguiu.
    expect(Date.now() - inicio).toBeLessThan(300);
    expect((await capturado).message).toContain("app encerrado");
  });
});
