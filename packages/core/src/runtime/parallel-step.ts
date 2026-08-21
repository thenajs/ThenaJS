import { StateManager } from "@thenajs/agentflow";
import type { Message, PipelineContext, Step } from "@thenajs/agentflow";
import { currentRun, withRun } from "../run-context.js";
import type { RunContext } from "../run-context.js";

/**
 * O bloco `parallel`, composto pelo **core** e não pelo `Pipeline.parallel` do
 * engine.
 *
 * O engine oferece o mecanismo (`Promise.all` sobre um ctx). Ordem de anexação e
 * isolamento entre ramos são *política*, e por ADR-001 política mora aqui. O
 * `Pipeline.parallel` continua existindo e exportado; ele é o combinador cru,
 * para quem monta um pipeline na mão.
 *
 * Três garantias, e cada uma existe por um defeito medido (ADR-022, ADR-023):
 *
 * 1. **Todos os ramos leem o mesmo histórico.** Um snapshot no início do bloco.
 *    Antes, o isolamento era acidental — funcionava porque todo ramo lia antes
 *    do primeiro `await` — e um `beforePrompt` que consultasse um cache já fazia
 *    o segundo ramo enxergar a resposta do primeiro.
 * 2. **A anexação é na ordem de declaração.** Cada ramo escreve num histórico
 *    próprio e os deltas entram no fim, na ordem do array. Antes era a ordem de
 *    conclusão: `parallel([lento, rapido])` produzia `rapido, lento`, e isso
 *    mudava a cada execução conforme a latência do modelo.
 * 3. **Um ramo que falha cancela os irmãos.** Antes eles seguiam até o fim,
 *    gastando tokens e escrevendo no estado de uma execução que já havia
 *    rejeitado.
 */

/**
 * Campos que o runtime monta no ctx do passo e que **não** voltam do ramo para
 * o pai. `signal` é o caso que importa: cada ramo tem o seu, composto com o do
 * bloco, e devolvê-lo ao pai deixaria o ctx da execução carregando o
 * cancelamento de um ramo que já terminou.
 */
const RUNTIME_OWNED = new Set([
  "state",
  "logs",
  "runId",
  "signal",
  "data",
  "usage",
  "abort",
  "stop",
  "onDispose",
  "meta",
]);

export function buildParallelStep(
  branches: Step<PipelineContext>[],
): Step<PipelineContext> {
  return async (ctx) => {
    const run = currentRun();
    const parent = ctx as PipelineContext & Record<string, unknown>;

    // O histórico como está agora. Todo ramo parte daqui e nenhum vê o que os
    // outros escreveram — nem se esperar antes de ler.
    const snapshot: Message[] = [...parent.state.history];

    // Cancela os irmãos quando um ramo lança. Composto com o signal da run, para
    // que abortar a execução inteira continue alcançando os ramos.
    const block = new AbortController();
    let firstError: unknown;

    const branchCtxs = branches.map(() => {
      // Um `StateManager` de verdade por ramo, em vez de uma fachada: as
      // leituras, o `set("history", …)` do padrão "não polua o transcript" e o
      // `toMessages()` continuam funcionando sem nenhum caso especial.
      //
      // `tasks` e `memory` seguem **compartilhados por referência**: são o ponto
      // de coleta que a documentação recomenda, e isolá-los quebraria o padrão
      // fan-out → coleta que já funciona hoje.
      const state = new StateManager();
      state.state = {
        ...parent.state.state,
        history: [...snapshot],
      };
      return { ...parent, state } as PipelineContext & Record<string, unknown>;
    });

    // Callback `async`, e não `.catch()` no retorno: um `Step` pode ser
    // síncrono, e um ramo que lançasse **sincronamente** estouraria dentro do
    // próprio `map` — deixando órfãos exatamente os irmãos que já tivessem
    // começado. O `async` transforma o throw síncrono em rejeição.
    const tasks = branches.map(async (branch, i) => {
      const branchRun: RunContext = {
        ...run,
        signal: run.signal ? AbortSignal.any([run.signal, block.signal]) : block.signal,
        // Cada ramo tem o seu `step`. Sem isto, uma tool que chame `context()`
        // receberia o ctx de quem escreveu por último — `run.step` é um campo
        // único (run-context.ts), e hoje o `parallel` só acerta porque todos os
        // ramos compartilham um ctx.
        step: undefined,
      };

      try {
        return await withRun(branchRun, () => branch(branchCtxs[i]));
      } catch (err) {
        firstError ??= err;
        // Aborta na primeira rejeição, e não depois do `allSettled`: o objetivo
        // é parar de pagar por trabalho cujo resultado já será descartado.
        block.abort(err);
        throw err;
      }
    });

    // `allSettled` e não `all`: com `all`, o bloco resolveria enquanto os irmãos
    // ainda estivessem escrevendo — que era metade do problema de ramo órfão.
    await Promise.allSettled(tasks);

    if (firstError !== undefined) {
      // Nada é fundido: a execução falhou, e mesclar o que os ramos alcançaram
      // deixaria o histórico com metade de um bloco que não aconteceu.
      throw firstError;
    }

    for (const branch of branchCtxs) {
      // O delta pelo tamanho: o que o ramo acrescentou ao snapshot. Um ramo que
      // encurta o próprio histórico (`set("history", h.slice(0, -1))`, o padrão
      // de manter o ramo fora do transcript) contribui com nada, que é
      // exatamente o pedido.
      const branchHistory = branch.state.history;
      if (branchHistory.length > snapshot.length) {
        for (const message of branchHistory.slice(snapshot.length)) {
          parent.state.append("history", message);
        }
      }

      // O que o ramo escreveu no ctx volta para o pai — é assim que o padrão
      // `ctx.security = resposta` da documentação funciona. Chaves distintas
      // convivem; em conflito, **o último declarado vence**, inclusive para
      // `output` e `turn`.
      for (const key of Object.keys(branch)) {
        if (RUNTIME_OWNED.has(key)) continue;
        if (branch[key] !== parent[key]) parent[key] = branch[key];
      }
    }

    return parent;
  };
}
