import type {
  LoopStep,
  ParallelStep,
  WorkflowContext,
  WorkflowStep,
} from "./types.js";

/**
 * Bloco paralelo: os passos rodam concorrentes sobre o mesmo contexto.
 * Use para agentes independentes — todos recebem a mesma entrada e a leitura
 * dos resultados costuma ser feita em `ctx.state`, não em `ctx.output`.
 */
export function parallel(steps: WorkflowStep[]): ParallelStep {
  return { kind: "parallel", steps };
}

/**
 * Bloco de repetição: executa `steps` até `until(ctx)` ser verdadeiro
 * (ou atingir `maxIterations`).
 */
export function loop(options: {
  steps: WorkflowStep[];
  until: (ctx: WorkflowContext) => unknown;
  maxIterations?: number;
}): LoopStep {
  return {
    kind: "loop",
    steps: options.steps,
    until: options.until,
    maxIterations: options.maxIterations,
  };
}
