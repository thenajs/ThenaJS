import { StateManager } from "../state/index.js";
import { LoopOptions, ParallelOptions, PipelineContext, Step } from "./pipeline.types.js";


export class Pipeline<C extends PipelineContext> {
    private steps: Step<C>[] = [];

    constructor(private stateManager: StateManager) { }

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
            await Promise.all(
                options.steps.map(step => step(ctx))
            );

            return ctx;
        };
    }

    loop(options: LoopOptions<C>): Step<C> {
        return async (ctx) => {
            let iterations = 0;

            while (true) {
                iterations++;

                for (const step of options.steps) {
                    ctx = await step(ctx);
                }

                if (await options.until(ctx)) break;

                if (
                    options.maxIterations &&
                    iterations >= options.maxIterations
                ) {
                    break;
                }
            }

            return ctx;
        };
    }
}