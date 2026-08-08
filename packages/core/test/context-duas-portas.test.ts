import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  Tool,
  Workflow,
  Thena,
  context,
  input,
  runWorkflow,
} from "@thenajs/core";
import type { Context } from "@thenajs/core";
import { FakeProvider, PROMPT, makeAgent, makeWorkflow } from "./harness.js";

/**
 * `context` tem duas portas para o mesmo objeto: decorator e função.
 *
 * O `Proxy` que torna isso possível é o ponto frágil — ele resolve o contexto
 * na leitura, e uma leitura acontece em lugares inesperados (`console.log`,
 * `await`, spread). Estes testes fixam o comportamento nessas bordas.
 */

const schema = z.object({ x: z.string() });

describe("as duas portas devolvem a mesma coisa", () => {
  it("dentro de uma tool, decorator e função dão o mesmo ctx", async () => {
    let iguais = false;
    let mesmoRunId = false;

    const T = class {
      execute(_args: unknown, ctx: Context) {
        const daFuncao = context();
        iguais = daFuncao.state === ctx.state;
        mesmoRunId = daFuncao.runId === ctx.runId;
        return "ok";
      }
    };
    Tool({ name: "alvo", description: "alvo", schema })(T as never);
    input()(T.prototype, "execute", 0);
    context()(T.prototype, "execute", 1);

    const provider = new FakeProvider([
      { tool: { name: "alvo", arguments: { x: "1" } } },
    ]);
    await runWorkflow(
      makeWorkflow([makeAgent({ provider, tools: [T as never] })]),
      "vai",
    );

    expect(iguais).toBe(true);
    expect(mesmoRunId).toBe(true);
  });

  it("numa factory de provider, a função dá a execução — sem o passo", async () => {
    let daFuncao: unknown;
    let erroDoState: string | undefined;

    @Agent({
      provider: () => {
        daFuncao = context().data.conta;
        try {
          void context().state;
        } catch (e) {
          erroDoState = (e as Error).message;
        }
        return new FakeProvider([{ content: "ok" }]);
      },
      prompt: PROMPT,
      tools: [],
    })
    class Agente {}
    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = Thena.create(Fluxo, {});
    await app.run({ input: { message: "x" }, data: { conta: "acme" } });
    await app.dispose();

    // O que vale desde o `run()` funciona…
    expect(daFuncao).toBe("acme");
    // …e o que é do passo ensina por que ainda não existe.
    expect(erroDoState).toMatch(/só existe dentro de um passo/);
    expect(erroDoState).toMatch(/factory de provider/);
  });
});

describe("as bordas do Proxy", () => {
  it("`@context()` é avaliado fora de qualquer run e NÃO explode", () => {
    // O decorator é aplicado no load do módulo. Se o Proxy resolvesse o
    // contexto ao ser criado, nem importar o arquivo funcionaria.
    expect(() => {
      const C = class {
        execute(_a: unknown, _ctx: Context) {
          return "ok";
        }
      };
      Tool({ name: "t", description: "t", schema })(C as never);
      context()(C.prototype, "execute", 1);
    }).not.toThrow();
  });

  it("console.log/inspect fora de uma run não explode", () => {
    // `util.inspect` sonda dezenas de símbolos. Se cada um resolvesse o
    // contexto, depurar viraria um campo minado.
    const c = context();
    expect(() => String(typeof c)).not.toThrow();
    expect(() => JSON.stringify({ tem: typeof c })).not.toThrow();
    expect(() => `${typeof c}`).not.toThrow();
  });

  it("`await context()` não trava — não há `then` no caminho", async () => {
    // Se o Proxy resolvesse `then`, `await` tentaria tratá-lo como thenable e
    // o resultado seria um deadlock silencioso, ou uma exceção obscura.
    const provider = new FakeProvider([{ content: "ok" }]);
    let ok = false;

    const Agente = makeAgent(
      { provider },
      {
        beforePrompt: async () => {
          const c = await (context() as unknown as Promise<Context>);
          ok = typeof c === "function" || typeof c === "object";
        },
      },
    );

    await runWorkflow(makeWorkflow([Agente]), "vai");
    expect(ok).toBe(true);
  });

  it("cada chamada lê o contexto do momento, não um congelado", async () => {
    const vistos: string[] = [];
    const provider = new FakeProvider([{ content: "ok" }]);
    const Agente = makeAgent(
      { provider },
      { beforePrompt: () => void vistos.push(String(context().data.conta)) },
    );
    const Fluxo = makeWorkflow([Agente]);

    const app = Thena.create(Fluxo, {});
    await app.run({ input: { message: "1" }, data: { conta: "a" } });
    await app.run({ input: { message: "2" }, data: { conta: "b" } });
    await app.dispose();

    expect(vistos).toEqual(["a", "b"]);
  });

  it("em runs concorrentes, cada uma lê a sua", async () => {
    const provider = new FakeProvider([{ content: "ok" }], { delayMs: 5 });
    const vistos: string[] = [];
    const Agente = makeAgent(
      { provider },
      {
        beforePrompt: async () => {
          const conta = String(context().data.conta);
          await new Promise((r) => setTimeout(r, 10)); // força a intercalação
          vistos.push(`${conta}->${String(context().data.conta)}`);
        },
      },
    );

    const app = Thena.create(makeWorkflow([Agente]), {});
    await Promise.all([
      app.run({ input: { message: "x" }, data: { conta: "a" } }),
      app.run({ input: { message: "x" }, data: { conta: "b" } }),
    ]);
    await app.dispose();

    // Antes e depois do await, o mesmo contexto — nenhuma run leu a da outra.
    expect(vistos.sort()).toEqual(["a->a", "b->b"]);
  });
});
