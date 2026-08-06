import type {
  LoopFailure,
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

/** Voltas antes de desistir, quando `maxIterations` não é informado. */
export const MAX_ITERATIONS_PADRAO = 10;

/** Falhas de tool seguidas antes de desistir, quando `maxFails` não é informado. */
export const MAX_FAILS_PADRAO = 5;

/**
 * Bloco de repetição: executa `steps` até `until(ctx)` ser verdadeiro.
 *
 * Três freios, e **os dois primeiros vêm ligados** — um loop sem teto gasta o
 * cartão de quem usa o framework, então ilimitado não pode ser o default:
 *
 * - `maxIterations` (default 10) — o loop não converge. Marca o loop como
 *   *exausto*: `onExhausted` é chamado e `ctx.loop.exhausted` fica `true`.
 * - `maxFails` (default 5) — o agente está **preso**, repetindo a mesma falha
 *   de tool. Conta falhas **consecutivas**: uma tool que funciona zera a
 *   contagem, então um agente que erra e corrige não é punido.
 * - `budget` da run — o teto global de tempo, chamadas, tokens e custo.
 *
 * `Infinity` desliga qualquer um dos dois primeiros, se você souber o que está
 * fazendo. O nó `loop` do report registra `stoppedBy`, para "convergiu" e
 * "desistiu" não ficarem indistinguíveis.
 *
 * ```ts
 * loop({
 *   steps: [ExplorerAgent],
 *   until: untilAnswered,
 *   maxFails: 3,
 *   onFail: (ctx, { consecutive, toolName }) =>
 *     logger.warn(`${toolName} falhou ${consecutive}x seguidas`),
 * })
 * ```
 */
export function loop(options: {
  steps: WorkflowStep[];
  until: (ctx: WorkflowContext, state?: any) => unknown;
  maxIterations?: number;
  onExhausted?: (
    ctx: WorkflowContext,
    iterations: number,
  ) => unknown | Promise<unknown>;
  maxFails?: number;
  onFail?: (
    ctx: WorkflowContext,
    info: LoopFailure,
  ) => unknown | Promise<unknown>;
}): LoopStep {
  return {
    kind: "loop",
    steps: options.steps,
    until: options.until,
    // Os defaults ficam aqui, e não no `Pipeline.loop` do engine: o `loop()` é
    // a API de quem escreve workflow, enquanto o `Pipeline` é a primitiva crua
    // — mudar o default de lá alteraria o comportamento de quem a usa direto.
    maxIterations: options.maxIterations ?? MAX_ITERATIONS_PADRAO,
    onExhausted: options.onExhausted,
    // `Math.max(1, …)` pelo mesmo motivo do `maxAttempts` do retry: `0` não
    // deve virar nem "ilimitado" nem uma comparação que para sem ter falhado.
    maxFails: Math.max(1, options.maxFails ?? MAX_FAILS_PADRAO),
    onFail: options.onFail,
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

/**
 * `true` se o loop mais recente parou por `maxIterations`, não porque `until`
 * ficou verdadeiro. Em loops aninhados o último a terminar vence; para o dado
 * aninhado, leia `data.exhausted` dos nós `loop` do report.
 */
export function wasExhausted(ctx: WorkflowContext): boolean {
  return ctx.loop?.exhausted ?? false;
}
