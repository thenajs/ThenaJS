import { currentRun, peekRun, pedirParada } from "./run-context.js";
import type { RunContext } from "./run-context.js";
import type { Context } from "./types.js";

/**
 * Campos que só existem **dentro de um passo**.
 *
 * Fora dele — numa factory de provider, por exemplo — o pipeline ainda não
 * começou e não há `state` nem `turn` para entregar.
 */
const DO_PASSO = ["state", "output", "turn", "loop", "logs"] as const;

/**
 * O contexto visto de fora de um passo.
 *
 * Devolve o que vale para a execução inteira e **lança** no que é do passo. A
 * alternativa seria marcar `state` como opcional, e aí toda tool — onde ele
 * sempre existe — pagaria um `?.` por um erro que só acontece num lugar. Falhar
 * alto com uma mensagem que ensina é a mesma escolha que o `currentRun()` já
 * fazia para quem o chamava fora de uma execução.
 */
function vistaDaRun(run: RunContext): Context {
  const erro = (campo: string) =>
    new Error(
      `[thena] \`context().${campo}\` só existe dentro de um passo. Aqui a ` +
        `execução já começou, mas o pipeline ainda não — é o caso de uma ` +
        `factory de provider. Use \`data\`, \`runId\`, \`signal\` ou ` +
        `\`usage()\`, que valem desde o \`run()\`.`,
    );

  const vista = {
    runId: run.runId,
    data: run.data,
    signal: run.signal!,
    usage: () => run.budget.usage(),
    abort: (reason?: unknown) => run.abort(reason),
    stop: () => pedirParada(run),
    onDispose: (fn: () => void | Promise<void>) => void run.descartes.push(fn),
    meta: (dados: Record<string, unknown>) => run.recorder.metaAtual(dados),
  } as unknown as Context;

  for (const campo of DO_PASSO) {
    Object.defineProperty(vista, campo, {
      get: () => {
        throw erro(campo);
      },
      configurable: true,
    });
  }

  return vista;
}

/**
 * O contexto da execução em curso: o do passo, se houver um, senão o da run.
 *
 * Lança fora de qualquer execução — é bug do chamador, não estado válido.
 */
export function resolverContexto(): Context {
  const run = currentRun();
  return run.passo ?? vistaDaRun(run);
}

/** O mesmo, sem lançar — para quem precisa decidir se há execução. */
export function peekContexto(): Context | undefined {
  const run = peekRun();
  return run ? (run.passo ?? vistaDaRun(run)) : undefined;
}
