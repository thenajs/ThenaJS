import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  Tool,
  Workflow,
  bootstrapWorkflow,
  context,
  currentRun,
  runWorkflow,
} from "@thenajs/core";
import type { AgentContext } from "@thenajs/core";
import { FakeProvider, PROMPT, criarAgente, criarWorkflow } from "./harness.js";

/**
 * Configuração por execução — o que destrava multi-tenant.
 *
 * O provider era resolvido do decorator e instanciado **sem argumentos**, com
 * as credenciais fixas na subclasse: o tenant A e o tenant B batiam no mesmo
 * endpoint com a mesma chave.
 */

const schema = z.object({ x: z.string() });

describe("run({ data })", () => {
  it("chega em currentRun().data", async () => {
    let visto: unknown;
    const provider = new FakeProvider();

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class Agente {
      beforePrompt() {
        visto = currentRun().data;
      }
    }
    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = await bootstrapWorkflow(Fluxo, {});
    await app.run({ input: { message: "oi" }, data: { tenant: "acme" } });
    await app.dispose();

    expect(visto).toEqual({ tenant: "acme" });
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
    const app = await bootstrapWorkflow(
      criarWorkflow([criarAgente({ provider, tools: [QuemTool] })]),
      {},
    );
    await app.run({ input: { message: "oi" }, data: { tenant: "acme" } });
    await app.dispose();

    expect(visto).toEqual({ tenant: "acme" });
  });

  it("NÃO vai para o modelo — a diferença para o `memory`", async () => {
    const provider = new FakeProvider();
    const app = await bootstrapWorkflow(criarWorkflow([criarAgente({ provider })]), {});
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
        vistoNoFilho = currentRun().data;
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
    const app = await bootstrapWorkflow(
      criarWorkflow([
        criarAgente({ provider: providerPai, tools: [SubTool as never] }),
      ]),
      {},
    );
    await app.run({ input: { message: "pai" }, data: { tenant: "acme" } });
    await app.dispose();

    expect(vistoNoFilho).toEqual({ tenant: "acme" });
  });

  it("sem data, é um objeto vazio — nunca undefined", async () => {
    let visto: unknown = "não rodou";
    const provider = new FakeProvider();
    const Agente = criarAgente(
      { provider },
      { beforePrompt: () => void (visto = currentRun().data) },
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
        const tenant = String(currentRun().data.tenant);
        criados.push(tenant);
        return new FakeProvider([{ content: `resposta de ${tenant}` }]);
      },
      prompt: PROMPT,
      tools: [],
    })
    class Agente {}
    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = await bootstrapWorkflow(Fluxo, {});
    const a = await app.run({ input: { message: "x" }, data: { tenant: "acme" } });
    const b = await app.run({ input: { message: "x" }, data: { tenant: "globex" } });
    await app.dispose();

    // Duas execuções, dois providers, credenciais diferentes.
    expect(criados).toEqual(["acme", "globex"]);
    expect(a).toBe("resposta de acme");
    expect(b).toBe("resposta de globex");
  });

  it("execuções concorrentes de tenants diferentes não se misturam", async () => {
    @Agent({
      provider: () =>
        new FakeProvider([{ content: String(currentRun().data.tenant) }], {
          delayMs: Number(currentRun().data.atraso),
        }),
      prompt: PROMPT,
      tools: [],
    })
    class Agente {}
    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = await bootstrapWorkflow(Fluxo, {});
    const [a, b] = await Promise.all([
      app.run({ input: { message: "x" }, data: { tenant: "acme", atraso: 30 } }),
      app.run({ input: { message: "x" }, data: { tenant: "globex", atraso: 5 } }),
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

describe("currentRun fora de uma execução", () => {
  it("falha alto, em vez de devolver defaults em silêncio", () => {
    expect(() => currentRun()).toThrow(/Nenhuma execução em curso/);
  });
});
