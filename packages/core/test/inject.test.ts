import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  Tool,
  Workflow,
  bootstrapWorkflow,
  context,
  input,
  loop,
  memory,
  runWorkflow,
  state,
} from "@thenajs/core";
import type { AgentContext, VectorMemory } from "@thenajs/core";
import {
  FakeProvider,
  FakeVectorStore,
  FakeVectorStoreB,
  PROMPT,
  criarAgente,
  criarWorkflow,
} from "./harness.js";

/**
 * Injeção por decorator de parâmetro. Aqui a sintaxe `@` é usada de verdade —
 * é o caminho do usuário, e o que garante que o esbuild (tsx) e o tsc emitem
 * as chamadas do jeito que o runtime espera.
 */

class EstadoDeTeste {
  visitados: string[] = [];
  aprovado = false;
}

const schema = z.object({ path: z.string() });

afterEach(() => FakeVectorStore.limpar());

describe("@input, @state e @context no execute da tool", () => {
  it("entrega os três, e a ordem dos parâmetros não importa", async () => {
    const visto: { args: unknown; temCtx: boolean; estado?: EstadoDeTeste } = {
      args: undefined,
      temCtx: false,
    };

    @Tool({ name: "ler", description: "lê", schema })
    class LerTool {
      // de propósito fora da ordem "natural": state, input, context
      async execute(
        @state() estado: EstadoDeTeste,
        @input() args: { path: string },
        @context() ctx: AgentContext,
      ) {
        visto.args = args;
        visto.estado = estado;
        visto.temCtx = typeof ctx?.state?.append === "function";
        estado.visitados.push(args.path);
        return "ok";
      }
    }

    const provider = new FakeProvider([
      { tool: { name: "ler", arguments: { path: "a.ts" } } },
    ]);
    const Fluxo = criarWorkflow(
      [criarAgente({ provider, tools: [LerTool] })],
      EstadoDeTeste,
    );

    await runWorkflow(Fluxo, "vai");

    expect(visto.args).toEqual({ path: "a.ts" });
    expect(visto.temCtx).toBe(true);
    expect(visto.estado?.visitados).toEqual(["a.ts"]);
  });

  it("sem decorator nenhum, o execute recebe só os argumentos", async () => {
    let recebido: unknown;

    @Tool({ name: "ler", description: "lê", schema })
    class LerTool {
      async execute(args: { path: string }) {
        recebido = args;
        return "ok";
      }
    }

    const provider = new FakeProvider([
      { tool: { name: "ler", arguments: { path: "b.ts" } } },
    ]);
    const Fluxo = criarWorkflow([criarAgente({ provider, tools: [LerTool] })]);

    await runWorkflow(Fluxo, "vai");

    expect(recebido).toEqual({ path: "b.ts" });
  });

  it("o estado injetado na tool é a MESMA instância que o until do loop lê", async () => {
    @Tool({ name: "aprovar", description: "aprova", schema: z.object({}) })
    class AprovarTool {
      async execute(@state() estado: EstadoDeTeste) {
        estado.aprovado = true;
        return "aprovado";
      }
    }

    const provider = new FakeProvider([
      { tool: { name: "aprovar", arguments: {} } },
    ]);

    let visto: EstadoDeTeste | undefined;
    const Fluxo = criarWorkflow(
      [
        loop({
          steps: [criarAgente({ provider, tools: [AprovarTool] })],
          until: (_ctx, s: EstadoDeTeste) => {
            visto = s;
            return s.aprovado;
          },
          maxIterations: 5,
        }),
      ],
      EstadoDeTeste,
    );

    await runWorkflow(Fluxo, "vai");

    // Se fossem instâncias diferentes, `aprovado` seria `false` aqui e o loop
    // teria rodado as 5 voltas.
    expect(visto?.aprovado).toBe(true);
    expect(provider.chamadas).toHaveLength(1);
  });
});

describe("@state no construtor do agente", () => {
  it("recebe a mesma instância que o until do loop enxerga", async () => {
    const provider = new FakeProvider([
      { content: "AJUSTAR" },
      { content: "APROVADO" },
    ]);

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class Revisor {
      constructor(@state() private readonly estado: EstadoDeTeste) {}
      async afterResponse(resposta: string) {
        this.estado.visitados.push(resposta);
        this.estado.aprovado = /APROVADO/.test(resposta);
      }
    }

    let visto: EstadoDeTeste | undefined;

    @Workflow({
      state: EstadoDeTeste,
      steps: [
        loop({
          steps: [Revisor],
          until: (_ctx, s: EstadoDeTeste) => {
            visto = s;
            return s.aprovado;
          },
          maxIterations: 5,
        }),
      ],
    })
    class Fluxo {}

    await runWorkflow(Fluxo, "vai");

    // Duas voltas: reprova, depois aprova. Se a instância não fosse a mesma,
    // o loop iria até o teto de 5.
    expect(visto?.aprovado).toBe(true);
    expect(visto?.visitados).toEqual(["AJUSTAR", "APROVADO"]);
    expect(provider.chamadas).toHaveLength(2);
  });

  it("uma instância de estado por execução — runs não compartilham", async () => {
    const fazerFluxo = () => {
      const provider = new FakeProvider([{ content: "APROVADO" }]);

      @Agent({ provider, prompt: PROMPT, tools: [] })
      class Revisor {
        constructor(@state() private readonly estado: EstadoDeTeste) {}
        async afterResponse(r: string) {
          this.estado.visitados.push(r);
        }
      }
      return { Revisor };
    };

    const { Revisor } = fazerFluxo();
    const vistos: EstadoDeTeste[] = [];

    @Workflow({
      state: EstadoDeTeste,
      steps: [
        loop({
          steps: [Revisor],
          until: (_ctx, s: EstadoDeTeste) => {
            vistos.push(s);
            return true;
          },
        }),
      ],
    })
    class Fluxo {}

    await runWorkflow(Fluxo, "um");
    await runWorkflow(Fluxo, "dois");

    expect(vistos).toHaveLength(2);
    expect(vistos[0]).not.toBe(vistos[1]);
    expect(vistos[0].visitados).toEqual(["APROVADO"]);
    expect(vistos[1].visitados).toEqual(["APROVADO"]);
  });
});

describe("mensagens de erro da injeção", () => {
  it("@context() no construtor explica que o contexto ainda não existe", async () => {
    const provider = new FakeProvider();

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class Cedo {
      constructor(@context() private readonly ctx: AgentContext) {}
    }

    @Workflow({ steps: [Cedo] })
    class Fluxo {}

    await expect(runWorkflow(Fluxo, "vai")).rejects.toThrow(
      /@context\(\).*ainda\s+não existe quando a classe é construída/s,
    );
  });

  it("@state() sem state no @Workflow diz o que acrescentar", async () => {
    const provider = new FakeProvider();

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class PedeEstado {
      constructor(@state() private readonly s: EstadoDeTeste) {}
    }

    @Workflow({ steps: [PedeEstado] })
    class Fluxo {}

    await expect(runWorkflow(Fluxo, "vai")).rejects.toThrow(
      /nenhum estado.*state: MinhaClasse/s,
    );
  });

  it("@memory(Store) com store não registrado nomeia a classe", async () => {
    const provider = new FakeProvider();

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class PedeMemoria {
      constructor(@memory(FakeVectorStoreB) private readonly m: VectorMemory) {}
    }

    @Workflow({ steps: [PedeMemoria] })
    class Fluxo {}

    const app = await bootstrapWorkflow(Fluxo, { memory: [FakeVectorStore] });

    await expect(app.run({ input: { message: "vai" } })).rejects.toThrow(
      /@memory\(FakeVectorStoreB\).*não está.*registrado/s,
    );
    await app.dispose();
  });
});
