import { currentRun, peekRun, requestStop } from "./run-context.js";
import type { RunContext } from "./run-context.js";
import type { Context } from "./types.js";

/**
 * Campos que só existem **dentro de um passo**.
 *
 * Fora dele — numa factory de provider, por exemplo — o pipeline ainda não
 * começou e não há `state` nem `turn` para entregar.
 */
const STEP_ONLY_FIELDS = ["state", "output", "turn", "loop", "logs"] as const;

/**
 * O contexto visto de fora de um passo.
 *
 * Devolve o que vale para a execução inteira e **lança** no que é do passo. A
 * alternativa seria marcar `state` como opcional, e aí toda tool — onde ele
 * sempre existe — pagaria um `?.` por um erro que só acontece num lugar. Falhar
 * alto com uma mensagem que ensina é a mesma escolha que o `currentRun()` já
 * fazia para quem o chamava fora de uma execução.
 */
function runOnlyView(run: RunContext): Context {
  const fail = (field: string) =>
    new Error(
      `[thena] \`context().${field}\` only exists inside a step. Here the run ` +
        `has started but the pipeline has not — this is what happens in a ` +
        `provider factory. Use \`data\`, \`runId\`, \`signal\` or \`usage()\`, ` +
        `which are available from \`run()\` onwards.`,
    );

  const view = {
    runId: run.runId,
    data: run.data,
    signal: run.signal!,
    usage: () => run.budget.usage(),
    abort: (reason?: unknown) => run.abort(reason),
    stop: () => requestStop(run),
    onDispose: (fn: () => void | Promise<void>) => void run.cleanups.push(fn),
    meta: (data: Record<string, unknown>) => run.recorder.currentMeta(data),
  } as unknown as Context;

  for (const field of STEP_ONLY_FIELDS) {
    Object.defineProperty(view, field, {
      get: () => {
        throw fail(field);
      },
      configurable: true,
    });
  }

  return view;
}

/**
 * O contexto da execução em curso: o do passo, se houver um, senão o da run.
 *
 * Lança fora de qualquer execução — é bug do chamador, não estado válido.
 */
export function resolveContext(): Context {
  const run = currentRun();
  return run.step ?? runOnlyView(run);
}

/** O mesmo, sem lançar — para quem precisa decidir se há execução. */
export function peekContext(): Context | undefined {
  const run = peekRun();
  return run ? (run.step ?? runOnlyView(run)) : undefined;
}
