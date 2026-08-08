import { Pipeline, StateManager } from "@thenajs/agentflow";
import { getWorkflowMetadata } from "../decorators/metadata.js";
import {
  childRunContext,
  runCleanups,
  newRunContext,
  peekRun,
  throwIfAborted,
  withRun,
} from "../run-context.js";
import type { RunBudget } from "../budget.js";
import type { WorkflowInput } from "../types.js";
import { buildAgentStep } from "./agent-step.js";
import { compileStep } from "./compile.js";

/** Deriva a string inicial do pipeline a partir do `input` do workflow. */
export function toInitial(input: WorkflowInput): string {
  return typeof input.message === "string" ? input.message : JSON.stringify(input);
}

/**
 * Executa um único agente. Toda a orquestração (pipeline, estado, contexto)
 * fica no `@thenajs/agentflow`; o framework só monta as peças a partir
 * dos metadados do `@Agent`.
 */
export async function run<T = string>(AgentClass: Function, input: string): Promise<T> {
  // Dentro de uma run já em curso, reaproveita o contexto: um agente avulso é
  // mais um turno da mesma execução, e deve contar no orçamento dela. Fora de
  // qualquer run, abre um contexto de topo.
  const runCtx = peekRun() ?? newRunContext();

  return withRun(runCtx, async () => {
    const pipeline = new Pipeline(new StateManager());
    pipeline.new([buildAgentStep(AgentClass)]);
    const ctx = await pipeline.run(input);
    return ctx.output as T;
  });
}

/**
 * Executa um workflow: os passos rodam num único pipeline, compartilhando o
 * mesmo estado. Passos podem ser agentes (sequenciais), blocos `parallel` ou
 * `loop`. A saída do último passo é retornada.
 *
 * `memory` é o contexto inicial semeado no estado (`state.memory`) antes da
 * execução — disponível para os agentes e para os `until` dos loops.
 */
export async function runWorkflow<T = string>(
  WorkflowClass: Function,
  input: string,
  memory?: unknown,
  runBudget?: RunBudget,
): Promise<T> {
  // Uma run aninhada (tool que dispara outro workflow) herda id, recorder e
  // settings do pai. Sem `runBudget`, herda também o teto — um sub-workflow
  // não é uma forma de sair do orçamento da run. Chamado fora de qualquer run,
  // abre um contexto de topo com os defaults.
  const parent = peekRun();
  const runCtx = parent
    ? childRunContext(parent, runBudget)
    : newRunContext({ budget: runBudget });

  return withRun(runCtx, async () => {
    const meta = getWorkflowMetadata(WorkflowClass);
    const state = new StateManager();
    if (memory !== undefined) {
      // `memory` do estado é string[]; serializa contexto não-textual.
      state.append(
        "memory",
        typeof memory === "string" ? memory : JSON.stringify(memory),
      );
    }
    // Uma instância por execução: os valores iniciais são as inicializações de
    // campo da classe, e todos os passos veem o mesmo objeto.
    const workflowState = meta.state ? new meta.state() : undefined;

    const pipeline = new Pipeline(state);
    // A compilação acontece **dentro** do escopo de propósito: `buildAgentStep`
    // instancia provider, tools e agente, e resolve as memórias vetoriais lendo
    // `currentRun().settings`. Compilar fora — como era antes — faria o
    // `memory` do ThenaConfig ser ignorado em silêncio.
    pipeline.new(meta.steps.map((s) => compileStep(s, pipeline, workflowState)));

    return runCtx.recorder.around("workflow", WorkflowClass.name, async (node) => {
      const antes = runCtx.budget.usage();
      try {
        const ctx = await pipeline.run(input);
        // O cancelamento é checado **entre** passos. Sem esta última checagem,
        // um `ctx.abort()` no passo final não teria mais ninguém para notá-lo,
        // e a run resolveria normalmente — cancelamento silenciosamente
        // ignorado é pior do que não ter cancelamento.
        throwIfAborted(runCtx);
        return ctx.output as T;
      } finally {
        // Antes da telemetria: uma limpeza pode gastar (fechar conexão, gravar
        // algo), e o nó deve refletir o que a execução custou de verdade.
        await runCleanups(runCtx);

        // O **delta**, e não o acumulado: uma run aninhada compartilha o
        // tracker do pai, então ler o acumulado aqui atribuiria ao
        // sub-workflow o que quem o chamou já tinha gasto. Na run de topo o
        // ponto de partida é zero e o delta é o próprio acumulado.
        //
        // No nó mesmo quando a run falha — o consumo já aconteceu.
        const agora = runCtx.budget.usage();
        runCtx.recorder.meta(node, {
          chatCalls: agora.chatCalls - antes.chatCalls,
          toolCalls: agora.toolCalls - antes.toolCalls,
          tokens: agora.tokens - antes.tokens,
          costUsd: agora.costUsd - antes.costUsd,
          elapsedMs: agora.elapsedMs - antes.elapsedMs,
          exceeded: runCtx.budget.exceeded(),
        });
      }
    });
  });
}
