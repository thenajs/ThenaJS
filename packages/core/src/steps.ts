import type {
  LoopStep,
  ParallelStep,
  TurnInfo,
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

// --------------------------------------------------------------------------
// Leitura do último turno — para condições de `until` sem boilerplate.
// --------------------------------------------------------------------------

/** Resumo do último turno do agente (undefined se nenhum agente rodou ainda). */
export function turnOf(ctx: WorkflowContext): TurnInfo | undefined {
  return ctx.turn;
}

/** `true` se o último turno do agente executou uma tool. */
export function calledTool(ctx: WorkflowContext): boolean {
  return ctx.turn?.calledTool ?? false;
}

/**
 * `until` pronto: para o loop quando o agente respondeu **sem** chamar tool
 * (padrão ReAct — "repita enquanto usa tools; pare quando responder").
 *
 * Pensado para loops de **um** agente. Em `parallel` dentro de loop, vários
 * agentes gravam `ctx.turn` e o último vence — nesse caso escreva um `until`
 * próprio. Sem turno registrado, retorna `true` (para o loop) por segurança.
 */
export const untilAnswered = (ctx: WorkflowContext): boolean => !calledTool(ctx);
