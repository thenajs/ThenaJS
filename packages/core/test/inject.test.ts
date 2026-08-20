import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  Tool,
  Workflow,
  Thena,
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
  makeAgent,
  makeWorkflow,
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
    const visto: { args: unknown; temCtx: boolean; workflowState?: EstadoDeTeste } = {
      args: undefined,
      temCtx: false,
    };

    @Tool({ name: "ler", description: "lê", schema })
    class LerTool {
      // de propósito fora da ordem "natural": state, input, context
      async execute(
        @state() workflowState: EstadoDeTeste,
        @input() args: { path: string },
        @context() ctx: AgentContext,
      ) {
        visto.args = args;
        visto.workflowState = workflowState;
        visto.temCtx = typeof ctx?.state?.append === "function";
        workflowState.visitados.push(args.path);
        return "ok";
      }
    }

    const provider = new FakeProvider([
      { tool: { name: "ler", arguments: { path: "a.ts" } } },
    ]);
    const Fluxo = makeWorkflow(
      [makeAgent({ provider, tools: [LerTool] })],
      EstadoDeTeste,
    );

    await runWorkflow(Fluxo, "vai");

    expect(visto.args).toEqual({ path: "a.ts" });
    expect(visto.temCtx).toBe(true);
    expect(visto.workflowState?.visitados).toEqual(["a.ts"]);
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
    const Fluxo = makeWorkflow([makeAgent({ provider, tools: [LerTool] })]);

    await runWorkflow(Fluxo, "vai");

    expect(recebido).toEqual({ path: "b.ts" });
  });

  it("o estado injetado na tool é a MESMA instância que o until do loop lê", async () => {
    @Tool({ name: "aprovar", description: "aprova", schema: z.object({}) })
    class AprovarTool {
      async execute(@state() workflowState: EstadoDeTeste) {
        workflowState.aprovado = true;
        return "aprovado";
      }
    }

    const provider = new FakeProvider([{ tool: { name: "aprovar", arguments: {} } }]);

    let visto: EstadoDeTeste | undefined;
    const Fluxo = makeWorkflow(
      [
        loop({
          steps: [makeAgent({ provider, tools: [AprovarTool] })],
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
      constructor(@state() private readonly workflowState: EstadoDeTeste) {}
      async afterResponse(response: string) {
        this.workflowState.visitados.push(response);
        this.workflowState.aprovado = /APROVADO/.test(response);
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
        constructor(@state() private readonly workflowState: EstadoDeTeste) {}
        async afterResponse(r: string) {
          this.workflowState.visitados.push(r);
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
      /@context\(\).*does not exist yet when the class is constructed/s,
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
      /no state declared.*state: MyClass/s,
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

    const app = Thena.create(Fluxo, { stores: [FakeVectorStore] });

    await expect(app.run({ input: { message: "vai" } })).rejects.toThrow(
      /@memory\(FakeVectorStoreB\).*not registered/s,
    );
    await app.dispose();
  });
});
