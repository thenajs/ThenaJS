import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Agent, Tool, Workflow, Thena, context, runWorkflow } from "@thenajs/core";
import type { AgentContext } from "@thenajs/core";
import { FakeProvider, PROMPT, criarAgente, criarWorkflow } from "./harness.js";

/**
 * Configuração resolvida dentro do escopo da execução.
 *
 * O provider era resolvido do decorator e instanciado **sem argumentos**, com
 * as credenciais fixas na subclasse: duas execuções batiam no mesmo endpoint
 * com a mesma chave, sem como variar.
 *
 * O que estes testes fixam é o **mecanismo** — `run({ data })` propaga sem ser
 * interpretado, e a factory do provider roda dentro do escopo e enxerga esses
 * dados. Os valores usados abaixo (`conta`, `regiao`) são domínio de exemplo:
 * o framework não conhece nenhum deles, e é de propósito que não conheça.
 */

const schema = z.object({ x: z.string() });

describe("run({ data })", () => {
  it("chega em context().data", async () => {
    let visto: unknown;
    const provider = new FakeProvider();

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class Agente {
      beforePrompt() {
        visto = context().data;
      }
    }
    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = Thena.create(Fluxo, {});
    await app.run({ input: { message: "oi" }, data: { conta: "acme" } });
    await app.dispose();

    expect(visto).toEqual({ conta: "acme" });
  });

  it("chega no ctx, alcançável por @context() numa tool", async () => {
    let visto: unknown;

    @Tool({ name: "quem", description: "quem", schema })
    class QuemTool {
      async execute(@context() ctx: AgentContext) {
        visto = ctx.data;
        return "ok";
      }
    }

    const provider = new FakeProvider([
      { tool: { name: "quem", arguments: { x: "1" } } },
    ]);
    const app = Thena.create(
      criarWorkflow([criarAgente({ provider, tools: [QuemTool] })]),
      {},
    );
    await app.run({ input: { message: "oi" }, data: { conta: "acme" } });
    await app.dispose();

    expect(visto).toEqual({ conta: "acme" });
  });

  it("NÃO vai para o modelo — a diferença para o `memory`", async () => {
    const provider = new FakeProvider();
    const app = Thena.create(criarWorkflow([criarAgente({ provider })]), {});
    await app.run({
      input: { message: "oi" },
      data: { chaveInterna: "segredo-nunca-visto" },
      memory: { visivel: "isto o modelo lê" },
    });
    await app.dispose();

    const enviado = provider.chamadas[0].messages.map((m) => m.content).join("\n");
    expect(enviado).not.toContain("segredo-nunca-visto");
    expect(enviado).toContain("isto o modelo lê");
  });

  it("é herdado pela run aninhada", async () => {
    let vistoNoFilho: unknown;
    const providerFilho = new FakeProvider();

    @Agent({ provider: providerFilho, prompt: PROMPT, tools: [] })
    class Filho {
      beforePrompt() {
        vistoNoFilho = context().data;
      }
    }
    @Workflow({ steps: [Filho] })
    class SubFluxo {}

    const SubTool = class {
      constructor(private readonly runtime: any) {}
      execute() {
        return this.runtime.run(SubFluxo, { input: { message: "sub" } });
      }
    };
    Tool({ name: "sub", description: "sub", schema })(SubTool as never);

    const providerPai = new FakeProvider([
      { tool: { name: "sub", arguments: { x: "1" } } },
    ]);
    const app = Thena.create(
      criarWorkflow([
        criarAgente({ provider: providerPai, tools: [SubTool as never] }),
      ]),
      {},
    );
    await app.run({ input: { message: "pai" }, data: { conta: "acme" } });
    await app.dispose();

    expect(vistoNoFilho).toEqual({ conta: "acme" });
  });

  it("sem data, é um objeto vazio — nunca undefined", async () => {
    let visto: unknown = "não rodou";
    const provider = new FakeProvider();
    const Agente = criarAgente(
      { provider },
      { beforePrompt: () => void (visto = context().data) },
    );

    await runWorkflow(criarWorkflow([Agente]), "oi");
    expect(visto).toEqual({});
  });
});

describe("provider como factory", () => {
  it("é chamada por execução, e enxerga os dados da run", async () => {
    const criados: string[] = [];

    @Agent({
      provider: () => {
        const conta = String(context().data.conta);
        criados.push(conta);
        return new FakeProvider([{ content: `resposta de ${conta}` }]);
      },
      prompt: PROMPT,
      tools: [],
    })
    class Agente {}
    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = Thena.create(Fluxo, {});
    const a = await app.run({ input: { message: "x" }, data: { conta: "acme" } });
    const b = await app.run({ input: { message: "x" }, data: { conta: "globex" } });
    await app.dispose();

    // Duas execuções, dois providers, credenciais diferentes.
    expect(criados).toEqual(["acme", "globex"]);
    expect(a).toBe("resposta de acme");
    expect(b).toBe("resposta de globex");
  });

  it("execuções concorrentes com dados diferentes não se misturam", async () => {
    @Agent({
      provider: () =>
        new FakeProvider([{ content: String(context().data.conta) }], {
          delayMs: Number(context().data.atraso),
        }),
      prompt: PROMPT,
      tools: [],
    })
    class Agente {}
    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = Thena.create(Fluxo, {});
    const [a, b] = await Promise.all([
      app.run({ input: { message: "x" }, data: { conta: "acme", atraso: 30 } }),
      app.run({ input: { message: "x" }, data: { conta: "globex", atraso: 5 } }),
    ]);
    await app.dispose();

    expect(a).toBe("acme");
    expect(b).toBe("globex");
  });

  it("uma classe continua sendo instanciada com new", async () => {
    class ProviderProprio extends FakeProvider {
      constructor() {
        super([{ content: "da classe" }]);
      }
    }

    await expect(
      runWorkflow(criarWorkflow([criarAgente({ provider: ProviderProprio })]), "vai"),
    ).resolves.toBe("da classe");
  });

  it("uma instância continua sendo usada direto", async () => {
    const provider = new FakeProvider([{ content: "da instância" }]);
    await expect(
      runWorkflow(criarWorkflow([criarAgente({ provider })]), "vai"),
    ).resolves.toBe("da instância");
  });

  it("factory escrita como `function` também funciona", async () => {
    const fabrica = function () {
      return new FakeProvider([{ content: "de function" }]);
    };

    await expect(
      runWorkflow(criarWorkflow([criarAgente({ provider: fabrica })]), "vai"),
    ).resolves.toBe("de function");
  });
});

describe("context() fora de uma execução", () => {
  it("falha alto ao ler, em vez de devolver defaults em silêncio", () => {
    expect(() => context().data).toThrow(/Nenhuma execução em curso/);
  });

  it("mas `context()` sozinho NÃO lança — a resolução é preguiçosa", () => {
    // Consequência de o mesmo símbolo servir de decorator: `@context()` é
    // avaliado no load do módulo, fora de qualquer execução, e não pode
    // explodir ali. O preço é a falha sair no primeiro acesso, e não na
    // chamada. Fixado em teste para a mudança não passar despercebida.
    expect(() => context()).not.toThrow();
  });
});
