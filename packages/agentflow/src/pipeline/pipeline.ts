import { StateManager } from "../state/index.js";
import {
  LoopOptions,
  ParallelOptions,
  PipelineContext,
  Step,
} from "./pipeline.types.js";

export class Pipeline<C extends PipelineContext> {
  private steps: Step<C>[] = [];

  constructor(private stateManager: StateManager) {}

  new(steps: Step<C>[]) {
    this.steps = steps;
    return this;
  }

  private createContext(): C {
    return {
      state: this.stateManager,
      logs: [],
    } as unknown as C;
  }

  async run(initial: string): Promise<C> {
    let ctx = this.createContext();
    // injeta a mensagem inicial do usuário como primeiro turno da conversa
    ctx.state.append("history", { role: "user", content: initial });

    for (const step of this.steps) {
      ctx = await step(ctx);
    }

    return ctx;
  }

  parallel(options: ParallelOptions<C>): Step<C> {
    return async (ctx) => {
      // executa tudo ao mesmo tempo, compartilhando state
      await Promise.all(options.steps.map((step) => step(ctx)));

      return ctx;
    };
  }

  loop(options: LoopOptions<C>): Step<C> {
    return async (ctx) => {
      // `?? Infinity` em vez de guard de truthiness: `maxIterations: 0`
      // deixa de significar "ilimitado".
      const max = options.maxIterations ?? Infinity;
      let iterations = 0;
      let exhausted = false;

      while (true) {
        iterations++;

        for (const step of options.steps) {
          ctx = await step(ctx);
        }

        if (await options.until(ctx)) break;

        if (iterations >= max) {
          exhausted = true;
          break;
        }
      }

      if (exhausted) {
        await options.onExhausted?.(ctx, iterations);
      }

      // Torna a parada legível para quem consome o run (telemetria honesta:
      // "convergiu" e "bateu no teto" deixam de ser indistinguíveis).
      ctx.loop = { iterations, exhausted, maxIterations: options.maxIterations };

      return ctx;
    };
  }
}
